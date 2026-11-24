/**
 * 任务调度（TD-045）。
 *
 * 队列本身的顺序在 `task-queue.test.ts` 里问过了；这里问的是**驱动器有没有守住
 * 上限**、**名额腾不腾得出来**、以及**取消是不是真的取消**。
 *
 * 用一个可控的假 Harness：每个任务的 `advance` 挂着不返回，直到用例自己放行 ——
 * 否则「同时在跑几个」这件事根本观测不到（真实 Harness 瞬间跑完，任何上限都测
 * 得出「没超过」）。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProjectRuntime } from "@vxture/ruyin-core";

import { TaskRunner, maxConcurrentFromEnv, DEFAULT_MAX_CONCURRENT_TASKS } from "./task-runner.js";

/** 让出事件循环，好让 spawn 里那些 `void promise.finally(...)` 跑到。 */
const tick = async (times = 3): Promise<void> => {
  for (let i = 0; i < times; i++) await Promise.resolve();
};

interface Fake {
  runtime: ProjectRuntime;
  /** 放行某个任务的 advance / recover。 */
  finish: (id: string, how?: "ok" | "throw") => Promise<void>;
  started: string[];
  cancelled: string[];
  mode: Map<string, "advance" | "recover">;
}

function fakeRuntime(interrupted: string[] = []): Fake {
  const started: string[] = [];
  const cancelled: string[] = [];
  const mode = new Map<string, "advance" | "recover">();
  const gates = new Map<string, { resolve: () => void; reject: (e: Error) => void }>();

  const hold = (id: string, how: "advance" | "recover") => {
    started.push(id);
    mode.set(id, how);
    return new Promise<void>((resolve, reject) => gates.set(id, { resolve, reject }));
  };

  const runtime = {
    createHarness: async () => ({
      advance: (id: string) => hold(id, "advance"),
      recover: (id: string) => hold(id, "recover"),
      cancel: async (id: string) => {
        cancelled.push(id);
        return { id, state: "cancelled" };
      },
    }),
    listProjects: async () => [{ id: "prj_1" }],
    listInterruptedTasks: async () => interrupted.map((id) => ({ id })),
  } as unknown as ProjectRuntime;

  return {
    runtime,
    started,
    cancelled,
    mode,
    finish: async (id, how = "ok") => {
      const gate = gates.get(id);
      if (!gate) throw new Error(`${id} 还没开始，放行不了`);
      if (how === "ok") gate.resolve();
      else gate.reject(new Error("boom"));
      await tick();
    },
  };
}

test("上限：超过的排队，不同时跑", async () => {
  const f = fakeRuntime();
  const runner = new TaskRunner(f.runtime, new Set(), undefined, { maxConcurrent: 2 });
  runner.start("prj_1", "a");
  runner.start("prj_1", "b");
  runner.start("prj_1", "c");
  await tick();

  assert.deepEqual(f.started, ["a", "b"], "第三个不该开始");
  assert.equal(runner.runningCount, 2);
  assert.equal(runner.queuedCount, 1);
  assert.equal(runner.activeCount, 3);
  assert.equal(runner.isQueued("c"), true);
  assert.equal(runner.queuePosition("c"), 1);
});

test("名额：一个跑完，队里下一个自己开始", async () => {
  const f = fakeRuntime();
  const runner = new TaskRunner(f.runtime, new Set(), undefined, { maxConcurrent: 1 });
  runner.start("prj_1", "a");
  runner.start("prj_1", "b");
  await tick();
  assert.deepEqual(f.started, ["a"]);

  await f.finish("a");
  assert.deepEqual(f.started, ["a", "b"], "a 跑完后 b 应该自己开始");
  assert.equal(runner.queuedCount, 0);
});

test("名额：**失败的任务同样腾出名额** —— 否则一次失败会把队列卡死", async () => {
  const f = fakeRuntime();
  const runner = new TaskRunner(f.runtime, new Set(), undefined, { maxConcurrent: 1 });
  runner.start("prj_1", "a");
  runner.start("prj_1", "b");
  await tick();

  await f.finish("a", "throw");
  assert.deepEqual(f.started, ["a", "b"], "a 失败之后 b 仍要开始");
});

test("取消：排队中的被取消之后不会再开始", async () => {
  const f = fakeRuntime();
  const runner = new TaskRunner(f.runtime, new Set(), undefined, { maxConcurrent: 1 });
  runner.start("prj_1", "a");
  runner.start("prj_1", "b");
  await tick();
  assert.equal(runner.isQueued("b"), true);

  await runner.cancel("prj_1", "b");
  assert.equal(runner.isQueued("b"), false, "取消要把它从队里拿走");
  assert.deepEqual(f.cancelled, ["b"], "同时也要落到 harness 上，才有持久状态与审计");

  await f.finish("a");
  assert.deepEqual(f.started, ["a"], "b 被取消了，不该因为 a 跑完而开始");
});

test("优先级：用户随后点的，排在启动扫出来的一堆恢复任务前面", async () => {
  const f = fakeRuntime(["r1", "r2", "r3"]);
  const runner = new TaskRunner(f.runtime, new Set(), undefined, { maxConcurrent: 1 });
  const picked = await runner.recoverAll();
  await tick();
  assert.equal(picked, 3);
  assert.deepEqual(f.started, ["r1"], "只有一个名额，其余排队");

  runner.start("prj_1", "mine");
  assert.equal(runner.queuePosition("mine"), 1, "用户那个排在两个恢复任务前面");

  await f.finish("r1");
  assert.deepEqual(f.started, ["r1", "mine"]);
  assert.equal(f.mode.get("mine"), "advance");
  assert.equal(f.mode.get("r1"), "recover", "恢复走的是 recover，不是 advance");
});

test("重复提交同一个任务：在跑的、在队里的，都不再入一次", async () => {
  const f = fakeRuntime();
  const runner = new TaskRunner(f.runtime, new Set(), undefined, { maxConcurrent: 1 });
  runner.start("prj_1", "a");
  runner.start("prj_1", "a");
  runner.start("prj_1", "b");
  runner.start("prj_1", "b");
  await tick();
  assert.deepEqual(f.started, ["a"]);
  assert.equal(runner.queuedCount, 1, "b 只该排一次");
});

test("上限取值：缺省 3、可被环境变量覆盖、非法值回落而不是变成 0", () => {
  assert.equal(maxConcurrentFromEnv({}), DEFAULT_MAX_CONCURRENT_TASKS);
  assert.equal(maxConcurrentFromEnv({ RUYIN_MAX_CONCURRENT_TASKS: "5" }), 5);
  // 0 会让每个任务都排队且永不出队 —— 一个把应用变成砖头的配置错，不静默生效。
  assert.equal(maxConcurrentFromEnv({ RUYIN_MAX_CONCURRENT_TASKS: "0" }), 3);
  assert.equal(maxConcurrentFromEnv({ RUYIN_MAX_CONCURRENT_TASKS: "-2" }), 3);
  assert.equal(maxConcurrentFromEnv({ RUYIN_MAX_CONCURRENT_TASKS: "abc" }), 3);
  assert.equal(maxConcurrentFromEnv({ RUYIN_MAX_CONCURRENT_TASKS: "2.5" }), 3);
});
