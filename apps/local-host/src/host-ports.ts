/**
 * Node host implementations of the kernel ports (clock / id / crypto) and the
 * Phase A mock AI gateway. The real gateway client (Vxture AI Gateway, 60
 * section T10) replaces MockAIGateway in Phase B - nothing else changes.
 */

import { createHash, randomUUID } from "node:crypto";
import type {
  AIGatewayPort,
  CapabilityInvocation,
  CapabilityResult,
  ClockPort,
  CryptoPort,
  IdPort,
} from "@vxture/ruyin-core";

export const nodeClock: ClockPort = {
  now: () => new Date().toISOString(),
};

export const nodeId: IdPort = {
  newId: (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "")}`,
};

export const nodeCrypto: CryptoPort = {
  sha256: (input: string) =>
    createHash("sha256").update(input, "utf8").digest("hex"),
};

export class MockAIGateway implements AIGatewayPort {
  async invoke(request: CapabilityInvocation): Promise<CapabilityResult> {
    return {
      content: `[mock:${request.capability}] generated for task ${request.taskInstance} with inputs: ${Object.keys(request.inputs).join(", ") || "(none)"}`,
    };
  }
}
