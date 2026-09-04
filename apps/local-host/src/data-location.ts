/**
 * 数据目录的**指针与搬家**（owner 2026-09-04 定；TD-039 由「界面内不给改」改写
 * 为「重启期迁移」）。
 *
 * 为什么必须在重启时搬，而不是运行中搬：搬的是一堆**已加密的库**，运行中每个
 * 项目库都被 SQLCipher 打开着，还带着 `-wal`。中途失败会留下两份加密数据，而
 * 两份加密数据比没有更糟 —— 哪份是真的、哪把钥匙对应哪份，用户无从判断。放到
 * 进程启动、**开任何库之前**做，就没有任何句柄，也不存在半开半搬的状态。
 *
 * 这一版的不变量，按重要性排：
 *
 * 1. **任何时刻都只有一份权威。** 跨盘时源在删除之前一直是权威（先复制、逐文件
 *    核对大小与摘要、写下 `done` 标记，才回头删源）；同盘走逐项改名，中途失败
 *    则把已经改过名的**原路搬回**，回到出发状态。
 * 2. **断电可判定。** 目标里的 `.ruyin-move` 记着来源与状态：`copying` 说明上次
 *    没走完，那份半成品会被丢弃重来（丢的是副本，源还在）；`done` 说明数据其实
 *    已经在目标这边了，这一次要做的是**接着把尾巴收完**，绝不是把目标删掉。
 * 3. **不搬缓存。** `chromium/` 是 Electron 的缓存，删了会自己长回来 —— 它通常
 *    是整棵树里最大的一块，搬它只是拿风险换等待。
 * 4. **不跨用户、不跨机器。** 主密钥由 DPAPI 按用户作用域封装，换个 Windows
 *    用户就解不开。这里搬的是「同一个用户换个盘」；别的场景要导出，不是搬移。
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join, relative, resolve } from "node:path";

/** 搬家时**不带走**的东西：缓存，删了自己会长回来。 */
const SKIP = new Set(["chromium"]);
/** 目标目录里的搬家标记。 */
const MARKER = ".ruyin-move";
/** 留出的余量：复制期间盘上还有别的进程在写。 */
const HEADROOM = 1.1;

export interface MoveOutcome {
  status: "moved" | "failed" | "none";
  from?: string;
  to?: string;
  at?: string;
  /** 失败时的原话。给用户看的，所以说的是发生了什么，不是错误码。 */
  reason?: string;
}

export interface LocationFile {
  /** 当前生效的数据目录。没有这一条时由调用方决定默认值。 */
  dataDir?: string;
  /** 待搬到的目标目录。有它就意味着「下次启动时搬」。 */
  pending?: string;
  /**
   * 要搬多少字节（排队那一刻算的）。**壳读它决定等多久** —— 搬家发生在守护
   * 进程开库之前，壳只能等；等多久不能是一个常数（见 shell 的
   * migration-wait.ts：原来那个固定 15 秒会在数据超过约 180 MB 时把启动judge
   * 成失败）。
   */
  pendingBytes?: number;
  /** 上一次搬家的结果 —— 重启后界面要能说清楚成没成。 */
  lastMove?: MoveOutcome;
}

interface Marker {
  from: string;
  at: string;
  state: "copying" | "done";
  /** 同盘改名时已经搬过去的条目 —— 断电后靠它把尾巴收完。 */
  names?: string[];
}

export function readLocation(file: string): LocationFile {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as LocationFile;
    return typeof raw === "object" && raw !== null ? raw : {};
  } catch {
    // 没有这个文件、或者它被写坏了：都按「还没搬过家」处理。这个文件里只有一个
    // 路径，重建的代价是零，为它把应用卡住是不成比例的。
    return {};
  }
}

export function writeLocation(file: string, next: LocationFile): void {
  mkdirSync(resolve(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify(next, null, 2));
}

function readMarker(dir: string): Marker | undefined {
  try {
    const m = JSON.parse(readFileSync(join(dir, MARKER), "utf8")) as Marker;
    return m.state === "copying" || m.state === "done" ? m : undefined;
  } catch {
    return undefined;
  }
}

/** `b` 是不是在 `a` 里面（含相等）。用来挡住「搬进自己肚子里」。 */
function contains(a: string, b: string): boolean {
  const rel = relative(a, b);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export interface CheckResult {
  ok: boolean;
  /** 不行的时候，为什么不行 —— 一句给用户看的话。 */
  reason?: string;
  /** 同一个卷（可以原子改名），还是跨卷（要复制 + 核对）。 */
  sameVolume?: boolean;
  /** 要搬的字节数（不含缓存）。 */
  bytes?: number;
  /** 目标那边还剩多少可用空间。 */
  freeBytes?: number;
}

/** 目录树大小（跳过缓存）。 */
export function treeSize(dir: string): number {
  let total = 0;
  const walk = (d: string, top: boolean) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (top && SKIP.has(e.name)) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p, false);
      else if (e.isFile()) total += statSync(p).size;
    }
  };
  if (existsSync(dir)) walk(dir, true);
  return total;
}

function freeSpace(dir: string): number | undefined {
  try {
    const fs = statfsSync(dir);
    return Number(fs.bavail) * Number(fs.bsize);
  } catch {
    // 问不到就不拿它拦人：空间不够会在复制那一步真实地失败，而那一步是可回滚的。
    return undefined;
  }
}

/**
 * 能不能搬到那儿去。**没有任何副作用**（除了一个立刻删掉的探针文件）—— 界面在
 * 用户按下确认之前先问这一句，搬家真的开始之前再问一次：中间隔着一次重启，
 * 世界可能已经变了。
 */
export function checkTarget(from: string, to: string): CheckResult {
  if (!to.trim()) return { ok: false, reason: "还没填目标目录。" };
  if (!isAbsolute(to)) {
    return { ok: false, reason: "要写完整路径（例如 D:\\RuyinData），不是相对路径。" };
  }
  const src = resolve(from);
  const dst = resolve(to);
  if (src === dst) return { ok: false, reason: "目标就是当前目录，不用搬。" };
  if (contains(src, dst)) {
    return { ok: false, reason: "目标在当前数据目录里面 —— 那等于把数据搬进它自己。" };
  }
  if (contains(dst, src)) {
    return { ok: false, reason: "当前数据目录在目标里面 —— 那等于把数据搬进它自己的上级。" };
  }

  const parent = resolve(dst, "..");
  if (existsSync(dst)) {
    let st;
    try {
      st = statSync(dst);
    } catch (e) {
      return { ok: false, reason: `打不开目标目录：${(e as Error).message}` };
    }
    if (!st.isDirectory()) return { ok: false, reason: "目标是一个文件，不是目录。" };
    // 非空目录不接：搬进别人家里，出问题时分不清哪些文件是谁的。
    const rest = readdirSync(dst).filter((n) => n !== MARKER);
    if (rest.length > 0) {
      return { ok: false, reason: "目标目录里已经有东西了。请选一个空目录，或者新建一个。" };
    }
  } else if (!existsSync(parent)) {
    return { ok: false, reason: "目标的上级目录不存在。先建好它，或者换一个位置。" };
  }

  // 真写一下：只读盘、权限不足、被安全软件挡住，都要在用户按确认之前就说出来，
  // 而不是等到重启之后才发现。
  const probeDir = existsSync(dst) ? dst : parent;
  const probe = join(probeDir, `.ruyin-write-probe-${Date.now()}`);
  try {
    writeFileSync(probe, "probe");
  } catch (e) {
    return { ok: false, reason: `目标目录不可写：${(e as Error).message}` };
  } finally {
    quietRemove(probe);
  }

  const bytes = treeSize(src);
  const free = freeSpace(probeDir);
  if (free !== undefined && free < bytes * HEADROOM) {
    return {
      ok: false,
      reason: `目标那边空间不够：要搬 ${mb(bytes)}，可用 ${mb(free)}。`,
      bytes,
      freeBytes: free,
    };
  }

  // 同卷判定用「能不能真的改名」来做，而不是比较盘符：挂载点、junction、网络盘
  // 上盘符相同也可能跨卷，改名会失败 —— 那时该走复制那条路。
  let sameVolume = false;
  const landing = join(probeDir, `.ruyin-vol-a-${Date.now()}`);
  const takeoff = join(src, `.ruyin-vol-b-${Date.now()}`);
  try {
    writeFileSync(takeoff, "v");
    renameSync(takeoff, landing);
    sameVolume = true;
  } catch {
    sameVolume = false;
  } finally {
    quietRemove(landing);
    quietRemove(takeoff);
  }
  return { ok: true, sameVolume, bytes, ...(free === undefined ? {} : { freeBytes: free }) };
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** 逐文件核对：大小 + 摘要。没核对过的副本不算数。 */
function verifyTree(srcDir: string, dstDir: string): string | undefined {
  const walk = (rel: string): string | undefined => {
    for (const e of readdirSync(join(srcDir, rel), { withFileTypes: true })) {
      const r = rel ? join(rel, e.name) : e.name;
      const a = join(srcDir, r);
      const b = join(dstDir, r);
      if (e.isDirectory()) {
        if (!existsSync(b)) return `复制后少了目录 ${r}`;
        const deeper = walk(r);
        if (deeper) return deeper;
      } else if (e.isFile()) {
        if (!existsSync(b)) return `复制后少了文件 ${r}`;
        if (statSync(a).size !== statSync(b).size) return `复制后大小对不上：${r}`;
        if (sha256(a) !== sha256(b)) return `复制后内容对不上：${r}`;
      }
    }
    return undefined;
  };
  return walk("");
}

/**
 * 核对副本。**导出**是为了能直接测它：跨卷复制那条路在临时目录里造不出来
 * （同一个盘上 rename 永远成功），而「核对能抓出坏副本」正是那条路唯一的护栏 ——
 * 不能只靠一条走不到的分支来保证。
 */
export function verifyMoved(src: string, dst: string, names: string[]): string | undefined {
  for (const name of names) {
    const a = join(src, name);
    if (!existsSync(a)) continue;
    if (statSync(a).isDirectory()) {
      const bad = verifyTree(a, join(dst, name));
      if (bad) return bad;
      continue;
    }
    const b = join(dst, name);
    if (!existsSync(b)) return `复制后少了文件 ${name}`;
    if (statSync(a).size !== statSync(b).size) return `复制后大小对不上：${name}`;
    if (sha256(a) !== sha256(b)) return `复制后内容对不上：${name}`;
  }
  return undefined;
}

/**
 * 上一次搬家留下的残局。**先看标记再决定动谁** —— 这一段是整个模块里最要紧的
 * 地方：搞错方向就会删掉唯一那份好数据。
 *
 * - `done`：数据已经完整地在目标那边了（断电断在「删源」或「清标记」之间）。
 *   要做的是把源那边的残留删掉、清掉标记，然后**认目标**。
 * - `copying`：副本不完整。丢掉副本重来，源一直没动过。
 */
function settleUnfinished(dst: string): { resolved?: "target"; note?: string } {
  const m = readMarker(dst);
  if (!m) return {};
  if (m.state === "done") {
    for (const name of m.names ?? readdirSync(dst).filter((n) => n !== MARKER)) {
      rmSync(join(m.from, name), { recursive: true, force: true });
    }
    rmSync(join(dst, MARKER), { force: true });
    return { resolved: "target", note: "上一次搬家已经搬完，这次把收尾做完了。" };
  }
  rmSync(dst, { recursive: true, force: true });
  return { note: "上一次搬家没走完，那份不完整的副本已经丢掉，数据仍在原处。" };
}

/**
 * 执行搬家。**必须在打开任何库之前调用。**
 *
 * 同卷：逐项改名（每一项都是原子的），中途失败把已改名的原路搬回。
 * 跨卷：复制 → 逐文件核对 → 写 `done` → 删源 → 清标记。
 */
export function performMove(
  from: string,
  to: string,
  /** `copy` 强制走「复制 + 核对 + 删源」那条路。跨卷时自动如此；测试用它把那条
      路走一遍，遇到古怪文件系统时也可以用它换取更保险的过程。 */
  mode: "auto" | "copy" = "auto",
): MoveOutcome {
  const at = new Date().toISOString();
  const src = resolve(from);
  const dst = resolve(to);

  const settled = settleUnfinished(dst);
  if (settled.resolved === "target") {
    return { status: "moved", from: src, to: dst, at, reason: settled.note };
  }

  const probe = checkTarget(src, dst);
  if (!probe.ok) {
    return { status: "failed", from: src, to: dst, at, reason: probe.reason ?? "" };
  }
  const check = mode === "copy" ? { ...probe, sameVolume: false } : probe;

  /**
   * **源必须真的在那儿。** 不加这一条时，源目录不存在会一路走成「搬完了」——
   * 什么都没复制、什么都没删，然后指针被改指到一个空目录上（2026-09-05 实测）。
   *
   * 现实里这不是假想：数据在移动硬盘上、开机时没插，同时有一次待搬 —— 应用会
   * 宣布搬完、指向空目录，而数据还在那块盘上，用户只能手工改指针才能找回。
   * 「找不到数据」必须报错，绝不能报成功。
   */
  if (!existsSync(src)) {
    return {
      status: "failed",
      from: src,
      to: dst,
      at,
      reason: `找不到当前数据目录（${src}）—— 没有搬移任何东西，设置也没有改动。如果数据在移动硬盘上，接好之后重试。`,
    };
  }
  const entries = readdirSync(src, { withFileTypes: true })
    .filter((e) => !SKIP.has(e.name) && e.name !== MARKER)
    .map((e) => e.name);
  const done: string[] = [];
  try {
    mkdirSync(dst, { recursive: true });
    writeFileSync(
      join(dst, MARKER),
      JSON.stringify({ from: src, at, state: "copying", names: [] } satisfies Marker),
    );
    for (const name of entries) {
      const a = join(src, name);
      const b = join(dst, name);
      if (check.sameVolume) renameSync(a, b);
      else cpSync(a, b, { recursive: true, force: true });
      done.push(name);
      // 每搬完一项就把清单落盘：断电之后要知道哪些已经在那边了。
      writeFileSync(
        join(dst, MARKER),
        JSON.stringify({ from: src, at, state: "copying", names: done } satisfies Marker),
      );
    }
    if (!check.sameVolume) {
      const bad = verifyMoved(src, dst, entries);
      if (bad) {
        // 副本不可信：丢掉副本，源一动没动，如实说是哪一处对不上。
        rmSync(dst, { recursive: true, force: true });
        return { status: "failed", from: src, to: dst, at, reason: bad };
      }
      // 只有核对通过了才写 done —— 这个标记的含义是「目标是权威」。
      writeFileSync(
        join(dst, MARKER),
        JSON.stringify({ from: src, at, state: "done", names: entries } satisfies Marker),
      );
      for (const name of entries) rmSync(join(src, name), { recursive: true, force: true });
    }
    rmSync(join(dst, MARKER), { force: true });
    return { status: "moved", from: src, to: dst, at };
  } catch (e) {
    // 同卷失败时数据是**分开**的（一部分在那边）—— 那是最危险的状态，原路搬回。
    if (check.sameVolume) {
      for (const name of done) {
        try {
          renameSync(join(dst, name), join(src, name));
        } catch {
          // 搬回也失败：不再动手，把两边的位置如实写进原因里，让人能自己收拾。
          return {
            status: "failed",
            from: src,
            to: dst,
            at,
            reason: `搬移中断且回滚失败：${(e as Error).message}。部分数据现在在 ${dst}，其余仍在 ${src} —— 请不要删除任何一边，两边合起来才是完整的一份。`,
          };
        }
      }
    } else {
      rmSync(dst, { recursive: true, force: true });
    }
    rmSync(join(dst, MARKER), { force: true });
    return { status: "failed", from: src, to: dst, at, reason: (e as Error).message };
  }
}

/**
 * 数据目录该用哪一个。**在 applyPendingMove 之前跑**，因为「待搬」的起点就是它
 * 定下来的。
 *
 * 三条，按优先级：
 *
 * 1. **指针说了算。** 用户改过目录（或上一次搬家落定过），那就是权威。
 * 2. **老位置有数据就钉在老位置，并把指针写下来。** 默认位置从漫游
 *    `%APPDATA%Ruyindata` 挪到了本地 `%LOCALAPPDATA%Ruyindata`（owner
 *    2026-09-05 定：漫游目录在域环境里会随登录/注销整份同步，而项目库是 GB 级的
 *    东西）。已经在用的机器**一个字节都不搬** —— 只写一条指针把它钉在原处，行为
 *    与今天完全一致。想换位置的话，设置里那条会真搬的路一直在。
 * 3. 都没有：用新默认位置（也就是全新安装的那条路）。
 *
 * 「有数据」的判据是 `runtime/` 里有东西 —— 主密钥在那儿。用整个目录是否存在做
 * 判据会误判：装过一次、还没登录过的机器上，那个目录可能已经建出来但是空的。
 */
export function resolveDataDir(
  locationFile: string,
  preferred: string,
  legacy?: string,
): { dataDir: string; pinnedLegacy: boolean } {
  const loc = readLocation(locationFile);
  if (loc.dataDir?.trim()) {
    const pointed = resolve(loc.dataDir);
    // **指针不等于承诺。** 它可能指向一块已经拔掉的移动硬盘、一个被删掉的目录、
    // 或者装机时写下、之后被改成只读的位置。当场验一次能不能建、能不能写：验
    // 不过就用默认位置起来（应用能用，用户能在设置里改），而不是在开库那一步
    // 崩掉 —— 那在用户眼里就是「装完打不开」。
    if (usable(pointed)) return { dataDir: pointed, pinnedLegacy: false };
    console.error(
      `[ruyin] data dir ${pointed} is unusable; falling back to ${resolve(preferred)}`,
    );
    return { dataDir: resolve(preferred), pinnedLegacy: false };
  }

  const old = legacy?.trim() ? resolve(legacy) : undefined;
  if (old && hasData(old)) {
    writeLocation(locationFile, { dataDir: old, ...(loc.pending ? { pending: loc.pending } : {}) });
    return { dataDir: old, pinnedLegacy: true };
  }
  return { dataDir: resolve(preferred), pinnedLegacy: false };
}

/**
 * 删掉一个探针文件，**删不掉也不抛**。
 *
 * `rmSync(..., { force: true })` 只吞 ENOENT。父目录本身不是目录时（把一个普通
 * 文件当目录用），lstat 会抛 ENOTDIR —— 而这行清理写在 `finally` 里，一抛就
 * 冲出了外面那层 try/catch，把「这个目录不可用」变成了「进程崩了」。CI 2026-09-05
 * 就是这么红的（Linux 上抛，Windows 上不抛，本机因此测不出来）。
 */
function quietRemove(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    // 探针留在那儿也不碍事：它是零字节的一个文件，下一次会被覆盖。
  }
}

/** 能不能在这儿建目录、写文件。 */
function usable(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    const probe = join(dir, ".ruyin-write-probe");
    writeFileSync(probe, "probe");
    quietRemove(probe);
    return true;
  } catch {
    return false;
  }
}

/** 这个目录里有没有真的数据（主密钥在 `runtime/`）。 */
export function hasData(dir: string): boolean {
  try {
    return readdirSync(join(dir, "runtime")).length > 0;
  } catch {
    return false;
  }
}

/**
 * 启动时跑这一句：有待搬就搬，然后**返回这一轮真正该用的目录**。
 *
 * 无论成败都把结果写回指针文件 —— 界面重启后要能说清楚上次搬没搬成、没搬成是
 * 因为什么。失败时返回源目录：数据在哪儿就从哪儿启动，不因为一次失败的搬家让
 * 用户面对一个空应用。
 */
export function applyPendingMove(
  locationFile: string,
  fallbackDir: string,
): { dataDir: string; outcome: MoveOutcome; movedNow: boolean } {
  const loc = readLocation(locationFile);
  const current = resolve(loc.dataDir ?? fallbackDir);
  // `movedNow` 与 `outcome` 是两件事：outcome 也可能是**上一次**的结果（界面要
  // 用它讲「上次搬移已完成」），而日志只该在真的搬了的那一次说话。少了这个区分
  // 时，每次启动都会打印一遍「data dir moved」—— 一条每次都出现的搬家日志，
  // 等于告诉读日志的人「它又搬了一次」。
  if (!loc.pending) {
    return { dataDir: current, outcome: loc.lastMove ?? { status: "none" }, movedNow: false };
  }

  const outcome = performMove(current, resolve(loc.pending));
  const dataDir = outcome.status === "moved" ? resolve(loc.pending) : current;
  writeLocation(locationFile, { dataDir, lastMove: outcome });
  return { dataDir, outcome, movedNow: true };
}
