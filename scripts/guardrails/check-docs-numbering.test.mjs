/**
 * check-docs-numbering.mjs 自己的测试。
 *
 * 这道守卫认的是**文件名的形状**，而形状规则是三条正则。正则最容易出的事故是
 * 「放得太松」：多写一个 `?`、少写一个 `$`，从此什么名字都算合规 —— 而它照样
 * 打印一行 OK，没有任何东西会响。
 *
 * 所以两边都验：合规的每一族都要过（不能把正确的写法也拦掉），不合规的要被拦下
 * **并且报出是哪个文件**。外加一条最容易被忽略的：`--strict` 与非 strict 的退出码
 * 必须不同 —— CI 跑的是 strict，本地跑的是报告模式，两者混了等于 CI 上没有这道闸。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { fixtureRepo } from "./fixture-repo.mjs";

const GUARD = "check-docs-numbering.mjs";

/** 在一棵只有这些文档的假仓库里跑守卫。 */
function check(files, args = []) {
  const repo = fixtureRepo("ruyin-docs-");
  try {
    for (const f of files) repo.write(`docs/${f}`, "# x\n");
    return repo.run(GUARD, args);
  } finally {
    repo.clean();
  }
}

void test("三族合规命名都要认 —— 拦住正确的写法比漏掉错的更糟", () => {
  const ok = [
    "00-meta/00-index.md",
    "10-standards/140-repo-governance-standard.md",
    "30-design/30-contract-schema.md",
    "30-design/decisions/ADR-019-harness-strategy.md",
    "60-operations/TD-001-something.md",
    "20-specs/data_bidproposal_240_schema.md",
    "20-specs/design_runtime_100_ports.md",
    "20-specs/ops_release_310_channels.md",
    "README.md",
  ];
  const r = check(ok, ["--strict"]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, new RegExp(`OK - ${ok.length} docs`));
});

void test("没编号的被拦下，并且**点名是哪个文件**", () => {
  const r = check(["00-meta/00-index.md", "30-design/随手记.md"], ["--strict"]);
  assert.equal(r.code, 1);
  assert.match(r.out, /1 unnumbered/);
  assert.match(r.out, /docs\/30-design\/随手记\.md/, "要说出是哪个文件，否则得自己找");
  assert.match(r.out, /number it|delete it/, "要说出下一步能做什么");
});

void test("形状要卡紧：差一点的名字一律不算数", () => {
  for (const bad of [
    "3-design.md", // 只有一位数字
    "3000-design.md", // 四位
    "10design.md", // 少了连字符
    "ADR-19-x.md", // ADR 编号不足三位
    "data_bid-proposal_240_x.md", // domain 里有连字符
    "data_bidproposal_24_x.md", // band 不足三位
    "kind_domain_240_x.md", // kind 不在 data/design/ops 里
  ]) {
    const r = check([bad], ["--strict"]);
    assert.equal(r.code, 1, `${bad} 应该被拦下`);
  }
});

void test("**strict 与报告模式的退出码必须不同** —— 混了等于 CI 上没有这道闸", () => {
  const files = ["00-meta/00-index.md", "30-design/随手记.md"];
  const strict = check(files, ["--strict"]);
  const report = check(files, []);
  assert.equal(strict.code, 1, "CI 跑的是 strict，必须红");
  assert.equal(report.code, 0, "本地报告模式不该拦人");
  assert.match(report.out, /report mode \(non-blocking\)/);
  // 两边都要把违规文件列出来 —— 报告模式的价值全在那张清单上。
  for (const r of [strict, report]) assert.match(r.out, /随手记\.md/);
});

void test("没有 docs/ 就跳过，不报错 —— 别的仓库借用这支脚本时不该当场红", () => {
  const repo = fixtureRepo("ruyin-docs-none-");
  try {
    const r = repo.run(GUARD, ["--strict"]);
    assert.equal(r.code, 0);
    assert.match(r.out, /no docs\/ - skip/);
  } finally {
    repo.clean();
  }
});

void test("只看 .md —— 目录里别的文件不算文档，也不该被当成违规", () => {
  const repo = fixtureRepo("ruyin-docs-mixed-");
  try {
    repo.write("docs/00-meta/00-index.md", "# x\n");
    repo.write("docs/00-meta/diagram.png", "not markdown");
    repo.write("docs/00-meta/notes.txt", "not markdown");
    const r = repo.run(GUARD, ["--strict"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /OK - 1 docs/);
  } finally {
    repo.clean();
  }
});
