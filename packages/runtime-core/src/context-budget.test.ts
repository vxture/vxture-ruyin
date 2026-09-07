/**
 * 上下文预算（TD-044）。
 *
 * 判据里点名的三件事，这里逐条问：**预算变了选择要跟着变**、**超预算时裁的是
 * 条目不是把某一条截断**、**必需的那一条不会被预算挤掉**。
 *
 * 再加两件不问就一定会踩的：广度优先（否则第一类吃光预算），以及预算再小也不
 * 清零（否则上层会把「预算太小」报成「你没绑目录」）。
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { selectWithinBudget, type RankedType } from "./context-budget.js";
import type { ContextItemMeta } from "./ports.js";

const item = (id: string, bytes: number, type = "doc"): ContextItemMeta => ({
  id,
  type,
  source: "connector",
  connector: "local-fs",
  ref: `/x/${id}`,
  name: id,
  bytes,
  modifiedAt: "2026-09-07T00:00:00.000Z",
});

const type = (
  name: string,
  items: ContextItemMeta[],
  required = false,
): RankedType => ({ type: name, required, ranked: items });

const ids = (r: { selected: ContextItemMeta[] }): string[] =>
  r.selected.map((i) => i.id);

test("预算变了，选择跟着变 —— 这是这条债的整个由来", () => {
  const types = [type("doc", [item("a", 100), item("b", 100), item("c", 100)])];

  const big = selectWithinBudget(types, { budgetBytes: 1000, maxPerType: 3 });
  assert.deepEqual(ids(big), ["a", "b", "c"]);

  const small = selectWithinBudget(types, { budgetBytes: 250, maxPerType: 3 });
  assert.deepEqual(ids(small), ["a", "b"], "预算只装得下两条就只给两条");

  // 此前那版按条数裁：这两次的结果会一模一样。
  assert.notDeepEqual(ids(big), ids(small));
});

test("超预算：**裁掉整条**，绝不把某一条截断", () => {
  const types = [type("doc", [item("small", 100), item("huge", 10_000)])];
  const r = selectWithinBudget(types, { budgetBytes: 500, maxPerType: 3 });

  assert.deepEqual(ids(r), ["small"]);
  assert.equal(r.usedBytes, 100);
  // 进来的那些，字节数与原来完全一致 —— 没有任何一条被改小过。
  // 截断会让成果里的引用指向原文里并不存在的半句话。
  for (const got of r.selected) {
    const src = types[0]!.ranked.find((i) => i.id === got.id)!;
    assert.equal(got.bytes, src.bytes, `${got.id} 被改动了`);
  }
  assert.deepEqual(
    r.dropped.map((d) => [d.item.id, d.reason]),
    [["huge", "over-budget"]],
  );
});

test("一条特别大的，挤掉的是它自己，不是它后面的一切", () => {
  const types = [type("doc", [item("huge", 10_000), item("ok", 100)], false)];
  // 排位靠前的那条放不下 —— 但不能就此收摊，后面还有放得下的。
  const r = selectWithinBudget(types, { budgetBytes: 500, maxPerType: 3 });
  assert.deepEqual(ids(r), ["ok"]);
});

test("必需类型的第一条一定进，即使超预算 —— 并如实标出来", () => {
  const types = [
    type("bid_doc", [item("must", 10_000, "bid_doc")], true),
    type("note", [item("n1", 50, "note")]),
  ];
  const r = selectWithinBudget(types, { budgetBytes: 500, maxPerType: 3 });

  assert.ok(ids(r).includes("must"), "必需的那条不该被预算挤掉");
  assert.deepEqual(
    r.overBudget.map((i) => i.id),
    ["must"],
    "超了要有人知道，不是默默超",
  );
  // 它已经吃光预算，后面的就装不下了 —— 这是可以接受的，但要看得出来。
  assert.deepEqual(ids(r), ["must"]);
  assert.deepEqual(
    r.dropped.map((d) => d.item.id),
    ["n1"],
  );
});

test("广度优先：先给每一类第一条，再回头给第二条", () => {
  const types = [
    type("a", [item("a1", 100), item("a2", 100), item("a3", 100)]),
    type("b", [item("b1", 100), item("b2", 100)]),
    type("c", [item("c1", 100)]),
  ];
  // 400 字节 = 四条。按类型顺序吃的话是 a1 a2 a3 b1，c 一条都没有 ——
  // 而任务声明了 c，正是因为它需要 c。
  const r = selectWithinBudget(types, { budgetBytes: 400, maxPerType: 3 });
  assert.deepEqual(ids(r), ["a1", "b1", "c1", "a2"]);
});

test("每类上限仍在：预算装得下也不让一类刷屏，且与预算裁的分开记", () => {
  const many = Array.from({ length: 6 }, (_, i) => item(`m${i}`, 10));
  const r = selectWithinBudget([type("doc", many)], {
    budgetBytes: 1_000_000,
    maxPerType: 2,
  });
  assert.deepEqual(ids(r), ["m0", "m1"]);
  assert.deepEqual(
    r.dropped.map((d) => d.reason),
    ["per-type-cap", "per-type-cap", "per-type-cap", "per-type-cap"],
    "这四条是被每类上限挡的，不是被预算挤的 —— 混成一件事就答不了「为什么它没进」",
  );
});

test("预算再小也不清零 —— 否则上层会把它报成「你没绑目录」", () => {
  const types = [type("doc", [item("only", 10_000)])];
  const r = selectWithinBudget(types, { budgetBytes: 1, maxPerType: 3 });
  assert.deepEqual(ids(r), ["only"]);
  assert.deepEqual(
    r.overBudget.map((i) => i.id),
    ["only"],
  );
  assert.deepEqual(r.dropped, [], "它进来了，就不该同时挂在被丢弃那一栏");
});

test("预算 <= 0 表示不限；空输入不抛错", () => {
  const types = [type("doc", [item("a", 1e9), item("b", 1e9)])];
  for (const budgetBytes of [0, -1]) {
    const r = selectWithinBudget(types, { budgetBytes, maxPerType: 3 });
    assert.deepEqual(ids(r), ["a", "b"], `预算 ${budgetBytes} 应视为不限`);
  }

  const empty = selectWithinBudget([], { budgetBytes: 100, maxPerType: 3 });
  assert.deepEqual(empty.selected, []);
  assert.equal(empty.usedBytes, 0);

  const noItems = selectWithinBudget([type("doc", [])], {
    budgetBytes: 100,
    maxPerType: 3,
  });
  assert.deepEqual(noItems.selected, []);
});

test("必需类型的第一条不会被再取一遍", () => {
  const types = [type("doc", [item("a", 10), item("b", 10)], true)];
  const r = selectWithinBudget(types, { budgetBytes: 1000, maxPerType: 3 });
  assert.deepEqual(ids(r), ["a", "b"], "a 不该出现两次");
  assert.equal(r.usedBytes, 20);
});
