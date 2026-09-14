/**
 * pack.mjs 冒烟输出的判读，抽出来只为了能被 node:test 钉住。
 *
 * pack.mjs 顶层就跑 pnpm install / build / electron-builder，import 不得；而它的
 * 断言第一次真正执行是在 CI 的 windows-latest 上 —— 本地打包被
 * SeCreateSymbolicLinkPrivilege 挡着（TD-025）—— 一处正则笔误在合并前没有任何别的
 * 网能接住。pack 本身仍照旧不自测，由 packaged-smoke 端到端走（TD-053）；这里只有
 * 「给一段冒烟输出，判它过不过」这一层，零依赖、纯函数。命名照 apps/shell 的
 * pdf-protocol.ts：`parseXxxSelfCheck(输出)`，读的是守护进程打的标记行。
 *
 * 另外两支（snapshotTree / diffTree）给「冒烟不许往安装目录里写」那条断言用：只读
 * 文件系统，不写；判定本身是纯的。
 *
 * 只读演练那三支（denyWrites / parseUvSeed / judgeReadOnlySmoke）给「装到只读位置也
 * 起得来」那条用：denyWrites 会改 ACL / 权限位并回一个 restore，其余两支是纯的。
 */

import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { join, posix, relative, sep, win32 } from "node:path";

/**
 * 工作台界面自检那一行（TD-061）。
 *
 * 守护进程在 `RUYIN_SMOKE=1` 下自己当一次浏览器：取 `/`，再把页面引用的每个文件取
 * 一遍（apps/local-host/src/ui-self-check.ts），端得出来就打 ok。在打包冒烟里这一行
 * **只认 ok**：pack 每次都 `pnpm -r build`，界面必然构建过，「没有可端的界面」在这里
 * 不成立 —— 那是壳没把 RUYIN_UI_DIR 传过去的样子。404 / 文件缺失 / MIME 不对不会走到
 * 这里：守护进程直接退出 1，pack 在 `[shell-smoke] OK` 那一关已经红了。
 *
 * 目录那一段用 `(.+)` 收到行尾：Windows 路径带反斜杠、空格与括号（`Program Files (x86)`），
 * 而 spawnSync 拿到的输出行尾是 `\r\n` —— `.` 不吃换行，`\r` 会跟在收尾的 `)` 之后，
 * 所以 `\)` 仍能对上最后那个括号。pack-smoke.test.mjs 两种行尾都钉着。
 *
 * @param {string} smokeOut 打包后应用 `--smoke` 的 stdout + stderr
 * @returns {{ ok: true, detail: string, assets: number, bytes: number, dir: string } | { ok: false, message: string }}
 */
export function parseUiSelfCheck(smokeOut) {
  const line = /\[ruyin\] ui self-check: (ok \((\d+) asset\(s\), (\d+) bytes, (.+)\)|no built workspace ui to serve)/.exec(
    smokeOut,
  );
  if (!line) {
    return {
      ok: false,
      message:
        '[pack] FAILED: 守护进程没有报工作台界面自检（缺 "[ruyin] ui self-check" 这一行）—— ' +
        "多半是它排到了 PDF 自检之后、被壳截断了（apps/local-host/src/main.ts 的冒烟顺序）。",
    };
  }
  if (!line[1].startsWith("ok")) {
    return {
      ok: false,
      message:
        "[pack] FAILED: 打包后的守护进程端出来的是 Dev Console，不是工作台界面 —— 多半是壳没把 RUYIN_UI_DIR " +
        "传过去（或传的是空串，apps/shell/src/main.ts 的 startDaemon）。pack 每次都构建界面，「没有可端的界面」在这里不成立。",
    };
  }
  return { ok: true, detail: line[1], assets: Number(line[2]), bytes: Number(line[3]), dir: line[4] };
}

/**
 * 一棵目录树的快照：相对路径 -> { kind, size, mtimeMs }（软链记目标，不跟进去）。
 *
 * 给「冒烟前后 `resources/` 一个字节都不该变」用（TD-062）：uvx 形态曾把缓存写进
 * 随包目录，一次冒烟一万多个文件；装到只读位置首次使用就会失败。比把目录设只读再
 * 冒烟更平台无关 —— Windows 上目录的只读位挡不住建文件，得改 ACL。
 *
 * @param {string} root
 * @returns {Map<string, { kind: "file" | "dir" | "link", size: number, mtimeMs: number }>}
 */
export function snapshotTree(root) {
  const out = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = relative(root, full).split(sep).join("/");
      const st = lstatSync(full);
      if (st.isSymbolicLink()) {
        out.set(rel, { kind: "link", size: Buffer.byteLength(readlinkSync(full)), mtimeMs: 0 });
      } else if (st.isDirectory()) {
        out.set(rel, { kind: "dir", size: 0, mtimeMs: 0 });
        walk(full);
      } else {
        out.set(rel, { kind: "file", size: st.size, mtimeMs: st.mtimeMs });
      }
    }
  };
  walk(root);
  return out;
}

/**
 * 两份快照的差：多了什么、少了什么、变了什么（大小或 mtime）。
 *
 * @param {ReturnType<typeof snapshotTree>} before
 * @param {ReturnType<typeof snapshotTree>} after
 * @returns {{ added: string[], removed: string[], changed: string[], clean: boolean }}
 */
export function diffTree(before, after) {
  const added = [];
  const removed = [];
  const changed = [];
  for (const [rel, b] of before) {
    const a = after.get(rel);
    if (!a) removed.push(rel);
    else if (a.kind !== b.kind || a.size !== b.size || a.mtimeMs !== b.mtimeMs) changed.push(rel);
  }
  for (const rel of after.keys()) if (!before.has(rel)) added.push(rel);
  added.sort();
  removed.sort();
  changed.sort();
  return { added, removed, changed, clean: added.length === 0 && removed.length === 0 && changed.length === 0 };
}

/**
 * 把 diffTree 的结果说成 pack 那一行人话；clean 时返回 undefined。
 *
 * @param {ReturnType<typeof diffTree>} diff
 * @returns {string | undefined}
 */
export function describeTreeWrites(diff) {
  if (diff.clean) return undefined;
  const sample = (xs) => xs.slice(0, 6).join("、") + (xs.length > 6 ? ` …（共 ${xs.length} 个）` : "");
  const parts = [];
  if (diff.added.length) parts.push(`新增 ${diff.added.length} 个：${sample(diff.added)}`);
  if (diff.changed.length) parts.push(`改动 ${diff.changed.length} 个：${sample(diff.changed)}`);
  if (diff.removed.length) parts.push(`删除 ${diff.removed.length} 个：${sample(diff.removed)}`);
  return (
    "[pack] FAILED: 冒烟往安装目录 resources/ 里写了东西 —— " +
    parts.join("；") +
    "。装到只读位置（Program Files）首次使用就会失败（TD-062）。可写的东西应落在数据目录（apps/local-host/src/tool-servers.ts 的 uvx 缓存那一段）。"
  );
}

/**
 * 能不能往这个目录里建文件 —— 建一个探针再删掉。
 *
 * 只读演练全靠它说真话：拒绝写入没生效（POSIX 上 root 无视权限位、Windows 上 ACE
 * 没传播到子目录）的演练是在演戏。所以拒绝之后探一次、恢复之后再探一次。
 *
 * @param {string} dir
 * @returns {boolean}
 */
export function canWrite(dir) {
  const probe = join(dir, `.ruyin-write-probe-${process.pid}`);
  if (process.platform === "win32") {
    // **不能用 Node 自己探。** libuv 在 Windows 上打开文件一律带 FILE_FLAG_BACKUP_SEMANTICS，
    // 而令牌里 SeBackupPrivilege / SeRestorePrivilege 处于启用状态时（GitHub 的 Windows
    // runner 就是），带这个标志的打开会**绕过 ACL** —— 拒绝项摆在那儿，Node 照样写进去
    // （#244 第一次在 CI 上跑就是这样红的）。cmd 的重定向走普通 CreateFile，没有那个标志，
    // 探出来的才是 uv（Rust，也没有那个标志）和普通用户会遇到的答案。
    // 判据是「文件在不在」，不是 cmd 的退出码 —— 重定向失败时它的 errorlevel 不可靠。
    spawnSync("cmd.exe", ["/d", "/c", `echo probe> "${probe}"`], { encoding: "utf8", windowsVerbatimArguments: true });
    if (!existsSync(probe)) return false;
    try {
      rmSync(probe, { force: true });
    } catch {
      /* 探针留着也无害 */
    }
    return true;
  }
  try {
    writeFileSync(probe, "probe");
  } catch {
    return false;
  }
  try {
    rmSync(probe, { force: true });
  } catch {
    /* 建得了删不了（Windows 上只拒了 DE 的情形）：算能写，探针留着也无害 */
  }
  return true;
}

/**
 * 当前进程令牌的用户 SID（Windows）：`whoami /user /fo csv /nh` 的最后一列。
 *
 * @returns {string}
 */
export function tokenSid() {
  const r = spawnSync("whoami", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8" });
  const m = /"(S-1-[\d-]+)"\s*$/.exec((r.stdout ?? "").trim());
  if (!m) throw new Error(`tokenSid: 读不出令牌 SID：${r.stdout ?? ""}${r.stderr ?? ""}`);
  return m[1];
}

/**
 * 只读演练没生效时给人看的诊断：跑作业的身份、令牌里启用的特权、树根现在的 ACL。
 * 全部来自子进程输出，不经 process.env。
 *
 * @param {string} dir
 * @returns {string}
 */
export function describeIdentity(dir) {
  const out = (cmd, args) => {
    const r = spawnSync(cmd, args, { encoding: "utf8" });
    return `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  };
  if (process.platform === "win32") {
    return [`whoami /user /priv:`, out("whoami", ["/user", "/priv"]), `icacls ${dir}:`, out("icacls", [dir])].join("\n");
  }
  return [`id:`, out("id", []), `ls -ld ${dir}:`, out("ls", ["-ld", dir])].join("\n");
}

/**
 * 让一棵树对当前用户拒绝写入，回一个 restore()。装到 Program Files 的那台机器就是
 * 这个样子（TD-062）：非提权进程对安装目录只有读。
 *
 * - Windows：目录的只读位挡不住建文件，走 ACL —— 给当前身份加一条**拒绝**写 / 建 /
 *   删的 ACE，(OI)(CI) 让子孙继承。拒绝优先于允许，管理员组的 Allow 也压不过它，
 *   所以 CI 的 runneradmin 上照样生效。**必须带 /T**：#244 在 CI 上红了四轮才由自证
 *   看清 —— 不带 /T 时 icacls 只改树根，已有的子孙一个都不落（「. 写不了，sub 能写」），
 *   而 uv 写的正是 resources/uv/ 深处。/T 给两万多个条目各写一条显式 ACE，恢复时同样
 *   /T 各删一遍，各花几十秒，是这条演练的固定开销。
 * - POSIX：`chmod -R a-w`。root 无视权限位 —— 那正是 `effective` 存在的理由。
 *
 * restore 之后再探一次每个 probeDirs：还写不了的话 Windows 上再退一步用 /T 逐个
 * 删；还不行就抛，并把手动命令放进报错 —— 那棵树接下来还要给 upload-artifact 和
 * 开发者自己用，不能悄悄留成只读。
 *
 * @param {string} dir 要锁的树根
 * @param {string[]} [probeDirs] 拒绝之后探哪些目录（默认只探树根；传一个深处的子目录能顺便验继承）
 * @returns {{ effective: boolean, how: string, log: string, restore: () => void }} log 是锁那条命令的输出（icacls 会说处理了几个文件），给 pack 打进日志
 */
export function denyWrites(dir, probeDirs = [dir]) {
  const run = (cmd, args) => {
    // /T 的 icacls 会给两万多个条目各打一行「processed file」，默认 1 MB 的缓冲一撑就
    // ENOBUFS，子进程还会被半路杀掉（#244 第五轮）。带 /T 的调用都加 /Q 闭嘴，缓冲也放大。
    const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (r.error) throw new Error(`${cmd} ${args.join(" ")}: ${r.error.message}`);
    if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} 退出 ${r.status}：${r.stdout ?? ""}${r.stderr ?? ""}`);
    return `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  };
  const stillLocked = () => probeDirs.filter((d) => !canWrite(d));
  let how;
  let log;
  let undo;
  if (process.platform === "win32") {
    // 拒绝项按**令牌里的 SID** 写，不按 USERNAME：whoami 读的是令牌本身；SID 前加 * 是
    // icacls 的写法。顺带避开了 USERNAME 进日志被 CodeQL 判成明文泄露那一条。
    //
    // **几种写法按顺序试，第一种挡得住的算数。** 第一种就够（自证里它锁得住树根），
    // 后面几种是给下一台不一样的机器留的退路；每种写法挡没挡住、锁着时的 ACL 长什么样，
    // 全部留在 log 里，再出问题不用猜。
    const sid = tokenSid();
    const strategies = [
      { who: `*${sid}`, perm: "(OI)(CI)(DE,DC,WD,AD,WEA,WA)", label: "令牌 SID · 具体权限" },
      { who: `*${sid}`, perm: "(OI)(CI)W", label: "令牌 SID · W" },
      { who: "*S-1-5-32-544", perm: "(OI)(CI)W", label: "Administrators 组 · W" },
      { who: "*S-1-1-0", perm: "(OI)(CI)W", label: "Everyone · W" },
    ];
    const oneLine = (text) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(" | ");
    const notes = [];
    let applied;
    for (const st of strategies) {
      let out;
      try {
        out = run("icacls", [dir, "/deny", `${st.who}:${st.perm}`, "/T", "/Q"]);
      } catch (e) {
        // 半路失败的 /T 可能已经锁了一部分；先尽力撤掉再抛，别把树留成半只读。
        spawnSync("icacls", [dir, "/remove:d", st.who, "/T", "/Q"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
        throw e;
      }
      const left = stillLocked();
      notes.push(
        `${st.label}: ${oneLine(out)} -> ` +
          probeDirs.map((d) => `${relative(dir, d) || "."} ${left.includes(d) ? "写不了" : "能写"}`).join("，"),
      );
      if (left.length === probeDirs.length) {
        applied = st;
        break;
      }
      notes.push(`  锁着时的 ACL: ${oneLine(run("icacls", [dir]))}`);
      run("icacls", [dir, "/remove:d", st.who, "/T", "/Q"]);
    }
    log = notes.join("\n");
    how = applied ? `icacls /deny ${applied.who}:${applied.perm}` : "icacls /deny（四种写法都没挡住）";
    undo = () => {
      if (!applied) return;
      run("icacls", [dir, "/remove:d", applied.who, "/T", "/Q"]);
      const left = stillLocked();
      if (left.length) {
        throw new Error(
          `只读演练恢复失败：${left.join("、")} 仍然写不了。手动恢复：icacls "${dir}" /remove:d ${applied.who} /T /Q`,
        );
      }
    };
    return { effective: Boolean(applied), how, log, restore: undo };
  } else {
    log = run("chmod", ["-R", "a-w", dir]);
    how = "chmod -R a-w";
    undo = () => {
      run("chmod", ["-R", "u+w", dir]);
      const left = stillLocked();
      if (left.length) throw new Error(`只读演练恢复失败：${left.join("、")} 仍然写不了。手动恢复：chmod -R u+w "${dir}"`);
    };
  }
  return { effective: stillLocked().length === probeDirs.length, how, log, restore: undo };
}

/**
 * uv 种子那一行：`[ruyin] uv cache: seeded N file(s) from <种子> -> <缓存> (M ms)`
 * （apps/local-host/src/tool-servers.ts 的 seedUvCacheOnce）。第二次起、或随包没种子，
 * 都没有这一行 —— 返回 undefined。路径段用 `(.+?)` 收到 ` -> ` / ` (` 之前，Windows
 * 路径的反斜杠、空格、括号都在里面；`\r` 跟在收尾的 `)` 之后，不会被收进去。
 *
 * @param {string} smokeOut
 * @returns {{ files: number, from: string, to: string, ms: number } | undefined}
 */
export function parseUvSeed(smokeOut) {
  const m = /\[ruyin\] uv cache: seeded (\d+) file\(s\) from (.+?) -> (.+?) \((\d+) ms\)/.exec(smokeOut);
  if (!m) return undefined;
  return { files: Number(m[1]), from: m[2], to: m[3], ms: Number(m[4]) };
}

/**
 * 只读演练那一轮冒烟的判读（TD-062 的第 2 条）。
 *
 * 这一轮的条件照 Program Files 那台机器摆：安装目录拒绝写入、数据目录是个空的临时
 * 目录。所以判据比第一轮多两条：uvx 自检必须 ok（Python 半边正是当初写进包里的那
 * 一支），而且守护进程必须报了「uv cache: seeded」且种到了这一轮的数据目录之下 ——
 * 空数据目录里没有种子却 ok，只可能是缓存又指回了包里（在可写工作区里那也能过）。
 * 种子落在别处多半是守护进程按它自己的规则钉住了老数据目录（data-location.ts：老位置
 * 有数据就不搬），那是这台机器的状态，不是包的问题 —— 报错里把落点写出来。
 *
 * `expectUvx` 为 false（RUYIN_SKIP_SKILL_PULL=1，没种 Python 半边）时只看壳的 OK。
 *
 * @param {{ smokeOut: string, dataDir: string, expectUvx: boolean }} x
 * @returns {{ ok: true, detail: string } | { ok: false, message: string }}
 */
export function judgeReadOnlySmoke({ smokeOut, dataDir, expectUvx }) {
  if (!smokeOut.includes("[shell-smoke] OK")) {
    return {
      ok: false,
      message:
        "[pack] FAILED: 安装目录只读时应用起不来 —— 有东西在往包里写（看上面这一轮的输出）。" +
        "装到 Program Files 的用户看到的就是这个（TD-062）。",
    };
  }
  if (!expectUvx) return { ok: true, detail: "壳 OK（没种 Python 半边，uvx 与种子不在这一轮的判据里）" };
  const uvx = /\[ruyin\] uvx self-check: ([^\r\n]*)/.exec(smokeOut);
  if (!uvx || !uvx[1].startsWith("ok")) {
    return {
      ok: false,
      message:
        `[pack] FAILED: 安装目录只读时 uvx 自检没过（${uvx?.[1] ?? "没报"}）—— Python 半边还在依赖包里可写` +
        "（apps/local-host/src/tool-servers.ts 的 uvxPlan / seedUvCacheOnce）。",
    };
  }
  const seed = parseUvSeed(smokeOut);
  if (!seed) {
    return {
      ok: false,
      message:
        "[pack] FAILED: 只读演练用的是空数据目录，守护进程却没报「uv cache: seeded」—— 种子没从只读的包里种过去，" +
        "那 uvx 是靠什么起来的？多半是 UV_CACHE_DIR 又指回了包里（在可写工作区里那也能过，所以才有这一轮）。",
    };
  }
  // 两个路径来自同一台机器；按形状挑 API —— 判读本身要能在 Linux 上被 Windows 形状的
  // 样本钉住（自测跑在 ubuntu），而 win32 的 relative 顺带不分大小写。
  const P = /^[A-Za-z]:[\\/]/.test(dataDir) ? win32 : posix;
  const rel = P.relative(dataDir, seed.to);
  if (rel === "" || rel.startsWith("..") || P.isAbsolute(rel)) {
    return {
      ok: false,
      message:
        `[pack] FAILED: uv 种子落在了 ${seed.to}，不在这一轮的数据目录 ${dataDir} 之下。` +
        "多半是守护进程钉住了这台机器的老数据目录（apps/local-host/src/data-location.ts：老位置有数据就不搬）；" +
        "CI 的 runner 上不会有老数据，本机跑到这一条要先看 %APPDATA%\\Ruyin\\data。",
    };
  }
  return {
    ok: true,
    detail: `壳 OK；uvx ${uvx[1]}；种子 ${seed.files} 个文件从只读的包里种到 ${seed.to}（${seed.ms} ms）`,
  };
}
