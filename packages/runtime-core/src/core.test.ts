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
