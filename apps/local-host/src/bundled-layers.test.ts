/**
 * 预置层缺省路径。
 *
 * 这组用例只问一件事：**换一个工作目录，答案变不变。**上一版的缺省是
 * `resolve("resources/skills")`，从仓根跑时它对，所以任何在仓根跑的测试都会
 * 给它绿灯 —— 而缺陷恰恰只在 cwd 不是仓根时出现（壳拉起守护进程就是这样）。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { bundledSkillsDir, bundledToolsDir, repoResource } from "./bundled-layers.js";

/** 从**本测试文件**算出的仓根 —— 与被测代码各算各的，才有比对的意义。 */
const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

test("缺省指向仓内 resources/，且是绝对路径", () => {
  assert.equal(bundledSkillsDir({}), resolve(repoRoot, "resources", "skills"));
  assert.equal(bundledToolsDir({}), resolve(repoRoot, "resources", "tools"));
});

test("换工作目录，缺省不变 —— 这才是这次修的东西", () => {
  const before = { skills: bundledSkillsDir({}), tools: bundledToolsDir({}) };
  const cwd = process.cwd();
  try {
    process.chdir(tmpdir());
    assert.equal(bundledSkillsDir({}), before.skills);
    assert.equal(bundledToolsDir({}), before.tools);
  } finally {
    process.chdir(cwd);
  }
});

test("两个预置层落在同一个 resources/ 下 —— uv 按 tools 的兄弟位置找", () => {
  assert.equal(resolve(bundledSkillsDir({}), ".."), resolve(bundledToolsDir({}), ".."));
  assert.equal(resolve(bundledToolsDir({}), "..", "uv"), repoResource("uv"));
});

test("环境变量压过缺省（装机态就走这条）", () => {
  const packaged = { RUYIN_SKILLS_DIR: "C:\\app\\resources\\skills", RUYIN_TOOLS_DIR: "C:\\app\\resources\\tools" };
  assert.equal(bundledSkillsDir(packaged), "C:\\app\\resources\\skills");
  assert.equal(bundledToolsDir(packaged), "C:\\app\\resources\\tools");
});

test("空串 / 全空白按「没设置」算，不把相对路径从另一扇门放回来", () => {
  // 空串若穿过去，tools 的兄弟位置推算（<tools>/../uv）就又变成相对路径 ——
  // 正是这次要修的那个缺陷。
  assert.equal(bundledSkillsDir({ RUYIN_SKILLS_DIR: "" }), bundledSkillsDir({}));
  assert.equal(bundledToolsDir({ RUYIN_TOOLS_DIR: "   " }), bundledToolsDir({}));
});
