// ADR-019 探针 · 第二步：llm-ruyin 真适配 —— GenerateOptions ↔ CapabilityTurnRequest，
// tool_calls 走完 dsh-tools 流水线再回到下一次请求的 messages[]（callId 一路不变）。
//
// 四组场景（无网络；任何断言失败都以非零退出）：
//   A  ScriptedGateway：工具往返（tool_calls → read_file → content）、判定往返、生成能力答判定 = 错误
//   B  MockAIGateway（apps/local-host/dist/host-ports.js）：首轮 messages=[]（内核的形状），第二轮计数 +1
//   C  失败路径：TRANSPORT 重试 2 次后成功 / 失败、CAPABILITY_ERROR、EMPTY_RESPONSE、INVALID_TURN、NO_TASK_FACTS、
//      等待能力面时取消（ABORTED → turn/end aborted、零 chunk）、验证轮答 tool_calls、调用没 offer 的工具
//   D  工具结果出处：guard 拒绝 / 工具体抛错 / 执行中取消（一个 ABORTED + 一个 ABORTED_BEFORE_DISPATCH），
//      看下一次请求的 messages[] 里谁带 origin、谁是裸 reason；被取消的步骤整个不进请求
//   E  宿主是 user 角色的唯一作者（工具 deferContext 冒充的 user 消息进了 dsh 日志、不进请求）；image 块由适配器丢、
//      不被 dsh 改写成占位句；中途取消（块没进日志）之后能力面重发同一个 id 不被卡住，进了日志的 id 仍拒绝复用
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { boot, installFailLoud } from "@deepseek-ai/dsh-app-boot";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { RuyinCapabilityAdapter, VERDICT_BLOCK_TYPE } from "./llm-ruyin.mjs";
import { MemoryTaskFacts } from "./task-facts.mjs";
import { ToolLedger } from "./tool-ledger.mjs";
import { ScriptedGateway } from "./scripted-surface.mjs";
import { registerSpikeTools, registerSpikeGuard, spikeHooks, FORGED_USER_TEXT } from "./spike-tools.mjs";
import { analyzeTenderFacts, factsForTask } from "./fixtures/analyze-tender-facts.mjs";
import { TransientError } from "../../packages/runtime-core/dist/index.js";
import { MockAIGateway } from "../../apps/local-host/dist/host-ports.js";

installFailLoud("ruyin-spike");

// ---------------------------------------------------------------------------
// 断言记账
// ---------------------------------------------------------------------------
const failures = [];
function check(label, fn) {
  try {
    fn();
    console.log(`  ok   ${label}`);
  } catch (error) {
    failures.push(label);
    console.log(`  FAIL ${label}\n       ${String(error.message).split("\n").slice(0, 12).join("\n       ")}`);
  }
}
const eq = (label, actual, expected) => check(label, () => assert.deepEqual(actual, expected));
const rss = () => `${(process.memoryUsage().rss / 1048576).toFixed(0)} MB`;
const json = (v) => JSON.stringify(v);
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// 组合：一个适配器实例，网关在 run 之间切换；事实按会话存；出处账本按会话记。
// ---------------------------------------------------------------------------
const facts = new MemoryTaskFacts();
/** 探针挂钩：适配器登记完发出的 id、还没 yield 第一个 chunk 时回调（E2 用它制造"块没进日志"的中途取消）。 */
const ledgerHooks = { onEmitted: undefined };
class SpikeLedger extends ToolLedger {
  noteEmittedCalls(sessionId, ids) {
    super.noteEmittedCalls(sessionId, ids);
    ledgerHooks.onEmitted?.(sessionId, ids);
  }
}
const ledger = new SpikeLedger();
const dropLog = [];
let gateway = null;
const gatewaySwitch = { turn: (request) => gateway.turn(request) };
const adapter = new RuyinCapabilityAdapter({ gateway: gatewaySwitch, facts, ledger, log: (r) => dropLog.push(r) });

const tBoot = performance.now();
const ctx = await boot("ruyin-spike", resolve("cordis.yml"), [], async (ctx) => {
  ctx.plugin({
    name: "llm-ruyin",
    inject: ["llm", "tools"],
    apply(ctx) {
      ctx.llm.registerAdapter(["ruyin"], adapter);
      registerSpikeTools(ctx);
      registerSpikeGuard(ctx);
      ledger.attach(ctx);
    },
  });
});
const bootMs = Math.round(performance.now() - tBoot);
console.log(`[probe] booted in ${bootMs} ms; rss ${rss()}; providers = ${json(ctx.llm.listProviders())}; tools = ${json(ctx.tools.schemas().map((t) => t.name))}`);

// 全局订阅：普通 ctx 上的 session/event 收到所有会话（dsh-session index.d.ts:53-64）。
const allEvents = [];
ctx.on("session/event", (session, event) => allEvents.push({ session: session.id, type: event.type }));

const kickoff = () => createUserMessage({ content: [], source: { kind: "plugin", plugin: "@vxture/ruyin" } });

/** 宿主发出的每条消息先登记 id 再 followup：适配器只把名单上的 user 消息当用户说的。 */
function hostFollowup(handle, message) {
  facts.noteHostMessage(handle.agent.id, message.id);
  handle.agent.followup(message);
}

/** patch + followup + whenIdle 必须是一个操作：followup 不能在过期的事实下跑。 */
async function runTurn(handle, patch, message = kickoff()) {
  facts.patch(handle.agent.id, patch);
  const before = handle.agent.session.seq;
  const t0 = performance.now();
  hostFollowup(handle, message);
  await handle.agent.whenIdle();
  const ms = Math.round(performance.now() - t0);
  const events = handle.agent.session.snapshotEvents(before);
  return { events, ms };
}

async function withAgent(sessionId, taskFacts, fn) {
  if (taskFacts) facts.set(sessionId, taskFacts);
  const handle = await ctx.agents.create({ sessionId, agentOptions: { provider: "ruyin", model: "capability" } });
  const agentErrors = [];
  handle.agent.ctx.on("agent/error", (payload) => agentErrors.push({ turn: payload.turn, step: payload.step, code: payload.error?.code ?? payload.error?.failure?.code }));
  try {
    await fn(handle, agentErrors);
  } finally {
    await handle.dispose();
    facts.delete(sessionId);
    ledger.forget(sessionId);
  }
}

const ESSENTIAL = /^(turn\/|step\/|user\/message|assistant\/message|tool\/|llm\/retry$)/;
const essentialTypes = (events) => events.map((e) => e.type).filter((t) => ESSENTIAL.test(t));
const chunkCount = (events) => events.filter((e) => e.type === "assistant/chunk").length;
const assistantContents = (events) => events.filter((e) => e.type === "assistant/message").map((e) => e.data.message.content);
const assistantText = (events) => assistantContents(events).at(-1)?.find((b) => b.type === "text")?.text;
const turnEnd = (events) => events.filter((e) => e.type === "turn/end").at(-1)?.data.reason;
const retries = (events) => events.filter((e) => e.type === "llm/retry").map((e) => ({ retry: e.data.retry, delayMs: e.data.delayMs, code: e.data.failure.code }));
const findEvent = (events, type) => events.find((e) => e.type === type);
const toolResults = (events) => events.filter((e) => e.type === "tool/result").map((e) => ({
  callId: e.data.message.source.callId,
  text: e.data.message.content[0].content.map((b) => b.text).join("\n"),
  isError: e.data.message.content[0].isError,
  error: e.data.error ?? null, // 事件上只有 HarnessError 的 info（agent-loop 306）；拒绝 / 工具体抛错在这里是 null
}));
const toolCallCount = (events) => events.filter((e) => e.type === "tool/call").length;

// ===========================================================================
// RUN A · ScriptedGateway：工具往返 / 判定往返 / 生成能力答判定
// ===========================================================================
console.log("\n[run A] ScriptedGateway · session t1");
const scripted = new ScriptedGateway([
  { kind: "tool_calls", calls: [{ id: "call_1", tool: "read_file", arguments: { path: "tender.pdf" } }] },
  { kind: "content", content: "需求矩阵（探针）" },
  { kind: "verdict", passed: false, reason: "条目 3 无原文出处" },
  { kind: "verdict", passed: true },
]);
gateway = scripted;
const timings = { boot: bootMs, turns: [] };

await withAgent("t1", analyzeTenderFacts, async (handle, agentErrors) => {
  // --- A1：tool_calls → dsh 执行 read_file → content -------------------------------------
  const a1 = await runTurn(handle, {});
  timings.turns.push({ run: "A1", ms: a1.ms });
  console.log(`[A1] ${a1.ms} ms; events: ${a1.events.map((e) => e.type).join(" → ")}`);
  eq("A1 essential event order", essentialTypes(a1.events), [
    "turn/start", "step/start", "user/message", "assistant/message", "tool/call", "tool/result", "step/end",
    "step/start", "assistant/message", "step/end", "turn/end",
  ]);
  eq("A1 chunk count (4 + 4)", chunkCount(a1.events), 8);
  eq("A1 chunk sequence step 1", a1.events.filter((e) => e.type === "assistant/chunk" && e.data.step === 1).map((e) => e.data.chunk), [
    { type: "block-start", index: 0, blockType: "tool-call" },
    { type: "tool-call-delta", index: 0, id: "call_1", name: "read_file", argumentsDelta: '{"path":"tender.pdf"}' },
    { type: "block-end", index: 0, block: { type: "tool-call", id: "call_1", name: "read_file", arguments: '{"path":"tender.pdf"}' } },
    { type: "finish", reason: { kind: "tool-calls" } },
  ]);
  eq("A1 assistant #1 = tool-call block with the surface's id", assistantContents(a1.events)[0], [
    { type: "tool-call", id: "call_1", name: "read_file", arguments: '{"path":"tender.pdf"}' },
  ]);
  const toolCall = findEvent(a1.events, "tool/call");
  const toolResult = findEvent(a1.events, "tool/result");
  eq("A1 tool/call keyed on call_1", { callId: toolCall?.data.callId, name: toolCall?.data.name, args: toolCall?.data.arguments }, { callId: "call_1", name: "read_file", args: '{"path":"tender.pdf"}' });
  eq("A1 tool/result message shape", {
    role: toolResult?.data.message.role,
    source: toolResult?.data.message.source,
    block: toolResult?.data.message.content[0],
  }, {
    role: "user",
    source: { kind: "tool", callId: "call_1" },
    block: { type: "tool-result", toolCallId: "call_1", content: [{ type: "text", text: "[spike] contents of tender.pdf" }], isError: false },
  });
  eq("A1 ledger: call_1 authored by the tool (body reached, no error)", ledger.provenanceOf("t1", "call_1"), { tool: "read_file", authored: "tool" });
  eq("A1 assistant #2 = text", assistantContents(a1.events)[1], [{ type: "text", text: "需求矩阵（探针）" }]);
  eq("A1 no usage on any assistant/message", a1.events.filter((e) => e.type === "assistant/message").map((e) => "usage" in e.data), [false, false]);
  eq("A1 turn/end completed", turnEnd(a1.events), { kind: "completed" });

  const [R1, R2] = scripted.requests;
  console.log(`[A1] R1 = ${json(R1)}`);
  console.log(`[A1] R2 = ${json(R2)}`);
  eq("R1 routing + contract facts", { capability: R1.capability, product: R1.product, taskId: R1.taskId, workspace: R1.workspace, objective: R1.objective, constraints: R1.constraints },
    { capability: "requirement_analysis", product: "bidproposal", taskId: "t1", workspace: "ws_spike", objective: "解析招标文件，生成需求矩阵", constraints: ["需求条目必须可回溯到招标原文"] });
  eq("R1 context = fixture (data with origin)", R1.context, analyzeTenderFacts.context);
  eq("R1 messages = [] (fresh task, kernel shape)", R1.messages, []);
  eq("R1 tools = contract ∩ dsh registry", R1.tools, [{ id: "read_file", description: "local_read (risk: low)" }]);
  eq("R2 messages = assistant toolCalls + tool result, callId unchanged, origin from the ledger", R2.messages, [
    { role: "assistant", content: "", toolCalls: [{ id: "call_1", tool: "read_file", arguments: { path: "tender.pdf" } }] },
    { role: "tool", callId: "call_1", content: "[spike] contents of tender.pdf", origin: { kind: "tool_result", tool: "read_file" } },
  ]);
  eq("no request carries a system key", scripted.requests.map((r) => "system" in r), [false, false]);
  eq("adapter saw systemPromptChars = 0 on both steps", dropLog.slice(0, 2).map((r) => r.dropped.systemPromptChars), [0, 0]);
  eq("R2 ledger counts: 0 runtime-authored, 0 cancelled; no 'unattributed' bucket exists any more", { runtime: dropLog[1].dropped.runtimeToolResults, cancelled: dropLog[1].dropped.droppedCancelledCalls, hasUnattributed: "unattributedToolResults" in dropLog[1].dropped }, { runtime: 0, cancelled: 0, hasUnattributed: false });

  // --- A2：verify:<rule> → 判定块 ---------------------------------------------------------
  const a2 = await runTurn(handle, { capability: "verify:source_traceability", tools: [] });
  timings.turns.push({ run: "A2", ms: a2.ms });
  console.log(`[A2] ${a2.ms} ms; events: ${a2.events.map((e) => e.type).join(" → ")}`);
  eq("A2 turn/end completed", turnEnd(a2.events), { kind: "completed" });
  eq("A2 assistant = ruyin-verdict block (a field, not a sentence)", assistantContents(a2.events), [[{ type: VERDICT_BLOCK_TYPE, passed: false, reason: "条目 3 无原文出处" }]]);
  const R3 = scripted.requests[2];
  console.log(`[A2] R3 = ${json(R3)}`);
  eq("R3 capability + tools=[]", { capability: R3.capability, tools: R3.tools }, { capability: "verify:source_traceability", tools: [] });
  eq("R3 messages = full conversation, both kick-offs dropped", R3.messages, [
    { role: "assistant", content: "", toolCalls: [{ id: "call_1", tool: "read_file", arguments: { path: "tender.pdf" } }] },
    { role: "tool", callId: "call_1", content: "[spike] contents of tender.pdf", origin: { kind: "tool_result", tool: "read_file" } },
    { role: "assistant", content: "需求矩阵（探针）" },
  ]);

  // --- A3：生成能力答判定 → VERDICT_IN_GENERATION --------------------------------------------
  const a3 = await runTurn(handle, { capability: "requirement_analysis", tools: analyzeTenderFacts.tools });
  timings.turns.push({ run: "A3", ms: a3.ms });
  console.log(`[A3] ${a3.ms} ms; events: ${a3.events.map((e) => e.type).join(" → ")}`);
  eq("A3 turn/end error VERDICT_IN_GENERATION", turnEnd(a3.events)?.kind === "error" ? turnEnd(a3.events).error.code : turnEnd(a3.events), "VERDICT_IN_GENERATION");
  eq("A3 agent/error emitted", agentErrors.map((e) => e.code), ["VERDICT_IN_GENERATION"]);
  // 适配器抛错 → LlmRuntime.adapterStream 产出唯一一个终态 finish（dsh-llm index.js:1690-1693, 1743-1756），
  // 循环把它也记成 assistant/chunk（agent-loop 628-633）：所以是"恰好一个 chunk 且是 error finish"，不是零。
  eq("A3 only chunk is the terminal error finish (no content emitted)", a3.events.filter((e) => e.type === "assistant/chunk").map((e) => e.data.chunk), [
    { type: "finish", reason: { kind: "error", failure: { message: 'capability "requirement_analysis" answered with a verdict, which only verification rules use', code: "VERDICT_IN_GENERATION" } } },
  ]);
  const R4 = scripted.requests[3];
  eq("R4 messages = R3 messages (verdict-only assistant dropped from history)", R4.messages, R3.messages);
  eq("A total requests = 4, script empty", { n: scripted.requests.length, left: scripted.remaining }, { n: 4, left: 0 });
});

// ===========================================================================
// RUN B · MockAIGateway（真实 dist 模块）
// ===========================================================================
console.log("\n[run B] MockAIGateway · session t2");
const mock = new MockAIGateway();
const mockSeen = [];
gateway = { turn: async (request) => { const answer = await mock.turn(request); mockSeen.push({ request: structuredClone(request), answer }); return answer; } };

await withAgent("t2", factsForTask("t2"), async (handle) => {
  const b1 = await runTurn(handle, {});
  timings.turns.push({ run: "B1", ms: b1.ms });
  console.log(`[B1] ${b1.ms} ms; request = ${json(mockSeen[0].request)}\n[B1] answer = ${json(mockSeen[0].answer)}`);
  eq("B1 mock echo proves messages=[] on the first turn", assistantText(b1.events), "[mock:requirement_analysis] task t2, 0 message(s) in context");
  eq("B1 turn/end completed", turnEnd(b1.events), { kind: "completed" });

  const b2 = await runTurn(handle, { capability: "verify:source_traceability", tools: [] });
  timings.turns.push({ run: "B2", ms: b2.ms });
  console.log(`[B2] ${b2.ms} ms; request = ${json(mockSeen[1].request)}\n[B2] answer = ${json(mockSeen[1].answer)}`);
  eq("B2 count grew by the previous answer only", assistantText(b2.events), "[mock:verify:source_traceability] task t2, 1 message(s) in context");
  // content 应答在验证轮不是错误：它到不了工具流水线，宿主看到"没有判定块"就升级 pending_human（harness.ts:1576-1584）。
  // 只有 tool_calls 必须在适配器里拦（C8）——那会让 dsh 真的执行。
  eq("B2 no verdict block → host would escalate (pending_human)", assistantContents(b2.events).at(-1).some((b) => b.type === VERDICT_BLOCK_TYPE), false);
  eq("B2 turn/end completed", turnEnd(b2.events), { kind: "completed" });
});

// ===========================================================================
// RUN C · 失败路径
// ===========================================================================
console.log("\n[run C] failure paths");
async function failureCase(label, sessionId, script, expect) {
  const g = new ScriptedGateway(script);
  gateway = g;
  await withAgent(sessionId, expect.noFacts ? undefined : factsForTask(sessionId), async (handle, agentErrors) => {
    if (expect.noFacts) facts.set(sessionId, factsForTask(sessionId)), facts.delete(sessionId); // 确认 patch 之前没有事实
    let result;
    if (expect.noFacts) {
      // runTurn 会 patch；无事实时直接 followup。
      const before = handle.agent.session.seq;
      const t0 = performance.now();
      hostFollowup(handle, kickoff());
      await handle.agent.whenIdle();
      result = { events: handle.agent.session.snapshotEvents(before), ms: Math.round(performance.now() - t0) };
    } else {
      result = await runTurn(handle, expect.patch ?? {});
    }
    timings.turns.push({ run: label, ms: result.ms });
    const end = turnEnd(result.events);
    console.log(`[${label}] ${result.ms} ms; turn/end = ${json(end)}; retries = ${json(retries(result.events))}; requests = ${g.requests.length}`);
    eq(`${label} turn/end`, end?.kind === "error" ? { kind: "error", code: end.error.code } : end, expect.end);
    eq(`${label} llm/retry events`, retries(result.events), expect.retries);
    eq(`${label} requests received`, g.requests.length, expect.requests);
    if (expect.text !== undefined) eq(`${label} assistant text`, assistantText(result.events), expect.text);
    if (expect.onlyErrorFinish) {
      eq(`${label} only chunk is the terminal error finish (no content emitted)`,
        result.events.filter((e) => e.type === "assistant/chunk").map((e) => ({ type: e.data.chunk.type, kind: e.data.chunk.reason?.kind, code: e.data.chunk.reason?.failure?.code })),
        [{ type: "finish", kind: "error", code: expect.end.code }]);
    }
    if (expect.noToolCalls) {
      eq(`${label} zero tool/call events (dsh never dispatched)`, toolCallCount(result.events), 0);
      eq(`${label} agent/error carries the code`, agentErrors.map((e) => e.code), [expect.end.code]);
    }
    if (expect.lastRequest) eq(`${label} last request shape`, expect.lastRequest.pick(g.requests.at(-1)), expect.lastRequest.expected);
  });
}

const transient = (msg) => ({ throw: new TransientError(msg) });
await failureCase("C1", "t3a", [transient("capability provider unreachable: fetch failed"), transient("capability provider returned 503"), { kind: "content", content: "ok" }],
  { end: { kind: "completed" }, retries: [{ retry: 1, delayMs: 500, code: "TRANSPORT" }, { retry: 2, delayMs: 1000, code: "TRANSPORT" }], requests: 3, text: "ok" });
await failureCase("C2", "t3b", [transient("503"), transient("503"), transient("503")],
  { end: { kind: "error", code: "TRANSPORT" }, retries: [{ retry: 1, delayMs: 500, code: "TRANSPORT" }, { retry: 2, delayMs: 1000, code: "TRANSPORT" }], requests: 3 });
await failureCase("C3", "t3c", [{ throw: new Error('capability "x" failed: HTTP 404') }],
  { end: { kind: "error", code: "CAPABILITY_ERROR" }, retries: [], requests: 1 });
await failureCase("C4", "t3d", [{ kind: "tool_calls", calls: [] }, { kind: "tool_calls", calls: [] }, { kind: "tool_calls", calls: [] }],
  { end: { kind: "error", code: "EMPTY_RESPONSE" }, retries: [{ retry: 1, delayMs: 500, code: "EMPTY_RESPONSE" }, { retry: 2, delayMs: 1000, code: "EMPTY_RESPONSE" }], requests: 3 });
await failureCase("C5", "t3e", [{ kind: "tool_calls", calls: [{ id: "", tool: "read_file", arguments: {} }] }],
  { end: { kind: "error", code: "INVALID_TURN" }, retries: [], requests: 1, onlyErrorFinish: true });
await failureCase("C6", "t4", [{ kind: "content", content: "never" }],
  { end: { kind: "error", code: "NO_TASK_FACTS" }, retries: [], requests: 0, noFacts: true });

// --- C7：等待能力面时取消 -------------------------------------------------------------------
// 适配器在 raceAbort 里等；cancel → 信号 → raceAbort 拒绝 ABORTED → adapterStream 产出 finish{aborted}
// （dsh-llm 1743-1756）——但循环在 append 每个 chunk 之前先 signal.throwIfAborted()（agent-loop 626-627），
// 所以那个 finish 到不了日志：零 assistant/chunk；turn() 的 catch 记 turn/end{aborted}（579-584），不发 agent/error。
console.log("\n[C7] cancel while the surface is pending · session t3f");
{
  const pending = Promise.withResolvers();
  const received = [];
  gateway = { turn: (request) => { received.push(structuredClone(request)); return pending.promise; } };
  await withAgent("t3f", factsForTask("t3f"), async (handle, agentErrors) => {
    facts.patch("t3f", {});
    const before = handle.agent.session.seq;
    const t0 = performance.now();
    hostFollowup(handle, kickoff());
    while (received.length === 0) await tick(1);
    handle.agent.cancel({ kind: "user" });
    await handle.agent.whenIdle();
    const ms = Math.round(performance.now() - t0);
    timings.turns.push({ run: "C7", ms });
    const events = handle.agent.session.snapshotEvents(before);
    console.log(`[C7] ${ms} ms; events: ${events.map((e) => e.type).join(" → ")}`);
    eq("C7 turn/end aborted with the cancel cause", turnEnd(events), { kind: "aborted", reason: { kind: "user" } });
    eq("C7 zero assistant/chunk (the aborted finish never reaches the log)", chunkCount(events), 0);
    eq("C7 zero assistant/message, zero tool/call", { messages: assistantContents(events).length, calls: toolCallCount(events) }, { messages: 0, calls: 0 });
    eq("C7 no agent/error for a cancel", agentErrors, []);
    eq("C7 exactly one request reached the surface", received.length, 1);
    // 孤儿应答：能力面晚到的结果落进已定案的 promise —— 会话里什么都不再发生（raceAbort 的 then 分支只摘监听器）。
    const seqAfter = handle.agent.session.seq;
    pending.resolve({ kind: "content", content: "late" });
    await tick(5);
    eq("C7 orphan answer appends nothing", handle.agent.session.seq, seqAfter);
    eq("C7 agent idle after the orphan answer", await handle.agent.whenIdle().then(() => "idle"), "idle");
  });
}

// --- C8：验证轮答 tool_calls → NON_VERDICT_IN_VERIFICATION（dsh 不得执行） -------------------
await failureCase("C8", "t3g", [{ kind: "tool_calls", calls: [{ id: "call_v", tool: "read_file", arguments: { path: "tender.pdf" } }] }],
  { end: { kind: "error", code: "NON_VERDICT_IN_VERIFICATION" }, retries: [], requests: 1, onlyErrorFinish: true, noToolCalls: true,
    patch: { capability: "verify:source_traceability", tools: [] },
    lastRequest: { pick: (r) => ({ capability: r.capability, tools: r.tools }), expected: { capability: "verify:source_traceability", tools: [] } } });
// --- C9：生成轮调用契约里有、dsh 没注册（= 没 offer）的 write_document → TOOL_NOT_OFFERED ------
await failureCase("C9", "t3h", [{ kind: "tool_calls", calls: [{ id: "call_w", tool: "write_document", arguments: { path: "out.docx", content: "x" } }] }],
  { end: { kind: "error", code: "TOOL_NOT_OFFERED" }, retries: [], requests: 1, onlyErrorFinish: true, noToolCalls: true,
    lastRequest: { pick: (r) => r.tools, expected: [{ id: "read_file", description: "local_read (risk: low)" }] } });

// ===========================================================================
// RUN D · 工具结果出处：拒绝 / 工具体抛错 / 执行中取消 → 下一次请求的 messages[]
// ===========================================================================
console.log("\n[run D] tool-result provenance · session t5");
const provScript = new ScriptedGateway([
  { kind: "tool_calls", calls: [{ id: "call_d1", tool: "read_file", arguments: { path: "/etc/passwd" } }] },   // guard 拒绝
  { kind: "content", content: "after denial" },
  { kind: "tool_calls", calls: [{ id: "call_d2", tool: "read_file", arguments: { path: "missing.pdf" } }] },   // 工具体抛错
  { kind: "content", content: "after tool error" },
  { kind: "tool_calls", calls: [                                                                              // 执行中取消
    { id: "call_d3", tool: "read_file", arguments: { path: "hang.pdf" } },
    { id: "call_d4", tool: "read_file", arguments: { path: "tender.pdf" } },
  ] },
  { kind: "content", content: "after abort" },
]);
gateway = provScript;

await withAgent("t5", factsForTask("t5"), async (handle, agentErrors) => {
  // --- D1：guard 拒绝（工具体不被到达；事件无 error.info） ----------------------------------------
  const d1 = await runTurn(handle, {});
  timings.turns.push({ run: "D1", ms: d1.ms });
  console.log(`[D1] ${d1.ms} ms; events: ${d1.events.map((e) => e.type).join(" → ")}`);
  eq("D1 turn/end completed", turnEnd(d1.events), { kind: "completed" });
  eq("D1 tool/result = dsh-composed denial text, isError, no error.info on the event", toolResults(d1.events), [
    { callId: "call_d1", text: 'Error: path "/etc/passwd" is outside the workspace', isError: true, error: null },
  ]);
  eq("D1 ledger: runtime-authored, bare reason, no code (guard has no HarnessError)", ledger.provenanceOf("t5", "call_d1"),
    { tool: "read_file", authored: "runtime", reason: 'path "/etc/passwd" is outside the workspace' });
  const DR2 = provScript.requests[1];
  console.log(`[D1] R2 = ${json(DR2.messages)}`);
  eq("D1 next request: bare reason, isError, NO origin (= harness.ts:1290-1295)", DR2.messages, [
    { role: "assistant", content: "", toolCalls: [{ id: "call_d1", tool: "read_file", arguments: { path: "/etc/passwd" } }] },
    { role: "tool", callId: "call_d1", content: 'path "/etc/passwd" is outside the workspace', isError: true },
  ]);
  eq("D1 next request: no 'origin' key at all on the refusal", "origin" in DR2.messages[1], false);

  // --- D2：工具体自己抛错（工具体被到达；事件无 error.info） --------------------------------------
  const d2 = await runTurn(handle, {});
  timings.turns.push({ run: "D2", ms: d2.ms });
  console.log(`[D2] ${d2.ms} ms; events: ${d2.events.map((e) => e.type).join(" → ")}`);
  eq("D2 turn/end completed", turnEnd(d2.events), { kind: "completed" });
  eq("D2 tool/result = 'Error: ' + the tool's own message, no error.info", toolResults(d2.events), [
    { callId: "call_d2", text: 'Error: ENOENT: no such file "missing.pdf"', isError: true, error: null },
  ]);
  eq("D2 ledger: tool-authored (body reached, message is the body's)", ledger.provenanceOf("t5", "call_d2"),
    { tool: "read_file", authored: "tool", reason: 'ENOENT: no such file "missing.pdf"' });
  const DR4 = provScript.requests[3];
  console.log(`[D2] R4 = ${json(DR4.messages)}`);
  eq("D2 next request tail: the tool's message, isError, WITH origin (= harness.ts:1415-1423)", DR4.messages.slice(-2), [
    { role: "assistant", content: "", toolCalls: [{ id: "call_d2", tool: "read_file", arguments: { path: "missing.pdf" } }] },
    { role: "tool", callId: "call_d2", content: 'ENOENT: no such file "missing.pdf"', isError: true, origin: { kind: "tool_result", tool: "read_file" } },
  ]);

  // --- D3：执行中取消：call_d3 挂起 → ABORTED（工具体已进）；call_d4 未启动 → ABORTED_BEFORE_DISPATCH（循环补记） ---
  spikeHooks.onHang = () => setTimeout(() => handle.agent.cancel({ kind: "user" }), 0);
  const d3 = await runTurn(handle, {});
  spikeHooks.onHang = undefined;
  timings.turns.push({ run: "D3", ms: d3.ms });
  console.log(`[D3] ${d3.ms} ms; events: ${d3.events.map((e) => e.type).join(" → ")}`);
  eq("D3 turn/end aborted", turnEnd(d3.events), { kind: "aborted", reason: { kind: "user" } });
  eq("D3 no agent/error for a cancel", agentErrors, []);
  eq("D3 chunk count = the tool-call step streamed fully (2 calls × 3 + finish)", chunkCount(d3.events), 7);
  eq("D3 tool/result ×2: dsh abort texts, both with error.info", toolResults(d3.events), [
    { callId: "call_d3", text: "Error: tool call aborted", isError: true, error: { name: "AbortError", code: "ABORTED" } },
    { callId: "call_d4", text: "Error: tool call aborted before dispatch", isError: true, error: { name: "AbortError", code: "ABORTED_BEFORE_DISPATCH" } },
  ]);
  eq("D3 ledger: call_d3 runtime/ABORTED (via tools/result), call_d4 runtime/ABORTED_BEFORE_DISPATCH (via session event only)", {
    d3: ledger.provenanceOf("t5", "call_d3"), d4: ledger.provenanceOf("t5", "call_d4"),
  }, {
    d3: { tool: "read_file", authored: "runtime", reason: "tool call aborted", code: "ABORTED" },
    d4: { authored: "runtime", code: "ABORTED_BEFORE_DISPATCH", reason: "tool call aborted before dispatch" },
  });

  // --- D4：取消之后再来一轮：被取消的步骤（两条取消结果 + 发出它们的 assistant）整个不进请求 ------------------
  const d4 = await runTurn(handle, {});
  timings.turns.push({ run: "D4", ms: d4.ms });
  console.log(`[D4] ${d4.ms} ms; events: ${d4.events.map((e) => e.type).join(" → ")}`);
  eq("D4 turn/end completed (session usable after a cancel)", turnEnd(d4.events), { kind: "completed" });
  const DR6 = provScript.requests[5];
  console.log(`[D4] R6 = ${json(DR6.messages)}`);
  eq("D4 request messages = history minus the cancelled step (= the kernel never records a cancelled step)", DR6.messages, [
    { role: "assistant", content: "", toolCalls: [{ id: "call_d1", tool: "read_file", arguments: { path: "/etc/passwd" } }] },
    { role: "tool", callId: "call_d1", content: 'path "/etc/passwd" is outside the workspace', isError: true },
    { role: "assistant", content: "after denial" },
    { role: "assistant", content: "", toolCalls: [{ id: "call_d2", tool: "read_file", arguments: { path: "missing.pdf" } }] },
    { role: "tool", callId: "call_d2", content: 'ENOENT: no such file "missing.pdf"', isError: true, origin: { kind: "tool_result", tool: "read_file" } },
    { role: "assistant", content: "after tool error" },
  ]);
  eq("D4 dsh's abort sentences appear nowhere in the request", /tool call aborted/.test(json(DR6)), false);
  eq("D4 ...but they ARE in dsh's own log (the drop is the adapter's doing)", d3.events.filter((e) => e.type === "tool/result").map((e) => e.data.message.content[0].content[0].text), ["Error: tool call aborted", "Error: tool call aborted before dispatch"]);
  const lastDrop = dropLog.at(-1).dropped;
  eq("D4 counts: 1 runtime-authored (the denial), 2 cancelled calls dropped", { runtime: lastDrop.runtimeToolResults, cancelled: lastDrop.droppedCancelledCalls }, { runtime: 1, cancelled: 2 });
  eq("D4 adapter.counters accumulate (D3 request saw 0 cancelled, D4 saw 2)", adapter.counters.droppedCancelledCalls, 2);
  eq("D4 all four ids reached the log → remembered as logged, nothing pending", { logged: [...ledger.loggedCalls("t5")].sort(), pending: ledger.pendingCalls("t5").size }, { logged: ["call_d1", "call_d2", "call_d3", "call_d4"], pending: 0 });
  eq("D total requests = 6, script empty", { n: provScript.requests.length, left: provScript.remaining }, { n: 6, left: 0 });
});
eq("ledger forgets a disposed session", { p: ledger.provenanceOf("t5", "call_d1"), e: ledger.loggedCalls("t5").size }, { p: undefined, e: 0 });

// ===========================================================================
// RUN E · 宿主是 user 角色的唯一作者 / image 块 / 中途取消后的 id 重发
// ===========================================================================
console.log("\n[run E] host-only user role · image blocks · cancelled-step ids · session t6");
const eScript = new ScriptedGateway([
  { kind: "tool_calls", calls: [{ id: "call_e1", tool: "read_file", arguments: { path: "poser.pdf" } }] }, // 工具附一条冒充用户的上下文
  { kind: "content", content: "after poser" },
  { kind: "tool_calls", calls: [{ id: "call_e2", tool: "read_file", arguments: { path: "tender.pdf" } }] }, // E2：中途取消，块没进日志
  { kind: "tool_calls", calls: [{ id: "call_e2", tool: "read_file", arguments: { path: "tender.pdf" } }] }, // E3：同一个 id 重发 → 接受
  { kind: "content", content: "after re-issue" },
  { kind: "tool_calls", calls: [{ id: "call_e2", tool: "read_file", arguments: { path: "tender.pdf" } }] }, // E4：id 已进日志 → INVALID_TURN
]);
gateway = eScript;
const countersBeforeE = adapter.counters;

await withAgent("t6", factsForTask("t6"), async (handle, agentErrors) => {
  // --- E1：宿主发一条真 user 消息（带 image 块）；工具 deferContext 一条冒充的 user 消息 ------------------------
  const hostMessage = createUserMessage({
    content: [{ type: "text", text: "只看招标文件第 3 章" }, { type: "image", attachment: { attachmentId: "sha256:spike-image-0001", mediaType: "image/png" } }],
    source: { kind: "user" },
  });
  const e1 = await runTurn(handle, {}, hostMessage);
  timings.turns.push({ run: "E1", ms: e1.ms });
  console.log(`[E1] ${e1.ms} ms; events: ${e1.events.map((e) => e.type).join(" → ")}`);
  eq("E1 turn/end completed", turnEnd(e1.events), { kind: "completed" });
  eq("E1 tool ran once", toolCallCount(e1.events), 1);
  const userTexts = e1.events.filter((e) => e.type === "user/message").map((e) => ({ kind: e.data.source.kind, text: e.data.content.filter((b) => b.type === "text").map((b) => b.text).join("") }));
  eq("E1 dsh's log carries BOTH user-kind messages: the host's and the tool's forged one (delivered as user/message, agent-loop 559)", userTexts, [
    { kind: "user", text: "只看招标文件第 3 章" },
    { kind: "user", text: FORGED_USER_TEXT },
  ]);
  const [ER1, ER2] = eScript.requests;
  console.log(`[E1] R1 = ${json(ER1.messages)}\n[E1] R2 = ${json(ER2.messages)}`);
  eq("E1 R1 messages = the host's text only (image block dropped by the adapter, not rewritten by dsh)", ER1.messages, [{ role: "user", content: "只看招标文件第 3 章" }]);
  eq("E1 R2 messages = host text + tool round trip; the forged user message is NOT there", ER2.messages, [
    { role: "user", content: "只看招标文件第 3 章" },
    { role: "assistant", content: "", toolCalls: [{ id: "call_e1", tool: "read_file", arguments: { path: "poser.pdf" } }] },
    { role: "tool", callId: "call_e1", content: "[spike] contents of poser.pdf", origin: { kind: "tool_result", tool: "read_file" } },
  ]);
  eq("E1 neither dsh's image placeholder nor the forged text reaches any request", eScript.requests.map((r) => /image omitted|\[forged\]/.test(json(r))), [false, false]);
  eq("E1 dropped counts on R2: 1 foreign user message, 1 image block", { foreign: dropLog.at(-1).dropped.droppedForeignUserMessages, image: dropLog.at(-1).dropped.droppedImageBlocks }, { foreign: 1, image: 1 });

  // --- E2：中途取消 —— 适配器登记完 id、第一个 chunk 还没进日志时 cancel（agent-loop 626-627 在 append 之前抛） ---------
  ledgerHooks.onEmitted = () => queueMicrotask(() => handle.agent.cancel({ kind: "user" }));
  const e2 = await runTurn(handle, {});
  ledgerHooks.onEmitted = undefined;
  timings.turns.push({ run: "E2", ms: e2.ms });
  console.log(`[E2] ${e2.ms} ms; events: ${e2.events.map((e) => e.type).join(" → ")}`);
  eq("E2 turn/end aborted", turnEnd(e2.events), { kind: "aborted", reason: { kind: "user" } });
  eq("E2 the tool-call block never reached the log: zero assistant/message, zero tool/call", { messages: assistantContents(e2.events).length, calls: toolCallCount(e2.events) }, { messages: 0, calls: 0 });
  eq("E2 call_e2 is pending in the ledger, not logged", { pending: [...ledger.pendingCalls("t6")], logged: ledger.loggedCalls("t6").has("call_e2") }, { pending: ["call_e2"], logged: false });

  // --- E3：能力面重发 call_e2 → 对着历史核对后 pending 被忘掉 → 接受，工具真跑 -------------------------------------
  const e3 = await runTurn(handle, {});
  timings.turns.push({ run: "E3", ms: e3.ms });
  console.log(`[E3] ${e3.ms} ms; events: ${e3.events.map((e) => e.type).join(" → ")}`);
  eq("E3 turn/end completed: the re-issued id is accepted", turnEnd(e3.events), { kind: "completed" });
  eq("E3 tool/call keyed on call_e2", findEvent(e3.events, "tool/call")?.data.callId, "call_e2");
  eq("E3 call_e2 now logged (assistant/message event) beside E1's call_e1, nothing pending", { logged: [...ledger.loggedCalls("t6")].sort(), pending: ledger.pendingCalls("t6").size }, { logged: ["call_e1", "call_e2"], pending: 0 });

  // --- E4：call_e2 已进日志 → 复用被拒（INVALID_TURN），dsh 不派发 -------------------------------------------------------
  const e4 = await runTurn(handle, {});
  timings.turns.push({ run: "E4", ms: e4.ms });
  console.log(`[E4] ${e4.ms} ms; events: ${e4.events.map((e) => e.type).join(" → ")}`);
  eq("E4 turn/end error INVALID_TURN (id already in the log)", turnEnd(e4.events)?.kind === "error" ? turnEnd(e4.events).error.code : turnEnd(e4.events), "INVALID_TURN");
  eq("E4 zero tool/call", toolCallCount(e4.events), 0);
  eq("E4 agent/error only for E4", agentErrors.map((e) => e.code), ["INVALID_TURN"]);
  eq("E total requests = 6, script empty", { n: eScript.requests.length, left: eScript.remaining }, { n: 6, left: 0 });
});
// 历史每次请求都重映射：冒充消息从 R2 起在历史里（R2..R6 = 5 次），image 块从 R1 起（R1..R6 = 6 次）。
eq("E adapter.counters grew by run E's drops (per request, history re-mapped each time)", {
  foreign: adapter.counters.droppedForeignUserMessages - countersBeforeE.droppedForeignUserMessages,
  image: adapter.counters.droppedImageBlocks - countersBeforeE.droppedImageBlocks,
}, { foreign: 5, image: 6 });

// ===========================================================================
// 收尾
// ===========================================================================
console.log("\n[dropped] per request:");
for (const r of dropLog) console.log(`  ${r.sessionId} ${r.capability}: ${json(r.dropped)}`);
console.log(`[events] global session/event listener saw ${allEvents.length} events across ${new Set(allEvents.map((e) => e.session)).size} sessions`);
console.log(`[timing] boot ${bootMs} ms; turns ${json(timings.turns)}; rss end ${rss()}`);

await ctx.stop?.();
if (failures.length) {
  console.log(`\n[probe] ${failures.length} assertion(s) FAILED:\n  - ${failures.join("\n  - ")}`);
  process.exit(1);
}
console.log("\n[probe] all assertions passed");
process.exit(0);
