import assert from "node:assert/strict";
import { test } from "node:test";
import { FolderPick } from "./folder-pick.js";

void test("FolderPick: 挂着等，壳送回路径就唤醒", async () => {
  let notified = 0;
  const p = new FolderPick(1000, () => (notified += 1));
  const pending = p.ask("D:/start");
  assert.equal(notified, 1, "该通知壳去弹框");
  assert.equal(p.start(), "D:/start", "壳要问起始目录");
  p.settle("D:/chosen");
  assert.deepEqual(await pending, { path: "D:/chosen" });
  // 结果领走之后就没人在等了 —— 起始目录也随之作废。
  assert.equal(p.start(), undefined);
});

void test("FolderPick: 用户取消是正常结果，不是错误", async () => {
  const p = new FolderPick(1000);
  const pending = p.ask();
  p.settle(undefined);
  assert.deepEqual(await pending, { cancelled: true });
});

void test("FolderPick: 第二次询问顶掉第一次 —— 否则误触会攒下一串永远等不到的请求", async () => {
  const p = new FolderPick(1000);
  const first = p.ask("A");
  const second = p.ask("B");
  assert.deepEqual(await first, { cancelled: true }, "前一个要被告知取消，而不是悬着");
  assert.equal(p.start(), "B");
  p.settle("C:/picked");
  assert.deepEqual(await second, { path: "C:/picked" });
});

void test("FolderPick: 超时按取消处理 —— 用户什么也没做错，界面不该报错", async () => {
  const p = new FolderPick(20);
  assert.deepEqual(await p.ask(), { cancelled: true });
  // 超时之后壳才把结果送回来：没人在等，安静丢掉，不能抛。
  p.settle("D:/late");
});
