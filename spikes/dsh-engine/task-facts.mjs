// ADR-019 探针 · llm-ruyin 的事实来源。
//
// 这些字段正是内核在 harness.ts:1059-1076 组装 CapabilityTurnRequest 时用的那几个：
// 路由身份（capability / product / taskId / workspace）、契约事实（objective / constraints）、
// 上下文集（context[]）、工具与技能的 offer、修订轮数据。适配器只按 dsh 的 sessionId 来取，
// 不持有任何 cordis ctx。这个文件不 import dsh。
//
// 未来 local-host 的实现从 HarnessDeps 填这些字段即可，适配器不用改。

/**
 * @typedef {object} TaskFacts
 * @property {string} capability      'requirement_analysis' 或 'verify:<ruleId>'（harness.ts:1553 的命名）
 * @property {string} product         contract.product.id
 * @property {string} taskId
 * @property {string} workspace       CapabilityClient 在线上改名 projectId（capability-client.ts:83）
 * @property {string} objective       契约原文
 * @property {string[]} constraints   契约原文
 * @property {Array<{type:string,name:string,content:object,origin:object}>} context  ContextFact[]（ports.ts:185-195）
 * @property {Array<{id:string,description?:string}>} tools  与 harness.toolOffers 同形（harness.ts:1189）
 * @property {Array<{name:string,description:string}>=} skills
 * @property {{round:number,failures:Array<{rule:string,reason:string}>}=} revision
 */

/**
 * @typedef {object} TaskFactsProvider
 * @property {(sessionId: string) => TaskFacts | undefined} factsFor
 * @property {(sessionId: string, message: { id: string, content: unknown[] }) => boolean} isHostMessage
 *   这条 user 消息是不是宿主自己发的。dsh 里工具附加的 additionalContexts 可以带任何 MessageSource
 *   （dsh-tools index.d.ts:397/408/436-445）并被拼进下一步，所以"role user"不等于"用户说的"；宿主每次 followup /
 *   steer / inject 之前把消息登记进来，适配器只把名单上的转成 role 'user'。
 *   名单记的是指纹（id + 内容），不只是 id：工具能从 exec.agent.session.deriveMessages() 读到宿主的 id，再
 *   deferContext 一条复用该 id 的伪造消息（dsh 追加时不查 id 唯一，dsh-session 1403-1424）——同 id 不同内容不算宿主的。
 */

/**
 * 内容指纹：键排序后的 JSON。dsh 的 freezeMessage（structuredClone）与 session.append 的快照都不改键序，
 * 但排序后不依赖这一点；语义与 JSON.stringify 相同（对象里 undefined 值省略、数组里成 null）。
 * @param {unknown} content
 * @returns {string}
 */
export function contentFingerprint(content) {
  return canonicalJson(content) ?? "undefined";
}
function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v) ?? "null").join(",")}]`;
  if (typeof value === "object") {
    const parts = [];
    for (const k of Object.keys(value).sort()) {
      const v = canonicalJson(value[k]);
      if (v !== undefined) parts.push(`${JSON.stringify(k)}:${v}`);
    }
    return `{${parts.join(",")}}`;
  }
  return undefined; // undefined / function / symbol / bigint：与 JSON.stringify 一样不算值
}

/** 内存实现：一个 dsh 会话对应一份事实；宿主在每次 followup 之前 patch，并登记自己发出的消息。 */
export class MemoryTaskFacts {
  #facts = new Map();
  /** sessionId → Map<messageId, 内容指纹> */
  #hostMessages = new Map();

  /** @param {string} sessionId @param {TaskFacts} facts */
  set(sessionId, facts) {
    this.#facts.set(sessionId, { ...facts });
    return this;
  }

  /**
   * 宿主发消息之前登记它（createUserMessage 在入 inbox 之前就给了 id：dsh-llm index.js:40-52，且跨表示层不变）。
   * 记的是 id + 内容指纹；同一 id 用不同内容再登记是宿主的 bug，直接抛。
   * @param {string} sessionId @param {{ id: string, content: unknown[] }} message
   */
  noteHostMessage(sessionId, message) {
    const id = message?.id;
    if (typeof id !== "string" || id === "") throw new TypeError("a host message needs a string id");
    if (!Array.isArray(message.content)) throw new TypeError("a host message needs a content array");
    let map = this.#hostMessages.get(sessionId);
    if (map === undefined) this.#hostMessages.set(sessionId, (map = new Map()));
    const fingerprint = contentFingerprint(message.content);
    const prior = map.get(id);
    if (prior !== undefined && prior !== fingerprint) throw new TypeError(`host message "${id}" is already registered with different content`);
    map.set(id, fingerprint);
    return this;
  }

  /** @param {string} sessionId @param {{ id?: string, content?: unknown[] }} message  id 与内容指纹都对得上才算宿主的 */
  isHostMessage(sessionId, message) {
    const id = message?.id;
    if (typeof id !== "string") return false;
    const fingerprint = this.#hostMessages.get(sessionId)?.get(id);
    return fingerprint !== undefined && Array.isArray(message.content) && fingerprint === contentFingerprint(message.content);
  }

  /** 浅合并：宿主在两次 followup 之间推进 capability / tools / revision 用的。 */
  patch(sessionId, partial) {
    const current = this.#facts.get(sessionId);
    if (current === undefined) throw new Error(`no Ruyin task facts to patch for session "${sessionId}"`);
    this.#facts.set(sessionId, { ...current, ...partial });
    return this;
  }

  delete(sessionId) {
    this.#hostMessages.delete(sessionId);
    return this.#facts.delete(sessionId);
  }

  /** @param {string} sessionId @returns {TaskFacts | undefined} */
  factsFor(sessionId) {
    return this.#facts.get(sessionId);
  }
}
