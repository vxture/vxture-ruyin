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
 */

/** 内存实现：一个 dsh 会话对应一份事实；宿主在每次 followup 之前 patch。 */
export class MemoryTaskFacts {
  #facts = new Map();

  /** @param {string} sessionId @param {TaskFacts} facts */
  set(sessionId, facts) {
    this.#facts.set(sessionId, { ...facts });
    return this;
  }

  /** 浅合并：宿主在两次 followup 之间推进 capability / tools / revision 用的。 */
  patch(sessionId, partial) {
    const current = this.#facts.get(sessionId);
    if (current === undefined) throw new Error(`no Ruyin task facts to patch for session "${sessionId}"`);
    this.#facts.set(sessionId, { ...current, ...partial });
    return this;
  }

  delete(sessionId) {
    return this.#facts.delete(sessionId);
  }

  /** @param {string} sessionId @returns {TaskFacts | undefined} */
  factsFor(sessionId) {
    return this.#facts.get(sessionId);
  }
}
