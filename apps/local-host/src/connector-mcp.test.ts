/**
 * McpStdioClient + McpConnector against the fake server in fake-mcp-server.ts
 * - a real child process over real pipes, not a mocked transport. Every
 * failure path the client claims to handle is switched on in the fake and
 * observed here.
 */

import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { Binding } from "@vxture/ruyin-core";
import { McpConnector } from "./connector-mcp.js";
import { McpError, McpStdioClient } from "./mcp-client.js";

const FAKE = fileURLToPath(new URL("./fake-mcp-server.js", import.meta.url));

function spec(...flags: string[]) {
  return { command: process.execPath, args: [FAKE, ...flags] };
}

function bindingFor(root: string, type = "enterprise_capability"): Binding {
  return { type, source: "lan", connector: "crm", root };
}

test("client: initialize handshake, ping, paginated resources/list, read text and blob", async () => {
  const client = new McpStdioClient(spec("--pages", "3"), { timeoutMs: 5000 });
  const info = await client.start();
  assert.equal(info.serverInfo?.name, "fake-crm");
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

test("client: server exit rejects pending and later requests name the exit", async () => {
  const client = new McpStdioClient(spec("--exit-after-init"), { timeoutMs: 5000 });
  await client.start();
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(!client.running);
  await assert.rejects(client.ping(), /server exited/);
});

test("client: a request with no reply times out with the method named, not hangs", async () => {
  const client = new McpStdioClient(spec("--hang-read"), { timeoutMs: 300 });
  await client.start();
  await assert.rejects(client.readResource("crm://accounts/1"), /resources\/read: no reply within 300ms/);
  await client.stop();
});

test("client: prose on stdout is not a message; a server->client request gets -32601", async () => {
  const client = new McpStdioClient(spec("--prose-on-stdout", "--ask-client"), { timeoutMs: 5000 });
  await client.start();
  await client.ping();
  await new Promise((r) => setTimeout(r, 100));
  // The fake echoes our -32601 reply to stderr; the client keeps a tail of it.
  assert.match(client.diagnostics, /client does not implement sampling\/createMessage/);
  assert.match(client.diagnostics, /stdout not JSON/);
  await client.stop();
});

test("client: start twice and request before start are refused", async () => {
  const client = new McpStdioClient(spec(), { timeoutMs: 5000 });
  await assert.rejects(client.ping(), /not started/);
  await client.start();
  await assert.rejects(client.start(), /already started/);
  await client.stop();
});

test("client: unresolvable command surfaces as a rejection, not a crash", async () => {
  const client = new McpStdioClient(
    { command: "definitely-not-a-real-binary-ruyin" },
    { timeoutMs: 2000 },
  );
  await assert.rejects(client.start(), /spawn failed|no reply/);
});

test("connector: discover scopes to the binding's URI prefix and carries connector/source/type", async () => {
  const connector = new McpConnector({ id: "crm", ...spec() }, { timeoutMs: 5000 });
  await connector.start();
  const items = await connector.discover(bindingFor("crm://accounts/"));
  assert.deepEqual(
    items.map((i) => i.ref),
    ["crm://accounts/1", "crm://accounts/2", "crm://accounts/empty"],
  );
  const acme = items[0]!;
  assert.equal(acme.connector, "crm");
  assert.equal(acme.source, "lan");
  assert.equal(acme.type, "enterprise_capability");
  assert.equal(acme.name, "Acme 工业"); // title wins over name
  assert.equal(acme.bytes, 48);
  assert.equal(acme.modifiedAt, "2026-09-01T08:00:00Z");
  assert.match(acme.id, /^itm_[0-9a-f]{16}$/);
  // No annotation => unknown, not "now".
  assert.equal(items[1]!.modifiedAt, "");
  assert.equal(items[1]!.name, "globex");
  // Ids are stable and distinct per connector.
  const again = await connector.discover(bindingFor("crm://accounts/"));
  assert.equal(again[0]!.id, acme.id);
  const other = new McpConnector({ id: "crm2", ...spec() }, { timeoutMs: 5000 });
  await other.start();
  const otherItems = await other.discover({ ...bindingFor("crm://accounts/"), connector: "crm2" });
  assert.notEqual(otherItems[0]!.id, acme.id);
  await other.stop();
  await connector.stop();
});

test("connector: read - text with truncation flag, bytes with media type, empty and missing as unavailable", async () => {
  const connector = new McpConnector({ id: "crm", ...spec() }, { timeoutMs: 5000 });
  await connector.start();
  const items = await connector.discover(bindingFor("crm://"));
  const byRef = new Map(items.map((i) => [i.ref, i]));

  const acme = await connector.read(byRef.get("crm://accounts/1")!);
  assert.equal(acme.content.kind, "text");
  assert.ok(acme.content.kind === "text" && acme.content.text.includes("Acme"));
  assert.ok(acme.content.kind === "text" && !acme.content.truncated);

  const big = await connector.read(byRef.get("crm://accounts/2")!);
  assert.ok(big.content.kind === "text" && big.content.truncated === true);
  assert.ok(big.content.kind === "text" && Buffer.byteLength(big.content.text) <= 256_000);

  const pdf = await connector.read(byRef.get("crm://contracts/7")!);
  assert.ok(pdf.content.kind === "binary");
  assert.equal(pdf.content.kind === "binary" && pdf.content.mediaType, "application/pdf");
  assert.equal(pdf.bytes, Buffer.from("%PDF-1.7 fake").byteLength);

  const empty = await connector.read(byRef.get("crm://accounts/empty")!);
  assert.equal(empty.content.kind, "unavailable");
  assert.match(empty.content.kind === "unavailable" ? empty.content.reason : "", /no content/);

  const missing = await connector.read({ ...acme, ref: "crm://accounts/404" });
  assert.equal(missing.content.kind, "unavailable");
  assert.match(missing.content.kind === "unavailable" ? missing.content.reason : "", /could not read.*not found/);
  await connector.stop();
});

test("connector: health says running with server name; not running after stop; failure carries detail", async () => {
  const connector = new McpConnector({ id: "crm", ...spec() }, { timeoutMs: 5000 });
  const before = await connector.health();
  assert.equal(before.ok, false);
  assert.equal(before.detail, "not running");
  await connector.start();
  const up = await connector.health();
  assert.equal(up.ok, true);
  assert.match(up.detail ?? "", /fake-crm 0\.0\.1/);
  assert.match(up.checkedAt, /^\d{4}-/);
  await connector.stop();
  const down = await connector.health();
  assert.equal(down.ok, false);

  const dying = new McpConnector({ id: "crm", ...spec("--exit-after-init") }, { timeoutMs: 5000 });
  await dying.start();
  await new Promise((r) => setTimeout(r, 150));
  const gone = await dying.health();
  assert.equal(gone.ok, false);
  assert.equal(gone.detail, "not running");
});

test("connector: a read after the server died is unavailable, not a thrown task failure", async () => {
  const connector = new McpConnector({ id: "crm", ...spec("--exit-after-init") }, { timeoutMs: 5000 });
  await connector.start();
  await new Promise((r) => setTimeout(r, 150));
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
  assert.match(item.content.kind === "unavailable" ? item.content.reason : "", /server exited/);
  // Discovery with no server at all has nothing to attach an answer to: it throws.
  await assert.rejects(connector.discover(bindingFor("crm://")), /server exited/);
});
