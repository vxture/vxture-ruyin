// ADR-019 探针 · 有剧本的能力面（AIGatewayPort）。
//
// turn() 把收到的每个 CapabilityTurnRequest 原样（structuredClone）记进 .requests，
// 然后按 FIFO 回答。每条剧本要么是一个 CapabilityTurn（ports.ts:287-290 的三种形状之一），
// 要么是 `{ throw: Error }`（模拟能力面抛错，例如 TransientError），
// 要么是一个 (request) => CapabilityTurn 的函数。剧本用尽就抛错 —— 探针不允许"多问一轮"悄悄过去。

export class ScriptedGateway {
  /** @type {object[]} 收到的请求，按到达顺序 */
  requests = [];
  #script;

  /** @param {Array<object | {throw: unknown} | ((request: object) => object)>} script */
  constructor(script = []) {
    this.#script = [...script];
  }

  /** 追加剧本条目。 */
  push(...answers) {
    this.#script.push(...answers);
    return this;
  }

  get remaining() {
    return this.#script.length;
  }

  async turn(request) {
    this.requests.push(structuredClone(request));
    if (this.#script.length === 0) {
      throw new Error(`ScriptedGateway: script exhausted after ${this.requests.length} request(s)`);
    }
    const next = this.#script.shift();
    if (typeof next === "function") return next(request);
    if (next !== null && typeof next === "object" && "throw" in next) throw next.throw;
    return next;
  }
}
