/**
 * Connector tools (ADR-005 path two, batch D): MCP tools/list + tools/call
 * through the client, the connector, the registry and the executor - against
 * the real fake server over real pipes.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { ConnectorPort, ToolExecutionRequest } from "@vxture/ruyin-core";
import { McpConnector } from "./connector-mcp.js";
import { ConnectorRegistry } from "./connector-registry.js";
import { McpStdioClient } from "./mcp-client.js";
import { LocalToolExecutor, type ConnectorToolSource } from "./tool-executor.js";

const FAKE = fileURLToPath(new URL("./fake-mcp-server.js", import.meta.url));

function request(over: Partial<ToolExecutionRequest> = {}): ToolExecutionRequest {
  return {
    tool: "lookup_account",
    provider: "connector",
    arguments: { q: "acme" },
    workspace: "prj_1",
    taskId: "ti_1",
    grants: [],
    connectors: ["crm"],
    contextSet: [],
    ...over,
  };
}

test("client: tools/list and tools/call, including a tool-level isError and an unknown tool", async () => {
  const client = new McpStdioClient({ command: process.execPath, args: [FAKE] }, { timeoutMs: 5000 });
  await client.start();
  const tools = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name), ["lookup_account", "update_account"]);

  const ok = await client.callTool("lookup_account", { q: "acme" });
  assert.equal(ok.isError, undefined);
  assert.equal(ok.content[0]?.type, "text");
  assert.match(ok.content[0]?.text ?? "", /Acme 工业.*acme/);

  const failed = await client.callTool("update_account", {});
  assert.equal(failed.isError, true);
  await assert.rejects(client.callTool("nope", {}), /tools\/call: Unknown tool: nope/);
  await client.stop();
});

test("connector: tools() is learned at start (empty for a server without tools); callTool joins text and names non-text parts", async () => {
  const crm = new McpConnector({ id: "crm", command: process.execPath, args: [FAKE] }, { timeoutMs: 5000 });
  assert.deepEqual(crm.tools(), []);
  await crm.start();
  assert.deepEqual(crm.tools(), ["lookup_account", "update_account"]);

  const out = await crm.callTool("lookup_account", { q: "acme" });
  assert.equal(out.isError, undefined);
  assert.match(out.content, /Acme 工业/);
  // The image part is named, not silently dropped.
  assert.match(out.content, /\[image content omitted\]/);

  const bad = await crm.callTool("update_account", {});
  assert.equal(bad.isError, true);
  assert.match(bad.content, /id is required/);
  await crm.stop();

  const dead = await crm.callTool("lookup_account", { q: "x" });
  assert.equal(dead.isError, true);
  assert.match(dead.content, /could not run lookup_account/);

  const none = new McpConnector({ id: "bare", command: process.execPath, args: [FAKE, "--no-tools"] }, { timeoutMs: 5000 });
  await none.start();
  assert.deepEqual(none.tools(), []);
  await none.stop();
});

test("registry: exposes() is machine-level, providersOf() is grant-level, list() shows tools", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "ruyin-ctools-"));
  const lookup = new Map<string, ConnectorPort>();
  const registry = new ConnectorRegistry(dataDir, lookup, { allowUnsigned: true, timeoutMs: 5000 });
  try {
    await registry.install({ id: "crm", command: process.execPath, args: [FAKE], source: "lan" });
    await registry.install({ id: "erp", command: process.execPath, args: [FAKE], source: "private" });
    await registry.install({ id: "bare", command: process.execPath, args: [FAKE, "--no-tools"], source: "private" });

    assert.equal(registry.exposes("lookup_account"), true);
    assert.equal(registry.exposes("nope"), false);
    // Both crm and erp expose it; only what is granted counts.
    assert.deepEqual(registry.providersOf("lookup_account", ["crm"]), ["crm"]);
    assert.deepEqual(registry.providersOf("lookup_account", ["bare", "erp"]), ["erp"]);
    assert.deepEqual(registry.providersOf("lookup_account", []), []);

    const views = await registry.list();
    assert.deepEqual(views.find((v) => v.id === "crm")?.tools, ["lookup_account", "update_account"]);
    assert.deepEqual(views.find((v) => v.id === "bare")?.tools, []);

    const out = await registry.callTool("erp", "lookup_account", { q: "z" });
    assert.match(out.content, /Acme 工业/);
    const missing = await registry.callTool("ghost", "lookup_account", {});
    assert.equal(missing.isError, true);
    assert.match(missing.content, /not running/);
  } finally {
    await registry.stopAll();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("executor: provider decides who is asked; connector calls route only through granted connectors; ambiguity is reported, not resolved", async () => {
  const calls: Array<[string, string]> = [];
  const source: ConnectorToolSource = {
    exposes: (tool) => tool === "lookup_account" || tool === "read_file",
    providersOf: (tool, granted) =>
      tool === "lookup_account" ? granted.filter((g) => g === "crm" || g === "erp") : [],
    callTool: async (connector, tool) => {
      calls.push([connector, tool]);
      return { content: `${connector} answered` };
    },
  };
  const exec = new LocalToolExecutor(undefined, undefined, source);

  // supports: the contract's provider decides which side answers.
  assert.equal(exec.supports("lookup_account", "connector"), true);
  assert.equal(exec.supports("lookup_account", "runtime"), false);
  assert.equal(exec.supports("read_file"), true);
  // read_file under provider: connector asks the connectors, even though the runtime implements it.
  assert.equal(exec.supports("read_file", "connector"), true);
  assert.equal(exec.supports("nope", "connector"), false);

  const ok = await exec.execute(request({ connectors: ["crm"] }));
  assert.deepEqual(ok, { content: "crm answered", connector: "crm" });

  const ungranted = await exec.execute(request({ connectors: [] }));
  assert.equal(ungranted.isError, true);
  assert.match(ungranted.content, /has not granted/);

  const unknown = await exec.execute(request({ tool: "nope", connectors: ["crm"] }));
  assert.equal(unknown.isError, true);
  assert.match(unknown.content, /no installed connector exposes/);

  const ambiguous = await exec.execute(request({ connectors: ["crm", "erp"] }));
  assert.equal(ambiguous.isError, true);
  assert.match(ambiguous.content, /more than one granted connector \(crm, erp\)/);
  assert.deepEqual(calls, [["crm", "lookup_account"]]);

  // No connector surface at all: the honest answer, not a runtime fallback.
  const bare = new LocalToolExecutor();
  assert.equal(bare.supports("lookup_account", "connector"), false);
  const none = await bare.execute(request());
  assert.equal(none.isError, true);
  assert.match(none.content, /this host has none/);
});
