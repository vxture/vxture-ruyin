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

import { describeTreeWrites, diffTree, parseUiSelfCheck, snapshotTree } from "./pack-smoke.mjs";

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
