// ADR-019 探针 · 工具结果的出处账本（宿主维护，按 dsh 会话记；适配器只拿几个只读回调）。
//
// 为什么需要它：dsh 派生给适配器的 Message 不带 tool/result 事件的 error.info —— createToolResultMessage 只收
// callId / content / isError（dsh-agent-loop/lib/index.js:296-300），而 dsh 的运行时自己也会写工具结果文本：
//   guard / pre-execute 拒绝   `Error: ${denialReason}`                dsh-tools/lib/index.js:3128-3140（error 无 info）
//   任何抛错 / 未知工具        `Error: ${message}`                      dsh-tools/lib/index.js:3491-3503（HarnessError 才有 info）
//   输出校验 / 投影失败        `tool "X" returned invalid output: …`     dsh-tools/lib/index.js:2458, 2464-2466（INVALID_TOOL_OUTPUT）
//   取消（工具体已进 / 未进）  `Error: tool call aborted[ before dispatch]` dsh-tools/lib/index.js:3550-3577；
//                              未启动的调用由循环补记                     dsh-agent-loop/lib/index.js:277-292
//   post-execute block         决策的 feedback 文本                      dsh-tools/lib/index.js:3381-3389
// 内核的契约相反：拒绝是裸 reason、无 origin（harness.ts:1290-1295）；origin 只放在工具真正返回的数据上
// （harness.ts:1415-1423）。所以适配器不能只凭 options.messages 就断定"工具 X 产出了这段文字"。
//
// **不变式（第四轮 L6d）：本账本的 `tools/execute` 监听器必须是最内层的那一个（= 最后注册）。**
// tools/execute 是 around-dispatch 瀑布（dsh-tools 3210-3213：`ctx.waterfall(carrier,'tools/execute',exec,() => dispatchToolBody(exec))`），
// 谁先注册谁在外层。classifyToolResult 靠"next() 的返回值就是工具体的产出"来推断 reached / isError / message / 内容指纹；
// 只要有别的插件比账本更靠内，它的改写会被当成工具体自己的产出。组合里出现 around-dispatch 插件时，账本必须重新注册到最内层，
// 否则本文件的归属结论不成立（探针 G1c 演示了外层账本的降级行为：拿不到 outcome，reached 停在 true、无指纹）。
// 同理：post-execute block（3381-3389）在本账本之后改写结果，靠指纹对比而不是靠位置识别（见下）。
//
// 观察点（全是 dsh-tools / dsh-session 的公开事件，dsh-tools/lib/types/index.d.ts:38-83）：
//   tools/execute  瀑布：包住工具体，记下"工具体被到达"、工具体自己的结果（isError / error.message）以及**内容指纹**
//                  （resultFingerprint：isError + content + value 的规范 JSON）。最终结果与它对不上 = 工具体之后被改写
//                  （tools/post-execute accept{content} 3402-3406 / accept{value} 3392-3400 都会留下成功结果、不留 error）
//                  → 归成 runtime、无 code、无 hostReason，适配器 fail closed。
//   tools/result   通知：最终结果（含 error.message 与 error.info）。在 tool/result 事件 append 之前同步触发
//                  （finishScheduledExecution → notifyResult：dsh-tools 3271, 3285-3300；commitReady 先 finalize/finish
//                  再 appendToolResult：dsh-agent-loop 176-185），所以下一次请求组装时账本已经写好。
//   session/event  tool/result：记下这条结果的 message.id（适配器只接受 callId 与 message.id 都对得上的工具结果；
//                  同一 callId 的第二条事件不改记录）；从未进调度器的"跳过"调用在这里兜底（带 error.info：agent-loop 277-292, 306-307）。
//                  assistant/message：**只有与适配器登记过的 emission（noteEmission）对得上的那一条**才记成"本适配器产出的
//                  assistant 消息"（含 interrupted 的，agent-loop 639-654 / 680-688）；里面的 tool-call 块随之算"进了日志的
//                  tool-call id"（中断的消息走 interruptedBlocks，从不带 tool-call 块，dsh-llm index.js:935-942）。
//                  第四轮 L3：从事件本身推"这条 assistant 是我发的"是循环论证——拿到 exec.agent 的工具能直接
//                  `exec.agent.session.append('assistant/message', …)` 写一条（NOTES 遗留 (d)），于是它自己把自己写进了名单。
//                  现在名单的来源是适配器**发出前**登记的块集指纹：对不上就不进名单（mapMessages 对 assistant/model 会 fail closed）。
//                  user/message：同一 id 第二次出现、data.role 不是 'user'、或 source.kind 是 'tool'（工具结果只能经 tool/result 事件）
//                  → 污点 id。工具可以 deferContext 任何 Message（dsh-tools 3046-3048），循环按 user/message 追加、不查 role、不查 id
//                  唯一（agent-loop 185 → 559；dsh-session 1403-1424），表面再按 data.role 呈现（dsh-session 131）——所以 role 说明不了作者。
// 未标记作用域的监听器收到所有 agent 的派发（dsh-scope/lib/index.js:331-332）。session.append 同步触发 session/event
// （dsh-session 1428-1435），所以下一次请求组装时账本已经写好。
//
// 宿主自己的拒绝：guard 返回的理由由 dsh 渲染成 `Error: ${reason}`、error.message = reason（3128-3140），事件上没有 code。
// 这句是宿主写的，但只有宿主自己知道——guard 先 noteHostDenial 再把理由交给 dsh；tools/result 时账本把与 error.message
// 相同的宿主理由附成 hostReason。没有 code 又没有 hostReason 的运行时结果（别的 pre-execute 插件、流水线抛错 3150-3155、
// post-execute block）适配器一律 INVALID_HISTORY：不知道是谁写的就不转发。
//
// 发出过的 tool-call id 分两格：pending（适配器 yield 之前登记）和 logged（进过日志）。中途取消时块到不了日志
// （agent-loop 626-627 在 append 之前 throwIfAborted），pending 里的 id 在下一次请求对着历史表面核对后忘掉——
// 否则无状态的能力面重发同一个 id 会被永远卡住。logged 永远记住：compaction replace 之后表面看不见也算用过。
//
// 这个文件不 import dsh、不 import 适配器（只借 task-facts 的规范 JSON，两者都是宿主侧的纯函数）。
import { contentFingerprint } from "./task-facts.mjs";

const SEP = "\0"; // 会话 id 与 callId 之间的分隔符：U+0000，写成两字符转义（源码里不放真 NUL 字节，否则 git 当二进制文件）
const ERROR_PREFIX = "Error: ";
const EMPTY = Object.freeze(new Set());

const key = (sessionId, callId) => `${sessionId}${SEP}${callId}`;
const keyOfExec = (exec) => {
  const sessionId = exec?.agent?.session?.id;
  return typeof sessionId === "string" && typeof exec?.callId === "string" ? key(sessionId, exec.callId) : undefined;
};
/** sessionId → Set 的取或建。 */
function setFor(map, sessionId) {
  let set = map.get(sessionId);
  if (set === undefined) map.set(sessionId, (set = new Set()));
  return set;
}

/** dsh 渲染错误文本的固定前缀（toolErrorResult 3496-3499、拒绝 3131-3134、取消 3551-3554, 3568-3571）。 */
export function stripErrorPrefix(text) {
  return typeof text === "string" && text.startsWith(ERROR_PREFIX) ? text.slice(ERROR_PREFIX.length) : text;
}

/** 第四轮 L4：块容器不一定是数组——工具的 output.render 返回任意 lossless JSON 都能落进 tool-result 块（snapshotProjection 2468-2477）。 */
function joinText(blocks) {
  if (!Array.isArray(blocks)) return "";
  const texts = [];
  for (const block of blocks) if (block?.type === "text") texts.push(block.text);
  return texts.join("\n");
}

/**
 * 一个工具结果里"内容"的指纹：isError + content + （成功结果才有的）value 的规范 JSON。
 * meta / additionalContexts / concludesTurn 不算内容（它们到不了适配器）。
 * 工具体产出的指纹与最终结果的指纹不同 = 工具体之后被改写过（tools/post-execute accept{content|value}）。
 */
export function resultFingerprint(result) {
  const shape = result === null || typeof result !== "object" ? { raw: result } : {
    isError: result.isError === true,
    content: result.content,
    ...(Object.hasOwn(result, "value") ? { value: result.value } : {}),
  };
  return contentFingerprint(shape);
}

/** 一组 assistant 内容块的指纹（键序无关）。 */
export function blocksFingerprint(blocks) {
  return contentFingerprint(Array.isArray(blocks) ? blocks : { notAnArray: true });
}

/**
 * dsh 在被中断的回合里保留的块（BlockAssembler.interruptedBlocks，dsh-llm 935-942）：只留有非空白文本的
 * text / reasoning 块，tool-call 与未知块一律丢。适配器发出的块集要按同样的规则算一份指纹，
 * 否则 interrupted 的那条 assistant/message 对不上自己的 emission。
 */
function interruptedProjection(blocks) {
  return (Array.isArray(blocks) ? blocks : []).filter(
    (b) => (b?.type === "text" || b?.type === "reasoning") && typeof b.text === "string" && b.text.trim() !== "",
  );
}

/**
 * 纯分类：最终结果 + 工具体观察 → 这段文字是谁写的。
 * @param {{ isError?: boolean, error?: { message: string, info?: { name: string, code: string } } }} result
 *   tools/result 收到的 ToolExecutionResult
 * @param {{ reached: boolean, isError?: boolean, message?: string, fingerprint?: string } | undefined} body
 *   tools/execute 记下的工具体观察；undefined = 工具体从未被到达
 * @returns {{ authored: 'tool' | 'runtime', reason?: string, code?: string, bodyRewritten?: true }}
 */
export function classifyToolResult(result, body) {
  // 第四轮 L2：post-execute 的 accept{content}（3402-3406）/ accept{value}（3392-3400）会**替掉成功结果的内容而不留 error**，
  // 只看 isError / error.message 完全看不出来。工具体的内容指纹与最终结果对不上 → 不是工具说的。
  const rewritten = body?.reached === true && typeof body.fingerprint === "string" && body.fingerprint !== resultFingerprint(result);
  if (result?.error === undefined) {
    // createSuccessResult（dsh-tools 3416-3446）：内容就是工具的 render 输出——除非它之后被换掉了
    return rewritten ? { authored: "runtime", bodyRewritten: true } : { authored: "tool" };
  }
  const reason = typeof result.error.message === "string" ? result.error.message : undefined;
  const code = result.error.info?.code;
  // HarnessError 编码的失败全是运行时写的：UNKNOWN_TOOL（2449）、INVALID_TOOL_OUTPUT（2458, 2464-2466）、ABORTED / ABORTED_BEFORE_DISPATCH（3550-3577）…
  // code 是**未经校验的攻击者可控字符串**（HarnessError 收任何字符串，dsh-llm error.js:12-19；toolErrorResult 照抄 2516-2521）——
  // 账本原样记下，允许清单在适配器那一侧（llm-ruyin 的 KNOWN_FAILURE_CODES）。
  if (typeof code === "string") return { authored: "runtime", reason, code };
  // 工具体没被到达：guard / pre-execute 拒绝（3128-3140）或 pre-execute 流水线抛错（3154）
  if (body === undefined || body.reached !== true) return { authored: "runtime", reason };
  // 工具体自己抛的错（dispatchToolBody 3196-3197）：dsh 只加了前缀，message 是工具的——内容没被换过才算
  if (body.isError === true && body.message === reason) {
    return rewritten ? { authored: "runtime", reason, bodyRewritten: true } : { authored: "tool", reason };
  }
  // 工具体之后被改写（post-execute block 3381-3389 等）：不是工具说的
  return { authored: "runtime", reason };
}

export class ToolLedger {
  /** key → { reached, isError?, message? } */
  #body = new Map();
  /** key → { authored, tool?, reason?, code?, hostReason?, messageId? } */
  #results = new Map();
  /** key → 宿主 guard 自己写的拒绝理由（在交给 dsh 之前登记） */
  #hostDenials = new Map();
  /** sessionId → Set<callId>：适配器发出过、还没核对是否进了日志的 tool-call id */
  #pending = new Map();
  /** sessionId → Set<callId>：进过日志的 tool-call id（compaction 之后表面消失了也算用过） */
  #logged = new Map();
  /** sessionId → Set<messageId>：assistant/message 事件里的消息 id = 本适配器产出的 assistant 消息 */
  #assistantIds = new Map();
  /** sessionId → Set<messageId>：user/message 事件见过的 id */
  #userSeen = new Map();
  /** sessionId → Set<messageId>：污点 id（重复的 user/message id；role 不是 user；source.kind 是 tool） */
  #tainted = new Map();
  /** sessionId → Array<{ full, interrupted }>：适配器已经 yield、还没在日志里被认领的 assistant 块集指纹 */
  #emissions = new Map();

  /**
   * 挂到一个 cordis ctx 上（探针里是 inject 了 tools 的插件 ctx）。返回注销函数。
   * 三个监听器都不改变 dsh 的结果：tools/execute 原样 return next()，tools/result 只读，session/event 只读。
   */
  attach(ctx) {
    const disposers = [
      ctx.on("tools/execute", (exec, next) => {
        const k = keyOfExec(exec);
        if (k === undefined) return next();
        this.#body.set(k, { reached: true });
        return next().then((outcome) => {
          this.#body.set(k, {
            reached: true,
            isError: outcome?.isError === true,
            fingerprint: resultFingerprint(outcome), // 工具体产出的内容：最终结果与它不一致 = 之后被改写过（L2）
            ...(typeof outcome?.error?.message === "string" ? { message: outcome.error.message } : {}),
          });
          return outcome;
        });
      }),
      ctx.on("tools/result", (exec, result) => {
        const k = keyOfExec(exec);
        if (k === undefined || this.#results.has(k)) return; // 同一 callId 只记第一次
        const record = { tool: exec.name, ...classifyToolResult(result, this.#body.get(k)) };
        if (record.authored === "runtime" && record.code === undefined && record.bodyRewritten !== true) {
          // 无 code 的运行时结果：只有宿主自己登记过、且与 dsh 记下的 error.message 一字不差的理由才算宿主写的
          const host = this.#hostDenials.get(k);
          if (host !== undefined && host === record.reason) record.hostReason = host;
        }
        this.#results.set(k, record);
      }),
      ctx.on("session/event", (session, event) => {
        const type = event?.type;
        if (type === "assistant/message") {
          const message = event.data?.message;
          // L3：名单不能从事件本身推——写事件的人就能把自己写进名单。只认适配器发出前登记的块集指纹。
          const list = this.#emissions.get(session.id);
          const fingerprint = blocksFingerprint(message?.content);
          const at = list === undefined ? -1 : list.findIndex((e) => e.full === fingerprint || e.interrupted === fingerprint);
          if (at < 0) return; // 不是本适配器 yield 的那一条：不进名单（mapMessages 对 assistant/model 会 INVALID_HISTORY）
          list.splice(at, 1); // 一条 emission 只认领一条消息：内容一模一样的克隆也进不了名单
          if (typeof message?.id === "string") setFor(this.#assistantIds, session.id).add(message.id);
          // 进了日志的 tool-call 块（agent-loop 680-688）：这些 id 从此永远算用过。
          if (Array.isArray(message?.content)) {
            for (const block of message.content) {
              if (block?.type === "tool-call" && typeof block.id === "string") this.#confirm(session.id, block.id);
            }
          }
          return;
        }
        if (type === "user/message") {
          const message = event.data;
          const id = message?.id;
          if (typeof id !== "string") return;
          const seen = setFor(this.#userSeen, session.id);
          if (seen.has(id) || message.role !== "user" || message.source?.kind === "tool") setFor(this.#tainted, session.id).add(id);
          seen.add(id);
          return;
        }
        if (type !== "tool/result") return;
        const message = event.data?.message;
        const callId = message?.source?.callId;
        if (typeof callId !== "string") return;
        const k = key(session.id, callId);
        const existing = this.#results.get(k);
        if (existing !== undefined) {
          // 走过调度器的，tools/result 已经记了（它先于这个事件触发）：只补 message.id；同一 callId 的第二条事件不改记录
          if (existing.messageId === undefined && typeof message.id === "string") existing.messageId = message.id;
          return;
        }
        if (event.data.error === undefined) return;
        // 从未进调度器的跳过调用（agent-loop 277-292）：没有 error.message 可读，只能去掉 dsh 的固定前缀
        const block = (message.content ?? []).find((b) => b?.type === "tool-result");
        this.#results.set(k, {
          authored: "runtime",
          code: event.data.error.code,
          reason: stripErrorPrefix(joinText(block?.content)),
          ...(typeof message.id === "string" ? { messageId: message.id } : {}),
        });
      }),
    ];
    return () => { for (const dispose of disposers) if (typeof dispose === "function") dispose(); };
  }

  /** @returns {{ authored: 'tool'|'runtime', tool?: string, reason?: string, code?: string, hostReason?: string, messageId?: string } | undefined} */
  provenanceOf(sessionId, callId) {
    return this.#results.get(key(sessionId, callId));
  }

  /**
   * 宿主的 guard 在把拒绝理由交给 dsh 之前登记它：这句话是宿主写的。tools/result 时只有与 dsh 记下的 error.message
   * 相同的理由才会附成 hostReason（别的插件拒绝、流水线抛错都对不上 → 适配器 INVALID_HISTORY）。
   */
  noteHostDenial(sessionId, callId, reason) {
    if (typeof sessionId !== "string" || typeof callId !== "string" || typeof reason !== "string") {
      throw new TypeError("a host denial needs string sessionId / callId / reason");
    }
    this.#hostDenials.set(key(sessionId, callId), reason);
    return this;
  }

  /** 这条 assistant 消息是不是本适配器产出的（assistant/message 事件记过它的 id）。 */
  isAdapterAssistantMessage(sessionId, messageId) {
    return this.#assistantIds.get(sessionId)?.has(messageId) === true;
  }

  /** @returns {ReadonlySet<string>} 本会话 assistant/message 事件记过的消息 id（只给测试 / 探针看） */
  assistantMessageIds(sessionId) {
    return this.#assistantIds.get(sessionId) ?? EMPTY;
  }

  /** 这个消息 id 是否被标了污点（重复的 user/message id；role 不是 user；source.kind 是 tool）。 */
  isTaintedMessage(sessionId, messageId) {
    return this.#tainted.get(sessionId)?.has(messageId) === true;
  }

  /** @returns {ReadonlySet<string>} 本会话的污点消息 id（只给测试 / 探针看） */
  taintedMessageIds(sessionId) {
    return this.#tainted.get(sessionId) ?? EMPTY;
  }

  #confirm(sessionId, id) {
    setFor(this.#logged, sessionId).add(id);
    this.#pending.get(sessionId)?.delete(id);
  }

  /** 适配器每次发出 tool-call 块之前登记；是否真进了日志，下一次 reconcileEmitted 再定。 */
  noteEmittedCalls(sessionId, ids) {
    const set = setFor(this.#pending, sessionId);
    for (const id of ids) set.add(id);
  }

  /**
   * 适配器在 yield 第一个 chunk 之前登记这一步要发出的**整组块**（block-end 里的那些块，= dsh 装配后的 assistant 内容）。
   * 之后只有内容与它对得上的 assistant/message 事件才算"本适配器产出的"。同时把里面的 tool-call id 登记成 pending。
   * @param {string} sessionId
   * @param {Array<object>} blocks
   */
  noteEmission(sessionId, blocks) {
    const list = this.#emissions.get(sessionId) ?? [];
    if (!this.#emissions.has(sessionId)) this.#emissions.set(sessionId, list);
    const ids = (Array.isArray(blocks) ? blocks : [])
      .filter((b) => b?.type === "tool-call" && typeof b.id === "string" && b.id !== "")
      .map((b) => b.id);
    if (ids.length > 0) this.noteEmittedCalls(sessionId, ids);
    list.push({ full: blocksFingerprint(blocks), interrupted: blocksFingerprint(interruptedProjection(blocks)) });
    return this;
  }

  /** @returns {number} 还没被任何 assistant/message 认领的 emission 数（只给测试 / 探针看） */
  pendingEmissions(sessionId) {
    return this.#emissions.get(sessionId)?.length ?? 0;
  }

  /**
   * 下一次请求组装时调用：pending 对着 dsh 的历史表面核对——出现了的 = 进过日志（记住）；没出现的 = 块没进日志
   * （中途取消），忘掉。返回本会话进过日志的全部 id（含 assistant/message 事件确认的、compaction 后表面看不见的）。
   * @param {string} sessionId
   * @param {ReadonlySet<string>} historyIds  历史表面上的 tool-call id（llm-ruyin historyCallIds）
   * @returns {ReadonlySet<string>}
   */
  reconcileEmitted(sessionId, historyIds) {
    // 上一步的 assistant/message 是在流结束时同步追加的（agent-loop 672-687），到这里已经认领过了；
    // 还留着的 emission 是没进日志的那种（中途取消）——清掉，免得日后一条内容相同的伪造消息把它认领走。
    this.#emissions.delete(sessionId);
    const pending = this.#pending.get(sessionId);
    if (pending !== undefined) {
      for (const id of pending) if (historyIds.has(id)) this.#confirm(sessionId, id);
      this.#pending.delete(sessionId);
    }
    return this.loggedCalls(sessionId);
  }

  /** @returns {ReadonlySet<string>} 本会话进过日志的 tool-call id */
  loggedCalls(sessionId) {
    return this.#logged.get(sessionId) ?? EMPTY;
  }

  /** @returns {ReadonlySet<string>} 发出过、还没核对的 tool-call id（只给测试 / 探针看） */
  pendingCalls(sessionId) {
    return this.#pending.get(sessionId) ?? EMPTY;
  }

  /** 会话结束时清掉它的全部记录。 */
  forget(sessionId) {
    const prefix = `${sessionId}${SEP}`;
    for (const map of [this.#body, this.#results, this.#hostDenials]) for (const k of map.keys()) if (k.startsWith(prefix)) map.delete(k);
    for (const map of [this.#pending, this.#logged, this.#assistantIds, this.#userSeen, this.#tainted, this.#emissions]) map.delete(sessionId);
  }
}
