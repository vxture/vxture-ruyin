/**
 * Node host implementations of the kernel ports (clock / id / crypto) and the
 * Phase A mock AI gateway. The real gateway client (Vxture AI Gateway, 60
 * section T10) replaces MockAIGateway in Phase B - nothing else changes.
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
 * Stand-in provider until the Capability Resolver lands (ADR-001).
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
