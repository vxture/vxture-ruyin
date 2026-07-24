/**
 * Kernel tests over the in-memory reference storage: workspace lifecycle,
 * business state machine, harness state machine (including waiting_human
 * suspension and rebuild-on-resume), and audit chain integrity.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { parseContract } from "@vxture/ruyin-contract-schema";
import {
  MemoryConnector,
  MemoryStoragePort,
  WorkspaceRuntime,
  verifyAuditChain,
  ContractInvalidError,
  NeedsHumanConfirmationError,
  type RuntimePorts,
} from "./index.js";

// Compiled test runs from dist/, so ../../../ is the repo root.
const bidUrl = new URL(
  "../../../products/bid/ruyin.product.yaml",
  import.meta.url,
);
const bidContract = parseContract(readFileSync(bidUrl, "utf8"));

function makePorts(): RuntimePorts {
  let seq = 0;
  return {
    storage: new MemoryStoragePort(),
    clock: { now: () => new Date().toISOString() },
    id: { newId: (prefix) => `${prefix}_${(++seq).toString().padStart(4, "0")}_${randomUUID().slice(0, 8)}` },
    crypto: {
      sha256: (input) => createHash("sha256").update(input, "utf8").digest("hex"),
    },
    gateway: {
      invoke: async (req) => ({ content: `[mock:${req.capability}]` }),
    },
  };
}

test("createWorkspace validates, persists, and seeds the initial state", async () => {
  const ports = makePorts();
  const runtime = new WorkspaceRuntime(ports);
  const meta = await runtime.createWorkspace(bidContract, "投标项目 A");
  assert.equal(meta.productId, "vxture.bid");
  assert.equal(meta.workspaceType, "project");

  const view = await runtime.openWorkspace(meta.id);
  assert.equal(view.businessState, "draft");
  assert.equal(view.contract.product.id, "vxture.bid");

  const listed = await runtime.listWorkspaces();
  assert.equal(listed.length, 1);
  assert.equal(listed[0]!.id, meta.id);
});

test("createWorkspace rejects an invalid contract", async () => {
  const runtime = new WorkspaceRuntime(makePorts());
  const broken = structuredClone(bidContract) as { contract: string };
  broken.contract = "9.9";
  await assert.rejects(
    runtime.createWorkspace(broken, "bad"),
    ContractInvalidError,
  );
});

test("business state machine follows the contract, confirm: human enforced", async () => {
  const runtime = new WorkspaceRuntime(makePorts());
  const meta = await runtime.createWorkspace(bidContract, "ws");

  assert.equal(await runtime.transitionBusinessState(meta.id, "planning"), "planning");
  await runtime.transitionBusinessState(meta.id, "writing");
  await runtime.transitionBusinessState(meta.id, "review");

  // review -> submitted is declared confirm: human
  await assert.rejects(
    runtime.transitionBusinessState(meta.id, "submitted"),
    NeedsHumanConfirmationError,
  );
  await runtime.transitionBusinessState(meta.id, "submitted", {
    humanConfirmed: true,
  });
  assert.equal((await runtime.openWorkspace(meta.id)).businessState, "submitted");

  // illegal jump
  await assert.rejects(runtime.transitionBusinessState(meta.id, "draft"));
});

test("harness: task with human verification suspends, resume completes", async () => {
  const runtime = new WorkspaceRuntime(makePorts());
  const meta = await runtime.createWorkspace(bidContract, "ws");
  const harness = await runtime.createHarness(meta.id);

  const instance = await harness.startTask("analyze_tender", {
    tender_document: { ref: "file://tender.pdf" },
  });
  assert.equal(instance.state, "waiting_human");
  assert.ok(
    instance.verification.some((v) => v.id === "matrix_review" && v.status === "pending_human"),
  );
  assert.equal(instance.capabilityOutputs["requirement_analysis"], "[mock:requirement_analysis]");

  // Rebuild-on-resume: a FRESH harness decides the checkpoint.
  const resumed = await runtime.createHarness(meta.id);
  const done = await resumed.decideCheckpoint(instance.id, true);
  assert.equal(done.state, "completed");
  assert.ok(done.result);
  assert.deepEqual(done.result.sources, ["tender_document"]);
});

test("harness: human rejection fails the task", async () => {
  const runtime = new WorkspaceRuntime(makePorts());
  const meta = await runtime.createWorkspace(bidContract, "ws");
  const harness = await runtime.createHarness(meta.id);
  const instance = await harness.startTask("analyze_tender", {
    tender_document: {},
  });
  const rejected = await harness.decideCheckpoint(instance.id, false);
  assert.equal(rejected.state, "failed");
  assert.match(rejected.error ?? "", /rejected/);
});

test("harness: task without human verification completes directly", async () => {
  const runtime = new WorkspaceRuntime(makePorts());
  const meta = await runtime.createWorkspace(bidContract, "ws");
  const harness = await runtime.createHarness(meta.id);
  // validate_coverage has only an automated rule.
  const instance = await harness.startTask("validate_coverage", {
    requirement_matrix: {},
    technical_proposal: {},
  });
  assert.equal(instance.state, "completed");
});

test("harness: missing required context fails startability, not the AI", async () => {
  const runtime = new WorkspaceRuntime(makePorts());
  const meta = await runtime.createWorkspace(bidContract, "ws");
  const harness = await runtime.createHarness(meta.id);
  // tender_document is required: true and not supplied.
  const instance = await harness.startTask("analyze_tender", {});
  assert.equal(instance.state, "failed");
  assert.match(instance.error ?? "", /required context missing: tender_document/);
  // No capability was ever invoked.
  assert.deepEqual(instance.capabilityOutputs, {});
});

test("harness: unknown task id throws", async () => {
  const runtime = new WorkspaceRuntime(makePorts());
  const meta = await runtime.createWorkspace(bidContract, "ws");
  const harness = await runtime.createHarness(meta.id);
  await assert.rejects(harness.startTask("nope", {}));
});

function makeSelectionFixture(): {
  ports: RuntimePorts;
  runtime: WorkspaceRuntime;
  connector: MemoryConnector;
} {
  const ports = makePorts();
  const connector = new MemoryConnector();
  ports.connectors = new Map([["memory", connector]]);
  return { ports, runtime: new WorkspaceRuntime(ports), connector };
}

async function bindTender(
  runtime: WorkspaceRuntime,
  connector: MemoryConnector,
  wsId: string,
): Promise<void> {
  await runtime.addGrant(wsId, "/granted/tenders");
  connector.register("/granted/tenders", [
    {
      id: "itm_tender_v2",
      type: "tender_document",
      ref: "/granted/tenders/tender-v2.md",
      name: "tender-v2.md",
      bytes: 2048,
      modifiedAt: "2026-07-20T00:00:00Z",
      content: "智慧水务项目招标：技术要求37条……",
    },
    {
      id: "itm_tender_v1",
      type: "tender_document",
      ref: "/granted/tenders/tender-v1.md",
      name: "tender-v1.md",
      bytes: 1024,
      modifiedAt: "2026-07-01T00:00:00Z",
      content: "旧版招标草案",
    },
  ]);
  // Binding validation rejects roots outside grants first.
  await assert.rejects(
    runtime.setBinding(wsId, { type: "tender_document", root: "/elsewhere" }),
    /outside every granted folder/,
  );
  await runtime.setBinding(wsId, {
    type: "tender_document",
    root: "/granted/tenders",
    connector: "memory",
  });
}

test("selection pipeline: high sensitivity gates on context_confirm, then completes", async () => {
  const { ports, runtime, connector } = makeSelectionFixture();
  const meta = await runtime.createWorkspace(bidContract, "ws");
  await bindTender(runtime, connector, meta.id);

  const harness = await runtime.createHarness(meta.id);
  const instance = await harness.startTask("analyze_tender"); // no inputs => selection
  assert.equal(instance.state, "waiting_human");
  assert.equal(instance.checkpoint?.kind, "context_confirm");
  assert.equal(instance.contextSet?.length, 2);
  // Nothing was transmitted or invoked before the user confirmed.
  assert.deepEqual(instance.capabilityOutputs, {});

  const resumed = await runtime.createHarness(meta.id);
  const done = await resumed.decideCheckpoint(instance.id, true);
  // analyze_tender still ends at its human verification rule.
  assert.equal(done.state, "waiting_human");
  assert.equal(done.checkpoint?.kind, "verification_review");
  const final = await resumed.decideCheckpoint(instance.id, true);
  assert.equal(final.state, "completed");
  assert.deepEqual(final.result?.sources, ["itm_tender_v2", "itm_tender_v1"]);

  // Transmission audit: hashes + confirmed_by user, never content.
  const events = await runtime.listAuditEvents(meta.id);
  const tx = events.find((e) => e.kind === "transmission.inference");
  assert.ok(tx);
  const payload = tx.payload as {
    context_items: Array<{ id: string; content_hash: string }>;
    persistence: string;
    confirmed_by: string;
  };
  assert.equal(payload.persistence, "none");
  assert.equal(payload.confirmed_by, "user");
  assert.match(payload.context_items[0]!.content_hash, /^sha256:[0-9a-f]{64}$/);
  assert.ok(verifyAuditChain(ports.crypto, meta.id, events));
});

test("selection pipeline: declining the context stops the task", async () => {
  const { runtime, connector } = makeSelectionFixture();
  const meta = await runtime.createWorkspace(bidContract, "ws");
  await bindTender(runtime, connector, meta.id);
  const harness = await runtime.createHarness(meta.id);
  const instance = await harness.startTask("analyze_tender");
  const declined = await harness.decideCheckpoint(instance.id, false);
  assert.equal(declined.state, "failed");
  assert.match(declined.error ?? "", /declined the selected context/);
  assert.deepEqual(declined.capabilityOutputs, {});
});

test("selection pipeline: required type without binding fails startability", async () => {
  const { runtime } = makeSelectionFixture();
  const meta = await runtime.createWorkspace(bidContract, "ws");
  const harness = await runtime.createHarness(meta.id);
  const instance = await harness.startTask("analyze_tender");
  assert.equal(instance.state, "failed");
  assert.match(instance.error ?? "", /required context "tender_document" has no binding/);
});

test("audit chain verifies end-to-end and detects tamper", async () => {
  const ports = makePorts();
  const runtime = new WorkspaceRuntime(ports);
  const meta = await runtime.createWorkspace(bidContract, "ws");
  const harness = await runtime.createHarness(meta.id);
  const instance = await harness.startTask("analyze_tender", {
    tender_document: {},
  });
  await harness.decideCheckpoint(instance.id, true);
  await runtime.transitionBusinessState(meta.id, "planning");

  const events = await runtime.listAuditEvents(meta.id);
  assert.ok(events.length >= 10, `expected a rich trail, got ${events.length}`);
  assert.ok(verifyAuditChain(ports.crypto, meta.id, events));

  // Content tamper breaks the chain.
  const tampered = structuredClone(events);
  (tampered[2]!.payload as Record<string, unknown>)["injected"] = true;
  assert.equal(verifyAuditChain(ports.crypto, meta.id, tampered), false);

  // Truncation from the middle breaks the chain.
  const truncated = [events[0]!, ...events.slice(2)];
  assert.equal(verifyAuditChain(ports.crypto, meta.id, truncated), false);
});
