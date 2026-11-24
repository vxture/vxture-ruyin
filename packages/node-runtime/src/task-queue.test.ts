/**
 * 任务队列（TD-045）。
 *
 * 这组用例问三件事：**顺序对不对**、**位置报得准不准**、**取消能不能真的拿走**。
 * 第三件最要紧 —— 一个被取消却留在队里的任务，会在前面的任务跑完时自己开始跑。
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { TaskQueue, type QueuedTask } from "./task-queue.js";

const t = (id: string, priority: QueuedTask["priority"] = "advance"): QueuedTask => ({
  projectId: "prj_1",
  taskInstanceId: id,
  priority,
});

test("队列：同档先来先服务", () => {
  const q = new TaskQueue();
  q.enqueue(t("a"));
  q.enqueue(t("b"));
  q.enqueue(t("c"));
  assert.equal(q.take()?.taskInstanceId, "a");
  assert.equal(q.take()?.taskInstanceId, "b");
  assert.equal(q.take()?.taskInstanceId, "c");
  assert.equal(q.take(), undefined);
});

test("队列：用户刚点的排在重启扫出来的前面", () => {
  const q = new TaskQueue();
  // 先排进一堆恢复任务 —— 这正是启动扫描会做的事。
  q.enqueue(t("r1", "recover"));
  q.enqueue(t("r2", "recover"));
  // 用户随后点了一个。
  q.enqueue(t("mine", "advance"));
  assert.equal(q.take()?.taskInstanceId, "mine", "用户那个应该先出");
  assert.equal(q.take()?.taskInstanceId, "r1");
  assert.equal(q.take()?.taskInstanceId, "r2");
});

test("队列：位置按真实出队顺序算，不按入队下标", () => {
  const q = new TaskQueue();
  q.enqueue(t("r1", "recover"));
  q.enqueue(t("r2", "recover"));
  q.enqueue(t("mine", "advance"));
  // 它是数组里的第三个，但下一个就轮到它。**报「第 3 位」会让用户以为要等很久。**
  assert.equal(q.positionOf("mine"), 1);
  assert.equal(q.positionOf("r1"), 2);
  assert.equal(q.positionOf("r2"), 3);
  assert.equal(q.positionOf("不在队里"), 0);
});

test("队列：同一个任务不重复入队", () => {
  const q = new TaskQueue();
  assert.equal(q.enqueue(t("a")), true);
  assert.equal(q.enqueue(t("a")), false, "重复入队要被拒");
  assert.equal(q.size, 1);
});

test("队列：取消能把它从队里真的拿走 —— 否则它会自己开始跑", () => {
  const q = new TaskQueue();
  q.enqueue(t("a"));
  q.enqueue(t("b"));
  assert.equal(q.remove("a"), true);
  assert.equal(q.has("a"), false);
  assert.equal(q.remove("a"), false, "拿第二次要说没有");
  assert.equal(q.take()?.taskInstanceId, "b", "被取消的那个不该再被取出");
});

test("队列：snapshot 按出队顺序，不改动队列本身", () => {
  const q = new TaskQueue();
  q.enqueue(t("r1", "recover"));
  q.enqueue(t("mine", "advance"));
  assert.deepEqual(
    q.snapshot().map((x) => x.taskInstanceId),
    ["mine", "r1"],
  );
  assert.equal(q.size, 2, "看一眼不该把队列看空");
});

test("队列：空队列的每个问法都有答案，不抛错", () => {
  const q = new TaskQueue();
  assert.equal(q.size, 0);
  assert.equal(q.take(), undefined);
  assert.equal(q.has("x"), false);
  assert.equal(q.remove("x"), false);
  assert.equal(q.positionOf("x"), 0);
  assert.deepEqual(q.snapshot(), []);
});
