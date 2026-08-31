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
import type { RuyinContract, Tool } from "@vxture/ruyin-contract-schema";
import {
  MemoryConnector,
  MemoryStoragePort,
  ProjectRuntime,
  verifyAuditChain,
  ContractInvalidError,
  NeedsHumanConfirmationError,
  interruptedResumePoint,
  pendingCheckpoint,
  decideTool,
  validateToolCall,
  TransientError,
  type Harness,
  type RuntimePorts,
  type TaskInstanceRecord,
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
    clock: { now: () => new Date().toISOString(), sleep: async () => {} },
    id: { newId: (prefix) => `${prefix}_${(++seq).toString().padStart(4, "0")}_${randomUUID().slice(0, 8)}` },
    crypto: {
      sha256: (input) => createHash("sha256").update(input, "utf8").digest("hex"),
    },
    gateway: {
      // Echoes the conversation length so tests can assert that capability N
      // actually saw N-1's output (the straight-line bug this replaced).
      turn: async (req) => ({
        kind: "content" as const,
        content: `[mock:${req.capability}|msgs=${req.messages.length}]`,
      }),
    },
  };
}

/**
 * startTask + advance. Recording an instance is fast, running it is not, so
 * the API is two-step: the host answers its request, then drives the task.
 * Tests want the finished state, so they do both.
 */
function runTask(
  harness: Harness,
  taskId: string,
  inputs?: Record<string, unknown>,
): Promise<TaskInstanceRecord> {
  return harness
    .startTask(taskId, inputs)
    .then((created) => harness.advance(created.id));
}

/** Decide a checkpoint, then let the task continue. */
function decide(
  harness: Harness,
  id: string,
  approve: boolean,
): Promise<TaskInstanceRecord> {
  return harness.decideCheckpoint(id, approve).then(() => harness.advance(id));
}

test("createProject validates, persists, and seeds the initial state", async () => {
  const ports = makePorts();
  const runtime = new ProjectRuntime(ports);
  const meta = await runtime.createProject(bidContract, "投标项目 A");
  assert.equal(meta.productId, "vxture.bid");
  assert.equal(meta.projectType, "project");

  const view = await runtime.openProject(meta.id);
  assert.equal(view.businessState, "draft");
  assert.equal(view.contract.product.id, "vxture.bid");

  const listed = await runtime.listProjects();
  assert.equal(listed.length, 1);
  assert.equal(listed[0]!.id, meta.id);
});

test("createProject rejects an invalid contract", async () => {
  const runtime = new ProjectRuntime(makePorts());
  const broken = structuredClone(bidContract) as { contract: string };
  broken.contract = "9.9";
  await assert.rejects(
    runtime.createProject(broken, "bad"),
    ContractInvalidError,
  );
});

test("business state machine follows the contract, confirm: human enforced", async () => {
  const runtime = new ProjectRuntime(makePorts());
  const meta = await runtime.createProject(bidContract, "ws");

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
  assert.equal((await runtime.openProject(meta.id)).businessState, "submitted");

  // illegal jump
  await assert.rejects(runtime.transitionBusinessState(meta.id, "draft"));
});

test("harness: task with human verification suspends, resume completes", async () => {
  const runtime = new ProjectRuntime(makePorts());
  const meta = await runtime.createProject(bidContract, "ws");
  const harness = await runtime.createHarness(meta.id);

  const instance = await runTask(harness, "analyze_tender", {
    tender_document: { ref: "file://tender.pdf" },
  });
  assert.equal(instance.state, "waiting_human");
  assert.ok(
    instance.verification.some((v) => v.id === "matrix_review" && v.status === "pending_human"),
  );
  // msgs=1: the opening context message. The count is the whole point - it is
  // what proves the capability was handed a conversation rather than a bag of
  // inputs.
  assert.equal(
    instance.capabilityOutputs["requirement_analysis"],
    "[mock:requirement_analysis|msgs=1]",
  );

  // Rebuild-on-resume: a FRESH harness decides the checkpoint.
  const resumed = await runtime.createHarness(meta.id);
  const done = await decide(resumed, instance.id, true);
  assert.equal(done.state, "completed");
  assert.ok(done.result);
  assert.deepEqual(done.result.sources, ["tender_document"]);
});

test("harness: human rejection fails the task", async () => {
  const runtime = new ProjectRuntime(makePorts());
  const meta = await runtime.createProject(bidContract, "ws");
  const harness = await runtime.createHarness(meta.id);
  const instance = await runTask(harness, "analyze_tender", {
    tender_document: {},
  });
  const rejected = await decide(harness, instance.id, false);
  assert.equal(rejected.state, "failed");
  assert.match(rejected.error ?? "", /rejected/);
});

test("verify: an automated rule goes to the product, not to a runtime check", async () => {
  // ADR-010: the contract says WHAT to check by name; the product knows what
  // that name means. `kind` only orders the pipeline, it does not decide where
  // the check runs - so automated goes down the same capability path.
  const asked: string[] = [];
  const ports = makePorts();
  ports.gateway = {
    turn: async (req) => {
      if (req.capability.startsWith("verify:")) asked.push(req.capability);
      return { kind: "content" as const, content: "PASS" };
    },
  };
  const runtime = new ProjectRuntime(ports);
  const meta = await runtime.createProject(bidContract, "ws");
  const harness = await runtime.createHarness(meta.id);
  // validate_coverage declares one automated rule.
  const instance = await runTask(harness, "validate_coverage", {
    requirement_matrix: {},
    technical_proposal: {},
  });

  assert.deepEqual(asked, ["verify:coverage_complete"]);
  const outcome = instance.verification.find((v) => v.id === "coverage_complete");
  assert.equal(outcome?.kind, "automated");
  assert.equal(outcome?.status, "passed");
  assert.equal(instance.state, "completed");
});

test("verify: an unreadable automated verdict escalates, it does not pass", async () => {
  const runtime = new ProjectRuntime(makePorts()); // mock answers with prose
  const meta = await runtime.createProject(bidContract, "ws");
  const harness = await runtime.createHarness(meta.id);
  const instance = await runTask(harness, "validate_coverage", {
    requirement_matrix: {},
    technical_proposal: {},
  });
  // Same rule as above, unreadable answer: not "passed". Claiming a check that
  // never happened is worse than admitting we could not read the answer.
  assert.equal(instance.state, "waiting_human");
  const outcome = instance.verification.find((v) => v.id === "coverage_complete");
  assert.equal(outcome?.status, "pending_human");
  assert.match(outcome?.note ?? "", /could not be read as a verdict/);

  const done = await decide(harness, instance.id, true);
  assert.equal(done.state, "completed");
});

test("harness: startTask records but does not execute; advance drives it", async () => {
  const runtime = new ProjectRuntime(makePorts());
  const meta = await runtime.createProject(bidContract, "ws");
  const harness = await runtime.createHarness(meta.id);

  const created = await harness.startTask("validate_coverage", {
    requirement_matrix: {},
    technical_proposal: {},
  });
  // Nothing ran: a real provider takes tens of seconds per turn, so the
  // caller has to be able to answer its request first.
  assert.equal(created.state, "created");
  assert.deepEqual(created.capabilityOutputs, {});

  // Runs to its first resting point - here the review of an automated rule
  // the runtime cannot evaluate on its own.
  const done = await harness.advance(created.id);
  assert.equal(done.state, "waiting_human");
  assert.equal(Object.keys(done.capabilityOutputs).length, 2);

  // advance() clears the resume marker as it claims the work, so a second
  // caller finds nothing to do instead of re-running the task.
  const again = await harness.advance(created.id);
  assert.equal(again.state, "waiting_human");
  assert.deepEqual(again.capabilityOutputs, done.capabilityOutputs);
});

test("harness: recovery resumes an interrupted task without redoing finished work", async () => {
  const ports = makePorts();
  const runtime = new ProjectRuntime(ports);
  const meta = await runtime.createProject(bidContract, "ws");
  const harness = await runtime.createHarness(meta.id);
  const created = await harness.startTask("validate_coverage", {
    requirement_matrix: {},
    technical_proposal: {},
  });

  // Freeze the record the way a killed process leaves one: mid-execution,
  // the first capability already answered, and the resume marker cleared
  // because advance() had claimed the work before dying.
  const store = await ports.storage.openProjectStore(meta.id);
  assert.ok(store);
  const frozen = JSON.parse(
    (await store.getTaskInstance(created.id))!,
  ) as TaskInstanceRecord;
  frozen.state = "executing";
  delete frozen.resume;
  frozen.capabilityOutputs = { coverage_verification: "answered before the crash" };
  await store.putTaskInstance(created.id, JSON.stringify(frozen));

  assert.equal(interruptedResumePoint(frozen), "execute");

  const restarted = await runtime.createHarness(meta.id);
  const recovered = await restarted.recover(created.id);

  assert.equal(recovered.state, "waiting_human");
  // The capability that already succeeded is not asked again - re-asking
  // burns a call and returns a different answer for a finished step.
  assert.equal(
    recovered.capabilityOutputs["coverage_verification"],
    "answered before the crash",
  );
  // And the unfinished one was handed the earlier answer, not a blank slate.
  assert.equal(
    recovered.capabilityOutputs["consistency_analysis"],
    "[mock:consistency_analysis|msgs=2]",
  );

  const events = await runtime.listAuditEvents(meta.id);
  assert.ok(events.some((e) => e.kind === "task.resumed"));
});

test("harness: settled and waiting tasks are not treated as interrupted", async () => {
  const base = {
    resume: undefined,
    capabilityOutputs: {},
    verification: [],
  } as unknown as TaskInstanceRecord;

  for (const state of ["completed", "failed", "cancelled"] as const) {
    assert.equal(interruptedResumePoint({ ...base, state }), null, state);
  }
  // Waiting on a person is not an interruption: the checkpoint is persisted,
  // so it survives a restart on its own and must not be re-driven.
  assert.equal(
    interruptedResumePoint({ ...base, state: "waiting_human" }),
    null,
  );
  // An instance already armed is in flight, not interrupted.
  assert.equal(
    interruptedResumePoint({ ...base, state: "executing", resume: "execute" }),
    null,
  );
  assert.equal(
    interruptedResumePoint({ ...base, state: "executing" }),
    "execute",
  );
});

// -- Transient errors and cancellation (50-harness sections 3 / 8.4) --------

test("transient: retried with backoff, then parked - not failed", async () => {
  const ports = makePorts();
  const waits: number[] = [];
  ports.clock = {
    now: () => new Date().toISOString(),
    sleep: async (ms) => {
      waits.push(ms);
    },
  };
  let attempts = 0;
  ports.gateway = {
    turn: async () => {
      attempts += 1;
      throw new TransientError("provider unreachable");
    },
  };
  const runtime = new ProjectRuntime(ports);
  const meta = await runtime.createProject(bidContract, "ws");
  const harness = await runtime.createHarness(meta.id);
  const instance = await runTask(harness, "analyze_tender", {
    tender_document: {},
  });

  assert.equal(attempts, 3);
  assert.deepEqual(waits, [500, 1000], "exponential, and no wait after the last try");
  // Someone else's outage is not this task going wrong.
  assert.equal(instance.state, "suspended");
  assert.notEqual(instance.state, "failed");
  assert.match(instance.suspendedReason ?? "", /unreachable/);
  // A restart is exactly when the network may be back, so recovery takes it.
  assert.equal(interruptedResumePoint(instance), "execute");
});

test("transient: a permanent error still fails, it is not parked forever", async () => {
  const ports = makePorts();
  ports.gateway = {
    turn: async () => {
      throw new Error("contract says this capability does not exist");
    },
  };
  const runtime = new ProjectRuntime(ports);
  const meta = await runtime.createProject(bidContract, "ws");
  const harness = await runtime.createHarness(meta.id);
  const instance = await runTask(harness, "analyze_tender", {
    tender_document: {},
  });
  assert.equal(instance.state, "failed");
});

test("cancel: an idle task stops at once and keeps what it produced", async () => {
  const runtime = new ProjectRuntime(makePorts());
  const meta = await runtime.createProject(bidContract, "ws");
  const harness = await runtime.createHarness(meta.id);
  const waiting = await runTask(harness, "analyze_tender", { tender_document: {} });
  assert.equal(waiting.state, "waiting_human");

  const stopped = await harness.cancel(waiting.id);
  assert.equal(stopped.state, "cancelled");
  // Side effects and results are kept, not rolled back - the audit trail is
  // what shows what happened (50-harness section 12).
  assert.ok(stopped.capabilityOutputs["requirement_analysis"]);
  const events = await runtime.listAuditEvents(meta.id);
  assert.ok(events.some((e) => e.kind === "task.cancelled"));

  // Cancelling twice is not an error, and a cancelled task is not recovered.
  assert.equal((await harness.cancel(waiting.id)).state, "cancelled");
  assert.equal(interruptedResumePoint(stopped), null);
});

test("cancel: a running task stops between capabilities", async () => {
  const cancelled = new Set<string>();
  const ports = makePorts();
  ports.isCancelled = (id) => cancelled.has(id);
  ports.gateway = {
    // Ask to stop while the first capability is answering.
    turn: async (req) => {
      cancelled.add(req.taskId);
      return { kind: "content" as const, content: "partial" };
    },
  };
  const runtime = new ProjectRuntime(ports);
  const meta = await runtime.createProject(bidContract, "ws");
  const harness = await runtime.createHarness(meta.id);
  // validate_coverage has two capabilities; the second must not run.
  const instance = await runTask(harness, "validate_coverage", {
    requirement_matrix: {},
    technical_proposal: {},
  });

  assert.equal(instance.state, "cancelled");
  assert.equal(
    Object.keys(instance.capabilityOutputs).length,
    1,
    "the call in flight finished; the next one never started",
  );
});

// -- Verification and revision rounds (50-harness section 7) ----------------

/**
 * A gateway that answers verification with a scripted verdict and echoes back
 * whether it was told what went wrong last time.
 */
function verifyingPorts(verdicts: string[]): RuntimePorts {
  const ports = makePorts();
  let call = 0;
  ports.gateway = {
    turn: async (req) => {
      if (req.capability.startsWith("verify:")) {
        const verdict = verdicts[Math.min(call++, verdicts.length - 1)]!;
        return { kind: "content" as const, content: verdict };
      }
      const revising = req.messages.some(
        (m) => m.role === "user" && /verification failed/.test(m.content),
      );
      return {
        kind: "content" as const,
        content: revising ? "revised draft" : "first draft",
      };
    },
  };
  return ports;
}

test("verify: a FAIL sends the reason back and the work is regenerated", async () => {
  // generate_proposal has two ai_assisted rules then a human one.
  const runtime = new ProjectRuntime(
    verifyingPorts(["FAIL: 有三条需求没覆盖", "PASS", "PASS"]),
  );
  const meta = await runtime.createProject(bidContract, "ws");
  const harness = await runtime.createHarness(meta.id);
  const instance = await runTask(harness, "generate_proposal", {
    requirement_matrix: {},
    enterprise_capability: {},
    case_library: {},
    enterprise_knowledge: {},
  });

  assert.equal(instance.revisionRound, 1);
  // The second attempt was told what was wrong - a silent retry would just
  // produce the same thing again.
  assert.equal(instance.capabilityOutputs["proposal_generation"], "revised draft");
  assert.ok(
    instance.verification.every((v) => v.status !== "failed"),
    "the failed outcome is discarded so the rule runs again on the new work",
  );
});

test("verify: revisions are bounded and the end is always a person", async () => {
  const runtime = new ProjectRuntime(verifyingPorts(["FAIL: still wrong"]));
  const meta = await runtime.createProject(bidContract, "ws");
  const harness = await runtime.createHarness(meta.id);
  const instance = await runTask(harness, "generate_proposal", {
    requirement_matrix: {},
    enterprise_capability: {},
    case_library: {},
    enterprise_knowledge: {},
  });

  // Never an endless retry, and never a silent discard.
  assert.equal(instance.revisionRound, 2);
  assert.equal(instance.state, "waiting_human");
  const cp = pendingCheckpoint(instance);
  assert.equal(cp?.kind, "verification_review");
  // The person can see what failed and why, not just that something did.
  assert.match(JSON.stringify(cp?.subject), /still wrong/);
});

test("verify: an unreadable verdict escalates rather than passing", async () => {
  const runtime = new ProjectRuntime(
    verifyingPorts(["looks broadly reasonable to me"]),
  );
  const meta = await runtime.createProject(bidContract, "ws");
  const harness = await runtime.createHarness(meta.id);
  const instance = await runTask(harness, "generate_proposal", {
    requirement_matrix: {},
    enterprise_capability: {},
    case_library: {},
    enterprise_knowledge: {},
  });

  assert.equal(instance.state, "waiting_human");
  const outcome = instance.verification.find((v) => v.id === "requirement_coverage");
  // Not "passed": an answer we cannot read is an answer we have not got.
  assert.equal(outcome?.status, "pending_human");
  assert.match(outcome?.note ?? "", /could not be read as a verdict/);
  // And no revision was spent on it - there was no reason to feed back.
  assert.equal(instance.revisionRound ?? 0, 0);
});

// -- Tool Gate (50-harness section 5) ---------------------------------------

const bid = bidContract as RuyinContract;

function bidTool(id: string): Tool {
  const found = bid.tools.find((t) => t.id === id);
  assert.ok(found, `fixture tool ${id} missing`);
  return found;
}

test("gate: the external_send floor cannot be relaxed by anyone", () => {
  const sender = {
    ...bidTool("write_document"),
    id: "send_email",
    category: "external_send" as const,
    default: "allow" as const,
  };
  // Contract says allow, user says allow - the floor still wins, because
  // something sent outward cannot be recalled.
  for (const userPolicy of [undefined, "allow" as const]) {
    const decision = decideTool({
      tool: sender,
      permissions: bid.permissions,
      userPolicy,
    });
    assert.equal(decision.value, "ask");
    assert.equal(decision.source, "hard_floor");
  }
  // And the task-scoped cache does not apply to it either: approving once is
  // not consent for the next one.
  assert.equal(
    decideTool({
      tool: sender,
      permissions: bid.permissions,
      askCache: new Set(["send_email"]),
    }).value,
    "ask",
  );
});

test("gate: user policy beats the contract default, both ways", () => {
  const readFile = bidTool("read_file"); // contract default: allow
  assert.equal(
    decideTool({ tool: readFile, permissions: bid.permissions }).source,
    "contract_default",
  );
  const tightened = decideTool({
    tool: readFile,
    permissions: bid.permissions,
    userPolicy: "deny",
  });
  assert.equal(tightened.value, "deny");
  assert.equal(tightened.source, "user_policy");
});

test("gate: an approved-for-this-task tool stops asking", () => {
  const write = bidTool("write_document"); // contract default: ask
  assert.equal(
    decideTool({ tool: write, permissions: bid.permissions }).value,
    "ask",
  );
  const cached = decideTool({
    tool: write,
    permissions: bid.permissions,
    askCache: new Set(["write_document"]),
  });
  assert.equal(cached.value, "allow");
  assert.equal(cached.source, "ask_cache");
});

test("gate: a path outside the grants is refused", () => {
  const grants = [
    { id: "g1", path: "C:/work/bid", mode: "read" as const, createdAt: "" },
  ];
  const inside = validateToolCall({
    tool: bidTool("read_file"),
    args: { path: "C:/work/bid/tender.md" },
    grants,
    contextSet: [],
  });
  assert.equal(inside.ok, true);

  const outside = validateToolCall({
    tool: bidTool("read_file"),
    args: { path: "C:/Users/someone/.ssh/id_rsa" },
    grants,
    contextSet: [],
  });
  assert.equal(outside.ok, false);
  assert.match(outside.ok === false ? outside.reason : "", /granted folder/);

  // A sibling directory that merely shares a prefix is still outside.
  const prefixTrick = validateToolCall({
    tool: bidTool("read_file"),
    args: { path: "C:/work/bid-secrets/keys.txt" },
    grants,
    contextSet: [],
  });
  assert.equal(prefixTrick.ok, false);
});

test("gate: undeclared parameters and missing required ones are refused", () => {
  const grants = [
    { id: "g1", path: "C:/work", mode: "readwrite" as const, createdAt: "" },
  ];
  const missing = validateToolCall({
    tool: bidTool("write_document"),
    args: { path: "C:/work/out.md" },
    grants,
    contextSet: [],
  });
  assert.equal(missing.ok, false);
  assert.match(missing.ok === false ? missing.reason : "", /content/);

  // An undeclared parameter has no rules to check it against, so it is not
  // waved through.
  const extra = validateToolCall({
    tool: bidTool("write_document"),
    args: { path: "C:/work/out.md", content: "x", mode: "append" },
    grants,
    contextSet: [],
  });
  assert.equal(extra.ok, false);
  assert.match(extra.ok === false ? extra.reason : "", /not declared/);
});

test("gate: a context_item reference must be in this task's context set", () => {
  const grants = [
    { id: "g1", path: "C:/work", mode: "readwrite" as const, createdAt: "" },
  ];
  const base = {
    tool: bidTool("write_document"),
    grants,
    contextSet: [
      {
        id: "item_1",
        type: "tender_document",
        source: "local",
        ref: "C:/work/t.md",
        name: "t.md",
        bytes: 4,
        modifiedAt: "",
      },
    ],
  };
  assert.equal(
    validateToolCall({
      ...base,
      args: { path: "C:/work/o.md", content: "x", source: "item_1" },
    }).ok,
    true,
  );
  const foreign = validateToolCall({
    ...base,
    args: { path: "C:/work/o.md", content: "x", source: "item_elsewhere" },
  });
  assert.equal(foreign.ok, false);
  assert.match(foreign.ok === false ? foreign.reason : "", /context set/);
});

test("harness: an ask-class tool suspends on tool_ask, then runs on approval", async () => {
  const ports = makePorts();
  const executed: string[] = [];
  ports.tools = {
    supports: (t) => t === "write_document",
    execute: async (req) => {
      executed.push(req.tool);
      return { content: "written" };
    },
  };
  let asked = false;
  ports.gateway = {
    turn: async () => {
      if (!asked) {
        asked = true;
        return {
          kind: "tool_calls" as const,
          calls: [
            {
              id: "c1",
              tool: "write_document",
              arguments: { path: "C:/work/out.md", content: "hello" },
            },
          ],
        };
      }
      return { kind: "content" as const, content: "done" };
    },
  };
  const runtime = new ProjectRuntime(ports);
  const meta = await runtime.createProject(bidContract, "ws");
  await runtime.addGrant(meta.id, "C:/work", "readwrite");
  const harness = await runtime.createHarness(meta.id);

  const parked = await runTask(harness, "analyze_tender", { tender_document: {} });
  assert.equal(parked.state, "waiting_human");
  const cp = pendingCheckpoint(parked);
  assert.equal(cp?.kind, "tool_ask");
  // The user can see exactly what they are approving, and can edit it.
  assert.deepEqual(cp?.options, ["approve", "reject", "modify"]);
  assert.equal(executed.length, 0, "nothing runs before the user answers");

  const done = await decide(harness, parked.id, true);
  assert.deepEqual(executed, ["write_document"]);
  assert.equal(done.state, "waiting_human"); // now the verification review
  assert.equal(pendingCheckpoint(done)?.kind, "verification_review");
});

test("harness: a refused tool reports back instead of failing the task", async () => {
  const ports = makePorts();
  const executed: string[] = [];
  ports.tools = {
    supports: (t) => t === "write_document",
    execute: async (req) => {
      executed.push(req.tool);
      return { content: "written" };
    },
  };
  let asked = false;
  ports.gateway = {
    turn: async (req) => {
      if (!asked) {
        asked = true;
        return {
          kind: "tool_calls" as const,
          calls: [
            {
              id: "c1",
              tool: "write_document",
              arguments: { path: "C:/work/out.md", content: "hello" },
            },
          ],
        };
      }
      // The provider must be able to see the refusal and change plan.
      const refusal = req.messages.find(
        (m) => m.role === "tool" && m.isError === true,
      );
      return {
        kind: "content" as const,
        content: refusal ? "saw refusal" : "no refusal seen",
      };
    },
  };
  const runtime = new ProjectRuntime(ports);
  const meta = await runtime.createProject(bidContract, "ws");
  await runtime.addGrant(meta.id, "C:/work", "readwrite");
  const harness = await runtime.createHarness(meta.id);

  const parked = await runTask(harness, "analyze_tender", { tender_document: {} });
  const after = await decide(harness, parked.id, false);

  assert.deepEqual(executed, [], "a refused call never runs");
  // Refusing one tool is not a reason to throw away the whole task.
  assert.notEqual(after.state, "failed");
  assert.equal(after.capabilityOutputs["requirement_analysis"], "saw refusal");
});

test("harness: capabilities chain - each one sees the previous output", async () => {
  const runtime = new ProjectRuntime(makePorts());
  const meta = await runtime.createProject(bidContract, "ws");
  const harness = await runtime.createHarness(meta.id);
  // validate_coverage declares two capabilities, run in order.
  const instance = await runTask(harness, "validate_coverage", {
    requirement_matrix: {},
    technical_proposal: {},
  });

  // The mock reports how many messages it was handed. The first capability
  // sees only the opening context; the second must also see the first one's
  // answer. Equal counts would mean the straight-line bug is back: both fed
  // the same inputs, neither aware of the other.
  assert.equal(
    instance.capabilityOutputs["coverage_verification"],
    "[mock:coverage_verification|msgs=1]",
  );
  assert.equal(
    instance.capabilityOutputs["consistency_analysis"],
    "[mock:consistency_analysis|msgs=2]",
  );
});

test("harness: an illegal call is refused with a reason, and looping is bounded", async () => {
  const ports = makePorts();
  const seen: string[] = [];
  // A provider that keeps asking for the same call with no arguments at all.
  ports.gateway = {
    turn: async (req) => {
      for (const m of req.messages) {
        if (m.role === "tool" && m.isError) seen.push(m.content);
      }
      return {
        kind: "tool_calls" as const,
        calls: [{ id: "c1", tool: "write_document", arguments: {} }],
      };
    },
  };
  const runtime = new ProjectRuntime(ports);
  const meta = await runtime.createProject(bidContract, "ws");
  const harness = await runtime.createHarness(meta.id);
  const instance = await runTask(harness, "analyze_tender", {
    tender_document: {},
  });

  // The refusal reaches the provider as a tool result it can read and act on -
  // not a silent empty success, which would read as "it ran and found nothing".
  assert.ok(seen.some((s) => /missing required parameter "path"/.test(s)));
  // And a provider that never takes the hint is stopped by the turn ceiling
  // rather than looping forever.
  assert.equal(instance.state, "failed");
  assert.match(instance.error ?? "", /exceeded \d+ turns/);
});

test("harness: missing required context fails startability, not the AI", async () => {
  const runtime = new ProjectRuntime(makePorts());
  const meta = await runtime.createProject(bidContract, "ws");
  const harness = await runtime.createHarness(meta.id);
  // tender_document is required: true and not supplied.
  const instance = await runTask(harness, "analyze_tender", {});
  assert.equal(instance.state, "failed");
  assert.match(instance.error ?? "", /required context missing: tender_document/);
  // No capability was ever invoked.
  assert.deepEqual(instance.capabilityOutputs, {});
});

test("harness: unknown task id throws", async () => {
  const runtime = new ProjectRuntime(makePorts());
  const meta = await runtime.createProject(bidContract, "ws");
  const harness = await runtime.createHarness(meta.id);
  await assert.rejects(harness.startTask("nope", {}));
});

function makeSelectionFixture(): {
  ports: RuntimePorts;
  runtime: ProjectRuntime;
  connector: MemoryConnector;
} {
  const ports = makePorts();
  const connector = new MemoryConnector();
  ports.connectors = new Map([["memory", connector]]);
  return { ports, runtime: new ProjectRuntime(ports), connector };
}

async function bindTender(
  runtime: ProjectRuntime,
  connector: MemoryConnector,
  projectId: string,
): Promise<void> {
  await runtime.addGrant(projectId, "/granted/tenders");
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
    runtime.setBinding(projectId, { type: "tender_document", root: "/elsewhere" }),
    /outside every granted folder/,
  );
  await runtime.setBinding(projectId, {
    type: "tender_document",
    root: "/granted/tenders",
    connector: "memory",
  });
}

test("selection pipeline: high sensitivity gates on context_confirm, then completes", async () => {
  const { ports, runtime, connector } = makeSelectionFixture();
  const meta = await runtime.createProject(bidContract, "ws");
  await bindTender(runtime, connector, meta.id);

  const harness = await runtime.createHarness(meta.id);
  const instance = await runTask(harness, "analyze_tender"); // no inputs => selection
  assert.equal(instance.state, "waiting_human");
  assert.equal(pendingCheckpoint(instance)?.kind, "context_confirm");
  assert.equal(instance.contextSet?.length, 2);
  // Nothing was transmitted or invoked before the user confirmed.
  assert.deepEqual(instance.capabilityOutputs, {});

  const resumed = await runtime.createHarness(meta.id);
  const done = await decide(resumed, instance.id, true);
  // analyze_tender still ends at its human verification rule.
  assert.equal(done.state, "waiting_human");
  assert.equal(pendingCheckpoint(done)?.kind, "verification_review");
  const final = await decide(resumed, instance.id, true);
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
  const meta = await runtime.createProject(bidContract, "ws");
  await bindTender(runtime, connector, meta.id);
  const harness = await runtime.createHarness(meta.id);
  const instance = await runTask(harness, "analyze_tender");
  const declined = await decide(harness, instance.id, false);
  assert.equal(declined.state, "failed");
  assert.match(declined.error ?? "", /declined the selected context/);
  assert.deepEqual(declined.capabilityOutputs, {});
});

test("discoverContext previews bound items; empty without a binding", async () => {
  const { runtime, connector } = makeSelectionFixture();
  const meta = await runtime.createProject(bidContract, "ws");
  assert.deepEqual(await runtime.discoverContext(meta.id, "tender_document"), []);
  await bindTender(runtime, connector, meta.id);
  const items = await runtime.discoverContext(meta.id, "tender_document");
  assert.equal(items.length, 2);
  assert.ok(items.every((i) => i.type === "tender_document"));
});

test("selection pipeline: required type without binding fails startability", async () => {
  const { runtime } = makeSelectionFixture();
  const meta = await runtime.createProject(bidContract, "ws");
  const harness = await runtime.createHarness(meta.id);
  const instance = await runTask(harness, "analyze_tender");
  assert.equal(instance.state, "failed");
  assert.match(instance.error ?? "", /required context "tender_document" has no binding/);
});

test("audit chain verifies end-to-end and detects tamper", async () => {
  const ports = makePorts();
  const runtime = new ProjectRuntime(ports);
  const meta = await runtime.createProject(bidContract, "ws");
  const harness = await runtime.createHarness(meta.id);
  const instance = await runTask(harness, "analyze_tender", {
    tender_document: {},
  });
  await decide(harness, instance.id, true);
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
