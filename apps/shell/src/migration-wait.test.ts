import assert from "node:assert/strict";
import { test } from "node:test";
import { humanBytes, moveWaitMs } from "./migration-wait.js";

void test("moveWaitMs: 小数据也给足底限 —— 进程起来、开库、原生绑定自检都要时间", () => {
  assert.equal(moveWaitMs(0), 60_000);
  assert.equal(moveWaitMs(1024), 60_000);
});

void test("moveWaitMs: 跟着字节数走 —— 这正是原来那个固定 15 秒的问题", () => {
  // 实测基准：136 MB 的跨卷复制 + 逐文件核对约 11.7 秒。按 2 MB/s 估要 68 秒，
  // 也就是留了近 6 倍余量（机械盘、网络盘、杀毒软件扫描都比 SSD 慢得多）。
  const oneThirtySix = 136 * 1024 * 1024;
  assert.ok(moveWaitMs(oneThirtySix) > 60_000);
  // 5 GB 实测外推约 7 分钟；估到 40 分钟以上，而原来的上限是 15 秒。
  const fiveGiB = 5 * 1024 ** 3;
  assert.ok(moveWaitMs(fiveGiB) > 40 * 60_000, String(moveWaitMs(fiveGiB)));
  assert.ok(moveWaitMs(fiveGiB) <= 60 * 60_000);
});

void test("moveWaitMs: 上限封住；字节数不可信时按上限等，绝不半途杀进程", () => {
  assert.equal(moveWaitMs(500 * 1024 ** 3), 60 * 60_000);
  assert.equal(moveWaitMs(undefined), 60 * 60_000);
  assert.equal(moveWaitMs(Number.NaN), 60 * 60_000);
  assert.equal(moveWaitMs(-1), 60 * 60_000);
});

void test("humanBytes: 给那一屏一句人话；说不出来就什么都不说", () => {
  assert.equal(humanBytes(2 * 1024 ** 3), "2.0 GB");
  assert.equal(humanBytes(136 * 1024 ** 2), "136 MB");
  assert.equal(humanBytes(2048), "2 KB");
  assert.equal(humanBytes(undefined), "");
});
