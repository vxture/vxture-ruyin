/**
 * 产品级凭据（bridge-token.ts，ADR-022 §3.2）。
 *
 * 这几条钉的是**一把钥匙能开什么、不能开什么、以及什么时候不再开**。端到端那
 * 四条（会话令牌打不了 /bridge、桥凭据打不了 /projects、跨项目读不到、正文不出）
 * 在 server 的用例里，这里只管凭据本身。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { BRIDGE_TOKEN_TTL_MS, BridgeTokens } from "./bridge-token.js";

void test("BridgeTokens: 签出来的凭据认得回它绑的那两件事实", () => {
  const t = new BridgeTokens();
  const { token } = t.mint({ projectId: "prj_a", productId: "bidproposal" });
  assert.deepEqual(t.verify(token), { projectId: "prj_a", productId: "bidproposal" });
});

void test("BridgeTokens: 每次签的都是新的一张，不复用", () => {
  const t = new BridgeTokens();
  const a = t.mint({ projectId: "prj_a", productId: "p" }).token;
  const b = t.mint({ projectId: "prj_a", productId: "p" }).token;
  assert.notEqual(a, b);
  // 两张都有效 —— 同一个项目开两个界面是正常的，后签的不该把先签的挤掉。
  assert.ok(t.verify(a));
  assert.ok(t.verify(b));
});

/**
 * 认不出、过期、根本不是这套凭据 —— **一律 undefined，不区分**。
 *
 * 区分了就等于告诉调用方「这张存在过但过期了」，那是一条免费的探测通道：
 * 拿一堆随机串来问，能问出哪些曾经被签发过。
 */
void test("BridgeTokens: 过期的、乱写的、空的，回答都一样（不给探测通道）", () => {
  const t = new BridgeTokens();
  const now = 1_000_000;
  const { token } = t.mint({ projectId: "prj_a", productId: "p" }, now);

  assert.ok(t.verify(token, now + BRIDGE_TOKEN_TTL_MS - 1), "没到期之前认得");
  assert.equal(t.verify(token, now + BRIDGE_TOKEN_TTL_MS), undefined, "到点就不认");
  assert.equal(t.verify("deadbeef", now), undefined);
  assert.equal(t.verify("", now), undefined);
  assert.equal(t.verify(undefined, now), undefined);
});

/**
 * **可撤销是这套东西存在的一半理由。**
 *
 * 少了这一条，项目关了之后它的产品界面还能继续读它 —— 而用户以为自己已经把那扇
 * 门带上了。这也是为什么用一张进程内的表，而不是 JWT 那种自证凭据：自证的签出去
 * 就收不回来。
 */
void test("BridgeTokens: 作废一个项目的凭据，只影响那个项目", () => {
  const t = new BridgeTokens();
  const a1 = t.mint({ projectId: "prj_a", productId: "p" }).token;
  const a2 = t.mint({ projectId: "prj_a", productId: "p" }).token;
  const b1 = t.mint({ projectId: "prj_b", productId: "p" }).token;

  assert.equal(t.revokeProject("prj_a"), 2);
  assert.equal(t.verify(a1), undefined);
  assert.equal(t.verify(a2), undefined);
  assert.ok(t.verify(b1), "别的项目不受牵连");
});

/** 过期的自己会掉，不靠有人来扫 —— 否则一台开着不关的机器会一直攒。 */
void test("BridgeTokens: 过期的条目会被清掉，不是留在表里只是认不出", () => {
  const t = new BridgeTokens();
  const now = 1_000_000;
  t.mint({ projectId: "prj_a", productId: "p" }, now);
  t.mint({ projectId: "prj_b", productId: "p" }, now);
  assert.equal(t.size(now), 2);
  assert.equal(t.size(now + BRIDGE_TOKEN_TTL_MS), 0);
});
