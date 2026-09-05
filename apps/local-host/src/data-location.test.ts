/**
 * 搬家这件事只有一个判据：**任何时刻、任何中断点，都还有完整的一份数据在某处，
 * 而且能判定是哪一处。** 所以这些用例大半在造中断，而不是走通顺路。
 */
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
  applyPendingMove,
  checkTarget,
  performMove,
  hasData,
  readLocation,
  resolveDataDir,
  treeSize,
  verifyMoved,
  writeLocation,
} from "./data-location.js";

const roots: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "ruyin-move-"));
  roots.push(d);
  return d;
}
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

/** 一个像样的数据目录：密钥、产品库、项目库，外加一份不该被搬走的缓存。 */
function seed(dir: string): void {
  mkdirSync(join(dir, "runtime"), { recursive: true });
  writeFileSync(join(dir, "runtime", "master.key.dpapi"), "KEY");
  mkdirSync(join(dir, "products", "bidproposal", "1.0.0"), { recursive: true });
  writeFileSync(join(dir, "products", "bidproposal", "1.0.0", "ruyin.product.yaml"), "id: bidproposal");
  mkdirSync(join(dir, "projects", "prj_1", "files"), { recursive: true });
  writeFileSync(join(dir, "projects", "prj_1", "project.db"), "DB");
  writeFileSync(join(dir, "projects", "prj_1", "project.db-wal"), "WAL");
  writeFileSync(join(dir, "projects", "prj_1", "key.enc"), "K");
  mkdirSync(join(dir, "chromium", "Cache"), { recursive: true });
  writeFileSync(join(dir, "chromium", "Cache", "blob"), "x".repeat(4096));
}

void test("checkTarget: 拦住那些不该搬的目标，并且说得清为什么", async () => {
  const src = tmp();
  seed(src);
  assert.match(checkTarget(src, "").reason ?? "", /还没填/);
  assert.match(checkTarget(src, "relative/dir").reason ?? "", /完整路径/);
  assert.match(checkTarget(src, src).reason ?? "", /就是当前目录/);
  assert.match(checkTarget(src, join(src, "inner")).reason ?? "", /在当前数据目录里面/);
  assert.match(checkTarget(join(src, "projects"), src).reason ?? "", /在目标里面/);

  const file = join(tmp(), "afile");
  writeFileSync(file, "x");
  assert.match(checkTarget(src, file).reason ?? "", /是一个文件/);

  const busy = tmp();
  writeFileSync(join(busy, "someone-elses"), "x");
  assert.match(checkTarget(src, busy).reason ?? "", /已经有东西/);

  assert.match(
    checkTarget(src, join(tmp(), "no-such-parent", "deep")).reason ?? "",
    /上级目录不存在/,
  );

  const ok = join(tmp(), "fresh");
  const r = checkTarget(src, ok);
  assert.equal(r.ok, true);
  // 缓存不算在要搬的量里 —— 它是整棵树里最大的一块，把它算进去会把「够不够」
  // 这个判断整体带偏。
  assert.equal(r.bytes, treeSize(src));
  assert.ok((r.bytes ?? 0) < 4096, `不该把 chromium 的 4096 字节算进来，实际 ${r.bytes}`);
});

void test("performMove: 搬完之后源那边只剩缓存，目标那边逐字节一致", async () => {
  const src = tmp();
  seed(src);
  const dst = join(tmp(), "moved");
  const out = await performMove(src, dst);
  assert.equal(out.status, "moved", out.reason);

  assert.deepEqual(readdirSync(src), ["chromium"]);
  assert.equal(readFileSync(join(dst, "runtime", "master.key.dpapi"), "utf8"), "KEY");
  // WAL 必须跟着库走：留在原地等于最近那批已提交的写入静默消失。
  assert.equal(readFileSync(join(dst, "projects", "prj_1", "project.db-wal"), "utf8"), "WAL");
  assert.equal(existsSync(join(dst, "projects", "prj_1", "files")), true);
  assert.equal(existsSync(join(dst, "chromium")), false);
  // 收尾干净：标记不留在数据目录里。
  assert.equal(existsSync(join(dst, ".ruyin-move")), false);
});

void test("performMove: 目标不可用时源一动没动，且如实说原因", async () => {
  const src = tmp();
  seed(src);
  const busy = tmp();
  writeFileSync(join(busy, "occupied"), "x");
  const before = readdirSync(src).sort();
  const out = await performMove(src, busy);
  assert.equal(out.status, "failed");
  assert.match(out.reason ?? "", /已经有东西/);
  assert.deepEqual(readdirSync(src).sort(), before);
});

void test("断电在复制中途（copying 标记）：丢掉那份不完整的副本，源仍是权威", async () => {
  const src = tmp();
  seed(src);
  const dst = join(tmp(), "halfway");
  // 造一个「上次搬到一半」的现场：目标里有一份残缺的 projects，标记是 copying。
  mkdirSync(join(dst, "projects", "prj_1"), { recursive: true });
  writeFileSync(join(dst, "projects", "prj_1", "project.db"), "TRUNCATED");
  writeFileSync(
    join(dst, ".ruyin-move"),
    JSON.stringify({ from: src, at: "t", state: "copying", names: ["projects"] }),
  );

  const out = await performMove(src, dst);
  assert.equal(out.status, "moved", out.reason);
  // 那份截断的副本没有被当成数据接着用 —— 它被丢掉，然后从源重新搬了一遍。
  assert.equal(readFileSync(join(dst, "projects", "prj_1", "project.db"), "utf8"), "DB");
  assert.equal(readFileSync(join(dst, "runtime", "master.key.dpapi"), "utf8"), "KEY");
});

void test("断电在删源之前（done 标记）：认目标、收尾，绝不把目标删掉", async () => {
  const src = tmp();
  seed(src);
  const dst = join(tmp(), "already-there");
  // 造现场：数据已经完整复制到目标并核对过（done），但源还没删干净。
  mkdirSync(dst, { recursive: true });
  for (const name of ["runtime", "products", "projects"]) {
    mkdirSync(join(dst, name), { recursive: true });
  }
  writeFileSync(join(dst, "runtime", "master.key.dpapi"), "KEY");
  mkdirSync(join(dst, "projects", "prj_1"), { recursive: true });
  writeFileSync(join(dst, "projects", "prj_1", "project.db"), "DB");
  writeFileSync(
    join(dst, ".ruyin-move"),
    JSON.stringify({
      from: src,
      at: "t",
      state: "done",
      names: ["runtime", "products", "projects"],
    }),
  );

  const out = await performMove(src, dst);
  assert.equal(out.status, "moved", out.reason);
  // 关键断言：**目标那份还在**。把 done 当成「上次没走完、丢掉重来」处理，
  // 会删掉唯一一份好数据 —— 这条用例就是为了钉死这个方向。
  assert.equal(readFileSync(join(dst, "projects", "prj_1", "project.db"), "utf8"), "DB");
  assert.equal(existsSync(join(dst, ".ruyin-move")), false);
  // 源那边的残留清掉了，缓存留着（它从来不参与搬家）。
  assert.deepEqual(readdirSync(src), ["chromium"]);
});

void test("applyPendingMove: 没有待搬就什么也不做；搬成了把指针指向新目录", async () => {
  const src = tmp();
  seed(src);
  const locFile = join(tmp(), "location.json");

  // 没有指针文件：按调用方给的默认目录走，不动任何东西。
  const idle = await applyPendingMove(locFile, src);
  assert.equal(idle.dataDir, src);
  assert.equal(idle.outcome.status, "none");
  assert.equal(existsSync(locFile), false);

  const dst = join(tmp(), "next");
  writeLocation(locFile, { dataDir: src, pending: dst });
  const moved = await applyPendingMove(locFile, src);
  assert.equal(moved.outcome.status, "moved", moved.outcome.reason);
  assert.equal(moved.dataDir, dst);
  const loc = readLocation(locFile);
  assert.equal(loc.dataDir, dst);
  // 待搬这一条要清掉：留着它，下一次启动会再搬一遍（而那时源已经空了）。
  assert.equal(loc.pending, undefined);
  assert.equal(loc.lastMove?.status, "moved");
});

void test("applyPendingMove: 搬不成时从原目录启动 —— 一次失败的搬家不该换来一个空应用", async () => {
  const src = tmp();
  seed(src);
  const locFile = join(tmp(), "location.json");
  const busy = tmp();
  writeFileSync(join(busy, "occupied"), "x");
  writeLocation(locFile, { dataDir: src, pending: busy });

  const r = await applyPendingMove(locFile, src);
  assert.equal(r.outcome.status, "failed");
  assert.equal(r.dataDir, src);
  // 失败的原因要留在指针文件里：界面重启后要能说清楚为什么没搬成。
  assert.match(readLocation(locFile).lastMove?.reason ?? "", /已经有东西/);
  assert.equal(readLocation(locFile).pending, undefined);
  assert.equal(readFileSync(join(src, "runtime", "master.key.dpapi"), "utf8"), "KEY");
});

void test("readLocation: 文件被写坏了按「还没搬过家」处理，不因为一个路径把应用卡住", async () => {
  const f = join(tmp(), "location.json");
  writeFileSync(f, "{ not json");
  assert.deepEqual(readLocation(f), {});
  writeFileSync(f, '"a string"');
  assert.deepEqual(readLocation(f), {});
});

void test("跨卷那条路：复制 + 核对 + 删源，一步都不少", async () => {
  const src = tmp();
  seed(src);
  const dst = join(tmp(), "cross-volume");
  // 临时目录都在同一个盘上，rename 永远成功，跨卷那条路在真实条件下走不到 ——
  // 所以显式强制它，否则这条分支只能靠「相信它写对了」。
  const out = await await performMove(src, dst, "copy");
  assert.equal(out.status, "moved", out.reason);
  assert.equal(readFileSync(join(dst, "projects", "prj_1", "project.db-wal"), "utf8"), "WAL");
  assert.deepEqual(readdirSync(src), ["chromium"]);
  assert.equal(existsSync(join(dst, ".ruyin-move")), false);
});

void test("核对能抓出坏副本：少一个文件、大小不对、内容不对，各说各的", async () => {
  const src = tmp();
  seed(src);
  const dst = tmp();
  const names = ["runtime", "projects"];
  // 完整复制一份，先证明核对在正常情况下是安静的。
  cpSync(join(src, "runtime"), join(dst, "runtime"), { recursive: true });
  cpSync(join(src, "projects"), join(dst, "projects"), { recursive: true });
  assert.equal(await verifyMoved(src, dst, names), undefined);

  rmSync(join(dst, "projects", "prj_1", "key.enc"));
  assert.match(await verifyMoved(src, dst, names) ?? "", /少了文件/);

  writeFileSync(join(dst, "projects", "prj_1", "key.enc"), "K-but-longer");
  assert.match(await verifyMoved(src, dst, names) ?? "", /大小对不上/);

  // 同样长度、不同内容 —— 只比大小的实现会在这里放过一份坏数据。
  writeFileSync(join(dst, "projects", "prj_1", "key.enc"), "X");
  assert.match(await verifyMoved(src, dst, names) ?? "", /内容对不上/);
});

void test("applyPendingMove: 搬完之后再启动，不会再报一次「搬了」", async () => {
  const src = tmp();
  seed(src);
  const locFile = join(tmp(), "location.json");
  const dst = join(tmp(), "there");
  writeLocation(locFile, { dataDir: src, pending: dst });
  const first = await applyPendingMove(locFile, src);
  assert.equal(first.movedNow, true);

  // 第二次启动：指针里已经没有待搬，什么也不该发生。outcome 仍然是「上次搬成了」
  // （界面要用它讲那句确认），但 movedNow 是 false —— 日志据此闭嘴。
  const second = await applyPendingMove(locFile, src);
  assert.equal(second.movedNow, false);
  assert.equal(second.dataDir, dst);
  assert.equal(second.outcome.status, "moved");
});

void test("resolveDataDir: 指针说了算", async () => {
  const locFile = join(tmp(), "location.json");
  const chosen = tmp();
  writeLocation(locFile, { dataDir: chosen });
  const r = resolveDataDir(locFile, tmp(), tmp());
  assert.equal(r.dataDir, chosen);
  assert.equal(r.pinnedLegacy, false);
});

void test("resolveDataDir: 老位置有数据 → 钉在老位置并写下指针，**一个字节都不搬**", async () => {
  const legacy = tmp();
  seed(legacy);
  const locFile = join(tmp(), "location.json");
  const preferred = join(tmp(), "new-default");

  const r = resolveDataDir(locFile, preferred, legacy);
  assert.equal(r.dataDir, legacy);
  assert.equal(r.pinnedLegacy, true);
  // 指针落盘了：下一次启动不必再靠探测。
  assert.equal(readLocation(locFile).dataDir, legacy);
  // 数据还在原处，新默认位置压根没被建出来。
  assert.equal(readFileSync(join(legacy, "runtime", "master.key.dpapi"), "utf8"), "KEY");
  assert.equal(existsSync(preferred), false);
});

void test("resolveDataDir: 全新机器 → 用新默认位置，不写指针（少一处要保持一致的状态）", async () => {
  const locFile = join(tmp(), "location.json");
  const preferred = join(tmp(), "fresh");
  const emptyLegacy = tmp();
  const r = resolveDataDir(locFile, preferred, emptyLegacy);
  assert.equal(r.dataDir, preferred);
  assert.equal(r.pinnedLegacy, false);
  assert.equal(existsSync(locFile), false);
});

void test("resolveDataDir: 老目录建出来了但是空的，不算「有数据」—— 那是装过没登录过的机器", async () => {
  const legacy = tmp();
  mkdirSync(join(legacy, "runtime"), { recursive: true });
  const locFile = join(tmp(), "location.json");
  const preferred = join(tmp(), "fresh");
  assert.equal(hasData(legacy), false);
  assert.equal(resolveDataDir(locFile, preferred, legacy).dataDir, preferred);
});

void test("resolveDataDir: 钉老位置时不能把已经排好的搬家丢掉", async () => {
  const legacy = tmp();
  seed(legacy);
  const locFile = join(tmp(), "location.json");
  const target = join(tmp(), "target");
  // 上一次会话里排了一次搬家，但那时指针里还没有 dataDir（刚升级上来）。
  writeLocation(locFile, { pending: target });
  const r = resolveDataDir(locFile, join(tmp(), "fresh"), legacy);
  assert.equal(r.dataDir, legacy);
  assert.equal(readLocation(locFile).pending, target);
});

void test("resolveDataDir: 指针指向不能用的位置（拔掉的盘、被删的目录）→ 回落默认位置", async () => {
  const locFile = join(tmp(), "location.json");
  // 拿一个**普通文件**当父目录：两个平台都是 ENOTDIR，立刻失败，不必依赖
  // 「某个盘符不存在」或 /proc 这类平台特有的东西 —— 那种写法在另一个系统上
  // 可能不是「快速失败」，而是别的行为。
  const blocker = join(tmp(), "not-a-dir");
  writeFileSync(blocker, "x");
  writeLocation(locFile, { dataDir: join(blocker, "child") });
  const preferred = join(tmp(), "fresh");
  const r = resolveDataDir(locFile, preferred, undefined);
  // 应用照旧起来，而不是在开库那一步崩掉 —— 那在用户眼里就是「装完打不开」。
  assert.equal(r.dataDir, preferred);
});

void test("performMove: 源目录不存在时报失败 —— 绝不能把「什么都没搬」说成搬完了", async () => {
  const root = tmp();
  const gone = join(root, "no-such-source");
  const target = join(root, "target");
  const out = await performMove(gone, target);
  assert.equal(out.status, "failed");
  assert.match(out.reason ?? "", /找不到当前数据目录/);
  // 目标不该被建出来：一个空目录会让下一次启动以为数据在那儿。
  assert.equal(existsSync(target), false);
});

void test("applyPendingMove: 源目录不存在时指针一动不动 —— 数据可能只是在没插的盘上", async () => {
  const root = tmp();
  const gone = join(root, "unplugged-drive");
  const target = join(root, "target");
  const locFile = join(root, "location.json");
  writeLocation(locFile, { dataDir: gone, pending: target });

  const r = await applyPendingMove(locFile, join(root, "fallback"));
  assert.equal(r.outcome.status, "failed");
  // **关键**：指针仍然指着原来那个位置。改指到空目录，等于把用户的数据弄丢了
  // ——数据其实还在，只是应用再也不看那儿了。
  assert.equal(readLocation(locFile).dataDir, gone);
  assert.equal(readLocation(locFile).pending, undefined);
});

void test("指针里要带上「要搬多少字节」—— 壳靠它决定等多久，而不是一个常数", async () => {
  const src = tmp();
  seed(src);
  const locFile = join(tmp(), "location.json");
  const target = join(tmp(), "next");
  // 这一步在守护进程那侧由 dataMove.request 做，这里直接钉住它写下的形状。
  const bytes = checkTarget(src, target).bytes;
  assert.ok(bytes !== undefined && bytes > 0);
  writeLocation(locFile, { dataDir: src, pending: target, pendingBytes: bytes });
  const loc = readLocation(locFile);
  assert.equal(loc.pendingBytes, bytes);
  // 搬完之后这一条要跟着 pending 一起消失（写的是一份新的指针）。
  await applyPendingMove(locFile, src);
  assert.equal(readLocation(locFile).pendingBytes, undefined);
  assert.equal(readLocation(locFile).pending, undefined);
});

void test("performMove: 跨卷时逐文件报进度，复制与核对两段各自走到 100%", async () => {
  const src = tmp();
  seed(src);
  const dst = join(tmp(), "with-progress");
  const seen: Array<{ phase: string; copiedBytes: number; totalBytes: number }> = [];
  const out = await performMove(src, dst, "copy", (p) => void seen.push({ ...p }));
  assert.equal(out.status, "moved", out.reason);

  const copy = seen.filter((p) => p.phase === "copy");
  const verify = seen.filter((p) => p.phase === "verify");
  // 两段都要有汇报点：核对和复制一样费时间（两边全部字节都要读一遍），
  // 不报的话进度条会停在 100% 不动 —— 那是最容易被当成卡死的时刻。
  assert.ok(copy.length >= 4, `复制该逐文件报，实际 ${copy.length} 次`);
  assert.ok(verify.length >= 4, `核对该逐文件报，实际 ${verify.length} 次`);

  // 单调不减，且不超过总量。
  for (const list of [copy, verify]) {
    let prev = 0;
    for (const p of list) {
      assert.ok(p.copiedBytes >= prev, "进度不能倒退");
      assert.ok(p.copiedBytes <= p.totalBytes, `${p.copiedBytes} > ${p.totalBytes}`);
      prev = p.copiedBytes;
    }
  }
  // 两段最后都应当走到总量（缓存不算在总量里，也不参与搬移）。
  assert.equal(copy[copy.length - 1]?.copiedBytes, treeSize(dst));
  assert.equal(verify[verify.length - 1]?.copiedBytes, treeSize(dst));
});

void test("performMove: 逐文件复制要把空目录也建出来 —— 它可能是布局的一部分", async () => {
  const src = tmp();
  seed(src);
  mkdirSync(join(src, "projects", "prj_1", "empty-on-purpose"), { recursive: true });
  const dst = join(tmp(), "with-empty");
  assert.equal((await performMove(src, dst, "copy")).status, "moved");
  assert.equal(existsSync(join(dst, "projects", "prj_1", "empty-on-purpose")), true);
});

void test("performMove: 同卷改名没有进度可报（它是瞬间的），但也不能因此崩", async () => {
  const src = tmp();
  seed(src);
  const dst = join(tmp(), "same-volume");
  const seen: string[] = [];
  const out = await performMove(src, dst, "auto", (p) => void seen.push(p.phase));
  assert.equal(out.status, "moved", out.reason);
  assert.deepEqual(seen, []);
});
