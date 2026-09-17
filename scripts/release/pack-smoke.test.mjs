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

// uvx 与种子那几条判据 2026-09-18 一起去掉了（TD-042 ②：uv 不随安装包，包里没有那份
// 种子，缓存从一开始就写在数据目录）。**这一条守的是它们真的去掉了**：一份连 uvx 自检
// 都没报、一行种子都没有的只读演练必须照过 —— 留着那两条断言就是两条永远不会失败的
// 断言，而一条永不失败的断言读起来和一条在守着的一模一样。
void test("judgeReadOnlySmoke: 没有 uvx 自检、没有种子行也照过 —— Python 半边不随包了", () => {
  const r = judgeReadOnlySmoke({
    smokeOut: roTranscript({ uvx: "python runtime not installed (not-acquired)", seed: null }),
    dataDir: RO_DATA,
  });
  assert.equal(r.ok, true, r.ok ? "" : r.message);
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
