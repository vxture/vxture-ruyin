/**
 * Capability Resolver - resolves a contract capability to the business
 * product's own cloud service, and speaks the turn protocol to it (ADR-009).
 *
 * Why the product's service and not Atlas directly: Atlas identifies the
 * caller by `act.sub`, which comes from an S2S token exchange, which needs a
 * client secret. A desktop client ships to every user, so it holds none
 * (ADR-001). The product's service already has confidential credentials -
 * it calls Atlas, and Atlas meters the inference (nothing is metered here).
 *
 * The contract carries no provider (R6): resolution uses `product.id` plus
 * the capability id, and the base URL is a single runtime setting - keeping
 * it out of the contract is also what stops it becoming a second place where
 * hostnames live.
 */

import {
  TransientError,
  type AIGatewayPort,
  type CapabilityTurn,
  type CapabilityTurnRequest,
  type ToolCall,
} from "@vxture/ruyin-core";

export interface CapabilityClientConfig {
  /** e.g. https://capabilities.vxture.com - one setting, not per product. */
  baseUrl: string;
  /** Bearer for the product surface; absent while the path is unauthenticated. */
  token?: (() => Promise<string | undefined>) | undefined;
  timeoutMs?: number;
}

/** Network-class failures the runtime should retry rather than fail on. */
const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Is this status the surface being briefly unavailable, or the surface
 * definitively refusing?
 *
 * Shared with the contract fetcher, which talks to the same host and must
 * draw the same line - the two act differently on the answer (retry-and-park
 * vs fall back to cache), but "is this someone else's outage" is one question
 * and deserves one answer, not two that can drift apart.
 */
export function isTransientStatus(status: number): boolean {
  return TRANSIENT_STATUS.has(status);
}

export class CapabilityClient implements AIGatewayPort {
  constructor(private readonly config: CapabilityClientConfig) {}

  async turn(request: CapabilityTurnRequest): Promise<CapabilityTurn> {
    const url = new URL(
      `${this.config.baseUrl.replace(/\/+$/, "")}/products/${encodeURIComponent(
        request.product,
      )}/capabilities/${encodeURIComponent(request.capability)}/turn`,
    );

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs ?? 120_000,
    );
    let res: Response;
    try {
      const token = await this.config.token?.();
      res = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          // X-2: the cross-product aggregation key, logged verbatim by the
          // callee. Without it one task's cost and failure point cannot be
          // reconstructed across products.
          taskId: request.taskId,
          // The LOCAL container id, for correlation only. Deliberately not
          // called projectId: that word means the platform tenant workspace,
          // and the callee must take identity from the token alone - a body
          // field with a familiar name is an invitation to trust it instead.
          projectId: request.workspace,
          // Facts, not phrasing: the provider composes what the model sees.
          objective: request.objective,
          constraints: request.constraints,
          context: request.context,
          messages: request.messages,
          tools: request.tools,
          // 技能目录（ADR-018 §2.4）：名字与一句话，不是正文。**必须转发** ——
          // 内核在 tools 里放了 `use_skill`，而目录不过去的话，提供方拿到的是一个
          // 「可以取技能正文」的工具，却不知道有哪些技能可取，只能瞎猜名字。
          // 那种坏法看不出来：工具在、调用能发、每次都取不到。
          ...(request.skills?.length ? { skills: request.skills } : {}),
          ...(request.revision ? { revision: request.revision } : {}),
        }),
      });
    } catch (cause) {
      // Reaching the provider failed - that is someone else's outage, not this
      // task going wrong, so it retries and then parks (50-harness 8.4).
      throw new TransientError(
        `capability provider unreachable: ${describe(cause)}`,
        { cause },
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      let retryable = TRANSIENT_STATUS.has(res.status);
      try {
        const error = JSON.parse(body) as { retryable?: unknown } | null;
        if (typeof error?.retryable === "boolean") retryable = error.retryable;
      } catch { /* Older providers may return text instead of an envelope. */ }
      if (retryable) {
        throw new TransientError(
          `capability provider returned ${res.status}: ${body.slice(0, 200)}`,
        );
      }
      // 4xx other than the transient ones is a request the provider will keep
      // refusing - retrying only burns time.
      throw new Error(
        `capability "${request.capability}" failed: HTTP ${res.status} ${body.slice(0, 200)}`,
      );
    }

    return parseTurn(await res.json());
  }
}


function parseTurn(body: unknown): CapabilityTurn {
  const data = body as {
    kind?: string;
    content?: unknown;
    calls?: unknown;
    passed?: unknown;
    reason?: unknown;
    reasoning?: unknown;
  };
  const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  if (data?.reasoning !== undefined && !record(data.reasoning)) throw new Error("capability provider returned unreadable continuation state");
  const continuation = data?.reasoning ? { reasoning: data.reasoning as Record<string, unknown> } : {};
  if (data?.kind === "tool_calls" && Array.isArray(data.calls)) {
    const calls = data.calls;
    if (calls.length === 0 || calls.some(call => !record(call) || typeof call.id !== "string" || !call.id ||
        typeof call.tool !== "string" || !call.tool || !record(call.arguments)) ||
        new Set(calls.map(call => (call as ToolCall).id)).size !== calls.length ||
        (data.content !== undefined && typeof data.content !== "string")) {
      throw new Error("capability provider returned unreadable tool calls");
    }
    return { kind: "tool_calls", calls: calls as ToolCall[],
      ...(typeof data.content === "string" ? { content: data.content } : {}), ...continuation };
  }
  if (data?.kind === "content" && typeof data.content === "string") {
    return { kind: "content", content: data.content, ...continuation };
  }
  if (data?.kind === "verdict" && typeof data.passed === "boolean") {
    return {
      kind: "verdict",
      passed: data.passed,
      ...(typeof data.reason === "string" ? { reason: data.reason } : {}),
    };
  }
  // A shape we cannot read is not a result. Failing here beats handing the
  // harness an empty answer that would read as "the capability produced nothing".
  throw new Error(
    "capability provider returned an unreadable turn",
  );
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
