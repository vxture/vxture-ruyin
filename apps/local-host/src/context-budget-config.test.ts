/**
 * 上下文预算的宿主侧取值（TD-044）。
 *
 * 一条要紧：**非法值不能变成 0**。0 在内核里表示「不限」—— 一个手滑写错的环境
 * 变量把预算这道闸整个拆掉，而日志里什么都不会说。
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { contextBudgetFromEnv } from "./context-budget-config.js";

test("没配就用内核缺省", () => {
  assert.equal(contextBudgetFromEnv({}).bytes, undefined);
  assert.equal(contextBudgetFromEnv({ RUYIN_CONTEXT_BUDGET_KB: "  " }).bytes, undefined);
});

test("正整数按 KB 算", () => {
  assert.equal(contextBudgetFromEnv({ RUYIN_CONTEXT_BUDGET_KB: "256" }).bytes, 256 * 1024);
});

test("要不限得明写 unlimited，写错的值一律回落到缺省", () => {
  assert.equal(contextBudgetFromEnv({ RUYIN_CONTEXT_BUDGET_KB: "unlimited" }).bytes, 0);
  assert.equal(contextBudgetFromEnv({ RUYIN_CONTEXT_BUDGET_KB: "UNLIMITED" }).bytes, 0);
  for (const bad of ["0", "-5", "abc", "12.5"]) {
    assert.equal(
      contextBudgetFromEnv({ RUYIN_CONTEXT_BUDGET_KB: bad }).bytes,
      undefined,
      `"${bad}" 该回落到缺省，而不是变成 0（0 = 不限）`,
    );
  }
});

test("每种取法都给得出一句能进日志的话", () => {
  for (const env of [{}, { RUYIN_CONTEXT_BUDGET_KB: "256" }, { RUYIN_CONTEXT_BUDGET_KB: "unlimited" }, { RUYIN_CONTEXT_BUDGET_KB: "oops" }]) {
    assert.ok(contextBudgetFromEnv(env).note.length > 0);
  }
});
