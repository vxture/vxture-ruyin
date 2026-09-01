/**
 * 更新检查（TD-021）。
 *
 * 这些用例守的是同一条：**没查到不是「已是最新」**。这个功能的上一版不发任何
 * 请求就断言「当前已是最新」并附时间戳——用户会信它。所以每一种查不成的情形
 * 都必须落在 `unreachable` 上，一种都不许折叠。
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { checkForUpdate } from "./updates.js";

const BASE = { currentVersion: "0.1.0", feedBase: "https://dl.test/ruyin/stable" };

function feed(body: string, status = 200): typeof fetch {
  return (async () =>
    new Response(body, {
      status,
      headers: { "content-type": "text/yaml" },
    })) as unknown as typeof fetch;
}

void test("检查：feed 版本更高 → available", async () => {
  const r = await checkForUpdate({
    ...BASE,
    fetchImpl: feed("version: 0.2.0\nreleaseDate: '2026-09-01T00:00:00Z'\n"),
  });
  assert.equal(r.status, "available");
  assert.equal(r.status === "available" && r.latest, "0.2.0");
  assert.equal(r.status === "available" && r.releasedAt, "2026-09-01T00:00:00Z");
});

void test("检查：feed 版本相同 → current，且带上比对过的版本号", async () => {
  const r = await checkForUpdate({ ...BASE, fetchImpl: feed("version: 0.1.0\n") });
  assert.equal(r.status, "current");
  // latest 必须在场：它是「真比对过」的凭据。
  assert.equal(r.status === "current" && r.latest, "0.1.0");
});

void test("检查：feed 版本更低 → 也算 current，不谎报有更新", async () => {
  const r = await checkForUpdate({ ...BASE, fetchImpl: feed("version: 0.0.9\n") });
  assert.equal(r.status, "current");
});

void test("检查：网络不通 → unreachable，绝不是「已是最新」", async () => {
  const r = await checkForUpdate({
    ...BASE,
    fetchImpl: (async () => {
      throw new Error("ENOTFOUND dl.test");
    }) as unknown as typeof fetch,
  });
  assert.equal(r.status, "unreachable");
  assert.match(r.status === "unreachable" ? r.reason : "", /unreachable/);
});

void test("检查：feed 返回 404 / 500 → unreachable", async () => {
  for (const status of [404, 500]) {
    const r = await checkForUpdate({ ...BASE, fetchImpl: feed("nope", status) });
    assert.equal(r.status, "unreachable", `status ${status}`);
  }
});

void test("检查：feed 不是可读 YAML → unreachable", async () => {
  const r = await checkForUpdate({ ...BASE, fetchImpl: feed("\tversion: [oops\n") });
  assert.equal(r.status, "unreachable");
});

void test("检查：feed 里没有版本号 → unreachable，不静默当作最新", async () => {
  const r = await checkForUpdate({ ...BASE, fetchImpl: feed("files: []\n") });
  assert.equal(r.status, "unreachable");
  assert.match(r.status === "unreachable" ? r.reason : "", /no version/);
});

void test("检查：任何情况下都带当前版本，界面不必自己猜", async () => {
  for (const impl of [feed("version: 0.9.0\n"), feed("x", 500)]) {
    const r = await checkForUpdate({ ...BASE, fetchImpl: impl });
    assert.equal(r.current, "0.1.0");
    assert.ok(r.checkedAt);
  }
});

/**
 * 安装闸门与意图（TD-021 策略 1、2）。
 *
 * 策略 1「有任务在跑就不装」若只在按钮上禁用，就是一道**只挡误触、不挡竞态**的
 * 闸门：用户点下去到壳真正动手之间可能隔着一整段下载。所以它必须在守护进程侧
 * 每次被问到时重判。
 */
import { installGate, InstallIntentBox } from "./updates.js";

void test("闸门：有任务在跑 → 不可安装，并说清有几个", () => {
  const g = installGate(2);
  assert.equal(g.installable, false);
  assert.equal(g.runningTasks, 2);
  assert.match(g.reason ?? "", /2 个任务/);
});

void test("闸门：没有任务 → 可安装", () => {
  assert.equal(installGate(0).installable, true);
});

void test("意图：取走即清，重启后不会重复触发", () => {
  const box = new InstallIntentBox();
  box.request("0.9.9", "2026-09-01T00:00:00Z");
  assert.equal(box.peek()?.version, "0.9.9");
  assert.equal(box.take()?.version, "0.9.9");
  // 取过之后就没有了 —— 否则壳每轮询一次就要装一次。
  assert.equal(box.take(), null);
  assert.equal(box.peek(), null);
});

void test("意图：可被丢弃——任务在期间起来了，不该悄悄留着等会儿装", () => {
  const box = new InstallIntentBox();
  box.request("0.9.9", "2026-09-01T00:00:00Z");
  box.clear();
  // 留着它等任务停了再装，等于替用户挑了时机（策略 2 不允许）。
  assert.equal(box.peek(), null);
});
