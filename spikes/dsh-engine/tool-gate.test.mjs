// ADR-019 探针 · Tool Gate 的单元测试（node:test，不 boot dsh）。
// 运行：node --test tool-gate.test.mjs
//
// 这里验的是「翻译层」，不是判定本身：判定是内核的 decideTool / validateToolCall，
// 本文件从 packages/runtime-core/dist 原样 import 它们。所以每一条测试的形式都是
// 「同一份契约事实，闸门给出的答案与内核给的是同一个」。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RuyinToolGate, gateCall, findGateTool, isFlooredTool, DENY_WITHOUT_APPROVAL_CHANNEL,
} from "./tool-gate.mjs";
import { MemoryTaskFacts } from "./task-facts.mjs";
import { ToolLedger } from "./tool-ledger.mjs";
import {
  GATE_CONTRACT_TOOLS, GATE_PERMISSIONS, GATE_GRANTS, GATE_CONTEXT_SET,
  DEFAULT_TASK_TOOLS, GRANTED_ROOT, SIBLING_ROOT, gateFactsFor,
} from "./fixtures/gate-facts.mjs";
import { decideTool, SKILL_TOOLS } from "../../packages/runtime-core/dist/index.js";

const toolOf = (id) => GATE_CONTRACT_TOOLS.find((t) => t.id === id);
const gateOf = (over = {}) => ({
  tools: [...GATE_CONTRACT_TOOLS],
  permissions: { ...GATE_PERMISSIONS, ...(over.permissions ?? {}) },
  taskTools: over.taskTools ?? [...DEFAULT_TASK_TOOLS, "send_report", "export_bundle"],
  grants: [...GATE_GRANTS],
  contextSet: [...GATE_CONTEXT_SET],
  ...(over.userPolicy === undefined ? {} : { userPolicy: over.userPolicy }),
  askCache: [...(over.askCache ?? [])],
});
const TASK = { taskId: "t_gate" };
const run = (name, args, over = {}, task = TASK) => gateCall({ gate: gateOf(over), task, name, args });
const OK_PATH = `${GRANTED_ROOT}/tender.pdf`;

// ---------------------------------------------------------------- 谁在判定
test("decideTool 是唯一的判定人：闸门给的 value/source 与直接问内核一模一样", () => {
  for (const tool of GATE_CONTRACT_TOOLS) {
    const mine = gateCall({
      gate: gateOf(), task: TASK, name: tool.id,
      args: tool.id === "search_notes" ? { query: "q" }
        : tool.id === "export_bundle" ? { path: OK_PATH, format: "pdf", sources: [OK_PATH] }
        : tool.id === "send_report" ? { recipient: "a@b", path: OK_PATH }
        : tool.id === "write_note" ? { path: OK_PATH, content: "c" }
        : { path: OK_PATH },
    });
    const kernel = decideTool({ tool, permissions: GATE_PERMISSIONS, userPolicy: undefined, askCache: new Set() });
    if (kernel.value === "deny") {
      assert.equal(mine.outcome, "refuse");
      assert.equal(mine.reason, `tool "${tool.id}" denied: ${kernel.reason}`);
      assert.equal(mine.source, kernel.source);
    } else {
      assert.equal(mine.outcome, kernel.value === "allow" ? "allow" : "ask");
      assert.deepEqual(mine.decision, kernel);
    }
  }
});

// ---------------------------------------------------------------- 顺序（harness.gateCalls）
test("未知工具 → 内核原句 'is not declared in the contract'（并且先于其它一切）", () => {
  const r = run("run_shell", { path: "/etc/passwd" });
  assert.deepEqual(r, { outcome: "refuse", reason: 'tool "run_shell" is not declared in the contract', source: "contract" });
});

test("契约里有、任务白名单里没有 → 'is not available to task'，带任务 id", () => {
  const r = run("write_note", { path: OK_PATH, content: "c" }, { taskTools: ["read_notes"] });
  assert.deepEqual(r, { outcome: "refuse", reason: 'tool "write_note" is not available to task "t_gate"', source: "contract" });
});

test("deny 在参数校验之前：参数非法的 deny 工具报的是 denied，不是 rejected", () => {
  const r = run("delete_draft", { path: "D:/elsewhere/x.md" });
  assert.equal(r.outcome, "refuse");
  assert.equal(r.reason, 'tool "delete_draft" denied: contract default for "delete_draft"');
  assert.equal(r.source, "contract_default");
});

test("校验在问人之前：ask 类工具的非法路径是 rejected，不进审批（harness.ts:1329-1332）", () => {
  const r = run("write_note", { path: `${SIBLING_ROOT}/x.md`, content: "c" });
  assert.deepEqual(r, {
    outcome: "refuse",
    reason: `tool "write_note" rejected: path "${SIBLING_ROOT}/x.md" is outside every granted folder`,
    source: "parameter_check",
  });
});

// ---------------------------------------------------------------- 硬底线（C7 的形状）
test("硬底线：契约 allow + permissions.external_send 放松成 allow + 用户策略 allow + ask 缓存命中 → 仍然 ask", () => {
  const r = run("send_report", { recipient: "a@b", path: OK_PATH }, {
    permissions: { external_send: "allow" },
    userPolicy: { send_report: "allow" },
    askCache: ["send_report"],
  });
  assert.equal(r.outcome, "ask");
  assert.equal(r.decision.source, "hard_floor");
  assert.equal(r.decision.value, "ask");
});

test("硬底线只抬不压：用户策略 deny 的 external_send 仍然 deny", () => {
  const r = run("send_report", { recipient: "a@b", path: OK_PATH }, { userPolicy: { send_report: "deny" } });
  assert.equal(r.outcome, "refuse");
  assert.equal(r.reason, 'tool "send_report" denied: user policy for "send_report"');
});

test("isFlooredTool 是从 decideTool 反推出来的，不是抄的键集", () => {
  assert.equal(isFlooredTool(toolOf("send_report")), true);
  for (const id of ["read_notes", "write_note", "search_notes", "export_bundle", "delete_draft"]) {
    assert.equal(isFlooredTool(toolOf(id)), false, id);
  }
});

// ---------------------------------------------------------------- 用户策略层
test("用户策略可以收紧（allow → deny），source 记成 user_policy", () => {
  const r = run("read_notes", { path: OK_PATH }, { userPolicy: { read_notes: "deny" } });
  assert.equal(r.reason, 'tool "read_notes" denied: user policy for "read_notes"');
  assert.equal(r.source, "user_policy");
});

test("用户策略可以放松没有底线的类别（ask → allow）", () => {
  const r = run("write_note", { path: OK_PATH, content: "c" }, { userPolicy: { write_note: "allow" } });
  assert.equal(r.outcome, "allow");
  assert.equal(r.decision.source, "user_policy");
});

test("策略表里写了不是 allow/ask/deny 的东西 → 拒，而不是当成没设置", () => {
  const r = run("read_notes", { path: OK_PATH }, { userPolicy: { read_notes: "sometimes" } });
  assert.equal(r.outcome, "refuse");
  assert.match(r.reason, /is not a permission value/);
  assert.equal(r.source, "user_policy");
});

test("策略表的原型链不参与查表（工具叫 toString 也不会读到 Object.prototype）", () => {
  const gate = gateOf();
  gate.tools = [...gate.tools, { id: "toString", category: "query", risk: "low", default: "allow", input_schema: { type: "object", properties: {} } }];
  gate.taskTools = [...gate.taskTools, "toString"];
  gate.userPolicy = {};
  const r = gateCall({ gate, task: TASK, name: "toString", args: {} });
  assert.equal(r.outcome, "allow");
  assert.equal(r.decision.source, "contract_default");
});

// ---------------------------------------------------------------- ask 缓存
test("ask 缓存：命中 → allow / ask_cache；不命中 → ask", () => {
  const args = { path: OK_PATH, content: "c" };
  assert.equal(run("write_note", args).outcome, "ask");
  const hit = run("write_note", args, { askCache: ["write_note"] });
  assert.equal(hit.outcome, "allow");
  assert.equal(hit.decision.source, "ask_cache");
});

test("ask 缓存只按工具 id 记（内核也是），别的工具不沾光", () => {
  const r = run("export_bundle", { path: OK_PATH, format: "pdf", sources: [OK_PATH] }, { askCache: ["write_note"] });
  assert.equal(r.outcome, "ask");
});

// ---------------------------------------------------------------- 参数校验（内核的四类 + dsh 特有的一类）
test("必填缺失 / 未声明参数 / 类型不符，都是内核的原句加上 rejected 前缀", () => {
  assert.equal(run("read_notes", {}).reason, 'tool "read_notes" rejected: missing required parameter "path"');
  assert.equal(run("read_notes", { path: OK_PATH, depth: 3 }).reason, 'tool "read_notes" rejected: parameter "depth" is not declared');
  assert.equal(run("read_notes", { path: 7 }).reason, 'tool "read_notes" rejected: parameter "path" must be string, got number');
});

test("context_item 必须在本任务的上下文集里", () => {
  assert.equal(run("write_note", { path: OK_PATH, content: "c", source: "ci_tender" }).outcome, "ask");
  assert.equal(
    run("write_note", { path: OK_PATH, content: "c", source: "ci_elsewhere" }).reason,
    'tool "write_note" rejected: "ci_elsewhere" is not in this task\'s context set',
  );
});

test("一组路径里每一条都要过授权（export 的 sources）", () => {
  const good = run("export_bundle", { path: OK_PATH, format: "pdf", sources: [OK_PATH, `${GRANTED_ROOT}/a.md`] });
  assert.equal(good.outcome, "ask");
  const bad = run("export_bundle", { path: OK_PATH, format: "pdf", sources: [OK_PATH, `${SIBLING_ROOT}/leak.md`] });
  assert.equal(bad.reason, `tool "export_bundle" rejected: path "${SIBLING_ROOT}/leak.md" is outside every granted folder`);
});

test("dsh 只保证参数是无损 JSON：不是对象就拒（内核那边这一支到不了）", () => {
  for (const args of [null, undefined, 42, "path", ["a"]]) {
    const r = run("read_notes", args);
    assert.equal(r.outcome, "refuse", JSON.stringify(args ?? null));
    assert.equal(r.reason, 'tool "read_notes" rejected: arguments are not a JSON object');
  }
});

// ---------------------------------------------------------------- fail closed
test("没有闸门事实（这个会话没有任务实例）→ 拒，不是放行", () => {
  const r = gateCall({ gate: undefined, task: TASK, name: "read_notes", args: { path: OK_PATH } });
  assert.deepEqual(r, {
    outcome: "refuse",
    reason: 'tool "read_notes" rejected: no Ruyin task instance governs this call',
    source: "no_task_facts",
  });
});

test("连工具名都没有的执行也拒", () => {
  assert.equal(gateCall({ gate: undefined, task: TASK, name: undefined, args: {} }).reason,
    'tool "?" rejected: no Ruyin task instance governs this call');
});

// ---------------------------------------------------------------- 技能工具
test("任务声明了技能才回落到 SKILL_TOOLS（harness.ts:1278-1284）", () => {
  const withSkills = { taskId: "t_gate", skills: [{ name: "xberg", description: "d" }] };
  assert.equal(findGateTool(gateOf(), withSkills, "use_skill")?.id, "use_skill");
  assert.equal(findGateTool(gateOf(), TASK, "use_skill"), undefined);
  const r = gateCall({ gate: gateOf(), task: withSkills, name: "use_skill", args: { name: "xberg" } });
  // 技能工具不在 taskTools 里也放行（isSkillTool 那一支），并且照样受 permissions.local_read 管
  assert.equal(r.outcome, "allow");
  assert.equal(r.tool.category, SKILL_TOOLS[0].category);
});

// ---------------------------------------------------------------- 插件：两个钩子
/** 一个够用的假 ctx：记下监听器与 guard，测试自己驱动它们。 */
function fakeCtx() {
  const listeners = new Map();
  const guards = [];
  return {
    listeners, guards,
    on(name, fn) { listeners.set(name, fn); return () => listeners.delete(name); },
    tools: { guard(fn) { guards.push(fn); return () => guards.splice(guards.indexOf(fn), 1); } },
  };
}
const execOf = (sessionId, callId, name, args) => ({
  callId, name, arguments: args, signal: new AbortController().signal,
  agent: { session: { id: sessionId } },
});
function harnessOf(over = {}) {
  const facts = new MemoryTaskFacts();
  facts.set("s1", gateFactsFor("t_gate", { taskTools: [...DEFAULT_TASK_TOOLS, "send_report"], ...over }));
  const ledger = new ToolLedger();
  const asked = [];
  const gate = new RuyinToolGate({
    facts, ledger,
    approve: async (req) => { asked.push(req); return over.answer ? over.answer(req) : { approved: false }; },
  });
  const ctx = fakeCtx();
  const dispose = gate.install(ctx);
  return { facts, ledger, gate, ctx, asked, dispose, pre: ctx.listeners.get("tools/pre-execute"), guard: ctx.guards[0] };
}

test("install 挂的是 pre-execute + guard 两处，dispose 都摘得掉", () => {
  const h = harnessOf();
  assert.equal(typeof h.pre, "function");
  assert.equal(h.ctx.guards.length, 1);
  h.dispose();
  assert.equal(h.ctx.listeners.size, 0);
  assert.equal(h.ctx.guards.length, 0);
});

test("allow → next()；deny → {kind:'deny'} 且不调 next()", async () => {
  const h = harnessOf();
  let nexted = 0;
  const next = async () => { nexted += 1; return { kind: "allow" }; };
  assert.deepEqual(await h.pre(execOf("s1", "c1", "read_notes", { path: OK_PATH }), next), { kind: "allow" });
  assert.equal(nexted, 1);
  const denied = await h.pre(execOf("s1", "c2", "delete_draft", { path: OK_PATH }), next);
  assert.equal(denied.kind, "deny");
  assert.equal(denied.reason, 'tool "delete_draft" denied: contract default for "delete_draft"');
  assert.equal(nexted, 1);
});

/** 复刻 dsh 在拒绝之后走的那一步：把 `Error: ${reason}` 物化成结果，并触发 tools/result（3128-3140 → 3271, 3285-3300）。 */
function settleDenial(ledger, ctx, exec, reason) {
  ctx.listeners.get("tools/result")(exec, { isError: true, error: { message: reason } });
  return ledger.provenanceOf(exec.agent.session.id, exec.callId);
}

test("每一句拒绝在交给 dsh 之前先进账本（适配器只转发宿主登记过的那一句）", async () => {
  const h = harnessOf();
  h.ledger.attach(h.ctx); // 真实组合里账本与闸门挂在同一个 ctx 上
  for (const [callId, name, args] of [
    ["c3", "delete_draft", { path: OK_PATH }],           // 策略拒绝
    ["c4", "read_notes", { path: `${SIBLING_ROOT}/x` }], // 参数校验拒绝
    ["c5", "run_shell", { path: OK_PATH }],              // 契约里没有
  ]) {
    const exec = execOf("s1", callId, name, args);
    const denied = await h.pre(exec, async () => ({ kind: "allow" }));
    const rec = settleDenial(h.ledger, h.ctx, exec, denied.reason);
    assert.equal(rec.authored, "runtime", callId); // 工具体没被到达 → dsh 运行时写的
    assert.equal(rec.hostReason, denied.reason, callId); // 但宿主登记过它，所以能原样转发
    assert.equal(rec.code, undefined, callId);
  }
});

test("guard 的拒绝同样进账本（不然适配器读到会 INVALID_HISTORY）", async () => {
  const h = harnessOf();
  h.ledger.attach(h.ctx);
  const exec = execOf("s1", "c9", "read_notes", { path: OK_PATH });
  const reason = h.guard(exec); // 没过 pre-execute = 被绕过
  const rec = settleDenial(h.ledger, h.ctx, exec, reason);
  assert.equal(rec.hostReason, 'tool "read_notes" rejected: the Ruyin gate did not decide this call');
});

test("guard：没有闸门戳记的调用一律拒（= pre-execute 被绕过）", () => {
  const h = harnessOf();
  const exec = execOf("s1", "c4", "read_notes", { path: OK_PATH });
  assert.equal(h.guard(exec), 'tool "read_notes" rejected: the Ruyin gate did not decide this call');
});

test("guard：判定过的调用放行；改了名字 / 改了参数之后再拒", async () => {
  const h = harnessOf();
  const exec = execOf("s1", "c5", "read_notes", { path: OK_PATH });
  await h.pre(exec, async () => ({ kind: "allow" }));
  assert.equal(h.guard(exec), undefined);

  exec.name = "send_report";
  assert.equal(h.guard(exec), 'tool "read_notes" rejected: the call was renamed to "send_report" after the gate decided');
  exec.name = "read_notes";

  // 判定之后被换成越权路径 → guard 用当下的参数重跑 validateToolCall
  exec.arguments = { path: `${SIBLING_ROOT}/x.pdf` };
  assert.equal(h.guard(exec), `tool "read_notes" rejected: path "${SIBLING_ROOT}/x.pdf" is outside every granted folder`);

  // 换成合法但不是被判定过的那一次 → 也拒
  exec.arguments = { path: `${GRANTED_ROOT}/other.pdf` };
  assert.equal(h.guard(exec), 'tool "read_notes" rejected: arguments changed after the gate decided');
});

// ---------------------------------------------------------------- 审批接缝
test("默认 resolver 拒，用的是 Ruyin 自己的句子", async () => {
  const r = await DENY_WITHOUT_APPROVAL_CHANNEL({ tool: { id: "write_note" } });
  assert.deepEqual(r, {
    approved: false,
    reason: 'tool "write_note" needs a person to approve it, and this task has no approval channel open',
  });
});

test("没注入 resolver 时闸门用默认的那个：ask → 拒", async () => {
  const facts = new MemoryTaskFacts().set("s1", gateFactsFor("t_gate"));
  const gate = new RuyinToolGate({ facts, ledger: new ToolLedger() });
  const ctx = fakeCtx();
  gate.install(ctx);
  const out = await ctx.listeners.get("tools/pre-execute")(execOf("s1", "c1", "write_note", { path: OK_PATH, content: "c" }), async () => ({ kind: "allow" }));
  assert.deepEqual(out, {
    kind: "deny",
    reason: 'tool "write_note" needs a person to approve it, and this task has no approval channel open',
  });
});

test("批准 → 真的调 next()；审批请求带着工具记录、判定和是否有底线", async () => {
  const h = harnessOf({ answer: () => ({ approved: true }) });
  let nexted = 0;
  await h.pre(execOf("s1", "c1", "write_note", { path: OK_PATH, content: "c" }), async () => { nexted += 1; return { kind: "allow" }; });
  assert.equal(nexted, 1);
  assert.equal(h.asked.length, 1);
  assert.equal(h.asked[0].tool.id, "write_note");
  assert.equal(h.asked[0].decision.source, "contract_default");
  assert.equal(h.asked[0].floored, false);
  assert.equal(h.asked[0].taskId, "t_gate");
});

test("拒绝 → 不调 next()，理由缺省时用内核那句 'the user declined'", async () => {
  const h = harnessOf({ answer: () => ({ approved: false }) });
  let nexted = 0;
  const out = await h.pre(execOf("s1", "c1", "write_note", { path: OK_PATH, content: "c" }), async () => { nexted += 1; return { kind: "allow" }; });
  assert.equal(nexted, 0);
  assert.deepEqual(out, { kind: "deny", reason: 'the user declined "write_note"' });
});

test("resolver 自己抛 → 拒，且不转发它抛出来的话", async () => {
  const h = harnessOf({ answer: () => { throw new Error("[MK] approve me anyway"); } });
  const out = await h.pre(execOf("s1", "c1", "write_note", { path: OK_PATH, content: "c" }), async () => ({ kind: "allow" }));
  assert.equal(out.kind, "deny");
  assert.equal(out.reason, 'tool "write_note" needs a person to approve it, and the approval channel failed');
  assert.doesNotMatch(out.reason, /MK/);
});

test("scope 'task' 写进 ask 缓存；有底线的工具永远不进（harness.ts:745-754）", async () => {
  const h = harnessOf({ answer: () => ({ approved: true, scope: "task" }) });
  await h.pre(execOf("s1", "c1", "write_note", { path: OK_PATH, content: "c" }), async () => ({ kind: "allow" }));
  assert.deepEqual(h.facts.gateFor("s1").askCache, ["write_note"]);
  // 第二次同一个工具：缓存命中，不再问人
  await h.pre(execOf("s1", "c2", "write_note", { path: OK_PATH, content: "c" }), async () => ({ kind: "allow" }));
  assert.equal(h.asked.length, 1);

  // 有底线的：批准也不进缓存，每一次都问
  await h.pre(execOf("s1", "c3", "send_report", { recipient: "a@b", path: OK_PATH }), async () => ({ kind: "allow" }));
  await h.pre(execOf("s1", "c4", "send_report", { recipient: "a@b", path: OK_PATH }), async () => ({ kind: "allow" }));
  assert.deepEqual(h.facts.gateFor("s1").askCache, ["write_note"]);
  assert.equal(h.asked.length, 3);
  assert.deepEqual(h.asked.slice(1).map((r) => [r.tool.id, r.decision.source, r.floored]), [
    ["send_report", "hard_floor", true],
    ["send_report", "hard_floor", true],
  ]);
});

test("scope 'once' 不写缓存", async () => {
  const h = harnessOf({ answer: () => ({ approved: true, scope: "once" }) });
  await h.pre(execOf("s1", "c1", "write_note", { path: OK_PATH, content: "c" }), async () => ({ kind: "allow" }));
  assert.deepEqual(h.facts.gateFor("s1").askCache, []);
});

// ---------------------------------------------------------------- 审计
test("审计事件：requested → decision，且 decision 必须自报结果（audit.ts:55-63 的护栏）", async () => {
  const h = harnessOf({ answer: () => ({ approved: true }) });
  await h.pre(execOf("s1", "c1", "read_notes", { path: OK_PATH }), async () => ({ kind: "allow" }));
  await h.pre(execOf("s1", "c2", "delete_draft", { path: OK_PATH }), async () => ({ kind: "allow" }));
  assert.deepEqual(h.gate.events.map((e) => [e.action, e.outcome]), [
    ["tool.requested", "success"],
    ["tool.decision", "success"],
    ["tool.requested", "success"],
    ["tool.decision", "rejected"],
  ]);
  assert.deepEqual(h.gate.events[1].payload, { tool: "read_notes", decision: "allow", source: "contract_default" });
  assert.equal(h.gate.events[3].payload.reason, 'tool "delete_draft" denied: contract default for "delete_draft"');
  // 参数名进审计，参数值不进（harness.ts:1303-1306）
  assert.deepEqual(h.gate.events[0].payload, { tool: "read_notes", arguments: ["path"] });
});

test("构造器要事实源与账本：少一个就不给装", () => {
  assert.throws(() => new RuyinToolGate({ ledger: new ToolLedger() }), /TaskFactsProvider/);
  assert.throws(() => new RuyinToolGate({ facts: new MemoryTaskFacts() }), /ToolLedger/);
  assert.throws(() => new RuyinToolGate({ facts: new MemoryTaskFacts(), ledger: new ToolLedger(), approve: 1 }), /async function/);
});
