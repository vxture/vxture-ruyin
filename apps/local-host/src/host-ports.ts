/**
 * Node host implementations of the kernel ports (clock / id / crypto), plus a
 * stand-in gateway.
 *
 * MockAIGateway **不是"以后会被替换掉的东西"**：真正的
 * `CapabilityClient` 已经在了，配置了能力面就用它。这个替身是没有配置时的
 * 那条分支，而守护进程启动时会明说自己在用哪一条 —— 「没接上」绝不能看起来
 * 像「在工作」。
 */

import { createHash, randomUUID } from "node:crypto";
import type {
  AIGatewayPort,
  CapabilityTurn,
  CapabilityTurnRequest,
  ClockPort,
  CryptoPort,
  IdPort,
} from "@vxture/ruyin-core";

export const nodeClock: ClockPort = {
  now: () => new Date().toISOString(),
  sleep: (ms) =>
    new Promise((done) => {
      // unref: a pending backoff must not be the reason the daemon stays up.
      setTimeout(done, ms).unref?.();
    }),
};

export const nodeId: IdPort = {
  newId: (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "")}`,
};

export const nodeCrypto: CryptoPort = {
  sha256: (input: string | Uint8Array) =>
    createHash("sha256")
      .update(typeof input === "string" ? Buffer.from(input, "utf8") : input)
      .digest("hex"),
  base64: (input: Uint8Array) => Buffer.from(input).toString("base64"),
};

/**
 * 没有配置能力面时的那条分支 —— **不是等着被替换掉的占位**。
 *
 * 这一行原本写的是 "Stand-in provider until the Capability Resolver lands"，
 * 而**同一个文件往上四行**就写着相反的话：真正的 `CapabilityClient` 已经在了
 * （`capability-client.ts`），配了 `RUYIN_CAPABILITY_BASE` 就走它。一份文件里
 * 并存两种说法，读到哪一句全看运气 —— 而读到旧那句的人会去找一个不存在的待办。
 *
 * It echoes how many messages it was handed on purpose: the straight-line
 * predecessor fed every capability the same inputs, and a mock that ignored
 * the conversation is exactly what kept that hidden. This one makes chaining
 * visible - the count must grow from one capability to the next.
 */
export class MockAIGateway implements AIGatewayPort {
  async turn(request: CapabilityTurnRequest): Promise<CapabilityTurn> {
    return {
      kind: "content",
      content: `[mock:${request.capability}] task ${request.taskId}, ${request.messages.length} message(s) in context`,
    };
  }
}
