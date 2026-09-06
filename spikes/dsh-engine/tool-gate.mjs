// ADR-019 探针 · 第三步：Tool Gate 装进 dsh。
//
// 决定的人还是内核：`decideTool` / `validateToolCall` 从 packages/runtime-core/dist 原样 import，
// 这个文件一行判定逻辑都不重写 —— 重写一遍就等于把「dsh 版闸门与内核闸门是同一个答案」这件事
// 变成两份代码的巧合（C2 要的正是「同一契约默认 + 同一用户策略 → 决策一致」，conformance.ts:224-261）。
// 这里只做三件事：把 dsh 的一次执行翻译成 GateInput/ValidationInput、把答案翻译回 dsh 的决策、
// 以及把「问人」这一步接出去。
//
// 两个钩子，分工是有理由的（第四轮的对抗镜头已经把理由验过一遍）：
//
//   tools/pre-execute（瀑布，可 allow/deny/ask）  —— 真正的判定在这里。
//       它是**可被绕过**的：后注册且 prepend:true 的监听器排在前面，不调 next() 就把我们整个跳过；
//       外层监听器还能 await next() 看到我们的 deny 再返回 allow（cordis/lib/index.js:317-321, 336）。
//       所以它不能是唯一的一道。
//   ctx.tools.guard（单调，只能拒）           —— 复核在这里。
//       它不是监听器：waterfall 判定为 allow 之后、工具体之前，注册表**无条件**调用它
//       （dsh-tools/lib/index.js:3128 `decision.kind === "allow" ? this.guardReason(exec) : decision.reason`），
//       任何监听器排序都撤不回它的拒绝（types/index.d.ts:481-489）。
//       它做三件事：① 没有闸门戳记的调用一律拒（= 上面被绕过了）；② 工具名被改过就拒；
//       ③ **用当下的 exec.arguments 再跑一遍 validateToolCall**（pre-execute 之后还有别的监听器能整体
//       替换 exec.arguments —— 第四轮实测：exec 对象本身没冻结，只有 arguments 被 deepFreeze，
//       dsh-tools/lib/index.js:3060 vs 3193「工具体读的是派发那一刻的 exec.arguments」）。
//
// 为什么校验在 pre-execute 里**也**跑一遍：内核的顺序是 decide → 拒绝 → 校验 → 再问人
//（harness.ts:1329-1332「Validate before asking：把一次非法调用摆到人面前没有意义」）。
// 只放在 guard 里就会把顺序颠倒过来（guard 在审批之后才跑），人会被问一个本来就该拒的调用。
// 于是：pre-execute 负责顺序与「问人」，guard 负责不可绕过。两处调的是同一个内核函数。
//
// 措辞：每一句拒绝都是 Ruyin 自己的（内核 harness.ts:1288-1300 的四个模板原样照抄），
// 交给 dsh 之前先 noteHostDenial 进出处账本 —— dsh 会把它渲染成 `Error: ${reason}`
//（dsh-tools 3129-3140），适配器只转发账本里宿主登记过的那一句、并且是裸的（ADR-011，第三轮）。
// 没登记过的、无 code 的运行时结果，适配器一律 INVALID_HISTORY：这条纪律这一步没有放松。
//
// 审批（ask）：**我们的组合里 dsh 没有 resolver**。dsh 的 `{kind:'ask'}` 会走 serviceAsk →
// `ctx.get('approval')`，我们没装 ApprovalService，于是同一 tick 降级成 deny，理由是
// `ask.reason ?? 'tool "X" requires approval (not yet supported)'`（dsh-tools 3315-3325）。
// 官方的 @deepseek-ai/dsh-user-approval 0.1.2-rc.1 只在 .pnpm 仓里（dsh-tools 的 peer），
// 而且它唯一的「批准」是 allowed-once、拒绝句子是 dsh 写的（`the user rejected tool "X"`）。
// 所以 ask 由本插件自己接：pre-execute 里 await 一个宿主注入的 async resolver，
// 批准→next()，拒绝→Ruyin 自己的句子。dsh 的 ask 分支我们一次都不用（见 NOTES 的遗留）。
//
// 事实来源：宿主侧的 TaskFactsProvider（task-facts.mjs 的 gateFor / factsFor / rememberAsk），
// 不另起一个存储。gateFor 返回 undefined = 这个会话没有任务实例可比对 → 拒（fail closed）。

import {
  decideTool,
  validateToolCall,
  folderGrants,
  isSkillTool,
  SKILL_TOOLS,
  OUTCOME_MUST_BE_STATED,
} from "../../packages/runtime-core/dist/index.js";
import { contentFingerprint } from "./task-facts.mjs";

const PERMISSION_VALUES = new Set(["allow", "ask", "deny"]);

/** 全放开的一份 Permissions（只给 isFlooredTool 反向探底线用，不参与真实判定）。 */
const ALL_ALLOW = Object.freeze({
  local_read: "allow",
  local_write: "allow",
  delete: "allow",
  external_send: "allow",
  sync_to_cloud: "allow",
});

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * 这个工具的类别有没有硬底线 —— **不复制 HARD_FLOOR 的键集**。
 *
 * 内核自己在 harness.ts:745-754 复制了一份（`tools.filter(t => t.category === "external_send")`），
 * 两处必须同步改；这里换成反过来问 decideTool：把每一层都放到最松（tool.default=allow +
 * permissions 全 allow + userPolicy=allow + askCache 命中），还回不到 allow 的，就是有底线的类别
 * （tool-gate.ts:95-101 那一支会 short-circuit 成 source "hard_floor"）。
 * 底线清单以后长了，这里不用改。
 */
export function isFlooredTool(tool) {
  return (
    decideTool({
      tool: { ...tool, default: "allow" },
      permissions: ALL_ALLOW,
      userPolicy: "allow",
      askCache: new Set([tool.id]),
    }).source === "hard_floor"
  );
}

/**
 * 契约里的 Tool 记录。镜像 harness.ts:1278-1284：先查 contract.tools，
 * 任务声明了技能才回落到 SKILL_TOOLS（use_skill / read_skill_resource，skills.ts:26-64）。
 */
export function findGateTool(gate, task, name) {
  const declared = (gate?.tools ?? []).find((t) => t?.id === name);
  if (declared !== undefined) return declared;
  const hasSkills = Array.isArray(task?.skills) && task.skills.length > 0;
  return hasSkills ? SKILL_TOOLS.find((t) => t.id === name) : undefined;
}

/**
 * 一次调用过闸 —— 纯函数，顺序与 harness.gateCalls 逐行对齐（harness.ts:1276-1356）：
 * 未知工具 → 不在本任务 → decideTool → deny → validateToolCall → invalid → allow / ask。
 *
 * 四句拒绝文案与内核**一字不差**（harness.ts:1288, 1307-1316, 1329, 1341）；
 * 另外三句是内核里不可能出现、dsh 里可能出现的情形，由本探针自己写（都是 fail closed）。
 *
 * @param {{gate?: object, task?: object, name: string, args: unknown}} input
 * @returns {{outcome:'refuse', reason:string, source:string}
 *          | {outcome:'allow'|'ask', tool:object, decision:object}}
 */
export function gateCall({ gate, task, name, args }) {
  const refuse = (reason, source) => ({ outcome: "refuse", reason, source });
  const label = typeof name === "string" && name !== "" ? name : "?";

  // 内核里这一层不存在（Harness 手里永远有一个任务实例）；dsh 里一次执行可能根本没有 agent
  // （dsh-tools 2827-2828：无 agent 的执行连 agent 作用域的 guard 都不跑），所以必须先拒。
  if (!isPlainObject(gate)) {
    return refuse(`tool "${label}" rejected: no Ruyin task instance governs this call`, "no_task_facts");
  }

  const tool = findGateTool(gate, task, name);
  if (tool === undefined) {
    return refuse(`tool "${label}" is not declared in the contract`, "contract");
  }
  const taskId = typeof task?.taskId === "string" ? task.taskId : "?";
  if (!(gate.taskTools ?? []).includes(tool.id) && !isSkillTool(tool.id)) {
    return refuse(`tool "${tool.id}" is not available to task "${taskId}"`, "contract");
  }

  // 用户策略是按工具 id 存的一张表。用 Object.hasOwn 取：工具 id 是契约里的字符串，
  // 直接下标会把 "constructor" / "toString" 这种名字读成 Object.prototype 上的东西。
  let userPolicy;
  if (isPlainObject(gate.userPolicy) && Object.hasOwn(gate.userPolicy, tool.id)) {
    userPolicy = gate.userPolicy[tool.id];
    if (!PERMISSION_VALUES.has(userPolicy)) {
      // 宿主写坏了策略表：不能当成「没设置」悄悄回落到契约默认（那是放松）。
      return refuse(
        `tool "${tool.id}" denied: user policy for "${tool.id}" is not a permission value`,
        "user_policy",
      );
    }
  }

  const decision = decideTool({
    tool,
    permissions: gate.permissions,
    userPolicy,
    askCache: new Set(gate.askCache ?? []),
  });
  if (decision.value === "deny") {
    return refuse(`tool "${tool.id}" denied: ${decision.reason}`, decision.source);
  }

  // dsh 只保证参数是「无损 JSON」（types/index.d.ts:205-206），不保证是对象：
  // 手写 ToolDefinition 不过 defineTool 的那层 schema 包装（dsh-tools/lib/types/schema.js:293-316）。
  // 内核那边 ToolCall.arguments 的类型就是 Record，压根到不了这一支。
  if (!isPlainObject(args)) {
    return refuse(`tool "${tool.id}" rejected: arguments are not a JSON object`, "parameter_check");
  }

  const valid = validateToolCall({
    tool,
    args,
    grants: folderGrants(gate.grants ?? []),
    contextSet: gate.contextSet ?? [],
  });
  if (!valid.ok) {
    return refuse(`tool "${tool.id}" rejected: ${valid.reason}`, "parameter_check");
  }

  return { outcome: decision.value === "allow" ? "allow" : "ask", tool, decision };
}

/**
 * 默认的审批 resolver：拒。
 *
 * 「没人接就等于没人批准」—— 这是本探针唯一能诚实给出的默认值。dsh 自己的降级也是拒
 * （dsh-tools 3315-3325），但它写的是 dsh 的句子；这一句是 Ruyin 的。
 */
export const DENY_WITHOUT_APPROVAL_CHANNEL = async ({ tool }) => ({
  approved: false,
  reason: `tool "${tool.id}" needs a person to approve it, and this task has no approval channel open`,
});

/**
 * Tool Gate 插件。
 *
 * @param {object} deps
 * @param {import('./task-facts.mjs').MemoryTaskFacts} deps.facts  事实来源（gateFor / factsFor / rememberAsk）
 * @param {import('./tool-ledger.mjs').ToolLedger} deps.ledger     出处账本：每一句拒绝先登记再交给 dsh
 * @param {(request: object) => Promise<{approved: boolean, scope?: 'once'|'task', reason?: string}>} [deps.approve]
 *   审批接缝。宿主注入；默认拒。request = { sessionId, taskId, callId, tool, arguments, decision, floored, signal }。
 * @param {(record: object) => void} [deps.log]  每条审计记录的回调
 */
export class RuyinToolGate {
  /** 审计雏形：形状与 harness 的三个事件一致（harness.ts:1296-1300, 1304-1306, 1346-1353）。 */
  events = [];
  /** 每次判定的明细（探针断言用）：{ sessionId, callId, tool, stage, outcome, source, reason? } */
  decisions = [];

  #facts;
  #ledger;
  #approve;
  #log;
  /** exec → 闸门戳记。WeakMap 按对象身份记：伪造不出来，也不会漏内存。 */
  #decided = new WeakMap();

  constructor({ facts, ledger, approve = DENY_WITHOUT_APPROVAL_CHANNEL, log } = {}) {
    if (facts === undefined || typeof facts.gateFor !== "function") {
      throw new TypeError("RuyinToolGate needs a TaskFactsProvider with gateFor()");
    }
    if (ledger === undefined || typeof ledger.noteHostDenial !== "function") {
      // 账本是必填的（第二轮的结论）：没有它，闸门的拒绝理由到了适配器就分不清是谁写的。
      throw new TypeError("RuyinToolGate needs a ToolLedger (refusal texts must be host-registered)");
    }
    if (typeof approve !== "function") throw new TypeError("approve must be an async function");
    this.#facts = facts;
    this.#ledger = ledger;
    this.#approve = approve;
    this.#log = log;
  }

  /**
   * 装到一个 inject 了 'tools' 的 cordis ctx 上。返回注销函数。
   * @param {import('cordis').Context} ctx
   */
  install(ctx) {
    const disposers = [
      ctx.on("tools/pre-execute", (exec, next) => this.#preExecute(exec, next)),
      ctx.tools.guard((exec) => this.#guard(exec)),
    ];
    return () => {
      for (const dispose of disposers) if (typeof dispose === "function") dispose();
    };
  }

  // --- pre-execute：判定 + 问人 ---------------------------------------------------------------

  async #preExecute(exec, next) {
    const sessionId = exec?.agent?.session?.id;
    const callId = exec?.callId;
    const name = exec?.name;
    const task = typeof sessionId === "string" ? this.#facts.factsFor(sessionId) : undefined;
    const gate = typeof sessionId === "string" ? this.#facts.gateFor(sessionId) : undefined;

    this.#emit("tool.requested", {
      tool: name,
      arguments: isPlainObject(exec?.arguments) ? Object.keys(exec.arguments) : [],
    });

    const verdict = gateCall({ gate, task, name, args: exec?.arguments });
    if (verdict.outcome === "refuse") {
      return this.#deny(exec, verdict.reason, verdict.source, "pre-execute");
    }

    const { tool, decision } = verdict;
    if (verdict.outcome === "ask") {
      const floored = isFlooredTool(tool);
      let answer;
      try {
        answer = await this.#approve({
          sessionId,
          taskId: task?.taskId,
          callId,
          tool,
          arguments: exec.arguments,
          decision,
          floored,
          signal: exec.signal,
        });
      } catch {
        // 审批通道自己崩了：拒，而且不转发它抛出来的话（那句话不是 Ruyin 写的）。
        return this.#deny(
          exec,
          `tool "${tool.id}" needs a person to approve it, and the approval channel failed`,
          "approval_error",
          "pre-execute",
        );
      }
      if (answer?.approved !== true) {
        // 默认句子照抄内核在「用户拒绝」时补给模型的那一句（harness.ts:994-1000）。
        const reason =
          typeof answer?.reason === "string" && answer.reason !== ""
            ? answer.reason
            : `the user declined "${tool.id}"`;
        return this.#deny(exec, reason, "ask", "pre-execute");
      }
      if (answer.scope === "task") {
        // 内核的 askCache 写入点（harness.ts:745-754）：只在 approve + scope 'task' 时写，
        // 有硬底线的工具永不进 —— 「批准过一次」不是对下一次的同意（50-harness §5.3）。
        if (!floored && typeof sessionId === "string") this.#facts.rememberAsk(sessionId, tool.id);
      }
    }

    this.#decided.set(exec, {
      sessionId,
      callId,
      tool,
      name,
      fingerprint: contentFingerprint(exec.arguments),
      grants: folderGrants(gate.grants ?? []),
      contextSet: gate.contextSet ?? [],
    });
    this.#note(sessionId, callId, tool.id, "pre-execute", verdict.outcome, decision.source);
    this.#emit(
      "tool.decision",
      { tool: tool.id, decision: decision.value, source: decision.source },
      // 放行与转人工都不是拒绝 —— 与 harness.ts:1346-1353 同一句注释同一个判断。
      "success",
    );
    return next();
  }

  // --- guard：不可绕过的复核 -------------------------------------------------------------------

  #guard(exec) {
    const stamp = this.#decided.get(exec);
    const name = typeof exec?.name === "string" ? exec.name : "?";
    if (stamp === undefined) {
      // 上面那一层被绕过了（prepend 的监听器 / 外层监听器把 deny 改回 allow），或者根本没跑。
      return this.#guardDeny(exec, `tool "${name}" rejected: the Ruyin gate did not decide this call`);
    }
    if (stamp.name !== exec.name) {
      // pre-execute 之后还能改 exec.name 把调用重定向到另一个工具（第四轮实测过）。
      return this.#guardDeny(
        exec,
        `tool "${stamp.name}" rejected: the call was renamed to "${name}" after the gate decided`,
      );
    }
    // 参数可能在判定之后被整体替换（exec 对象本身没冻结，dsh-tools 3060）。
    // 先用**当下的**参数把内核的校验再跑一遍 —— guard 是唯一不可绕过的一层，
    // 所以「参数落在授权目录内」这条必须在这里也成立，而不只是在判定那一刻成立。
    if (isPlainObject(exec.arguments)) {
      const valid = validateToolCall({
        tool: stamp.tool,
        args: exec.arguments,
        grants: stamp.grants,
        contextSet: stamp.contextSet,
      });
      if (!valid.ok) {
        return this.#guardDeny(exec, `tool "${stamp.tool.id}" rejected: ${valid.reason}`);
      }
    }
    if (contentFingerprint(exec.arguments) !== stamp.fingerprint) {
      // 换成了「合法但不是闸门看过的那一次」：也拒。要执行的调用必须就是被判定过的那一个 ——
      // 何况循环早在判定之前就把原参数写进了 tool/call 事件（dsh-agent-loop 193-195），
      // 放过去等于日志与实际执行的不是一回事。
      return this.#guardDeny(
        exec,
        `tool "${stamp.tool.id}" rejected: arguments changed after the gate decided`,
      );
    }
    return undefined;
  }

  // --- 拒绝的两种出口（同一套记账） ------------------------------------------------------------

  #deny(exec, reason, source, stage) {
    this.#registerDenial(exec, reason, source, stage);
    return { kind: "deny", reason };
  }

  #guardDeny(exec, reason) {
    this.#registerDenial(exec, reason, "guard", "guard");
    return reason;
  }

  #registerDenial(exec, reason, source, stage) {
    const sessionId = exec?.agent?.session?.id;
    const callId = exec?.callId;
    // dsh 会把这句渲染成 `Error: ${reason}`（3129-3140）。先进账本：适配器只转发宿主登记过的那一句，
    // 而且是裸的（内核 harness.ts:1290-1295 的形状）。登记不了（没有会话 / callId）就不登记 ——
    // 那种结果适配器读到会 INVALID_HISTORY，也是对的：说不清是谁写的就不该进请求。
    if (typeof sessionId === "string" && typeof callId === "string") {
      this.#ledger.noteHostDenial(sessionId, callId, reason);
    }
    this.#note(sessionId, callId, exec?.name, stage, "deny", source, reason);
    this.#emit("tool.decision", { tool: exec?.name, decision: "deny", source, reason }, "rejected");
  }

  #note(sessionId, callId, tool, stage, outcome, source, reason) {
    this.decisions.push({
      sessionId,
      callId,
      tool,
      stage,
      outcome,
      source,
      ...(reason === undefined ? {} : { reason }),
    });
  }

  /** 本会话的判定明细（探针断言用）。 */
  decisionsFor(sessionId) {
    return this.decisions.filter((d) => d.sessionId === sessionId);
  }

  #emit(action, payload, outcome) {
    if (OUTCOME_MUST_BE_STATED.has(action) && outcome === undefined) {
      // audit.ts:55-63 的护栏照搬：结果不定的事件必须由调用点说明，否则每一次拒绝都会被记成通过。
      throw new Error(`audit "${action}" must state an outcome`);
    }
    const record = { action, payload, outcome: outcome ?? "success" };
    this.events.push(record);
    this.#log?.(record);
  }
}
