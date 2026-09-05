// ADR-019 探针 · llm-ruyin 纯函数 + 出处账本的单元测试（node:test，不 boot dsh）。
// 运行：node --test llm-ruyin.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RuyinCapabilityAdapter, VERDICT_BLOCK_TYPE,
  toTurnRequest, mapMessages, turnToChunks, classifyFailure, textOf, raceAbort, newDropped,
} from "./llm-ruyin.mjs";
import { MemoryTaskFacts } from "./task-facts.mjs";
import { ToolLedger, classifyToolResult, stripErrorPrefix } from "./tool-ledger.mjs";
import { TransientError } from "../../packages/runtime-core/dist/index.js";

const FACTS = Object.freeze({
  capability: "requirement_analysis", product: "bidproposal", taskId: "t1", workspace: "ws",
  objective: "obj", constraints: ["c1"], context: [{ type: "x", name: "n", content: { kind: "text", text: "t" }, origin: { kind: "caller" } }],
  tools: [{ id: "read_file", description: "local_read (risk: low)" }, { id: "write_document", description: "local_write (risk: medium)" }],
});
const VERIFY = { ...FACTS, capability: "verify:r", tools: [] };
/** 探针 R1 的形状：契约 ∩ dsh 可见 = 只剩 read_file。 */
const NARROW = { capability: "requirement_analysis", tools: [{ id: "read_file", description: "local_read (risk: low)" }] };

const user = (content, source = { kind: "user" }) => ({ id: "m", role: "user", content, source });
const asst = (content) => ({ id: "m", role: "assistant", content, source: { kind: "model", provider: "ruyin", model: "capability" } });
const toolResult = (callId, content, isError = false) => ({
  id: "m", role: "user", source: { kind: "tool", callId },
  content: [{ type: "tool-result", toolCallId: callId, content, isError }],
});
const text = (t) => [{ type: "text", text: t }];
const call = (id, name, args) => ({ type: "tool-call", id, name, arguments: args });
const options = (over = {}) => ({ provider: "ruyin", model: "capability", messages: [], sessionId: "t1", ...over });
const codeOf = (fn) => { try { fn(); } catch (e) { return e.code; } return undefined; };

// ---------------------------------------------------------------- toTurnRequest
test("toTurnRequest: all 11 fields, system never forwarded, tools intersected", () => {
  const facts = { ...FACTS, skills: [{ name: "xberg", description: "d" }], revision: { round: 1, failures: [{ rule: "r", reason: "x" }] } };
  const { request, dropped } = toTurnRequest(options({
    system: "You are an AI agent powered by DeepSeek Harness.",
    tools: [{ name: "read_file", description: "dsh text", parameters: {} }, { name: "dsh_only", description: "", parameters: {} }],
    temperature: 0.2, maxTokens: 10, stop: ["x"],
  }), facts);
  assert.deepEqual(Object.keys(request).sort(), ["capability", "constraints", "context", "messages", "objective", "product", "revision", "skills", "taskId", "tools", "workspace"]);
  assert.equal("system" in request, false);
  assert.deepEqual(request.tools, [{ id: "read_file", description: "local_read (risk: low)" }]);
  assert.deepEqual(request.skills, facts.skills);
  assert.deepEqual(request.revision, facts.revision);
  assert.equal(dropped.systemPromptChars, "You are an AI agent powered by DeepSeek Harness.".length);
  assert.equal(dropped.toolsNotVisible, 1);
  assert.equal(dropped.toolsNotInContract, 1);
});

test("toTurnRequest: skills only when non-empty, revision only when present", () => {
  const { request } = toTurnRequest(options(), { ...FACTS, skills: [] });
  assert.equal("skills" in request, false);
  assert.equal("revision" in request, false);
});

test("toTurnRequest: purpose set → UNSUPPORTED_PURPOSE; missing facts → NO_TASK_FACTS", () => {
  assert.equal(codeOf(() => toTurnRequest(options({ purpose: "compaction" }), FACTS)), "UNSUPPORTED_PURPOSE");
  assert.equal(codeOf(() => toTurnRequest(options(), undefined)), "NO_TASK_FACTS");
});

test("toTurnRequest: provenance callback reaches mapMessages", () => {
  const { request, dropped } = toTurnRequest(options({
    messages: [asst([call("c1", "read_file", "{}")]), toolResult("c1", text("Error: denied"), true)],
  }), FACTS, (id) => (id === "c1" ? { authored: "runtime", reason: "denied" } : undefined));
  assert.deepEqual(request.messages[1], { role: "tool", callId: "c1", content: "denied", isError: true });
  assert.equal(dropped.runtimeToolResults, 1);
});

// ---------------------------------------------------------------- mapMessages
test("mapMessages: user text kept; plugin/system/unknown dropped and counted; order preserved", () => {
  const { messages, dropped } = mapMessages([
    user(text("hi")),
    user(text("ctx"), { kind: "plugin", plugin: "@deepseek-ai/dsh-system-prompt", form: "snapshot", sections: [] }),
    user([], { kind: "plugin", plugin: "@vxture/ruyin" }),
    user(text("extra"), { kind: "plugin", plugin: "some-tool" }),
    { id: "m", role: "system", content: text("sys"), source: { kind: "user" } },
    { id: "m", role: "user", content: text("no source") }, // 缺 source：按 bug 计入 otherMessages
    asst(text("a")),
  ]);
  assert.deepEqual(messages, [{ role: "user", content: "hi" }, { role: "assistant", content: "a" }]);
  assert.equal(dropped.pluginMessages, 3);
  assert.equal(dropped.systemMessages, 1);
  assert.equal(dropped.otherMessages, 1);
});

test("mapMessages: user message without text blocks dropped", () => {
  const { messages, dropped } = mapMessages([user([{ type: "weird" }])]);
  assert.deepEqual(messages, []);
  assert.equal(dropped.emptyUserMessages, 1);
  assert.equal(dropped.nonTextBlocks, 1);
});

test("mapMessages: assistant text + tool-call → content + toolCalls with parsed args; '' args → {}", () => {
  const { messages } = mapMessages([asst([{ type: "text", text: "t" }, call("c1", "read_file", '{"path":"a"}'), call("c2", "other", "")])]);
  assert.deepEqual(messages, [{ role: "assistant", content: "t", toolCalls: [{ id: "c1", tool: "read_file", arguments: { path: "a" } }, { id: "c2", tool: "other", arguments: {} }] }]);
});

test("mapMessages: unparsable / non-object history args → INVALID_HISTORY", () => {
  assert.equal(codeOf(() => mapMessages([asst([call("c1", "x", "{nope")])])), "INVALID_HISTORY");
  assert.equal(codeOf(() => mapMessages([asst([call("c1", "x", "[1]")])])), "INVALID_HISTORY");
  assert.equal(codeOf(() => mapMessages([asst([call("c1", "x", "null")])])), "INVALID_HISTORY");
});

// dsh 运行时写的四种结果文本（拒绝 dsh-tools 3128-3140 / 3343-3346；未知工具 2449 + 3491-3503；取消 3550-3577；
// 循环补记的跳过 agent-loop 277-292）——对着内核的形状：裸 reason、isError、**无 origin**（harness.ts:1290-1295）。
test("mapMessages: tool results — the ledger decides: runtime-authored → bare reason + isError, no origin; tool-authored → origin", () => {
  const ledger = {
    c_ok: { authored: "tool", tool: "read_file" },
    c_thrown: { authored: "tool", tool: "read_file", reason: 'ENOENT: no such file "x"' },
    c_deny: { authored: "runtime", reason: 'the user rejected tool "read_file"' },
    c_unknown: { authored: "runtime", reason: 'unknown tool "write_document"', code: "UNKNOWN_TOOL" },
    c_abort: { authored: "runtime", reason: "tool call aborted", code: "ABORTED" },
    c_skip: { authored: "runtime", reason: "tool call aborted before dispatch", code: "ABORTED_BEFORE_DISPATCH" },
  };
  const calls = [call("c_ok", "read_file", "{}"), call("c_thrown", "read_file", "{}"), call("c_deny", "read_file", "{}"),
    call("c_unknown", "write_document", "{}"), call("c_abort", "read_file", "{}"), call("c_skip", "read_file", "{}")];
  const { messages, dropped } = mapMessages([
    asst(calls),
    toolResult("c_ok", text("data"), false),
    toolResult("c_thrown", text('Error: ENOENT: no such file "x"'), true),
    toolResult("c_deny", text('Error: the user rejected tool "read_file"'), true),
    toolResult("c_unknown", text('Error: unknown tool "write_document"'), true),
    toolResult("c_abort", text("Error: tool call aborted"), true),
    toolResult("c_skip", text("Error: tool call aborted before dispatch"), true),
    toolResult("orphan", text("x"), false),
  ], newDropped(), (id) => ledger[id]);
  assert.deepEqual(messages, [
    { role: "assistant", content: "", toolCalls: calls.map((c) => ({ id: c.id, tool: c.name, arguments: {} })) },
    { role: "tool", callId: "c_ok", content: "data", origin: { kind: "tool_result", tool: "read_file" } },
    { role: "tool", callId: "c_thrown", content: 'ENOENT: no such file "x"', isError: true, origin: { kind: "tool_result", tool: "read_file" } },
    { role: "tool", callId: "c_deny", content: 'the user rejected tool "read_file"', isError: true },
    { role: "tool", callId: "c_unknown", content: 'unknown tool "write_document"', isError: true },
    { role: "tool", callId: "c_abort", content: "tool call aborted", isError: true },
    { role: "tool", callId: "c_skip", content: "tool call aborted before dispatch", isError: true },
    { role: "tool", callId: "orphan", content: "x" },
  ]);
  for (const m of messages.slice(3)) assert.equal("origin" in m, false, `${m.callId} must not carry an origin`);
  assert.equal(dropped.runtimeToolResults, 4);
  assert.equal(dropped.unattributedToolResults, 1);
});

test("mapMessages: no provenance → content verbatim and NEVER an origin, even when the call is in history (fail closed)", () => {
  const { messages, dropped } = mapMessages([
    asst([call("c1", "read_file", "{}")]),
    toolResult("c1", text("Error: denied"), true),
    toolResult("c2", text("[spike] data"), false),
  ]);
  assert.deepEqual(messages.slice(1), [
    { role: "tool", callId: "c1", content: "Error: denied", isError: true },
    { role: "tool", callId: "c2", content: "[spike] data" },
  ]);
  assert.equal(dropped.unattributedToolResults, 2);
});

test("mapMessages: runtime-authored without a recorded reason falls back to stripping dsh's 'Error: ' prefix", () => {
  const { messages } = mapMessages([toolResult("c1", text("Error: tool call aborted before dispatch"), true)], newDropped(), () => ({ authored: "runtime" }));
  assert.deepEqual(messages, [{ role: "tool", callId: "c1", content: "tool call aborted before dispatch", isError: true }]);
});

test("mapMessages: verdict-only / reasoning-only assistant dropped; text '' kept; reasoning blocks dropped", () => {
  const { messages, dropped } = mapMessages([
    asst([{ type: VERDICT_BLOCK_TYPE, passed: true }]),
    asst([{ type: "reasoning", text: "thinking" }]),
    asst([{ type: "reasoning", text: "r" }, { type: "text", text: "" }]),
  ]);
  assert.deepEqual(messages, [{ role: "assistant", content: "" }]);
  assert.equal(dropped.verdictOnlyAssistant, 1);
  assert.equal(dropped.verdictBlocks, 1);
  assert.equal(dropped.emptyAssistantMessages, 1);
  assert.equal(dropped.reasoningBlocks, 2);
});

test("textOf joins text blocks with newline", () => {
  assert.equal(textOf([{ type: "text", text: "a" }, { type: "reasoning", text: "r" }, { type: "text", text: "b" }]), "a\nb");
});

// ---------------------------------------------------------------- turnToChunks
const noUsage = (chunks) => assert.equal(chunks.some((c) => c.type === "usage"), false);
const finishLast = (chunks) => { assert.equal(chunks.at(-1).type, "finish"); assert.equal(chunks.filter((c) => c.type === "finish").length, 1); };

test("turnToChunks: content 'x' and content '' → exact 4-chunk sequence", () => {
  for (const t of ["x", ""]) {
    const chunks = turnToChunks({ kind: "content", content: t }, FACTS, options());
    assert.deepEqual(chunks, [
      { type: "block-start", index: 0, blockType: "text" },
      { type: "text-delta", index: 0, text: t },
      { type: "block-end", index: 0, block: { type: "text", text: t } },
      { type: "finish", reason: { kind: "stop" } },
    ]);
    noUsage(chunks); finishLast(chunks);
  }
});

test("turnToChunks: two offered tool_calls → indices 0/1, raw JSON args, finish tool-calls", () => {
  const chunks = turnToChunks({ kind: "tool_calls", calls: [
    { id: "a", tool: "read_file", arguments: { path: "p" } },
    { id: "b", tool: "write_document", arguments: { path: "q", content: "c" } },
  ] }, FACTS, options());
  assert.deepEqual(chunks, [
    { type: "block-start", index: 0, blockType: "tool-call" },
    { type: "tool-call-delta", index: 0, id: "a", name: "read_file", argumentsDelta: '{"path":"p"}' },
    { type: "block-end", index: 0, block: { type: "tool-call", id: "a", name: "read_file", arguments: '{"path":"p"}' } },
    { type: "block-start", index: 1, blockType: "tool-call" },
    { type: "tool-call-delta", index: 1, id: "b", name: "write_document", argumentsDelta: '{"path":"q","content":"c"}' },
    { type: "block-end", index: 1, block: { type: "tool-call", id: "b", name: "write_document", arguments: '{"path":"q","content":"c"}' } },
    { type: "finish", reason: { kind: "tool-calls" } },
  ]);
  noUsage(chunks); finishLast(chunks);
});

test("turnToChunks: verdict in verify:* → verdict block; reason omitted when undefined", () => {
  const chunks = turnToChunks({ kind: "verdict", passed: true }, VERIFY, options());
  assert.deepEqual(chunks, [
    { type: "block-start", index: 0, blockType: VERDICT_BLOCK_TYPE },
    { type: "block-end", index: 0, block: { type: VERDICT_BLOCK_TYPE, passed: true } },
    { type: "finish", reason: { kind: "stop" } },
  ]);
  const withReason = turnToChunks({ kind: "verdict", passed: false, reason: "why" }, VERIFY, options());
  assert.deepEqual(withReason[1].block, { type: VERDICT_BLOCK_TYPE, passed: false, reason: "why" });
  noUsage(chunks); finishLast(chunks);
});

test("turnToChunks: failure codes", () => {
  const tc = (calls) => ({ kind: "tool_calls", calls });
  assert.equal(codeOf(() => turnToChunks({ kind: "verdict", passed: true }, FACTS, options())), "VERDICT_IN_GENERATION");
  assert.equal(codeOf(() => turnToChunks(tc([]), FACTS, options())), "EMPTY_RESPONSE");
  assert.equal(codeOf(() => turnToChunks(tc([{ id: "", tool: "read_file", arguments: {} }]), FACTS, options())), "INVALID_TURN");
  assert.equal(codeOf(() => turnToChunks(tc([{ id: "a", tool: "read_file", arguments: {} }, { id: "a", tool: "read_file", arguments: {} }]), FACTS, options())), "INVALID_TURN");
  assert.equal(codeOf(() => turnToChunks(tc([{ id: "used", tool: "read_file", arguments: {} }]), FACTS, options({ messages: [asst([call("used", "read_file", "{}")])] }))), "INVALID_TURN");
  assert.equal(codeOf(() => turnToChunks(tc([{ id: "a", tool: 7, arguments: {} }]), FACTS, options())), "INVALID_TURN");
  assert.equal(codeOf(() => turnToChunks(tc([{ id: "a", tool: "read_file", arguments: null }]), FACTS, options())), "INVALID_TURN");
  assert.equal(codeOf(() => turnToChunks(tc([{ id: "a", tool: "read_file", arguments: [] }]), FACTS, options())), "INVALID_TURN");
  assert.equal(codeOf(() => turnToChunks(tc("nope"), FACTS, options())), "INVALID_TURN");
  assert.equal(codeOf(() => turnToChunks({ kind: "reference", ref: "x" }, FACTS, options())), "CAPABILITY_ERROR");
  assert.equal(codeOf(() => turnToChunks(null, FACTS, options())), "CAPABILITY_ERROR");
});

// dsh 派发只看注册表可见性（dsh-tools 2907-2912），所以 offer 之外的工具必须在发出 chunk 之前拦下（ports.ts:244-247）。
test("turnToChunks: tool outside the request's offer → TOOL_NOT_OFFERED before any chunk", () => {
  const tc = (calls) => ({ kind: "tool_calls", calls });
  assert.equal(codeOf(() => turnToChunks(tc([{ id: "a", tool: "not_offered", arguments: {} }]), FACTS, options())), "TOOL_NOT_OFFERED");
  // 探针 R1 的形状：write_document 在契约里、不在 dsh 注册表里 → 不在 offer 里
  assert.equal(codeOf(() => turnToChunks(tc([{ id: "a", tool: "write_document", arguments: {} }]), NARROW, options())), "TOOL_NOT_OFFERED");
  // 混合批次：一个 offered、一个没 offer → 整批拒绝，零 chunk
  assert.equal(codeOf(() => turnToChunks(tc([{ id: "a", tool: "read_file", arguments: {} }, { id: "b", tool: "write_document", arguments: {} }]), NARROW, options())), "TOOL_NOT_OFFERED");
  assert.equal(turnToChunks(tc([{ id: "a", tool: "read_file", arguments: {} }]), NARROW, options()).length, 4);
});

// 验证轮 offer 恒为 []（harness.ts:1562）；内核对非判定升级 pending_human（1576-1584）——这里必须先于 dsh 执行拦下。
test("turnToChunks: verify:* answered with tool_calls → NON_VERDICT_IN_VERIFICATION (any shape, checked first)", () => {
  const tc = (calls) => ({ kind: "tool_calls", calls });
  assert.equal(codeOf(() => turnToChunks(tc([{ id: "a", tool: "read_file", arguments: {} }]), VERIFY, options())), "NON_VERDICT_IN_VERIFICATION");
  assert.equal(codeOf(() => turnToChunks(tc([]), VERIFY, options())), "NON_VERDICT_IN_VERIFICATION");
  assert.equal(codeOf(() => turnToChunks(tc("nope"), VERIFY, options())), "NON_VERDICT_IN_VERIFICATION");
  // content 在验证轮不是错误：宿主看"没有判定块"升级（探针 B2）
  assert.equal(turnToChunks({ kind: "content", content: "prose" }, VERIFY, options()).length, 4);
});

test("turnToChunks: ids the ledger says were emitted count as used even when the surface (post-compaction) no longer shows them", () => {
  const tc = (calls) => ({ kind: "tool_calls", calls });
  assert.equal(codeOf(() => turnToChunks(tc([{ id: "e1", tool: "read_file", arguments: {} }]), FACTS, options(), new Set(["e1"]))), "INVALID_TURN");
  assert.equal(turnToChunks(tc([{ id: "e2", tool: "read_file", arguments: {} }]), FACTS, options(), new Set(["e1"])).length, 4);
});

// ---------------------------------------------------------------- classifyFailure / raceAbort
test("classifyFailure: TransientError → TRANSPORT with cause; Error → CAPABILITY_ERROR; non-Error → String(x); empty message → fallback", () => {
  const t = new TransientError("fetch failed");
  const a = classifyFailure(t);
  assert.equal(a.code, "TRANSPORT"); assert.equal(a.message, "fetch failed"); assert.equal(a.cause, t);
  const b = classifyFailure(new Error("HTTP 404"));
  assert.equal(b.code, "CAPABILITY_ERROR"); assert.equal(b.message, "HTTP 404");
  const c = classifyFailure("boom");
  assert.equal(c.code, "CAPABILITY_ERROR"); assert.equal(c.message, "boom");
  assert.equal(classifyFailure(new TransientError("")).message, "capability surface unreachable");
  assert.equal(classifyFailure(new Error("")).message, "capability surface failed");
  const own = classifyFailure(a);
  assert.equal(own, a);
});

test("classifyFailure: hostile non-Error throws (throwing toString, null-prototype, symbol) still yield CAPABILITY_ERROR", () => {
  const hostile = { toString() { throw new Error("nope"); } };
  const h = classifyFailure(hostile);
  assert.equal(h.code, "CAPABILITY_ERROR"); assert.equal(h.message, "capability surface failed"); assert.equal(h.cause, hostile);
  const bare = classifyFailure(Object.create(null)); // String() 抛 TypeError
  assert.equal(bare.code, "CAPABILITY_ERROR"); assert.equal(bare.message, "capability surface failed");
  const sym = classifyFailure(Symbol("s"));
  assert.equal(sym.code, "CAPABILITY_ERROR"); assert.equal(sym.message, "Symbol(s)");
  assert.equal(classifyFailure("").message, "capability surface failed");
});

test("raceAbort: pre-aborted rejects ABORTED without awaiting; abort during wait rejects ABORTED; settle removes listener", async () => {
  const never = new Promise(() => {});
  const pre = new AbortController(); pre.abort();
  await assert.rejects(raceAbort(never, pre.signal), (e) => e.code === "ABORTED");

  const during = new AbortController();
  const p = raceAbort(never, during.signal);
  during.abort();
  await assert.rejects(p, (e) => e.code === "ABORTED");

  const ok = new AbortController();
  assert.equal(await raceAbort(Promise.resolve(42), ok.signal), 42);
  ok.abort(); // no listener left to fire
  assert.equal(await raceAbort(Promise.resolve(1), undefined), 1);
});

/** 只实现 raceAbort 用到的三个成员的信号桩，数监听器的加/减。 */
function countingSignal() {
  const listeners = new Set();
  return {
    aborted: false,
    added: 0,
    addEventListener(_type, fn) { this.added += 1; listeners.add(fn); },
    removeEventListener(_type, fn) { listeners.delete(fn); },
    get live() { return listeners.size; },
    fire() { this.aborted = true; for (const fn of [...listeners]) { listeners.delete(fn); fn(); } }, // once 语义
  };
}

test("raceAbort: listener add/remove is balanced on resolve, reject and abort (nothing dangles on dsh's signal)", async () => {
  const s1 = countingSignal();
  assert.equal(await raceAbort(Promise.resolve("v"), s1), "v");
  assert.deepEqual({ added: s1.added, live: s1.live }, { added: 1, live: 0 });

  const s2 = countingSignal();
  await assert.rejects(raceAbort(Promise.reject(new Error("x")), s2), /x/);
  assert.deepEqual({ added: s2.added, live: s2.live }, { added: 1, live: 0 });

  const s3 = countingSignal();
  const pending = Promise.withResolvers();
  const raced = raceAbort(pending.promise, s3);
  s3.fire();
  await assert.rejects(raced, (e) => e.code === "ABORTED");
  assert.deepEqual({ added: s3.added, live: s3.live }, { added: 1, live: 0 });
  pending.resolve("late"); // 孤儿应答落进已定案的 promise：无事发生
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(s3.live, 0);
});

// ---------------------------------------------------------------- ToolLedger
test("stripErrorPrefix strips exactly dsh's 'Error: ' prefix", () => {
  assert.equal(stripErrorPrefix("Error: x"), "x");
  assert.equal(stripErrorPrefix("Errors: x"), "Errors: x");
  assert.equal(stripErrorPrefix(undefined), undefined);
});

test("classifyToolResult: the four dsh result shapes", () => {
  const reached = { reached: true, isError: false };
  const threw = { reached: true, isError: true, message: "boom" };
  // createSuccessResult（3416-3446）：无 error → 工具的
  assert.deepEqual(classifyToolResult({ isError: false, content: [] }, reached), { authored: "tool" });
  // 工具体自己抛的（3196-3197）：工具体到达、message 相同
  assert.deepEqual(classifyToolResult({ isError: true, error: { message: "boom" } }, threw), { authored: "tool", reason: "boom" });
  // 拒绝 / pre-execute 流水线抛错（3128-3140, 3154）：工具体没到达
  assert.deepEqual(classifyToolResult({ isError: true, error: { message: "denied" } }, undefined), { authored: "runtime", reason: "denied" });
  assert.deepEqual(classifyToolResult({ isError: true, error: { message: "denied" } }, { reached: false }), { authored: "runtime", reason: "denied" });
  // HarnessError 编码的（未知工具 2449、取消 3550-3577、输出校验）：一律运行时
  assert.deepEqual(classifyToolResult({ isError: true, error: { message: 'unknown tool "w"', info: { name: "ToolNotFoundError", code: "UNKNOWN_TOOL" } } }, reached), { authored: "runtime", reason: 'unknown tool "w"', code: "UNKNOWN_TOOL" });
  assert.deepEqual(classifyToolResult({ isError: true, error: { message: "tool call aborted", info: { name: "AbortError", code: "ABORTED" } } }, reached), { authored: "runtime", reason: "tool call aborted", code: "ABORTED" });
  // post-execute block（3381-3389）：工具体成功了，最终却是 error → 不是工具说的
  assert.deepEqual(classifyToolResult({ isError: true, error: { message: "blocked by policy" } }, reached), { authored: "runtime", reason: "blocked by policy" });
  assert.deepEqual(classifyToolResult({ isError: true, error: { message: "rewritten" } }, threw), { authored: "runtime", reason: "rewritten" });
});

/** cordis ctx 的桩：只记 on() 的处理器。 */
function fakeCtx() {
  const handlers = new Map();
  return {
    handlers,
    on(name, fn) { handlers.set(name, fn); return () => handlers.delete(name); },
  };
}
const execOf = (callId, name = "read_file", sessionId = "s") => ({ callId, name, agent: { session: { id: sessionId } } });

test("ToolLedger.attach: tools/execute wraps the body transparently; tools/result records; per-session keys", async () => {
  const ctx = fakeCtx();
  const ledger = new ToolLedger();
  const dispose = ledger.attach(ctx);
  assert.deepEqual([...ctx.handlers.keys()].sort(), ["session/event", "tools/execute", "tools/result"]);
  const execute = ctx.handlers.get("tools/execute");
  const result = ctx.handlers.get("tools/result");

  // 成功
  const ok = { isError: false, content: [{ type: "text", text: "data" }] };
  assert.equal(await execute(execOf("c1"), async () => ok), ok);
  result(execOf("c1"), ok);
  assert.deepEqual(ledger.provenanceOf("s", "c1"), { tool: "read_file", authored: "tool" });

  // 工具体抛错（dispatchToolBody 已把它包成 toolErrorResult 再交给 next() 的调用方）
  const thrown = { isError: true, content: [], error: { message: "boom" } };
  assert.equal(await execute(execOf("c2"), async () => thrown), thrown);
  result(execOf("c2"), thrown);
  assert.deepEqual(ledger.provenanceOf("s", "c2"), { tool: "read_file", authored: "tool", reason: "boom" });

  // 拒绝：没有 tools/execute
  result(execOf("c3"), { isError: true, content: [], error: { message: "denied" } });
  assert.deepEqual(ledger.provenanceOf("s", "c3"), { tool: "read_file", authored: "runtime", reason: "denied" });

  // post-execute block：工具体成功，最终 isError
  await execute(execOf("c4"), async () => ok);
  result(execOf("c4"), { isError: true, content: [], error: { message: "blocked" } });
  assert.deepEqual(ledger.provenanceOf("s", "c4"), { tool: "read_file", authored: "runtime", reason: "blocked" });

  // 同一 callId、另一个会话：互不串
  assert.equal(ledger.provenanceOf("other", "c1"), undefined);
  result(execOf("c1", "write_document", "other"), { isError: true, content: [], error: { message: "unknown tool", info: { name: "ToolNotFoundError", code: "UNKNOWN_TOOL" } } });
  assert.deepEqual(ledger.provenanceOf("other", "c1"), { tool: "write_document", authored: "runtime", reason: "unknown tool", code: "UNKNOWN_TOOL" });
  assert.deepEqual(ledger.provenanceOf("s", "c1"), { tool: "read_file", authored: "tool" });

  // 没有 agent/session 的执行（嵌套 / 非循环调用）：不记、不挡
  assert.equal(await execute({ callId: "x", name: "read_file" }, async () => ok), ok);
  result({ callId: "x", name: "read_file" }, ok);

  // next() 拒绝时原样传播
  await assert.rejects(execute(execOf("c5"), async () => { throw new Error("pipeline"); }), /pipeline/);

  dispose();
  assert.equal(ctx.handlers.size, 0);
});

test("ToolLedger.attach: session/event tool/result with error.info covers calls the loop skipped; never overwrites a scheduler record", () => {
  const ctx = fakeCtx();
  const ledger = new ToolLedger();
  ledger.attach(ctx);
  const onEvent = ctx.handlers.get("session/event");
  const session = { id: "s" };
  const event = (callId, txt, error) => ({
    type: "tool/result",
    data: {
      turn: 1, step: 1,
      message: { role: "user", source: { kind: "tool", callId }, content: [{ type: "tool-result", toolCallId: callId, content: [{ type: "text", text: txt }], isError: true }] },
      ...(error ? { error } : {}),
    },
  });
  // 循环补记的跳过调用（agent-loop 277-292）
  onEvent(session, event("c9", "Error: tool call aborted before dispatch", { name: "AbortError", code: "ABORTED_BEFORE_DISPATCH" }));
  assert.deepEqual(ledger.provenanceOf("s", "c9"), { authored: "runtime", code: "ABORTED_BEFORE_DISPATCH", reason: "tool call aborted before dispatch" });
  // 没有 error 的事件（成功 / 拒绝 / 工具体抛错）不由这里判断
  onEvent(session, event("c10", "Error: denied"));
  assert.equal(ledger.provenanceOf("s", "c10"), undefined);
  // 已经有调度器记录的不被覆盖
  ctx.handlers.get("tools/result")(execOf("c11"), { isError: true, content: [], error: { message: "tool call aborted", info: { name: "AbortError", code: "ABORTED" } } });
  onEvent(session, event("c11", "Error: something else", { name: "AbortError", code: "ABORTED" }));
  assert.deepEqual(ledger.provenanceOf("s", "c11"), { tool: "read_file", authored: "runtime", reason: "tool call aborted", code: "ABORTED" });
  // 其它事件类型忽略
  onEvent(session, { type: "tool/call", data: { callId: "c12" } });
  assert.equal(ledger.provenanceOf("s", "c12"), undefined);
});

test("ToolLedger: emitted ids per session; forget clears everything for that session only", () => {
  const ledger = new ToolLedger();
  assert.equal(ledger.emittedCalls("s").size, 0);
  ledger.noteEmittedCalls("s", ["a", "b"]);
  ledger.noteEmittedCalls("s", ["b", "c"]);
  ledger.noteEmittedCalls("u", ["a"]);
  assert.deepEqual([...ledger.emittedCalls("s")].sort(), ["a", "b", "c"]);
  const ctx = fakeCtx();
  ledger.attach(ctx);
  ctx.handlers.get("tools/result")(execOf("a", "read_file", "s"), { isError: false, content: [] });
  ctx.handlers.get("tools/result")(execOf("a", "read_file", "u"), { isError: false, content: [] });
  ledger.forget("s");
  assert.equal(ledger.emittedCalls("s").size, 0);
  assert.equal(ledger.provenanceOf("s", "a"), undefined);
  assert.deepEqual([...ledger.emittedCalls("u")], ["a"]);
  assert.deepEqual(ledger.provenanceOf("u", "a"), { tool: "read_file", authored: "tool" });
});

// ---------------------------------------------------------------- adapter surface
test("providerRetryPolicy / resolveModel / providerInfo", async () => {
  const adapter = new RuyinCapabilityAdapter({ gateway: { turn: async () => ({}) }, facts: new MemoryTaskFacts() });
  assert.deepEqual(adapter.providerRetryPolicy("ruyin"), { mode: "normal", maxRetries: 2, retryableCodes: ["TRANSPORT", "EMPTY_RESPONSE"], initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0 });
  assert.deepEqual(await adapter.resolveModel("ruyin", "capability"), { provider: "ruyin", id: "capability", name: "Ruyin capability surface", inputModalities: ["text"] });
  assert.deepEqual(adapter.providerInfo("ruyin"), { id: "ruyin", name: "Ruyin capability surface" });
  assert.throws(() => new RuyinCapabilityAdapter({ gateway: { turn: async () => ({}) }, facts: new MemoryTaskFacts(), ledger: {} }), /provenanceOf/);
});

test("stream: content answer → 4 chunks; abort after the surface answered → ABORTED before any yield", async () => {
  const facts = new MemoryTaskFacts().set("t1", FACTS);
  const ac = new AbortController();
  const adapter = new RuyinCapabilityAdapter({
    gateway: { turn: async () => { ac.abort(); return { kind: "content", content: "late" }; } },
    facts,
  });
  const chunks = [];
  await assert.rejects((async () => { for await (const c of adapter.stream(options({ signal: ac.signal }))) chunks.push(c); })(), (e) => e.code === "ABORTED");
  assert.deepEqual(chunks, []);

  const logged = [];
  const plain = new RuyinCapabilityAdapter({ gateway: { turn: async () => ({ kind: "content", content: "hi" }) }, facts, log: (r) => logged.push(r) });
  const out = [];
  for await (const c of plain.stream(options({ system: "S" }))) out.push(c);
  assert.equal(out.length, 4);
  assert.deepEqual(out[3], { type: "finish", reason: { kind: "stop" } });
  assert.equal(logged[0].dropped.systemPromptChars, 1);
});

test("stream: gateway TransientError surfaces as LlmError TRANSPORT (the retry plugin routes on this code)", async () => {
  const facts = new MemoryTaskFacts().set("t1", FACTS);
  const adapter = new RuyinCapabilityAdapter({ gateway: { turn: async () => { throw new TransientError("503"); } }, facts });
  await assert.rejects((async () => { for await (const _ of adapter.stream(options())) { /* none */ } })(), (e) => e.code === "TRANSPORT" && e.name === "LlmError");
});

test("stream: with a ledger, emitted call ids are remembered before the first yield; reuse in a later turn → INVALID_TURN; unoffered tool → TOOL_NOT_OFFERED with nothing noted", async () => {
  const facts = new MemoryTaskFacts().set("t1", FACTS);
  const ledger = new ToolLedger();
  const answers = [
    { kind: "tool_calls", calls: [{ id: "call_1", tool: "read_file", arguments: { path: "a" } }] },
    { kind: "tool_calls", calls: [{ id: "call_1", tool: "read_file", arguments: { path: "b" } }] }, // 复用（表面上看不见：messages 仍是 []）
    { kind: "tool_calls", calls: [{ id: "call_2", tool: "write_document", arguments: {} }] },       // dsh 不可见 → 不在 offer
  ];
  const adapter = new RuyinCapabilityAdapter({ gateway: { turn: async () => answers.shift() }, facts, ledger });
  const dshTools = [{ name: "read_file", description: "", parameters: {} }];
  const collect = async () => { const out = []; for await (const c of adapter.stream(options({ tools: dshTools }))) out.push(c); return out; };
  assert.equal((await collect()).length, 4);
  assert.deepEqual([...ledger.emittedCalls("t1")], ["call_1"]);
  await assert.rejects(collect(), (e) => e.code === "INVALID_TURN");
  await assert.rejects(collect(), (e) => e.code === "TOOL_NOT_OFFERED");
  assert.deepEqual([...ledger.emittedCalls("t1")], ["call_1"]);
});

test("stream: ledger provenance reaches the request (runtime-authored result → bare reason, no origin)", async () => {
  const facts = new MemoryTaskFacts().set("t1", FACTS);
  const ledger = new ToolLedger();
  const ctx = fakeCtx();
  ledger.attach(ctx);
  ctx.handlers.get("tools/result")(execOf("c1", "read_file", "t1"), { isError: true, content: [], error: { message: "the user rejected tool \"read_file\"" } });
  const seen = [];
  const adapter = new RuyinCapabilityAdapter({ gateway: { turn: async (r) => { seen.push(r); return { kind: "content", content: "ok" }; } }, facts, ledger });
  for await (const _ of adapter.stream(options({ messages: [asst([call("c1", "read_file", "{}")]), toolResult("c1", text("Error: the user rejected tool \"read_file\""), true)] }))) { /* drain */ }
  assert.deepEqual(seen[0].messages[1], { role: "tool", callId: "c1", content: 'the user rejected tool "read_file"', isError: true });
});
