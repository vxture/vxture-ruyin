/**
 * 端口审计（RY-001 §07 任务 50）。真去数端口那一步只有 Windows 上做得到，所以这里
 * 测的是**判读**：哪一行算监听、哪一个地址算「出得了这台机器」、以及数不出来时说什么。
 */

import { strict as assert } from "node:assert";
import test from "node:test";

import { describeAudit, isLoopback, nonLoopbackListeners, parseNetstat } from "./listener-audit.js";

// 真机上抓到的那一份（2026-09-18）：3000 那一行就是 aas-ee.open-websearch。
const NETSTAT = [
  "",
  "活动连接",
  "",
  "  协议  本地地址          外部地址        状态           PID",
  "  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       23392",
  "  TCP    127.0.0.1:7420         0.0.0.0:0              LISTENING       12028",
  "  TCP    [::1]:7421             [::]:0                 LISTENING       12028",
  "  TCP    [::]:445               [::]:0                 LISTENING       4",
  "  TCP    192.168.1.9:52344      140.82.114.6:443       ESTABLISHED     8316",
  "",
].join("\r\n");

test("只认监听行 —— 已建立的连接不是这条审计要问的问题", () => {
  const got = parseNetstat(NETSTAT);
  assert.deepEqual(got, [
    { address: "0.0.0.0", port: 3000, pid: 23392 },
    { address: "127.0.0.1", port: 7420, pid: 12028 },
    { address: "[::1]", port: 7421, pid: 12028 },
    { address: "[::]", port: 445, pid: 4 },
  ]);
  assert.deepEqual(parseNetstat(""), []);
  assert.deepEqual(parseNetstat(undefined as never), []);
});

test("回环不算；0.0.0.0 与 [::] 是「所有接口」，正是要抓的那一种", () => {
  assert.equal(isLoopback("127.0.0.1"), true);
  assert.equal(isLoopback("[::1]"), true);
  assert.equal(isLoopback("::1"), true);
  assert.equal(isLoopback("0.0.0.0"), false);
  assert.equal(isLoopback("[::]"), false);
  assert.equal(isLoopback("192.168.1.9"), false);
});

test("只看我们自己起的那些进程 —— 别人的端口不是我们的事", () => {
  const all = parseNetstat(NETSTAT);
  // 23392 是预置服务器：0.0.0.0:3000 要被抓出来。
  assert.deepEqual(nonLoopbackListeners(all, [23392, 12028]), [
    { address: "0.0.0.0", port: 3000, pid: 23392 },
  ]);
  // 4 号进程（系统的 445）不是我们起的，不该出现在结论里。
  assert.deepEqual(nonLoopbackListeners(all, [12028]), []);
  assert.deepEqual(nonLoopbackListeners(all, []), []);
});

test("数不出来要说数不出来 —— 空数组读起来是「查过了，没有」", () => {
  assert.match(describeAudit(undefined), /not checked/);
  assert.equal(describeAudit([]), "ok (no non-loopback listener)");
  assert.match(describeAudit([{ address: "0.0.0.0", port: 3000, pid: 1 }]), /FOUND 0\.0\.0\.0:3000/);
});
