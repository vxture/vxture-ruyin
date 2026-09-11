/**
 * 产品界面能收到哪些事件（bridge-events.ts）。**白名单**：只有这个项目的 task /
 * project 两种；总线上别的事件 —— 包括以后新加的 —— 默认不给产品看。
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { bridgeEventOf } from "./bridge-events.js";
import type { RuntimeEvent } from "./events.js";

test("bridgeEventOf: 这个项目的任务与项目事件照形状给，别的项目的不给", () => {
  assert.deepEqual(bridgeEventOf({ kind: "task", projectId: "p1", taskInstance: "ti_1" }, "p1"), {
    topic: "task",
    payload: { taskInstance: "ti_1" },
  });
  assert.deepEqual(bridgeEventOf({ kind: "project", projectId: "p1" }, "p1"), { topic: "project", payload: {} });
  assert.equal(bridgeEventOf({ kind: "task", projectId: "p2", taskInstance: "ti_9" }, "p1"), undefined);
  assert.equal(bridgeEventOf({ kind: "project", projectId: "p2" }, "p1"), undefined);
});

/**
 * 工作台与壳之间的事件（请壳打开数据目录、请壳弹目录框、主题变了……）**一条都不给**。
 * 那些是给壳的指令；流进产品界面，产品就知道了它不该知道的工作台动静。
 */
test("bridgeEventOf: 总线上的其余事件一律不给产品看", () => {
  const others: RuntimeEvent[] = [
    { kind: "pending" },
    { kind: "component" },
    { kind: "ui-theme" },
    { kind: "app-restart" },
    { kind: "app-open-data-dir" },
    { kind: "app-pick-folder" },
  ];
  for (const e of others) assert.equal(bridgeEventOf(e, "p1"), undefined, e.kind);
});
