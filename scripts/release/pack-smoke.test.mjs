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

import { parseUiSelfCheck } from "./pack-smoke.mjs";

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
