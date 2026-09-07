/**
 * check-tech-debt-table.mjs 自己的测试。
 *
 * 这道守卫存在的理由是「一张会算错的账，比没有账更危险」—— 它自己坏掉的方式恰好
 * 也是最安静的一种：判断条件写松了，每一行都「通过」，而它从此再也不会拦住任何
 * 东西，清点继续静静地数错。
 *
 * 所以**反向验证每一条规则**：每个用例都是一张只坏了一处的表，断言守卫真的拒，
 * 而且拒的理由说的就是那一处。外加一条正向的：干净的表要通过，且**报出来的
 * open/closed/standing 计数要对** —— 那三个数字是这道守卫真正的产出。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { fixtureRepo, tdRow, tdTable } from "./fixture-repo.mjs";

const GUARD = "check-tech-debt-table.mjs";
const FILE = "docs/60-operations/10-tech-debt.md";

/** 用给定的表跑一次守卫。 */
function check(table) {
  const repo = fixtureRepo("ruyin-td-");
  try {
    repo.write(FILE, table);
    return repo.run(GUARD);
  } finally {
    repo.clean();
  }
}

void test("干净的表通过，并且**三个计数都报对** —— 那三个数字才是它的产出", () => {
  const r = check(
    tdTable([
      tdRow({ id: "TD-001", status: "open" }),
      tdRow({ id: "TD-002", status: "closed" }),
      tdRow({ id: "TD-003", status: "closed" }),
      tdRow({ id: "TD-004", status: "standing" }),
    ]),
  );
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /4 条均可解析/);
  assert.match(r.out, /open 1 \/ closed 2 \/ standing 1/);
});

void test("正文里没转义的 `|` 会多切一列 —— 这正是它当初被写出来的那个事故", () => {
  // 反引号救不了它：GFM 即使在代码片段里也按 | 切列。
  const r = check(tdTable([tdRow({ why: "代码里写着 `a | b`，管道没转义" })]));
  assert.equal(r.code, 1);
  assert.match(r.out, /切出 6 格，应为 5/);
  assert.match(r.out, /反引号救不了它/, "要说清为什么加反引号没用");
});

void test("转义成 \\| 的管道**不该**被当成列分隔符 —— 否则正确的写法反而过不了", () => {
  const r = check(tdTable([tdRow({ why: "代码里写着 `a \\| b`，已转义" })]));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /1 条均可解析/);
});

void test("少一个列分隔符（条目与原因被并成一格）也要拦", () => {
  const r = check(tdTable(["| TD-001 | 条目和原因挤在一起 | 回收条件 | open |"]));
  assert.equal(r.code, 1);
  assert.match(r.out, /切出 4 格，应为 5/);
});

void test("状态只认 open / closed / standing —— 别的字一律拒", () => {
  for (const status of ["OPEN", "done", "进行中", ""]) {
    const r = check(tdTable([tdRow({ status })]));
    assert.equal(r.code, 1, `状态 ${JSON.stringify(status)} 应该被拒`);
    assert.match(r.out, /只允许 open \/ closed \/ standing/);
  }
});

void test("编号不复用：同一个 ID 出现两次要拦，并说出是哪两行", () => {
  const r = check(tdTable([tdRow({ id: "TD-007" }), tdRow({ id: "TD-007" })]));
  assert.equal(r.code, 1);
  assert.match(r.out, /TD-007 重复出现/);
  assert.match(r.out, /第 5 行与第 6 行/, "要说得出是哪两行，否则在几十行里找不到");
});

void test("一行都解析不到时**报错而不是报 0 条通过** —— 表格结构变了要有人知道", () => {
  const r = check("# 技术债\n\n（表格被谁删了）\n");
  assert.equal(r.code, 1);
  assert.match(r.out, /一行 TD 都没解析到/);
});

void test("表格之外的正文不影响解析 —— 它只认 `| TD-` 开头的行", () => {
  const table = tdTable([tdRow({ id: "TD-001" })]);
  const r = check(`${table}\n\n## 一段说明\n\n这里提到 TD-001 但不是表格行。\n`);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /1 条均可解析/);
});
