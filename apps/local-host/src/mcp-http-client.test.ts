/**
 * McpHttpClient against fake-mcp-http-server.ts. Runs in-process (HTTP has no
 * process boundary to cross the way stdio does), one fake server instance per
 * test so misbehaviour options do not leak between cases.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { McpError } from "./mcp-client.js";
import { McpHttpClient } from "./mcp-http-client.js";
import { startFakeMcpHttpServer, type FakeMcpHttpServer } from "./fake-mcp-http-server.js";

async function withServer(
  opts: Parameters<typeof startFakeMcpHttpServer>[0],
  run: (server: FakeMcpHttpServer) => Promise<void>,
): Promise<void> {
  const server = await startFakeMcpHttpServer(opts);
  try {
    await run(server);
  } finally {
    await server.close();
  }
}

for (const useSse of [false, true]) {
  test(`client (${useSse ? "SSE" : "single JSON"} responses): initialize, ping, paginated resources/list, read text and blob`, async () => {
    await withServer({ pages: 3, useSse }, async (server) => {
      const client = new McpHttpClient({ url: server.url }, { timeoutMs: 5000 });
      const info = await client.start();
      assert.equal(info.serverInfo?.name, "fake-crm-http");
      assert.equal(client.serverInfo?.serverInfo?.name, "fake-crm-http");
      assert.ok(client.running);
      await client.ping();

      const resources = await client.listResources();
      assert.deepEqual(
        resources.map((r) => r.uri),
        ["crm://accounts/1", "crm://accounts/2", "crm://contracts/7", "crm://accounts/empty"],
      );

      const text = await client.readResource("crm://accounts/1");
      assert.ok("text" in text[0]!);
      const blob = await client.readResource("crm://contracts/7");
      assert.ok("blob" in blob[0]!);

      await assert.rejects(client.readResource("crm://nope"), (e: unknown) => {
        assert.ok(e instanceof McpError);
        assert.equal(e.code, -32002);
        assert.match(e.message, /resources\/read: Resource not found/);
        return true;
      });
      await client.stop();
      assert.ok(!client.running);
      await client.stop(); // idempotent
    });
  });
}

test("client: tools/list and tools/call, including a tool-level error (isError, not a JSON-RPC error)", async () => {
  await withServer({}, async (server) => {
    const client = new McpHttpClient({ url: server.url }, { timeoutMs: 5000 });
    await client.start();
    const tools = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name), ["lookup_account"]);
    const result = await client.callTool("lookup_account", { q: "acme" });
    assert.equal(result.content[0]?.type, "text");
    await assert.rejects(client.callTool("nope", {}), /Unknown tool/);
    await client.stop();
  });
});

test("client: session id from initialize is echoed on every later request; DELETE on stop", async () => {
  await withServer({}, async (server) => {
    const client = new McpHttpClient({ url: server.url }, { timeoutMs: 5000 });
    await client.start();
    await client.ping();
    await client.ping();
    // Every request past initialize succeeded only because the session header
    // was accepted each time (the fake server 400s on a missing/wrong one).
    assert.deepEqual(server.requests, ["initialize", "notifications/initialized", "ping", "ping"]);
    await client.stop();
  });
});

test("client: session expiring mid-use surfaces as a distinct, honest error (HTTP 404)", async () => {
  // 2, not 1: notifications/initialized already spends the session's first
  // use during start() - the limit has to leave room for it too.
  await withServer({ expireSessionAfterRequests: 2 }, async (server) => {
    const client = new McpHttpClient({ url: server.url }, { timeoutMs: 5000 });
    await client.start();
    await client.ping(); // still under the limit
    // The fake server's 404 body carries a real JSON-RPC error - the client
    // surfaces *that* message (more specific than the generic 404 fallback,
    // which only kicks in when the body carries nothing usable).
    await assert.rejects(client.ping(), (e: unknown) => {
      assert.ok(e instanceof McpError);
      assert.match(e.message, /session expired/);
      return true;
    });
  });
});

test("client: a bare 404 (no JSON-RPC error body) falls back to a generic, still-honest message", async () => {
  await withServer({ bareNotFound: true }, async (server) => {
    const client = new McpHttpClient({ url: server.url }, { timeoutMs: 2000 });
    await assert.rejects(client.start(), /session not found or expired \(HTTP 404\)/);
  });
});

test("client: a request with no reply times out with the method named, not hangs", async () => {
  await withServer({ hangRead: true }, async (server) => {
    const client = new McpHttpClient({ url: server.url }, { timeoutMs: 300 });
    await client.start();
    await assert.rejects(client.readResource("crm://accounts/1"), /resources\/read: no reply within 300ms/);
    await client.stop();
  });
});

test("client: server closing the listener after initialize surfaces later calls as a rejection, not a hang", async () => {
  await withServer({ exitAfterInit: true }, async (server) => {
    const client = new McpHttpClient({ url: server.url }, { timeoutMs: 2000 });
    await client.start();
    await new Promise((r) => setTimeout(r, 100));
    await assert.rejects(client.ping());
  });
});

test("client: a garbled response fails start() cleanly rather than crashing", async () => {
  await withServer({ malformedBody: true }, async (server) => {
    const client = new McpHttpClient({ url: server.url }, { timeoutMs: 2000 });
    await assert.rejects(client.start(), /initialize/);
    assert.equal(client.running, false);
  });
});

test("client: unreachable server surfaces as a rejection naming the method, not a crash", async () => {
  const client = new McpHttpClient({ url: "http://127.0.0.1:1" }, { timeoutMs: 2000 });
  await assert.rejects(client.start(), /initialize/);
});

test("client: a server that skips protocol negotiation is refused, not accepted silently", async () => {
  await withServer({ omitProtocolVersion: true }, async (server) => {
    const client = new McpHttpClient({ url: server.url }, { timeoutMs: 2000 });
    await assert.rejects(client.start(), /no protocolVersion/);
    assert.equal(client.running, false);
  });
});

test("client: a bare 202 to a real request is not a result and is rejected, not swallowed", async () => {
  await withServer({ accept202: true }, async (server) => {
    const client = new McpHttpClient({ url: server.url }, { timeoutMs: 2000 });
    await assert.rejects(client.start(), /accepted without a result/);
  });
});

test("client: stop() survives the DELETE itself failing (server already gone)", async () => {
  const server = await startFakeMcpHttpServer({});
  const client = new McpHttpClient({ url: server.url }, { timeoutMs: 5000 });
  await client.start();
  await server.close();
  await client.stop(); // must not throw even though the DELETE cannot reach anything
  assert.equal(client.running, false);
});

test("上限：一个普通（非 SSE）响应体本身超过上限时，同样在读取处收摊", async () => {
  await withServer({ hugeToolResult: true }, async (server) => {
    const client = new McpHttpClient({ url: server.url }, { timeoutMs: 5000, maxResponseBytes: 1000 });
    await client.start();
    await assert.rejects(client.callTool("huge", {}), (e: unknown) => {
      assert.ok(e instanceof McpError);
      assert.match(e.message, /exceeded 1000 bytes/);
      return true;
    });
    await client.stop();
  });
});

test("client: calling a method after stop() is refused, not sent", async () => {
  await withServer({}, async (server) => {
    const client = new McpHttpClient({ url: server.url }, { timeoutMs: 5000 });
    await client.start();
    await client.stop();
    await assert.rejects(client.ping(), /stopped/);
  });
});

test("client: request before start / start twice are refused", async () => {
  await withServer({}, async (server) => {
    const client = new McpHttpClient({ url: server.url }, { timeoutMs: 5000 });
    await assert.rejects(client.ping(), /not started/);
    await client.start();
    await assert.rejects(client.start(), /already started/);
    await client.stop();
  });
});

test("client: a server request mid SSE-stream gets -32601, same posture as stdio", async () => {
  await withServer({ useSse: true, askClient: true }, async (server) => {
    const client = new McpHttpClient({ url: server.url }, { timeoutMs: 5000 });
    await client.start();
    await client.ping();
    await new Promise((r) => setTimeout(r, 50));
    assert.match(client.diagnostics, /replied -32601/);
    await client.stop();
  });
});

/**
 * 本机资源上限（TD-046），HTTP 那一侧：一个不带事件边界的 SSE 流会被在上限处
 * 收摊，而不是被整段攒进内存。
 */
test("上限：SSE 响应不带事件边界地一直灌，客户端在上限处收摊而不是把它攒完", async () => {
  await withServer({ floodBody: true }, async (server) => {
    const client = new McpHttpClient({ url: server.url }, { timeoutMs: 5000, maxResponseBytes: 64 * 1024 });
    await client.start();
    await assert.rejects(client.ping(), (e: unknown) => {
      assert.ok(e instanceof McpError);
      assert.match(e.message, /bytes without completing/);
      return true;
    });
    await client.stop();
  });
});

test("没超上限的，一个字节都不动", async () => {
  await withServer({}, async (server) => {
    const client = new McpHttpClient({ url: server.url }, { timeoutMs: 5000 });
    await client.start();
    await client.ping();
    await client.stop();
  });
});
