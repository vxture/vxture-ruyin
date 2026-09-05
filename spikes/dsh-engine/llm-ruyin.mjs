// ADR-019 探针 · llm-ruyin：dsh 的 LlmAdapter ↔ Ruyin 的 AIGatewayPort（CapabilityTurnRequest / CapabilityTurn）。
//
// 规则（ADR-011）：Runtime 传结构化事实，产品负责措辞与判定。
// 这个类只搬事实：dsh 的 messages → TurnMessage[]；dsh 的 tools 只当"可见性"用来筛契约 offer；
// options.system 整个丢弃（只记长度）；能力面的三种应答形状（ports.ts:287-290）映射成 StreamChunk。
// 它没有 URL、没有 token、没有 fetch、没有 ctx：网关是构造参数（MockAIGateway / CapabilityClient / ScriptedGateway）。
// 工具结果的出处（谁写的这段文字）来自宿主维护的 ToolLedger（tool-ledger.mjs），适配器只拿回调，不订阅事件。
//
// 引用的 dsh 事实（NM = node_modules/@deepseek-ai）：
//   LlmAdapter 只有 stream() 必需                     NM/dsh-llm/lib/types/index.d.ts:122-178
//   GenerateOptions                                    NM/dsh-llm/lib/types/types.d.ts:380-416
//   StreamChunk 联合                                   NM/dsh-llm/lib/types/types.d.ts:335-365
//   ToolCallBlock.arguments 是原始 JSON 字符串          NM/dsh-llm/lib/types/types.d.ts:60-67
//   适配器抛错 → 一个终态 finish（aborted|error）        NM/dsh-llm/lib/index.js:1658-1723, 1743-1756
//   只有 HarnessError/LlmError 保得住 code               NM/dsh-llm/lib/types/adapter-failure.js:13-26
//   循环按内容（tool-call 块）而不是 finish 种类派发工具  NM/dsh-agent-loop/lib/index.js:689-693
//   派发只看注册表可见性，不看请求的 offer               NM/dsh-tools/lib/index.js:2907-2912（resolveExecution → view(scope).visible）
//   声明了不含 image 的 inputModalities 才会投影 image 块  NM/dsh-llm/lib/index.js:1684-1690（→ 521-523, 600-625 的英文占位句）
//   取消路径的两种结果文本是 dsh 写的                    NM/dsh-tools/lib/index.js:3550-3585；NM/dsh-agent-loop/lib/index.js:276-292
//   工具附加的上下文可以带任何 MessageSource             NM/dsh-tools/lib/types/index.d.ts:397, 408, 436-445；循环拼进下一步 agent-loop 185, 692 → 559
//   中途取消：块到不了日志                               NM/dsh-agent-loop/lib/index.js:626-627；interruptedBlocks 丢 tool-call 块 dsh-llm index.js:935-942
import { LlmAdapter, LlmError, ToolCallId, resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import { TransientError } from "../../packages/runtime-core/dist/index.js";

export const PROVIDER_DISPLAY_NAME = "Ruyin capability surface";
/**
 * 判定块：dsh 核心词表之外的块类型（ContentBlockMap 可合并扩展，types.d.ts:76-89）。
 * 运行时无碍（assembler.js:35-44 存任意 blockType，64-71/94-96 原样返回 block-end 的块），但在类型层面
 * block-start.blockType（types.d.ts:338）/ block-end.block（:356）要合规必须做模块增强：
 *   declare module '@deepseek-ai/dsh-llm' { interface ContentBlockMap { 'ruyin-verdict': { type: 'ruyin-verdict'; passed: boolean; reason?: string } } }
 * 适配器转 TS 时补上。另：被中断的回合里它会被 interruptedBlocks() 静默丢弃（assembler.js:155-165）——判定块只在完整回合里存在，
 * 这是设计如此（中断的判定没有意义）。
 */
export const VERDICT_BLOCK_TYPE = "ruyin-verdict";
const VERIFY_PREFIX = "verify:";
const EMPTY_SET = Object.freeze(new Set());
/** dsh 取消路径写的两种结果（dsh-tools 3550-3585；循环补记的跳过 agent-loop 276-292）。内核从不记录被取消的步骤。 */
const CANCELLED_CODES = Object.freeze(new Set(["ABORTED", "ABORTED_BEFORE_DISPATCH"]));
/** 什么都不知道的宿主：任何工具结果都是 INVALID_HISTORY，任何 user 消息都是外来的。 */
const NO_HOST = Object.freeze({ provenanceOf: () => undefined, isHostMessage: () => false });

// ---------------------------------------------------------------------------
// 纯函数
// ---------------------------------------------------------------------------

/** 每个请求的"丢弃 / 改写账目"——出路 (a) 的代价用数字记下来。 */
export function newDropped() {
  return {
    pluginMessages: 0,        // source.kind 'plugin' 的 user 消息（Ruyin 开场、dsh 运行时上下文、工具附加上下文）
    systemMessages: 0,        // role 'system'
    otherMessages: 0,         // 未知 source.kind / 缺 source
    emptyUserMessages: 0,     // 用户消息没有文本块
    verdictOnlyAssistant: 0,  // 只剩判定块的 assistant 消息（历史里再出现时丢）
    emptyAssistantMessages: 0,// 既无文本块也无工具调用的 assistant 消息（例如只有 reasoning）
    reasoningBlocks: 0,
    verdictBlocks: 0,
    nonTextBlocks: 0,         // 其它未知块（image 单独记在 droppedImageBlocks）
    runtimeToolResults: 0,    // dsh 运行时（不是工具）写的工具结果：转成裸 reason、无 origin（harness.ts:1290-1295 的形状）
    droppedCancelledCalls: 0, // 被取消的工具调用（ABORTED / ABORTED_BEFORE_DISPATCH）：结果和发出它的 toolCalls 条目一起抹掉，dsh 的取消文本不进请求
    droppedImageBlocks: 0,    // image 块：适配器自己丢（不声明 inputModalities，dsh 就不会先改写成英文占位句）
    droppedForeignUserMessages: 0, // source.kind 'user' 但不是宿主发的消息（工具附加的 additionalContexts 可以冒充用户）
    toolsNotVisible: 0,       // 契约 offer 里有、dsh 注册表里没有的工具
    toolsNotInContract: 0,    // dsh 注册表里有、契约没列的工具
    systemPromptChars: 0,     // options.system 的长度——只记长度，内容不读
  };
}

/** 文本块拼接；非文本块由调用方计数。 */
export function textOf(blocks) {
  const texts = [];
  for (const block of blocks ?? []) if (block?.type === "text") texts.push(block.text);
  return texts.join("\n");
}

/** dsh 渲染错误文本的固定前缀（dsh-tools 3496-3499 / 3131-3134 / 3551-3554）；只在账本没给 reason 时兜底用。 */
const ERROR_PREFIX = "Error: ";
function stripErrorPrefix(text) {
  return text.startsWith(ERROR_PREFIX) ? text.slice(ERROR_PREFIX.length) : text;
}

/** 历史里 assistant tool-call 块的 arguments：本适配器只写过 JSON.stringify(object)，别的就是损坏。 */
function parseHistoryArguments(raw, callId) {
  if (typeof raw !== "string") {
    throw new LlmError(`tool call "${callId}" in history carries non-string arguments`, "INVALID_HISTORY");
  }
  if (raw === "") return {}; // 与循环的 parseArguments 同规则（agent-loop 147-154）
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new LlmError(`tool call "${callId}" in history carries unparsable arguments`, "INVALID_HISTORY");
  }
  if (!isPlainObject(parsed)) {
    throw new LlmError(`tool call "${callId}" in history carries non-object arguments`, "INVALID_HISTORY");
  }
  return parsed;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * @typedef {object} HostKnowledge  宿主知道、dsh 的消息表面上看不出来的两件事
 * @property {(callId: string) => ({ authored: 'tool'|'runtime', tool?: string, reason?: string, code?: string } | undefined)} provenanceOf
 *   账本（tool-ledger.mjs）：这条工具结果是谁写的。没有记录 = INVALID_HISTORY，永不照转。
 * @property {(messageId: string) => boolean} isHostMessage
 *   这条 user 消息是不是宿主自己发的（followup 时登记的 id）。只有宿主能以用户的身份说话。
 */

/**
 * dsh Message[] → TurnMessage[]（ports.ts:64-76）。顺序保持，不合并。
 * @param {object[]} messages   options.messages（session.deriveMessages() 的表面）
 * @param {ReturnType<typeof newDropped>} [dropped]
 * @param {Partial<HostKnowledge>} [host]  缺哪一半就按"什么都不知道"处理（fail closed）。
 * @returns {{ messages: object[], dropped: ReturnType<typeof newDropped> }}
 */
export function mapMessages(messages, dropped = newDropped(), host = NO_HOST) {
  const provenanceOf = typeof host?.provenanceOf === "function" ? host.provenanceOf : NO_HOST.provenanceOf;
  const isHostMessage = typeof host?.isHostMessage === "function" ? host.isHostMessage : NO_HOST.isHostMessage;
  const out = [];
  /** callId → out 里发出这个调用的 assistant 消息的下标（取消时那条 toolCalls 也要抹掉） */
  const issuedAt = new Map();
  const countNonText = (block) => {
    if (block?.type === "image") dropped.droppedImageBlocks += 1; // 适配器自己丢：一个数字，不是 dsh 的占位句
    else dropped.nonTextBlocks += 1;
  };

  for (const message of messages ?? []) {
    const role = message?.role;
    const kind = message?.source?.kind;

    if (role === "assistant" && kind === "model") {
      const texts = [];
      const toolCalls = [];
      let sawVerdict = false;
      for (const block of message.content ?? []) {
        switch (block?.type) {
          case "text":
            texts.push(block.text);
            break;
          case "tool-call":
            toolCalls.push({ id: block.id, tool: block.name, arguments: parseHistoryArguments(block.arguments, block.id) });
            break;
          case "reasoning":
            dropped.reasoningBlocks += 1;
            break;
          case VERDICT_BLOCK_TYPE:
            dropped.verdictBlocks += 1;
            sawVerdict = true;
            break;
          default:
            countNonText(block);
        }
      }
      if (texts.length === 0 && toolCalls.length === 0) {
        if (sawVerdict) dropped.verdictOnlyAssistant += 1;
        else dropped.emptyAssistantMessages += 1;
        continue;
      }
      // tool_calls 应答读回来是 { role:'assistant', content:'', toolCalls }（= harness.ts:1094）
      out.push({ role: "assistant", content: texts.join("\n"), ...(toolCalls.length ? { toolCalls } : {}) });
      for (const c of toolCalls) issuedAt.set(c.id, out.length - 1);
      continue;
    }

    if (role === "user" && kind === "tool") {
      const block = (message.content ?? []).find((b) => b?.type === "tool-result");
      if (block === undefined) {
        throw new LlmError(`tool-result message for call "${message.source.callId}" has no tool-result block`, "INVALID_HISTORY");
      }
      for (const inner of block.content ?? []) if (inner?.type !== "text") countNonText(inner);
      const callId = block.toolCallId;
      const text = textOf(block.content);
      const provenance = provenanceOf(callId);

      if (provenance === undefined) {
        // 账本没有记录（不是这个进程产生的、或账本没接上）：不知道是谁写的就不转发——照转的反面是把 dsh 的渲染文本
        // （`Error: ` 前缀那一套）原样送进请求。
        throw new LlmError(`tool result for call "${callId}" has no ledger record`, "INVALID_HISTORY");
      }
      if (provenance.authored === "runtime" && CANCELLED_CODES.has(provenance.code)) {
        // 取消（dsh-tools 3550-3585 / agent-loop 276-292 写的 'tool call aborted[ before dispatch]'）：镜像内核——被取消的步骤
        // 从不进 messages。这条结果和发出它的那条 toolCalls 一起抹掉；发出方只剩空壳时整条抹掉。
        dropped.droppedCancelledCalls += 1;
        const at = issuedAt.get(callId);
        if (at !== undefined) {
          const issuer = out[at];
          const rest = issuer.toolCalls.filter((c) => c.id !== callId);
          if (rest.length > 0) issuer.toolCalls = rest;
          else {
            delete issuer.toolCalls;
            if (issuer.content === "") out[at] = undefined;
          }
        }
        continue;
      }
      if (provenance.authored === "runtime") {
        // dsh 运行时写的（拒绝 / 未知工具 / post-execute block）：= 内核 gate 拒绝的形状（harness.ts:1290-1295）——
        // 裸 reason（dsh 记在 error.message 里的那句）、isError、**没有 origin**：没有工具产出过这段文字。
        dropped.runtimeToolResults += 1;
        out.push({ role: "tool", callId, content: provenance.reason ?? stripErrorPrefix(text), isError: true });
        continue;
      }
      if (provenance.authored === "tool" && typeof provenance.tool === "string") {
        // 工具真正返回的（成功的 render 输出，或工具体自己抛的错的 message）：= harness.ts:1415-1423 推的形状，origin 是账本里
        // 实际执行的工具名（exec.name），不是从历史 tool-call 块猜的。
        out.push({
          role: "tool",
          callId,
          content: provenance.reason ?? text,
          ...(block.isError === true ? { isError: true } : {}),
          origin: { kind: "tool_result", tool: provenance.tool },
        });
        continue;
      }
      throw new LlmError(`tool result for call "${callId}" has an unreadable ledger record`, "INVALID_HISTORY");
    }

    if (role === "user" && kind === "user") {
      if (!isHostMessage(message?.id)) {
        // 只有宿主能以用户的身份说话。工具附加的 additionalContexts 可以带任何 MessageSource（dsh-tools index.d.ts:397/408/436-445），
        // 循环把它们拼进下一步（agent-loop 185, 692 → 559）——不在宿主名单上的 user 消息一律丢，只记数。
        dropped.droppedForeignUserMessages += 1;
        continue;
      }
      for (const block of message.content ?? []) if (block?.type !== "text") countNonText(block);
      const hasText = (message.content ?? []).some((b) => b?.type === "text");
      if (!hasText) {
        dropped.emptyUserMessages += 1;
        continue;
      }
      out.push({ role: "user", content: textOf(message.content) });
      continue;
    }

    if (role === "user" && kind === "plugin") {
      dropped.pluginMessages += 1;
      continue;
    }
    if (role === "system") {
      dropped.systemMessages += 1;
      continue;
    }
    dropped.otherMessages += 1;
  }

  return { messages: out.filter((m) => m !== undefined), dropped };
}

/**
 * GenerateOptions → CapabilityTurnRequest（ports.ts:197-261）。
 * options 是深冻结的（agent-loop 767），只读不改；每个映射值都是新对象。
 * @param {object} options
 * @param {import('./task-facts.mjs').TaskFacts | undefined} facts
 * @param {Parameters<typeof mapMessages>[2]} [host]
 * @returns {{ request: object, dropped: ReturnType<typeof newDropped> }}
 */
export function toTurnRequest(options, facts, host = NO_HOST) {
  if (facts === undefined || facts === null) {
    throw new LlmError(`no Ruyin task facts for session "${options?.sessionId ?? "?"}"`, "NO_TASK_FACTS");
  }
  if (options.purpose !== undefined) {
    throw new LlmError(`llm-ruyin does not serve purpose "${String(options.purpose)}"`, "UNSUPPORTED_PURPOSE");
  }

  const dropped = newDropped();
  // options.system：整个丢弃（出路 a；ADR-011:23-27, 38）。只记长度作为代价账目。
  dropped.systemPromptChars = typeof options.system === "string" ? options.system.length : 0;

  const { messages } = mapMessages(options.messages, dropped, host);

  // options.tools 只当"dsh 此刻能执行什么"的可见性事实（= harness.toolOffers 里的 deps.tools.supports()）。
  // ToolSchema 的 description / parameters 永远不转发：offer 的 description 是契约事实字符串（facts.tools）。
  const visible = new Set((options.tools ?? []).map((t) => t.name));
  const contractIds = new Set(facts.tools.map((o) => o.id));
  const tools = facts.tools.filter((o) => visible.has(o.id)).map((o) => ({ ...o }));
  dropped.toolsNotVisible = facts.tools.length - tools.length;
  dropped.toolsNotInContract = [...visible].filter((name) => !contractIds.has(name)).length;

  const request = {
    capability: facts.capability,
    product: facts.product,
    taskId: facts.taskId,
    workspace: facts.workspace,
    objective: facts.objective,
    constraints: [...facts.constraints],
    context: facts.context,
    messages,
    tools,
    ...(facts.skills && facts.skills.length ? { skills: facts.skills } : {}),
    ...(facts.revision ? { revision: facts.revision } : {}),
  };
  return { request, dropped };
}

/**
 * 历史表面上的 tool-call id（能力面不得复用）。
 * options.messages 是 session.deriveMessages() 的**表面**（agent-loop 619）——compaction replace 之后（dsh-session 1489-1490）
 * 早先的 id 会从表面消失，所以适配器还要并上账本里"进过日志"的 id（ToolLedger.reconcileEmitted）。
 * @returns {Set<string>}
 */
export function historyCallIds(options) {
  const ids = new Set();
  for (const message of options?.messages ?? []) {
    if (message?.role !== "assistant") continue;
    for (const block of message.content ?? []) if (block?.type === "tool-call") ids.add(block.id);
  }
  return ids;
}

/**
 * call.arguments → ToolCallBlock.arguments（原始 JSON 字符串，types.d.ts:65-66）。
 * JSON.stringify 会抛（BigInt、循环引用）或返回 undefined（toJSON 返回 undefined）、或返回非对象 JSON（toJSON 返回别的）——
 * 三种都是能力面违反协议，在发出任何 chunk 之前拒绝。
 */
function serializeArguments(call) {
  let args;
  try {
    args = JSON.stringify(call.arguments);
  } catch (error) {
    throw new LlmError(`capability surface answered tool_calls with unserializable arguments (call "${call.id}")`, "INVALID_TURN", { cause: error });
  }
  if (typeof args !== "string" || !args.startsWith("{")) {
    throw new LlmError(`capability surface answered tool_calls with arguments that do not serialize to a JSON object (call "${call.id}")`, "INVALID_TURN");
  }
  return args;
}

/**
 * CapabilityTurn → StreamChunk[]。整个数组先算完再交给调用方 yield：
 * 所有校验错误都在发出第一个 chunk 之前抛出（"finish 之后不能再有东西"，types.d.ts:327-333）。
 * 永远不发 usage（计量在网关服务端，CLAUDE.md）；永远不发 max-tokens（会丢 tool-call 块，assembler.js:121-126）。
 *
 * @param {object} turn      能力面的应答
 * @param {{ capability: string, tools: Array<{id: string}> }} request  **发出去的那个请求**：应答只能对着它校验——
 *   request.tools 是这一轮的 offer（契约 ∩ dsh 可见），request.capability 决定这是生成轮还是验证轮。
 *   dsh 派发工具只看注册表可见性、不看 offer（dsh-tools 2907-2912；agent-loop 690-692 对每个 tool-call 块都派发），
 *   所以"没 offer 的工具"必须在这里拦下，否则 dsh 会真的执行——ports.ts:244-247 的反面。
 * @param {object} options   GenerateOptions（只读 messages，查 id 复用）
 * @param {ReadonlySet<string>} [loggedIds]  账本里本会话进过日志的 tool-call id（表面上可能已被 compaction 抹掉）
 */
export function turnToChunks(turn, request, options, loggedIds = EMPTY_SET) {
  if (turn === null || typeof turn !== "object") {
    throw new LlmError("capability surface returned an unreadable turn", "CAPABILITY_ERROR");
  }
  const capability = request?.capability ?? "";
  const isVerification = capability.startsWith(VERIFY_PREFIX);

  if (turn.kind === "content" && typeof turn.content === "string") {
    const text = turn.content; // '' 也是一个文本块：内核接受空串作为答案（harness.ts:1078-1082）
    return [
      { type: "block-start", index: 0, blockType: "text" },
      { type: "text-delta", index: 0, text },
      { type: "block-end", index: 0, block: { type: "text", text } },
      { type: "finish", reason: { kind: "stop" } },
    ];
  }

  if (turn.kind === "tool_calls") {
    if (isVerification) {
      // 验证轮 offer 恒为 []（harness.ts:1562）；内核对任何非判定应答都升级 pending_human（harness.ts:1576-1584）。
      // 这里不能让它流到 dsh 去执行：抛不可重试的错，宿主按 code 升级。
      throw new LlmError(`capability "${capability}" answered with tool_calls, but a verification round takes only a verdict`, "NON_VERDICT_IN_VERIFICATION");
    }
    const calls = turn.calls;
    if (!Array.isArray(calls)) {
      throw new LlmError("capability surface answered tool_calls without a calls array", "INVALID_TURN");
    }
    if (calls.length === 0) {
      throw new LlmError("capability surface answered tool_calls with zero calls", "EMPTY_RESPONSE");
    }
    const offered = new Set((request?.tools ?? []).map((o) => o.id));
    const seen = new Set();
    const used = new Set([...historyCallIds(options), ...loggedIds]);
    const serialized = [];
    for (const call of calls) {
      if (!isPlainObject(call)) throw new LlmError("capability surface answered tool_calls with a non-object call", "INVALID_TURN");
      if (typeof call.id !== "string" || call.id === "") throw new LlmError("capability surface answered tool_calls with an empty call id", "INVALID_TURN");
      if (seen.has(call.id)) throw new LlmError(`capability surface answered tool_calls with duplicate call id "${call.id}"`, "INVALID_TURN");
      if (used.has(call.id)) throw new LlmError(`capability surface reused call id "${call.id}" already present in history`, "INVALID_TURN");
      if (typeof call.tool !== "string" || call.tool === "") throw new LlmError(`capability surface answered tool_calls with an empty tool name (call "${call.id}")`, "INVALID_TURN");
      if (!isPlainObject(call.arguments)) throw new LlmError(`capability surface answered tool_calls with non-object arguments (call "${call.id}")`, "INVALID_TURN");
      // 镜像 gate 的 tool-not-in-contract 拒绝（harness.ts:1280-1295），但在派发之前、以整回合失败的形式：
      // offer 是"Runtime 真会执行的工具"（ports.ts:244-247），执行没 offer 的工具是它的反面。
      if (!offered.has(call.tool)) throw new LlmError(`capability surface called tool "${call.tool}", which was not offered this turn (call "${call.id}")`, "TOOL_NOT_OFFERED");
      serialized.push(serializeArguments(call)); // 序列化也在第一个 chunk 之前：抛 / undefined / 非对象都是 INVALID_TURN
      seen.add(call.id);
    }
    const chunks = [];
    calls.forEach((call, index) => {
      const id = ToolCallId(call.id); // 运行时是恒等（brand.js:26-28）：能力面的 id 原样往下走
      const args = serialized[index]; // ToolCallBlock.arguments 是原始 JSON 字符串（types.d.ts:65-66）
      chunks.push({ type: "block-start", index, blockType: "tool-call" });
      chunks.push({ type: "tool-call-delta", index, id, name: call.tool, argumentsDelta: args });
      // block-end 带完整块：装配器原样返回它（assembler.js:64-71, 94-96），id/name/arguments 就是我们给的。
      chunks.push({ type: "block-end", index, block: { type: "tool-call", id, name: call.tool, arguments: args } });
    });
    chunks.push({ type: "finish", reason: { kind: "tool-calls" } });
    return chunks;
  }

  if (turn.kind === "verdict" && typeof turn.passed === "boolean") {
    if (!isVerification) {
      // 镜像 harness.ts:1084-1092：生成能力答判定 = 任务失败。
      throw new LlmError(`capability "${capability}" answered with a verdict, which only verification rules use`, "VERDICT_IN_GENERATION");
    }
    const block = {
      type: VERDICT_BLOCK_TYPE,
      passed: turn.passed,
      ...(typeof turn.reason === "string" ? { reason: turn.reason } : {}),
    };
    // 非核心块类型必须用 block-end 关闭（assembler.js:106 对未关闭的未知类型抛错）。
    return [
      { type: "block-start", index: 0, blockType: VERDICT_BLOCK_TYPE },
      { type: "block-end", index: 0, block },
      { type: "finish", reason: { kind: "stop" } },
    ];
  }

  throw new LlmError("capability surface returned an unreadable turn", "CAPABILITY_ERROR");
}

/** 非 Error 的抛出值：String() 可能被敌意 toString / 无原型对象弄崩（镜像 dsh 的 thrownMessage，adapter-failure.js:28-36）。 */
function safeString(value) {
  try {
    const text = String(value);
    return text.length > 0 ? text : "capability surface failed";
  } catch {
    return "capability surface failed";
  }
}

/** 网关抛出的东西 → 带 code 的 LlmError（普通 Error 过 normalizeLlmFailure 会变成 UNKNOWN）。 */
export function classifyFailure(error) {
  if (error instanceof LlmError) return error;
  if (error instanceof TransientError) {
    return new LlmError(error.message || "capability surface unreachable", "TRANSPORT", { cause: error });
  }
  if (error instanceof Error) {
    return new LlmError(error.message || "capability surface failed", "CAPABILITY_ERROR", { cause: error });
  }
  return new LlmError(safeString(error), "CAPABILITY_ERROR", { cause: error });
}

/**
 * AIGatewayPort.turn 不收 signal（ports.ts:301-303）：只能在等待侧竞争。
 * 信号先到 → 拒绝 ABORTED（监听器是 once，触发即自行移除）；promise 先到 → 摘掉监听器再放行。
 * 孤儿 fetch 会跑到 CapabilityClient 自己的超时（capability-client.ts:59-63），它晚到的结果落进已定案的 promise，无事发生。
 */
export function raceAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) {
    promise.catch(() => {}); // 不等它了，但别留下未处理的拒绝
    return Promise.reject(new LlmError("cancelled before the capability surface was called", "ABORTED"));
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new LlmError("cancelled while waiting for the capability surface", "ABORTED"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
      (error) => { signal.removeEventListener("abort", onAbort); reject(error); },
    );
  });
}

// ---------------------------------------------------------------------------
// 适配器
// ---------------------------------------------------------------------------

export class RuyinCapabilityAdapter extends LlmAdapter {
  #gateway;
  #facts;
  #ledger;
  #log;
  /** 三项"dsh 想塞进请求、被适配器挡下"的累计数（每请求的明细在 log 回调的 dropped 里；历史每次请求都重映射，所以同一条会累计多次）。 */
  #counters = { droppedCancelledCalls: 0, droppedImageBlocks: 0, droppedForeignUserMessages: 0 };

  /**
   * @param {{ gateway: { turn(request: object): Promise<object> },
   *           facts: import('./task-facts.mjs').TaskFactsProvider,
   *           ledger: import('./tool-ledger.mjs').ToolLedger,
   *           log?: (record: { sessionId: string, capability: string, dropped: object }) => void }} deps
   *   三者都是必需的：没有账本就分不出工具结果是谁写的（会把 dsh 的渲染文本照转），没有宿主名单就分不出 user 消息是谁发的。
   */
  constructor({ gateway, facts, ledger, log }) {
    super();
    if (!gateway || typeof gateway.turn !== "function") throw new TypeError("llm-ruyin needs a gateway with turn()");
    if (!facts || typeof facts.factsFor !== "function" || typeof facts.isHostMessage !== "function") {
      throw new TypeError("llm-ruyin needs a facts provider with factsFor() and isHostMessage()");
    }
    if (!ledger || typeof ledger.provenanceOf !== "function" || typeof ledger.reconcileEmitted !== "function" || typeof ledger.noteEmittedCalls !== "function") {
      throw new TypeError("llm-ruyin needs a tool ledger with provenanceOf() / reconcileEmitted() / noteEmittedCalls()");
    }
    this.#gateway = gateway;
    this.#facts = facts;
    this.#ledger = ledger;
    this.#log = log;
  }

  /** @returns {{ droppedCancelledCalls: number, droppedImageBlocks: number, droppedForeignUserMessages: number }} 快照 */
  get counters() {
    return { ...this.#counters };
  }

  providerInfo(provider) {
    return { id: provider, name: PROVIDER_DISPLAY_NAME };
  }

  /**
   * 无 reasoning（AgentOptions 不得带 reasoningEffort）。**不声明 inputModalities**：声明成 ['text'] 会让 LlmRuntime.adapterStream
   * 在适配器跑之前把 image 块改写成 dsh 的英文占位句（dsh-llm index.js:1684-1690 → 521-523, 600-625）；不声明就原样到达，
   * 由 mapMessages 自己丢、只记 droppedImageBlocks。
   */
  resolveModel(provider, model) {
    return Promise.resolve({ provider, id: model, name: PROVIDER_DISPLAY_NAME });
  }

  /** 镜像内核 MAX_TRANSIENT_ATTEMPTS=3 / BASE_BACKOFF_MS=500（harness.ts:316-317）：首发 + 2 次重试，500 → 1000 ms。 */
  providerRetryPolicy(provider) {
    return resolveRetryPolicy(
      {
        mode: "normal",
        maxRetries: 2,
        retryableCodes: ["TRANSPORT", "EMPTY_RESPONSE"],
        backoff: { initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0 },
      },
      `llm-ruyin provider "${provider}"`,
    );
  }

  async *stream(options) {
    if (options.signal?.aborted) throw new LlmError("cancelled before dispatch", "ABORTED");
    if (options.purpose !== undefined) {
      throw new LlmError(`llm-ruyin does not serve purpose "${String(options.purpose)}"`, "UNSUPPORTED_PURPOSE");
    }
    const sessionId = options.sessionId;
    const facts = this.#facts.factsFor(sessionId);
    if (facts === undefined) {
      throw new LlmError(`no Ruyin task facts for session "${sessionId ?? "?"}"`, "NO_TASK_FACTS");
    }
    const ledger = this.#ledger;
    const host = {
      provenanceOf: (callId) => ledger.provenanceOf(sessionId, callId),
      isHostMessage: (messageId) => this.#facts.isHostMessage(sessionId, messageId),
    };
    const { request, dropped } = toTurnRequest(options, facts, host);
    for (const key of Object.keys(this.#counters)) this.#counters[key] += dropped[key];
    this.#log?.({ sessionId, capability: facts.capability, dropped });

    let turn;
    try {
      turn = await raceAbort(this.#gateway.turn(request), options.signal);
    } catch (error) {
      throw classifyFailure(error);
    }
    if (options.signal?.aborted) throw new LlmError("cancelled after the capability surface answered", "ABORTED");

    // 上一次发出的 id 对着这次的历史表面核对：出现了的 = 进过日志（永远记住，compaction 之后也算用过）；
    // 没出现的 = 块没进日志（中途取消，agent-loop 626-627 在 append 之前抛），忘掉——无状态的能力面重发同一个 id 不会被卡死。
    const logged = ledger.reconcileEmitted(sessionId, historyCallIds(options));
    // 所有校验在第一个 chunk 之前；应答对着**发出去的请求**校验（offer / 生成轮 vs 验证轮）。
    const chunks = turnToChunks(turn, request, options, logged);
    if (turn.kind === "tool_calls") {
      // 先登记再 yield；是否真进了日志，下一次 reconcileEmitted 再定。
      ledger.noteEmittedCalls(sessionId, turn.calls.map((call) => call.id));
    }
    yield* chunks;
  }
}
