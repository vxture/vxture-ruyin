/**
 * pack.mjs 冒烟判读（pack-smoke.mjs）的自测。
 *
 * 这些正则第一次真正跑是在 CI 的 windows-latest 上：本地打包被
 * SeCreateSymbolicLinkPrivilege 挡着（TD-025），所以一处笔误在合并前没有别的网能
 * 接住 —— 一个写松了的正则每一行都放过，然后打一行 OK。这里用一段形状真实的
 * 冒烟输出把三种结果钉死：缺行要红、如实说「没有可端的界面」在打包里也要红、ok 要
 * 把数字与目录带出来；行尾 `\r\n` 也要过 —— 真实的 smokeOut 只在 Windows 上产生。
 * pack.mjs 本身仍不自测（TD-053），它由 packaged-smoke 端到端走。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  canWrite,
  denyWrites,
  describeTreeWrites,
  diffTree,
  judgeReadOnlySmoke,
  parseUiSelfCheck,
  parseUvSeed,
  snapshotTree,
} from "./pack-smoke.mjs";

/** 一段形状真实的冒烟输出：界面那一行排最前（真实顺序），由用例自己决定给不给；后面是三条既有自检 + 壳的 OK。 */
function transcript(uiLine, eol = "\n") {
  return [
    "[ruyin] listening on http://127.0.0.1:17420",
    ...(uiLine ? [uiLine] : []),
    "[ruyin] tools self-check: ok (microsoft.playwright-mcp, 24 tool(s))",
    "[ruyin] uvx self-check: ok (haris-musa.excel-mcp-server, 25 tool(s))",
    "[ruyin] pdf self-check: ok (3629 bytes)",
    "[shell-smoke] OK: daemon healthy, shell wiring verified",
  ].join(eol);
}

const WIN_DIR = "C:\\Program Files (x86)\\Ruyin\\resources\\ui";
const OK_LINE = `[ruyin] ui self-check: ok (2 asset(s), 812345 bytes, ${WIN_DIR})`;

void test("parseUiSelfCheck: 缺那一行就红 —— 壳报了 OK 不等于界面自检跑过（排到 PDF 之后就会这样）", () => {
  const r = parseUiSelfCheck(transcript(undefined));
  assert.equal(r.ok, false);
  assert.match(r.message, /缺 "\[ruyin\] ui self-check"/);
  assert.match(r.message, /PDF 自检之后/, "要把最可能的根因说出来：排序");
});

void test("parseUiSelfCheck: 「没有可端的界面」在打包冒烟里不算过 —— 开发态可以如实说，包里不行", () => {
  const r = parseUiSelfCheck(transcript("[ruyin] ui self-check: no built workspace ui to serve"));
  assert.equal(r.ok, false);
  assert.match(r.message, /RUYIN_UI_DIR/, "要点名壳那条没传过去的环境变量");
});

void test("parseUiSelfCheck: ok 那一行过，资产数、字节数与目录带出来 —— Windows 路径含反斜杠、空格与括号也行", () => {
  const r = parseUiSelfCheck(transcript(OK_LINE));
  assert.deepEqual(r, { ok: true, detail: `ok (2 asset(s), 812345 bytes, ${WIN_DIR})`, assets: 2, bytes: 812345, dir: WIN_DIR });
});

void test("parseUiSelfCheck: 行尾是 \\r\\n 也一样 —— 真实的冒烟输出只在 Windows 上产生，目录不能把 \\r 一起收进来", () => {
  const r = parseUiSelfCheck(transcript(OK_LINE, "\r\n"));
  assert.equal(r.ok, true);
  assert.equal(r.dir, WIN_DIR, "目录尾巴上不能带 \\r");
  assert.equal(r.assets, 2);
});

/** 一棵小树：文件、子目录、软链（能建就建 —— Windows 上建软链要特权，建不了就不测那一支）。 */
function tree() {
  const root = mkdtempSync(join(tmpdir(), "ruyin-tree-"));
  mkdirSync(join(root, "uv", "cache"), { recursive: true });
  writeFileSync(join(root, "uv", "cache", "a.txt"), "aaa");
  writeFileSync(join(root, "index.json"), "{}");
  let link = false;
  try {
    symlinkSync("cache", join(root, "uv", "link"), "dir");
    link = true;
  } catch {
    /* 没特权就算了 */
  }
  return { root, link };
}

void test("snapshotTree / diffTree: 没动就是 clean；新增、改动、删除各报各的，路径用正斜杠、排好序", () => {
  const { root, link } = tree();
  try {
    const before = snapshotTree(root);
    assert.equal(diffTree(before, snapshotTree(root)).clean, true, "什么都没动就该是 clean");
    assert.ok(before.has("uv/cache/a.txt") && before.has("uv/cache") && before.has("index.json"));
    if (link) assert.equal(before.get("uv/link").kind, "link", "软链记为 link，不跟进去");

    writeFileSync(join(root, "uv", "cache", "b.txt"), "new");
    writeFileSync(join(root, "uv", "cache", "a.txt"), "aaaa"); // 大小变了
    rmSync(join(root, "index.json"));
    const d = diffTree(before, snapshotTree(root));
    assert.deepEqual(d.added, ["uv/cache/b.txt"]);
    assert.deepEqual(d.changed, ["uv/cache/a.txt"]);
    assert.deepEqual(d.removed, ["index.json"]);
    assert.equal(d.clean, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test("diffTree: 内容同长但 mtime 变了也算改动 —— 原地覆盖一份同样大小的文件不该混过去", () => {
  const { root } = tree();
  try {
    const before = snapshotTree(root);
    utimesSync(join(root, "uv", "cache", "a.txt"), new Date(Date.now() + 5_000), new Date(Date.now() + 5_000));
    assert.deepEqual(diffTree(before, snapshotTree(root)).changed, ["uv/cache/a.txt"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test("describeTreeWrites: clean 时无话可说；有写入时点名前几个、说清后果并指向该改的地方", () => {
  assert.equal(describeTreeWrites({ added: [], removed: [], changed: [], clean: true }), undefined);
  const many = Array.from({ length: 9 }, (_, i) => `uv/cache/environments-v2/${i}`);
  const msg = describeTreeWrites({ added: many, removed: [], changed: ["uv/python/.lock"], clean: false });
  assert.match(msg, /新增 9 个/);
  assert.match(msg, /共 9 个/, "多了要说总数，不能只列前几个装作就这些");
  assert.match(msg, /改动 1 个：uv\/python\/\.lock/);
  assert.match(msg, /Program Files/, "要说清后果：装到只读位置首次使用就会失败");
  assert.match(msg, /tool-servers\.ts/, "要指向该改的地方");
});

// ---------------------------------------------------------------------------
// 只读演练（TD-062 第 2 条）
// ---------------------------------------------------------------------------

const RO_DATA = "C:\\Users\\runneradmin\\AppData\\Local\\Temp\\ruyin-ro-smoke-abc123";
const SEED_LINE = `[ruyin] uv cache: seeded 11678 file(s) from D:\\a\\Program Files (x86)\\Ruyin\\resources\\uv\\cache -> ${RO_DATA}\\tools\\uv-cache (28745 ms)`;

/** 只读那一轮的形状：种子行在壳的 OK 之后（真实顺序：Electron 只在退出后才把子进程的 stderr 冲出来）。 */
function roTranscript({ ok = true, uvx = "ok (haris-musa.excel-mcp-server, 25 tool(s))", seed = SEED_LINE, eol = "\n" } = {}) {
  return [
    "[ruyin] listening on http://127.0.0.1:17420",
    "[ruyin] ui self-check: ok (3 asset(s), 1190431 bytes, D:\\x\\resources\\ui)",
    "[ruyin] tools self-check: ok (microsoft.playwright-mcp, 24 tool(s))",
    `[ruyin] uvx self-check: ${uvx}`,
    "[ruyin] pdf self-check: ok (8171 bytes)",
    ...(ok ? ["[shell-smoke] OK: daemon healthy, shell wiring verified"] : ["[ruyin] smoke self-check failed: uvx: server exited (code 2)"]),
    ...(seed ? [seed] : []),
  ].join(eol);
}

void test("judgeReadOnlySmoke: 壳没 OK 就红，并说清这就是装到 Program Files 的样子", () => {
  const r = judgeReadOnlySmoke({ smokeOut: roTranscript({ ok: false }), dataDir: RO_DATA });
  assert.equal(r.ok, false);
  assert.match(r.message, /Program Files/);
  assert.match(r.message, /TD-062/);
});

void test("parseUvSeed: 数字、种子目录、落点都带出来 —— Windows 路径含括号与空格，行尾 \\r\\n 也不把 \\r 收进落点", () => {
  const r = parseUvSeed(roTranscript({ eol: "\r\n" }));
  assert.deepEqual(r, {
    files: 11678,
    from: "D:\\a\\Program Files (x86)\\Ruyin\\resources\\uv\\cache",
    to: `${RO_DATA}\\tools\\uv-cache`,
    ms: 28745,
  });
  assert.equal(parseUvSeed(roTranscript({ seed: null })), undefined, "第二次起没有这一行，要如实说没有");
});

/* ── uvx 与种子那两条判据（撤于 2026-09-18，搬回于 2026-09-19）───
 *
 * 它们守的是「随包的 uv 缓存能不能从只读的包里种到数据目录」。
 * 09-18 那天 uv 不随包，这条缝不存在，留着就是两条永不失败的断言；
 * 09-19 owner 改判运行环境随包，缝回来了，判据也跟着回来。
 * **撤得对、搬回来也对** —— 判据跟着包里到底有什么走，不跟着上一版的代码走。
 */
void test("judgeReadOnlySmoke: 壳 OK 但 uvx 没过也红 —— Python 半边正是当初写进包里的那一支", () => {
  const r = judgeReadOnlySmoke({
    smokeOut: roTranscript({ uvx: "no seeded uvx server to try" }),
    dataDir: RO_DATA,
  });
  assert.equal(r.ok, false);
  assert.match(r.message, /no seeded uvx server to try/, "要把守护进程实际报的那句带出来");
  assert.match(r.message, /tool-servers\.ts/);
});

void test("judgeReadOnlySmoke: 空数据目录却没有种子行也红 —— 那说明缓存又指回了包里，可写工作区看不出来", () => {
  const r = judgeReadOnlySmoke({ smokeOut: roTranscript({ seed: null }), dataDir: RO_DATA });
  assert.equal(r.ok, false);
  assert.match(r.message, /UV_CACHE_DIR/);
});

void test("judgeReadOnlySmoke: 种子落在这一轮的数据目录之外也红，并把落点与最可能的原因（钉住了老数据目录）写出来", () => {
  const elsewhere = SEED_LINE.replace(`${RO_DATA}\\tools\\uv-cache`, "C:\\Users\\x\\AppData\\Roaming\\Ruyin\\data\\tools\\uv-cache");
  const r = judgeReadOnlySmoke({ smokeOut: roTranscript({ seed: elsewhere }), dataDir: RO_DATA });
  assert.equal(r.ok, false);
  assert.match(r.message, /Roaming\\Ruyin\\data\\tools\\uv-cache/);
  assert.match(r.message, /data-location\.ts/);
});

void test("judgeReadOnlySmoke: 全对就过，detail 把 uvx 结果、种子数与落点带出来；行尾 \\r\\n 一样", () => {
  const r = judgeReadOnlySmoke({ smokeOut: roTranscript({ eol: "\r\n" }), dataDir: RO_DATA });
  assert.equal(r.ok, true, r.ok ? "" : r.message);
  assert.match(r.detail, /11678 个文件/);
  assert.match(r.detail, /uvx ok \(haris-musa\.excel-mcp-server, 25 tool\(s\)\)/);
});

void test("judgeReadOnlySmoke: 没拉随包工具（expectUvx=false）时只看壳的 OK，不去要种子", () => {
  const r = judgeReadOnlySmoke({
    smokeOut: roTranscript({ uvx: "no seeded uvx server to try", seed: null }),
    dataDir: RO_DATA,
    expectUvx: false,
  });
  assert.equal(r.ok, true);
  assert.equal(judgeReadOnlySmoke({ smokeOut: roTranscript({ ok: false }), dataDir: RO_DATA, expectUvx: false }).ok, false);
});

void test("denyWrites: 锁完 effective 说的是真话（非 root 就锁得住，root 就如实说锁不住），restore 之后树根与子目录都写得回来", () => {
  const { root } = tree();
  const sub = join(root, "uv", "cache");
  try {
    assert.equal(canWrite(root) && canWrite(sub), true, "起点：临时树可写");
    const lock = denyWrites(root, [root, sub]);
    try {
      assert.equal(typeof lock.effective, "boolean");
      assert.match(lock.how, /icacls|chmod/);
      const privileged = process.platform !== "win32" && typeof process.getuid === "function" && process.getuid() === 0;
      if (!privileged) {
        assert.equal(lock.effective, true, `${lock.how} 之后当前用户不该还能写`);
        assert.equal(canWrite(sub), false, "拒绝要传到子目录");
      }
    } finally {
      lock.restore();
    }
    assert.equal(canWrite(root), true, "恢复之后树根要写得回来");
    assert.equal(canWrite(sub), true, "恢复之后子目录也要写得回来");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
