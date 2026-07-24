/**
 * Phase A milestone integration test (workplan W2):
 *
 *   "The bid example contract is genuinely validated, loaded, and a
 *    Workspace is created."
 *
 * Two layers: (1) direct kernel-over-SQLite - full task lifecycle with
 * checkpoint resume across REOPENED storage (daemon-restart simulation),
 * audit chain verified; (2) HTTP smoke over the Local API with token auth.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import {
  WorkspaceRuntime,
  verifyAuditChain,
  type RuntimePorts,
} from "@vxture/ruyin-core";
import { SqliteStoragePort } from "./storage.js";
import { MockAIGateway, nodeClock, nodeCrypto, nodeId } from "./host-ports.js";
import { loadProducts } from "./products.js";
import { createLocalApi } from "./server.js";
import { LocalFsConnector } from "./connector-fs.js";
import { FtsRanker, reindexBinding } from "./fts.js";
import { KeyManager } from "./keys.js";

// Compiled test runs from dist/, so ../../../ is the repo root.
const productsDir = new URL("../../../products", import.meta.url).pathname
  // Windows pathname of a file URL starts with a slash before the drive letter.
  .replace(/^\/([A-Za-z]:)/, "$1");

async function makePorts(dataDir: string): Promise<{
  ports: RuntimePorts;
  storage: SqliteStoragePort;
}> {
  const keys = await KeyManager.open(dataDir);
  const storage = new SqliteStoragePort(dataDir, keys);
  return {
    ports: {
      storage,
      clock: nodeClock,
      id: nodeId,
      crypto: nodeCrypto,
      gateway: new MockAIGateway(),
      connectors: new Map([["local-fs", new LocalFsConnector()]]),
      ranker: new FtsRanker(storage),
    },
    storage,
  };
}

test("milestone: bid contract loads, workspace created, task runs over SQLite", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "ruyin-it-"));
  const first = await makePorts(dataDir);
  let second: Awaited<ReturnType<typeof makePorts>> | undefined;
  try {
    const scan = loadProducts(productsDir);
    assert.deepEqual(scan.failed, []);
    const bid = scan.loaded.find((p) => p.id === "vxture.bid");
    assert.ok(bid, "bid product must load");

    const runtime = new WorkspaceRuntime(first.ports);
    const meta = await runtime.createWorkspace(bid.contract, "投标项目 A");
    assert.equal(meta.productId, "vxture.bid");
    assert.equal((await runtime.openWorkspace(meta.id)).businessState, "draft");

    // Run a task to the human checkpoint.
    const harness = await runtime.createHarness(meta.id);
    const instance = await harness.startTask("analyze_tender", {
      tender_document: { ref: "file://tender.pdf" },
    });
    assert.equal(instance.state, "waiting_human");

    // Simulate a daemon restart: close every handle, then brand-new ports
    // over the SAME data dir.
    first.storage.closeAll();
    second = await makePorts(dataDir);
    const reopened = new WorkspaceRuntime(second.ports);
    const view = await reopened.openWorkspace(meta.id);
    assert.equal(view.meta.name, "投标项目 A");
    const resumed = await reopened.createHarness(meta.id);
    const done = await resumed.decideCheckpoint(instance.id, true);
    assert.equal(done.state, "completed");
    assert.ok(done.result?.content["requirement_analysis"]);

    // Audit chain survives the restart and verifies end-to-end.
    const events = await reopened.listAuditEvents(meta.id);
    assert.ok(events.length >= 10);
    assert.ok(verifyAuditChain(nodeCrypto, meta.id, events));
  } finally {
    first.storage.closeAll();
    second?.storage.closeAll();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("local api: token gate, product listing, workspace + task flow", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "ruyin-api-"));
  const token = "test-token";
  const scan = loadProducts(productsDir);
  const { ports, storage } = await makePorts(dataDir);
  const runtime = new WorkspaceRuntime(ports);
  const server = createLocalApi({
    runtime,
    products: scan.loaded,
    token,
    version: "test",
    reindex: (wsId, binding) =>
      reindexBinding(storage, wsId, binding, new LocalFsConnector()),
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  const authed = { authorization: `Bearer ${token}` };
  const json = { ...authed, "content-type": "application/json" };

  try {
    // /health is open; everything else requires the token.
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    const denied = await fetch(`${base}/products`);
    assert.equal(denied.status, 401);

    const products = (await (
      await fetch(`${base}/products`, { headers: authed })
    ).json()) as Array<{ id: string }>;
    assert.ok(products.some((p) => p.id === "vxture.bid"));

    const created = await fetch(`${base}/workspaces`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ product: "vxture.bid", name: "api-ws" }),
    });
    assert.equal(created.status, 201);
    const meta = (await created.json()) as { id: string };

    const task = await fetch(`${base}/workspaces/${meta.id}/tasks`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        task: "analyze_tender",
        inputs: { tender_document: {} },
      }),
    });
    assert.equal(task.status, 201);
    const instance = (await task.json()) as { id: string; state: string };
    assert.equal(instance.state, "waiting_human");

    const decided = await fetch(
      `${base}/workspaces/${meta.id}/tasks/${instance.id}/decision`,
      { method: "POST", headers: json, body: JSON.stringify({ approve: true }) },
    );
    assert.equal(decided.status, 200);
    assert.equal(((await decided.json()) as { state: string }).state, "completed");

    // Human-confirm state transition surfaces as 409 until confirmed.
    for (const to of ["planning", "writing", "review"]) {
      const r = await fetch(`${base}/workspaces/${meta.id}/state`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ to }),
      });
      assert.equal(r.status, 200);
    }
    const refused = await fetch(`${base}/workspaces/${meta.id}/state`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ to: "submitted" }),
    });
    assert.equal(refused.status, 409);
    const confirmed = await fetch(`${base}/workspaces/${meta.id}/state`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ to: "submitted", humanConfirmed: true }),
    });
    assert.equal(confirmed.status, 200);

    const audit = await fetch(`${base}/workspaces/${meta.id}/audit`, {
      headers: authed,
    });
    const events = (await audit.json()) as Parameters<typeof verifyAuditChain>[2];
    assert.ok(verifyAuditChain(nodeCrypto, meta.id, events));
  } finally {
    await new Promise<void>((ok) => server.close(() => ok()));
    storage.closeAll();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("selection over real files: grant -> bind (indexes) -> gate -> complete", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "ruyin-sel-"));
  const filesDir = mkdtempSync(join(tmpdir(), "ruyin-files-"));
  const { ports, storage } = await makePorts(dataDir);
  const runtime = new WorkspaceRuntime(ports);
  try {
    // Two tender files on disk; the newer/matching one should rank first.
    mkdirSync(join(filesDir, "sub"));
    writeFileSync(
      join(filesDir, "tender-water.md"),
      "智慧水务项目招标文件 technical requirements coverage matrix",
      "utf8",
    );
    writeFileSync(join(filesDir, "sub", "old-notes.txt"), "misc notes", "utf8");

    const scan = loadProducts(productsDir);
    const bid = scan.loaded.find((p) => p.id === "vxture.bid");
    assert.ok(bid);
    const meta = await runtime.createWorkspace(bid.contract, "sel-ws");

    // Grant, then bind (binding outside the grant is refused).
    await runtime.addGrant(meta.id, filesDir);
    await assert.rejects(
      runtime.setBinding(meta.id, { type: "tender_document", root: tmpdir() }),
      /outside every granted folder/,
    );
    const binding = await runtime.setBinding(meta.id, {
      type: "tender_document",
      root: filesDir,
    });
    const indexed = await reindexBinding(
      storage,
      meta.id,
      binding,
      new LocalFsConnector(),
    );
    assert.equal(indexed, 2);

    // Selection path: no inputs. tender_document is high sensitivity =>
    // context_confirm gate BEFORE any capability invocation.
    const harness = await runtime.createHarness(meta.id);
    const instance = await harness.startTask("analyze_tender");
    assert.equal(instance.state, "waiting_human");
    assert.equal(instance.checkpoint?.kind, "context_confirm");
    assert.ok((instance.contextSet?.length ?? 0) >= 1);
    assert.deepEqual(instance.capabilityOutputs, {});

    const afterContext = await harness.decideCheckpoint(instance.id, true);
    assert.equal(afterContext.checkpoint?.kind, "verification_review");
    const done = await harness.decideCheckpoint(instance.id, true);
    assert.equal(done.state, "completed");

    // Transmission audit carries hashes, not content; chain verifies.
    const events = await runtime.listAuditEvents(meta.id);
    const tx = events.find((e) => e.kind === "transmission.inference");
    assert.ok(tx);
    const payload = tx.payload as {
      context_items: Array<{ content_hash: string }>;
      confirmed_by: string;
      persistence: string;
    };
    assert.equal(payload.confirmed_by, "user");
    assert.equal(payload.persistence, "none");
    assert.match(payload.context_items[0]!.content_hash, /^sha256:[0-9a-f]{64}$/);
    assert.ok(verifyAuditChain(nodeCrypto, meta.id, events));
  } finally {
    storage.closeAll();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(filesDir, { recursive: true, force: true });
  }
});

test("daemon serves the built workspace ui with traversal guard", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "ruyin-ui-"));
  const uiDir = mkdtempSync(join(tmpdir(), "ruyin-uidist-"));
  const { ports, storage } = await makePorts(dataDir);
  const server = createLocalApi({
    runtime: new WorkspaceRuntime(ports),
    products: [],
    token: "t",
    version: "test",
    reindex: async () => 0,
    uiDir,
  });
  try {
    writeFileSync(join(uiDir, "index.html"), "<!doctype html><title>ui</title>");
    mkdirSync(join(uiDir, "assets"));
    writeFileSync(join(uiDir, "assets", "a.js"), "//js");
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;

    const index = await fetch(`${base}/`);
    assert.equal(index.status, 200);
    assert.match(await index.text(), /<title>ui<\/title>/);

    const asset = await fetch(`${base}/assets/a.js`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get("content-type") ?? "", /javascript/);

    // Traversal collapses via URL normalization and lands on token-gated
    // API space; a raw-path probe hits the static guard. Either way: no file.
    const probe = await fetch(`${base}/assets/%2e%2e/%2e%2e/package.json`);
    assert.notEqual(probe.status, 200);

    // Dev console stays reachable.
    const dev = await fetch(`${base}/dev`);
    assert.match(await dev.text(), /Ruyin Dev Console/);
  } finally {
    await new Promise<void>((ok) => server.close(() => ok()));
    storage.closeAll();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(uiDir, { recursive: true, force: true });
  }
});

test("workspace database is encrypted at rest (TD-009)", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "ruyin-enc-"));
  const { ports, storage } = await makePorts(dataDir);
  const runtime = new WorkspaceRuntime(ports);
  try {
    const scan = loadProducts(productsDir);
    const bid = scan.loaded.find((p) => p.id === "vxture.bid");
    assert.ok(bid);
    const meta = await runtime.createWorkspace(bid.contract, "enc-ws");
    storage.closeAll();

    // A plaintext SQLite file starts with "SQLite format 3\0"; an encrypted
    // one must not.
    const dbPath = join(dataDir, "workspaces", meta.id, "workspace.db");
    const header = readFileSync(dbPath).subarray(0, 16).toString("latin1");
    assert.ok(
      !header.startsWith("SQLite format 3"),
      "db file must not have a plaintext SQLite header",
    );

    // The per-workspace key blob exists and reopening with the key works.
    assert.ok(existsSync(join(dataDir, "workspaces", meta.id, "key.enc")));
    const reopened = await makePorts(dataDir);
    try {
      const view = await new WorkspaceRuntime(reopened.ports).openWorkspace(
        meta.id,
      );
      assert.equal(view.meta.name, "enc-ws");
    } finally {
      reopened.storage.closeAll();
    }
  } finally {
    storage.closeAll();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
