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
import { mkdtempSync, rmSync } from "node:fs";
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

// Compiled test runs from dist/, so ../../../ is the repo root.
const productsDir = new URL("../../../products", import.meta.url).pathname
  // Windows pathname of a file URL starts with a slash before the drive letter.
  .replace(/^\/([A-Za-z]:)/, "$1");

function makePorts(dataDir: string): {
  ports: RuntimePorts;
  storage: SqliteStoragePort;
} {
  const storage = new SqliteStoragePort(dataDir);
  return {
    ports: {
      storage,
      clock: nodeClock,
      id: nodeId,
      crypto: nodeCrypto,
      gateway: new MockAIGateway(),
    },
    storage,
  };
}

test("milestone: bid contract loads, workspace created, task runs over SQLite", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "ruyin-it-"));
  const first = makePorts(dataDir);
  let second: ReturnType<typeof makePorts> | undefined;
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
    second = makePorts(dataDir);
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
  const { ports, storage } = makePorts(dataDir);
  const runtime = new WorkspaceRuntime(ports);
  const server = createLocalApi({
    runtime,
    products: scan.loaded,
    token,
    version: "test",
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
