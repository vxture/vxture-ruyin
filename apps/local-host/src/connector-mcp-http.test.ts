/**
 * McpConnector against a Streamable HTTP fake server (fake-mcp-http-server.ts).
 * Mirrors connector-mcp.test.ts's stdio coverage for the parts that are
 * transport-independent (discover/read/health/callTool truncation all live in
 * connector-mcp.ts itself, unchanged by which client it holds) - this file
 * only needs to prove the `transport: "streamable_http"` wiring actually
 * reaches a real HTTP server end to end, not re-litigate every case already
 * covered there.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { Binding } from "@vxture/ruyin-core";
import { McpConnector } from "./connector-mcp.js";
import { startFakeMcpHttpServer } from "./fake-mcp-http-server.js";
import { DEFAULT_RESOURCE_LIMITS } from "./resource-limits.js";

function bindingFor(root: string): Binding {
  return { type: "enterprise_capability", source: "lan", connector: "crm", root };
}

test("http connector: discover/read/health/tools over Streamable HTTP end to end", async () => {
  const server = await startFakeMcpHttpServer({});
  try {
    const connector = new McpConnector(
      { id: "crm", transport: "streamable_http", url: server.url },
      { timeoutMs: 5000 },
    );
    const before = await connector.health();
    assert.equal(before.ok, false);
    assert.equal(before.detail, "not running");

    await connector.start();
    assert.deepEqual(connector.tools(), ["lookup_account"]);

    const items = await connector.discover(bindingFor("crm://accounts/"));
    assert.deepEqual(
      items.map((i) => i.ref),
      ["crm://accounts/1", "crm://accounts/2", "crm://accounts/empty"],
    );
    const acme = items[0]!;
    assert.equal(acme.connector, "crm");
    assert.equal(acme.name, "Acme 工业");

    const read = await connector.read(acme);
    assert.equal(read.content.kind, "text");

    const health = await connector.health();
    assert.equal(health.ok, true);
    assert.match(health.detail ?? "", /fake-crm-http/);

    const called = await connector.callTool("lookup_account", { q: "acme" });
    assert.match(called.content, /Acme 工业/);

    await connector.stop();
    const after = await connector.health();
    assert.equal(after.ok, false);
  } finally {
    await server.close();
  }
});

test("http connector: a read after the server is gone is unavailable, not a thrown task failure", async () => {
  const server = await startFakeMcpHttpServer({ exitAfterInit: true });
  const connector = new McpConnector({ id: "crm", transport: "streamable_http", url: server.url }, { timeoutMs: 2000 });
  await connector.start();
  await new Promise((r) => setTimeout(r, 100));
  const item = await connector.read({
    id: "itm_x",
    type: "t",
    source: "lan",
    connector: "crm",
    ref: "crm://accounts/1",
    name: "x",
    bytes: 0,
    modifiedAt: "",
  });
  assert.equal(item.content.kind, "unavailable");
  await server.close();
});

test("http connector: a huge tool result is truncated and says so (TD-046), same as stdio", async () => {
  const server = await startFakeMcpHttpServer({ hugeToolResult: true });
  try {
    const connector = new McpConnector(
      { id: "crm", transport: "streamable_http", url: server.url },
      { timeoutMs: 5000, limits: { ...DEFAULT_RESOURCE_LIMITS, maxToolResultBytes: 1000 } },
    );
    await connector.start();
    const out = await connector.callTool("huge", {});
    assert.ok(Buffer.byteLength(out.content, "utf8") < 1500);
    assert.match(out.content, /已在 1000 字节处截断/);
    await connector.stop();
  } finally {
    await server.close();
  }
});
