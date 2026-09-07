/**
 * 用户对工具的策略（TD-050）—— Tool Gate 三层里此前永远是空的那一层。
 *
 * 这组用例问两件 TD 点名要一起守住的事：**硬底线不可被它放松**、**它是每个项目
 * 各自的**。外加一件不问就一定会踩的：存坏了的记录读回来不能被当成合法权限值
 * 送进闸门。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Tool } from "@vxture/ruyin-contract-schema";

import { parseToolPolicy, policyRefusal, withPolicy } from "./tool-policy.js";

const tool = (id: string, category: Tool["category"]): Tool =>
  ({ id, category, default: "ask", description: id, parameters: [] }) as unknown as Tool;

test("底线之下的放宽：**当场拒绝**，不是存下来再在读的时候忽略", () => {
  const send = tool("send_email", "external_send");
  const refusal = policyRefusal(send, "allow");
  assert.ok(refusal, "external_send 的底线是 ask，不能放宽到 allow");
  // 那句话要说得出「为什么」和「还能改到哪儿」—— 一条永远不生效的记录会让用户
  // 以为他关掉了那道确认，而每次仍然被问。
  assert.equal(refusal!.kind, "floor", "这是策略拒绝，不是请求写错");
  assert.match(refusal!.message, /send_email/);
  assert.match(refusal!.message, /external_send/);
  assert.match(refusal!.message, /deny/, "要告诉他往严的方向是可以的");
});

test("底线之上：收紧一律可以", () => {
  const send = tool("send_email", "external_send");
  assert.equal(policyRefusal(send, "ask"), undefined);
  assert.equal(policyRefusal(send, "deny"), undefined);
});

test("没有底线的类别：放宽是用户有权做的选择", () => {
  const read = tool("read_file", "local_read");
  assert.equal(policyRefusal(read, "allow"), undefined);
  assert.equal(policyRefusal(read, "deny"), undefined);
});

test("不是权限值的一律拒绝 —— 别让一个来路不明的字符串进到闸门里", () => {
  const read = tool("read_file", "local_read");
  const bad = policyRefusal(read, "maybe" as never)!;
  assert.match(bad.message, /不是一个权限值/);
  // **不是 floor**：一个拼错值的请求报成「策略不允许」，会让人去找一个不存在的策略。
  assert.equal(bad.kind, "bad_value");
});

test("读回来：认不出来的丢掉，当作用户没表态（回落到更保守的契约默认）", () => {
  assert.deepEqual(parseToolPolicy(undefined), {});
  assert.deepEqual(parseToolPolicy("not json"), {});
  assert.deepEqual(parseToolPolicy("[1,2]"), {}, "数组不是策略表");
  assert.deepEqual(parseToolPolicy("null"), {});
  assert.deepEqual(
    parseToolPolicy('{"a":"allow","b":"maybe","c":7,"d":"deny"}'),
    { a: "allow", d: "deny" },
    "\"maybe\" 和 7 会被 decideTool 当成合法权限值传下去 —— 必须在这里就丢掉",
  );
});

test("清掉一条 ≠ 设成默认此刻的那个值：契约会升级，钉死的记录不会跟着变", () => {
  const p = withPolicy({}, "read_file", "deny");
  assert.deepEqual(p, { read_file: "deny" });
  assert.deepEqual(withPolicy(p, "read_file", undefined), {}, "清掉就是没有这一条");
  // 原表不该被就地改掉 —— 上层是拿它比对「改之前是什么」的。
  assert.deepEqual(p, { read_file: "deny" });
});
