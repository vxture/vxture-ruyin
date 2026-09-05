/**
 * Capability Resolver over a real loopback HTTP server (ADR-009).
 *
 * The interesting behaviour is not "it can POST" - it is how it classifies
 * failure. Getting that wrong is expensive in opposite directions: calling a
 * permanent error transient parks a task that will never recover, and calling
 * an outage permanent throws away work someone was in the middle of.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { TransientError, type CapabilityTurnRequest } from "@vxture/ruyin-core";
import { CapabilityClient } from "./capability-client.js";

function request(): CapabilityTurnRequest {
  return {
    capability: "requirement_analysis",
    product: "bidproposal",
    taskId: "ti_0001",
    workspace: "prj_0001",
    objective: "解析招标文件，生成需求矩阵",
    constraints: ["需求条目必须可回溯到招标原文"],
    context: [
      {
        type: "tender_document",
        name: "t.pdf",
        content: { kind: "text", text: "..." },
        origin: { kind: "local_file", connector: "local-fs" },
      },
    ],
    messages: [],
    tools: [],
  };
}

async function withServer(
  handler: Parameters<typeof createServer>[1],
  run: (base: string, seen: { path?: string; body?: string; auth?: string }) => Promise<void>,
): Promise<void> {
  const seen: { path?: string; body?: string; auth?: string } = {};
  const server: Server = createServer((req, res) => {
    seen.path = req.url ?? undefined;
    seen.auth = req.headers.authorization;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      seen.body = Buffer.concat(chunks).toString("utf8");
      handler?.(req, res);
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`, seen);
  } finally {
    await new Promise<void>((ok) => server.close(() => ok()));
  }
}

test("resolver: routes by product + capability and carries the aggregation key", async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ kind: "content", content: "drafted" }));
    },
    async (base, seen) => {
      const client = new CapabilityClient({
        baseUrl: base,
        token: async () => "user-token",
      });
      const turn = await client.turn(request());
      assert.deepEqual(turn, { kind: "content", content: "drafted" });
      assert.equal(
        seen.path,
        "/products/bidproposal/capabilities/requirement_analysis/turn",
      );
      assert.equal(seen.auth, "Bearer user-token");

      const body = JSON.parse(seen.body ?? "{}") as Record<string, unknown>;
      // X-2: without taskId one task's cost and failure point cannot be
      // reconstructed across products.
      assert.equal(body["taskId"], "ti_0001");
      // The local container id travels as projectId, never as workspaceId:
      // that word means the platform tenant workspace, and a familiar name on
      // a body field is an invitation for the callee to trust it over the
      // token (integration rule 8: identity comes from the token alone).
      assert.equal(body["projectId"], "prj_0001");
      assert.ok(!("workspaceId" in body));
    },
  );
});

test("resolver: an outage is transient, a refusal is not", async () => {
  // 503 - the provider is having a bad day. The task should park and retry,
  // not throw away the work already done.
  await withServer(
    (_req, res) => {
      res.writeHead(503);
      res.end("upstream unavailable");
    },
    async (base) => {
      const client = new CapabilityClient({ baseUrl: base });
      await assert.rejects(client.turn(request()), TransientError);
    },
  );

  // 400 - the provider will keep refusing this. Retrying only burns time, so
  // it must NOT be classified transient.
  await withServer(
    (_req, res) => {
      res.writeHead(400);
      res.end("unknown capability");
    },
    async (base) => {
      const client = new CapabilityClient({ baseUrl: base });
      await assert.rejects(client.turn(request()), (err: unknown) => {
        assert.ok(!(err instanceof TransientError), "400 must not park the task");
        assert.match(String(err), /unknown capability/);
        return true;
      });
    },
  );
});

test("resolver: an unreachable provider is transient", async () => {
  // Nothing listening: someone else's outage, not this task going wrong.
  const client = new CapabilityClient({ baseUrl: "http://127.0.0.1:1", timeoutMs: 2000 });
  await assert.rejects(client.turn(request()), TransientError);
});

test("resolver: an unreadable turn fails loudly", async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ result: "looks fine to me" }));
    },
    async (base) => {
      const client = new CapabilityClient({ baseUrl: base });
      // Not an empty content turn - that would read to the harness as "the
      // capability produced nothing", which is a different and wrong story.
      await assert.rejects(client.turn(request()), (err: unknown) => {
        assert.ok(!(err instanceof TransientError));
        assert.match(String(err), /unreadable turn/);
        return true;
      });
    },
  );
});

test("resolver: signed out sends no bearer rather than failing early", async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ kind: "content", content: "ok" }));
    },
    async (base, seen) => {
      const client = new CapabilityClient({
        baseUrl: base,
        token: async () => undefined,
      });
      await client.turn(request());
      // Refusing an unidentified call is the callee's job; crashing here would
      // just hide why.
      assert.equal(seen.auth, undefined);
    },
  );
});

test("resolver: facts travel structured; the runtime writes no prompt", async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ kind: "content", content: "ok" }));
    },
    async (base, seen) => {
      await new CapabilityClient({ baseUrl: base }).turn(request());
      const body = JSON.parse(seen.body ?? "{}") as Record<string, unknown>;

      // Objective, constraints and context arrive as data. Composing them into
      // a prompt is where domain knowledge lives, and that belongs to the
      // product - a runtime that writes the prompt has taken over that part.
      assert.equal(body["objective"], "解析招标文件，生成需求矩阵");
      assert.deepEqual(body["constraints"], ["需求条目必须可回溯到招标原文"]);
      // Origin travels with the content: the runtime is the only layer that
      // knows a file was the user''s, and the provider needs it to treat the
      // text as material rather than as direction.
      assert.deepEqual(body["context"], [
        {
          type: "tender_document",
          name: "t.pdf",
          // Content is a tagged union, not a bare string: the provider has to
          // be able to tell text from bytes from "we could not read this".
          content: { kind: "text", text: "..." },
          origin: { kind: "local_file", connector: "local-fs" },
        },
      ]);
      // But not where it sits on the user''s disk.
      assert.ok(!JSON.stringify(body["context"]).includes("ref"));
      // And nothing was pre-rendered into the conversation on their behalf.
      assert.deepEqual(body["messages"], []);
    },
  );
});

test("resolver: a verdict is read as a field, not parsed out of prose", async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ kind: "verdict", passed: false, reason: "三条未覆盖" }));
    },
    async (base) => {
      const turn = await new CapabilityClient({ baseUrl: base }).turn(request());
      assert.deepEqual(turn, { kind: "verdict", passed: false, reason: "三条未覆盖" });
    },
  );

  // A verdict without the boolean is not a verdict. Reading a pass out of a
  // malformed reply is the failure mode this shape exists to prevent.
  await withServer(
    (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ kind: "verdict", reason: "looks fine" }));
    },
    async (base) => {
      await assert.rejects(
        new CapabilityClient({ baseUrl: base }).turn(request()),
        /unreadable turn/,
      );
    },
  );
});
