/**
 * Business Runtime Harness - task-scoped execution kernel.
 * Design authority: docs/30-design/50-harness.md, 40-context-architecture.md.
 *
 * Implemented: task instantiation, the main state machine, real context
 * selection over bindings/connectors with relevance ranking and a per-type
 * budget (04 section 6.1), grant revalidation at selection time, the
 * context_confirm checkpoint for high-sensitivity context (04 section 6.2),
 * the inference-transmission audit event with content hashes (04 section
 * 7.3), capability invocation through the AIGatewayPort, the turn-based
 * capability loop with tool offers, the Tool Gate (decision synthesis +
 * argument validation + task-scoped ask cache), the verification pipeline
 * with the verification_review checkpoint and bounded revision rounds, the
 * checkpoint queue with modify, transient-error suspension with backoff,
 * cancellation between capabilities, project-produced context
 * (`sources: [project]`), interrupted-task recovery, journal entries, and
 * audit emission for every step.
 *
 * A fresh Harness per call: decideCheckpoint on a new instance IS the
 * rebuild-on-resume semantics of 50-harness section 8.
 *
 * The gateway is a port: `CapabilityClient` talks to the product's real
 * capability surface when one is configured, `MockAIGateway` stands in when
 * none is (and the daemon says which at startup - "not wired up" must never
 * look like "working").
 *
 * A caller may still pass explicit `inputs` (dev console manual mode /
 * tests): that path skips selection and marks the transmission as
 * caller-supplied context.
 *
 * **Still missing: redaction hooks.** That is the whole list.
 *
 * 这一段是给下一个读这个文件的人看的，所以它必须是真的。它曾经声称改订轮次、
 * 瞬时挂起、取消三项都还没实现 —— 三项都实现了，而且各自有用例。一段说反了
 * 的说明，和一段正确的说明长得一模一样。
 */

import type { RuyinContract, TaskDefinition } from "@vxture/ruyin-contract-schema";
import {
  emitAudit,
  OUTCOME_MUST_BE_STATED,
  RUNTIME_ACTOR,
} from "./audit.js";
import { TransientError } from "./ports.js";
import { LOCAL_FS, bindingRevoked, folderGrants, isPathGranted } from "./project.js";
import { decideTool, validateToolCall } from "./tool-gate.js";
import type {
  AIGatewayPort,
  Binding,
  ClockPort,
  ConnectorLookup,
  AuditOutcome,
  ContextContent,
  ContextItemMeta,
  CryptoPort,
  FactContent,
  Grant,
  IdPort,
  RankerPort,
  ContextFact,
  ProjectArtifact,
  ToolCall,
  ToolExecutionResult,
  ToolExecutorPort,
  ToolOffer,
  TurnMessage,
  ProjectStore,
} from "./ports.js";

export type TaskInstanceState =
  | "created"
  | "selecting"
  | "executing"
  | "verifying"
  | "finalizing"
  | "completed"
  | "failed"
  | "cancelled"
  | "waiting_human"
  | "suspended";

/**
 * Confirmation kinds that actually have an emitter.
 *
 * 50-harness section 6.2 lists six; the three without a trigger yet
 * (transmission_confirm, state_transition, result_acceptance) are left out
 * deliberately - a kind that can never be raised only buys the UI a branch
 * that never runs, and a reader the impression it is handled.
 */
export type CheckpointKind =
  | "context_confirm"
  | "verification_review"
  | "tool_ask";

export type CheckpointChoice = "approve" | "reject" | "modify";

/**
 * One thing waiting on a person (50-harness section 6.1). `subject` carries
 * the whole thing being decided - a confirmation the user cannot inspect is
 * not a confirmation.
 */
export interface Checkpoint {
  id: string;
  kind: CheckpointKind;
  subject: unknown;
  options: CheckpointChoice[];
  raisedAt: string;
  decision?: { by: string; choice: CheckpointChoice; at: string };
}

/** A decision, with the edited subject when the user chose to modify. */
export interface CheckpointDecision {
  choice: CheckpointChoice;
  /** Replacement subject; only read for `modify`. */
  subject?: unknown;
  /** Target a specific checkpoint; defaults to the oldest pending one. */
  checkpointId?: string;
  by?: string;
  /**
   * How long a tool approval lasts (50-harness 5.3). `once` is the default;
   * `task` stops asking again for the same tool within this task. Floored
   * operations ignore it - those are confirmed every single time.
   */
  scope?: "once" | "task";
}

/** The materialized context set as it goes to a provider. */
type ContextFacts = ContextFact[];

/** What one capability''s loop produced. */
type CapabilityOutcome =
  | { kind: "content"; content: string }
  | { kind: "suspended" }
  | { kind: "cancelled" }
  | { kind: "failed"; reason: string };

/** The phase `advance()` should run next. */
export type ResumePoint = "select" | "execute" | "finalize";

/** The confirmation currently in front of the user - oldest first, or none. */
export function pendingCheckpoint(
  instance: TaskInstanceRecord,
): Checkpoint | undefined {
  return instance.checkpoints.find((c) => !c.decision);
}

/**
 * Where to re-enter an instance the process died holding, or null if there is
 * nothing to recover (50-harness section 8.3).
 *
 * No journal replay is needed to spot one: `advance()` clears the resume
 * marker as it claims the work, so "non-terminal, not awaiting a person, and
 * no marker" is exactly the signature of an interrupted run.
 *
 * `execute` covers three interrupted states because the phases skip what is
 * already on record - completed capabilities and decided verification rules
 * are not redone, so re-entry lands on the first unfinished step.
 */
export function interruptedResumePoint(
  instance: TaskInstanceRecord,
): ResumePoint | null {
  if (instance.resume) return null; // already armed: in flight, not interrupted
  switch (instance.state) {
    case "created":
      return "select";
    case "selecting":
      return "select";
    case "executing":
    case "verifying":
    case "finalizing":
      return "execute";
    case "suspended":
      // Parked on someone else's outage. A restart is exactly the moment the
      // network may be back, so it is worth another try (50-harness 8.4).
      return "execute";
    default:
      // completed / failed / cancelled: done.
      // waiting_human: not interrupted - it is waiting on a person, and the
      // checkpoint is persisted, so it survives the restart on its own.
      return null;
  }
}

export interface VerificationOutcome {
  id: string;
  kind: "automated" | "ai_assisted" | "human";
  status: "passed" | "failed" | "pending_human";
  note?: string;
  /** Why it failed - fed back into the next revision round. */
  feedback?: string;
}

export interface TaskResult {
  content: Record<string, string>;
  sources: string[];
  provenance: {
    task: string;
    capabilities: string[];
    finishedAt: string;
  };
}

export interface TaskInstanceRecord {
  id: string;
  workspace: string;
  taskId: string;
  definition: TaskDefinition;
  /** Caller-supplied context (manual mode); undefined = selection pipeline. */
  inputs?: Record<string, unknown>;
  /** Selected context (selection pipeline). */
  contextSet?: ContextItemMeta[];
  /**
   * Confirmation queue, oldest first (50-harness 6.3). A queue rather than one
   * slot because the Tool Gate can raise a second question while the first is
   * still open - a single slot silently drops one of them.
   */
  checkpoints: Checkpoint[];
  /**
   * Where `advance()` picks up. Absent means there is nothing to drive: the
   * task is terminal, waiting on a person, or already in flight elsewhere.
   * `advance()` clears it before doing the work, so it doubles as the claim
   * that stops two callers from running the same step twice.
   */
  resume?: ResumePoint;
  /** Recorded at the context_confirm checkpoint; read when execution resumes. */
  contextConfirmed?: boolean;
  /**
   * The conversation, persisted only while a tool decision is outstanding.
   * Suspending mid-loop is the one point where it cannot be rebuilt from
   * capabilityOutputs - the capability has not produced its answer yet.
   */
  conversation?: TurnMessage[];
  /** The capability whose loop is parked on a tool decision. */
  pendingCapability?: string;
  /** Calls waiting for the user's answer, then for execution. */
  pendingToolCalls?: ToolCall[];
  /** Set by the decision: run them, or report them back as refused. */
  pendingToolsApproved?: boolean;
  /**
   * Tools the user approved for the rest of this task (50-harness 5.3, task
   * scope). Never holds a floored operation - those are confirmed every time.
   */
  askCache?: string[];
  /** Revision rounds already spent on failed verification (50-harness 7.2). */
  revisionRound?: number;
  /** What failed last round, handed to the next one as data (not as prose). */
  pendingRevision?: {
    round: number;
    failures: Array<{ rule: string; reason: string }>;
  };
  /**
   * The user asked to stop. Honoured at the next safe point rather than
   * mid-call: aborting a call in flight leaves it unknown whether the effect
   * happened, and "unknown" is worse than "finished then stopped".
   */
  cancelRequested?: boolean;
  /** Why the task is suspended, shown to the user (50-harness 8.4). */
  suspendedReason?: string;
  state: TaskInstanceState;
  capabilityOutputs: Record<string, string>;
  verification: VerificationOutcome[];
  result?: TaskResult;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface HarnessDeps {
  store: ProjectStore;
  contract: RuyinContract;
  projectId: string;
  clock: ClockPort;
  id: IdPort;
  crypto: CryptoPort;
  gateway: AIGatewayPort;
  connectors: ConnectorLookup;
  ranker?: RankerPort | undefined;
  /** Executes tools the gate lets through; absent = no tool is on offer. */
  tools?: ToolExecutorPort | undefined;
  /**
   * True once the user has asked this task to stop. Lives outside the record
   * on purpose: the running loop holds its own copy and would overwrite a
   * persisted flag on its next write.
   */
  isCancelled?: ((taskInstanceId: string) => boolean) | undefined;
}

export class HarnessError extends Error {}

/** Internal signal: park the task, do not fail it. */
class SuspendTask extends Error {}

const TERMINAL_STATES: ReadonlySet<TaskInstanceState> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

/** Transient-error attempts before the task parks (50-harness 8.4). */
const MAX_TRANSIENT_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;

const MAX_ITEMS_PER_TYPE = 3;

/**
 * Runtime turn ceiling per capability (50-harness section 4: the loop is
 * bounded so a runaway cannot spin forever). A contract-declared smaller
 * value is future work.
 */
const MAX_TURNS = 12;

/**
 * Revision rounds before the result goes to a person (50-harness 7.2, runtime
 * default 2). The ceiling is the point: verification that never passes must
 * end at a human, not in an endless retry.
 */
const MAX_REVISIONS = 2;

/** Cheap checks first, a person last (50-harness 7.1). */
const VERIFICATION_ORDER: Record<VerificationOutcome["kind"], number> = {
  automated: 0,
  ai_assisted: 1,
  human: 2,
};

/**
 * Which of a task's declared tools this host cannot run.
 *
 * One rule, one implementation: `startTask` refuses on it, and the task list
 * shows it before the user clicks. Two copies of this judgement would drift,
 * and the drift would look like a task that is offered but cannot start.
 */
export function unrunnableTools(
  tools: readonly string[],
  supports: (tool: string) => boolean,
): string[] {
  return tools.filter((tool) => !supports(tool));
}

export class Harness {
  constructor(private readonly deps: HarnessDeps) {}

  async startTask(
    taskId: string,
    inputs?: Record<string, unknown>,
  ): Promise<TaskInstanceRecord> {
    const { contract, clock, id } = this.deps;
    const definition = contract.tasks.find((t) => t.id === taskId);
    if (!definition) {
      throw new HarnessError(`task "${taskId}" is not declared in the contract`);
    }
    // A task whose tools this host cannot run is refused here, before a single
    // provider turn is paid for.
    //
    // toolOffers already drops unsupported tools - correctly, since promising
    // one and failing on use teaches the provider nothing. But dropping them
    // silently left the task with no way to reach its objective, and the only
    // symptom was "exceeded 12 turns without producing a result" twelve model
    // calls later: expensive, slow, and it never named the cause. Same outcome,
    // one twelfth the cost, and this time it says what is missing.
    const unrunnable = unrunnableTools(definition.tools, (tool) =>
      this.deps.tools?.supports(tool) ?? false,
    );
    if (unrunnable.length) {
      throw new HarnessError(
        `task "${taskId}" needs tools this host does not implement: ` +
          `${unrunnable.join(", ")}`,
      );
    }
    const instance: TaskInstanceRecord = {
      id: id.newId("ti"),
      workspace: this.deps.projectId,
      taskId,
      definition,
      inputs,
      state: "created",
      capabilityOutputs: {},
      verification: [],
      checkpoints: [],
      createdAt: clock.now(),
      updatedAt: clock.now(),
    };
    instance.resume = "select";
    await this.persist(instance);
    await this.audit(instance, "task.created", {
      task: taskId,
      mode: inputs ? "manual" : "selection",
    });
    // Returns without executing anything: a real provider takes tens of
    // seconds per turn, so the caller must be able to answer its request and
    // drive the task separately. Call advance() to run it.
    return instance;
  }

  /**
   * Drive an instance to its next resting point - terminal, or waiting on a
   * person. Safe to call on a fresh Harness, which is what makes it the same
   * entry point recovery will use (50-harness section 8).
   *
   * Nothing to drive (terminal, awaiting a decision, or already in flight)
   * returns the instance untouched.
   */
  async advance(taskInstanceId: string): Promise<TaskInstanceRecord> {
    const instance = await this.loadInstance(taskInstanceId);
    const resume = instance.resume;
    if (!resume) return instance;

    // Claim it first: clearing the marker before doing the work means a second
    // caller finds nothing to do rather than running the same step twice.
    instance.resume = undefined;
    await this.persist(instance);

    try {
      switch (resume) {
        case "select":
          return await this.selectPhase(instance);
        case "execute":
          return await this.executePhase(instance);
        case "finalize":
          return await this.finalize(instance);
      }
    } catch (cause) {
      if (cause instanceof SuspendTask) {
        // Someone else's outage is not this task going wrong: park it with the
        // reason, keep every result so far, and let recovery try again.
        instance.suspendedReason = cause.message;
        await this.transition(instance, "suspended");
        await this.audit(instance, "task.suspended", { reason: cause.message });
        return instance;
      }
      return this.fail(
        instance,
        cause instanceof Error ? cause.message : String(cause),
      );
    }
  }

  /**
   * Ask the task to stop. Honoured at the next safe point - between turns or
   * between capabilities - so a call already in flight finishes rather than
   * leaving it unknown whether its effect landed.
   *
   * Side effects already performed are kept, not rolled back; the audit trail
   * is what shows what happened (50-harness section 12).
   */
  async cancel(taskInstanceId: string): Promise<TaskInstanceRecord> {
    const instance = await this.loadInstance(taskInstanceId);
    if (TERMINAL_STATES.has(instance.state)) return instance;

    instance.cancelRequested = true;
    await this.audit(instance, "task.cancel_requested", { by: "user" });

    // Nothing is driving it, so nothing will reach a safe point on its own -
    // stop it here.
    const idle =
      instance.state === "waiting_human" ||
      instance.state === "suspended" ||
      instance.resume !== undefined;
    if (idle) {
      instance.resume = undefined;
      return this.stopCancelled(instance);
    }
    await this.persist(instance);
    return instance;
  }

  private async stopCancelled(
    instance: TaskInstanceRecord,
  ): Promise<TaskInstanceRecord> {
    await this.transition(instance, "cancelled");
    await this.audit(instance, "task.cancelled", {
      completedCapabilities: Object.keys(instance.capabilityOutputs),
    });
    return instance;
  }

  /**
   * Call the provider, retrying failures the host marked as temporary.
   *
   * Backoff is exponential and bounded; when it runs out the task suspends
   * instead of failing. A transient error costs no revision round either -
   * neither the work nor the model did anything wrong (50-harness 8.4).
   */
  private async turnWithRetry(
    request: Parameters<AIGatewayPort["turn"]>[0],
    instance: TaskInstanceRecord,
  ): Promise<Awaited<ReturnType<AIGatewayPort["turn"]>>> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_TRANSIENT_ATTEMPTS; attempt++) {
      try {
        return await this.deps.gateway.turn(request);
      } catch (cause) {
        if (!(cause instanceof TransientError)) throw cause;
        lastError = cause;
        await this.audit(
          instance,
          "capability.retry",
          { capability: request.capability, attempt, reason: cause.message },
          // 记的是「上一次没成」这个事实。
          "failed",
        );
        if (attempt < MAX_TRANSIENT_ATTEMPTS) {
          await this.deps.clock.sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
        }
      }
    }
    throw new SuspendTask(
      lastError instanceof Error ? lastError.message : String(lastError),
    );
  }

  /**
   * Re-arm an instance the process died holding, then drive it. A no-op on
   * anything that is not actually interrupted, so it is safe to call over a
   * whole workspace on startup.
   */
  async recover(taskInstanceId: string): Promise<TaskInstanceRecord> {
    const instance = await this.loadInstance(taskInstanceId);
    const from = interruptedResumePoint(instance);
    if (!from) return instance;

    await this.audit(instance, "task.resumed", {
      interrupted_in: instance.state,
      resume: from,
    });
    instance.resume = from;
    await this.persist(instance);
    return this.advance(taskInstanceId);
  }

  /**
   * Put a question to the user and suspend. `modify` is offered only where
   * editing the subject means something - approving a changed context set is
   * a real action; "modifying" a verification verdict is not.
   */
  private async raise(
    instance: TaskInstanceRecord,
    kind: CheckpointKind,
    subject: unknown,
  ): Promise<Checkpoint> {
    const checkpoint: Checkpoint = {
      id: this.deps.id.newId("cp"),
      kind,
      subject,
      options:
        kind === "verification_review"
          ? ["approve", "reject"]
          : ["approve", "reject", "modify"],
      raisedAt: this.deps.clock.now(),
    };
    instance.checkpoints.push(checkpoint);
    await this.transition(instance, "waiting_human");
    await this.audit(instance, "checkpoint.raised", {
      checkpoint: checkpoint.id,
      kind,
      subject,
    });
    return checkpoint;
  }

  private async loadInstance(id: string): Promise<TaskInstanceRecord> {
    const raw = await this.deps.store.getTaskInstance(id);
    if (!raw) throw new HarnessError(`task instance "${id}" not found`);
    return JSON.parse(raw) as TaskInstanceRecord;
  }

  /** Context selection, then straight into execution (04 section 6.1). */
  private async selectPhase(
    instance: TaskInstanceRecord,
  ): Promise<TaskInstanceRecord> {
    const { contract } = this.deps;
    const definition = instance.definition;
    const inputs = instance.inputs;

    await this.transition(instance, "selecting");
    if (inputs) {
      // Manual mode: caller supplies context; required-presence check only.
      const requiredIds = new Set(
        contract.context.types.filter((t) => t.required).map((t) => t.id),
      );
      const missing = definition.input_types.filter(
        (t) => requiredIds.has(t) && !(t in inputs),
      );
      if (missing.length > 0) {
        return this.fail(
          instance,
          `required context missing: ${missing.join(", ")} - task cannot start`,
        );
      }
      await this.audit(instance, "context.selected", {
        mode: "manual",
        types: Object.keys(inputs),
      });
      return this.executePhase(instance);
    }

    // -- Selection pipeline (04 section 6.1) --------------------------------
    const selection = await this.selectContext(instance, definition);
    if (!selection.ok) {
      return this.fail(instance, selection.reason);
    }
    instance.contextSet = selection.items;
    await this.persist(instance);
    await this.audit(instance, "context.selected", {
      mode: "selection",
      items: selection.items.map((i) => ({
        id: i.id,
        type: i.type,
        name: i.name,
        bytes: i.bytes,
      })),
    });

    // -- Sensitivity gate (04 section 6.2): high => user confirms -----------
    const sensitivityOf = new Map(
      contract.context.types.map((t) => [t.id, t.sensitivity]),
    );
    const hasHigh = selection.items.some(
      (i) => sensitivityOf.get(i.type) === "high",
    );
    if (hasHigh) {
      await this.raise(instance, "context_confirm", {
        items: selection.items.map((i) => ({
          id: i.id,
          type: i.type,
          name: i.name,
          bytes: i.bytes,
          ref: i.ref,
          origin: "local_file",
        })),
        // Stated so the person deciding knows what they are agreeing to: these
        // files go out as material to work FROM. Anything inside them that
        // reads like an instruction is not a instruction the runtime will act on.
        contentIsData: true,
      });
      return instance;
    }
    return this.executePhase(instance);
  }

  /**
   * Record the decision on a pending checkpoint. Safe on a freshly constructed
   * Harness - rebuild-on-resume.
   *
   * Recording is fast; continuing the task is not, so this returns as soon as
   * the decision is durable and leaves an approved task marked for advance().
   * A crash in that window loses nothing: the marker is already persisted.
   */
  async decideCheckpoint(
    taskInstanceId: string,
    decision: boolean | CheckpointDecision,
  ): Promise<TaskInstanceRecord> {
    const input: CheckpointDecision =
      typeof decision === "boolean"
        ? { choice: decision ? "approve" : "reject" }
        : decision;
    const instance = await this.loadInstance(taskInstanceId);

    const pendingList = instance.checkpoints.filter((c) => !c.decision);
    const target = input.checkpointId
      ? pendingList.find((c) => c.id === input.checkpointId)
      : pendingList[0]; // oldest first (50-harness 6.3)
    if (!target) {
      throw new HarnessError(
        `task instance "${taskInstanceId}" has no pending checkpoint to decide (state: ${instance.state})`,
      );
    }
    if (!target.options.includes(input.choice)) {
      throw new HarnessError(
        `checkpoint "${target.id}" does not offer "${input.choice}" (offers: ${target.options.join(", ")})`,
      );
    }

    // modify edits the subject before approving - the user changes what they
    // are agreeing to, and the change is part of the record (50-harness 6.3).
    if (input.choice === "modify") {
      if (input.subject === undefined) {
        throw new HarnessError(
          `checkpoint "${target.id}": modify requires a replacement subject`,
        );
      }
      target.subject = input.subject;
    }
    target.decision = {
      by: input.by ?? "user",
      choice: input.choice,
      at: this.deps.clock.now(),
    };
    const approve = input.choice !== "reject";

    await this.audit(
      instance,
      "checkpoint.decided",
      {
        checkpoint: target.id,
        kind: target.kind,
        choice: input.choice,
        by: target.decision.by,
      },
      // 人拒绝了就是 rejected。记成 success，审计就把每一次否决都写成了通过。
      input.choice === "reject" ? "rejected" : "success",
    );

    // Another question is still open - stay put until every one is answered.
    if (instance.checkpoints.some((c) => !c.decision)) {
      await this.persist(instance);
      return instance;
    }

    if (target.kind === "tool_ask") {
      // A refused tool is not a failed task: the provider gets told and picks
      // another route. Failing here would throw away work over one call.
      instance.pendingToolsApproved = approve;
      if (input.choice === "modify") {
        const edited = (input.subject as { calls?: ToolCall[] } | undefined)?.calls;
        if (edited) instance.pendingToolCalls = edited;
      }
      if (approve && input.scope === "task") {
        const floored = new Set(
          this.deps.contract.tools
            .filter((t) => t.category === "external_send")
            .map((t) => t.id),
        );
        const remembered = (instance.pendingToolCalls ?? [])
          .map((c) => c.tool)
          .filter((id) => !floored.has(id));
        instance.askCache = [...new Set([...(instance.askCache ?? []), ...remembered])];
      }
      instance.resume = "execute";
      await this.transition(instance, "executing");
      return instance;
    }

    if (target.kind === "context_confirm") {
      if (!approve) {
        return this.fail(instance, "user declined the selected context");
      }
      instance.contextConfirmed = true;
      instance.resume = "execute";
      // Back to the state the checkpoint was raised from (50-harness 3.2).
      await this.transition(instance, "selecting");
      return instance;
    }

    for (const outcome of instance.verification) {
      if (outcome.status === "pending_human") {
        outcome.status = approve ? "passed" : "failed";
      }
    }
    if (!approve) {
      return this.fail(instance, "human review rejected the result");
    }
    instance.resume = "finalize";
    await this.transition(instance, "verifying");
    return instance;
  }

  // -------------------------------------------------------------------------

  private async selectContext(
    instance: TaskInstanceRecord,
    definition: TaskDefinition,
  ): Promise<
    | { ok: true; items: ContextItemMeta[] }
    | { ok: false; reason: string }
  > {
    const { contract, store, connectors, ranker } = this.deps;
    const bindings = jsonArray<Binding>(await store.getBindings());
    const grants = jsonArray<Grant>(await store.getGrants());
    const requiredIds = new Set(
      contract.context.types.filter((t) => t.required).map((t) => t.id),
    );

    const artifacts = jsonArray<ProjectArtifact>(await store.getArtifacts());
    const empty: string[] = [];

    const selected: ContextItemMeta[] = [];
    for (const type of definition.input_types) {
      const binding = bindings.find((b) => b.type === type);
      let candidates: ContextItemMeta[] = [];
      // 本项目自己产出的成果。契约把这类上下文声明为 `sources: [project]`，
      // 而在此之前没有任何东西兑现它 —— 于是「校验技术方案对需求矩阵的覆盖」
      // 这种任务，会在两份文档一份都没拿到的情况下照跑，而且不说一个字。
      for (const a of artifacts) {
        if (a.type !== type) continue;
        // 授权可能已经变了：产出时在授权目录里，不代表现在还在。
        if (!isPathGranted(a.path, grants)) continue;
        candidates.push({
          id: `art_${a.type}_${a.path}`,
          type,
          source: "project",
          connector: LOCAL_FS,
          ref: a.path,
          name: a.path.split(/[\\/]/).pop() ?? a.path,
          bytes: a.bytes,
          modifiedAt: a.producedAt,
        });
      }
      if (binding) {
        // Grants may have changed since the binding was created - revalidate
        // (04 section 4.3: the runtime never reads outside granted folders,
        // and never through a connector the project no longer grants).
        const revoked = bindingRevoked(binding, grants);
        if (revoked) return { ok: false, reason: revoked };
        const connector = connectors.get(binding.connector);
        if (!connector) {
          return {
            ok: false,
            reason: `connector "${binding.connector}" is not available`,
          };
        }
        candidates.push(...(await connector.discover(binding)));
      }
      if (candidates.length === 0) {
        if (requiredIds.has(type)) {
          return {
            ok: false,
            reason: `required context "${type}" has no binding or no items - task cannot start`,
          };
        }
        empty.push(type);
        continue;
      }
      const ranked = ranker
        ? await ranker.rank(this.deps.projectId, definition.objective, candidates)
        : [...candidates].sort((a, b) =>
            b.modifiedAt.localeCompare(a.modifiedAt),
          );
      selected.push(...ranked.slice(0, MAX_ITEMS_PER_TYPE));
    }
    // 声明了输入、却一份都没拿到 —— 这个任务达不成它的目标。
    //
    // 每个类型单看都是 `required: false`，所以逐个检查一个都不会响；而合起来
    // 「一份资料都没有」是另一回事。`validate_coverage` 的目标是「逐条对照
    // 需求矩阵与技术方案」，它曾经就是在 context = [] 的情况下跑完的，没有
    // 任何一处说过不对。
    if (definition.input_types.length > 0 && selected.length === 0) {
      return {
        ok: false,
        reason:
          `task has no context at all: ${empty.join(", ")} produced no items - ` +
          `bind a folder for them, or run the task that produces them first`,
      };
    }
    // 同一份文件可能同时落在两个类型下（本项目的产出，又恰好在某个绑定目录
    // 里）。同样的字节送两遍，成本翻倍而信息没多 —— 按 input_types 的先后保留
    // 第一次出现的那个类型。
    const byRef = new Map<string, ContextItemMeta>();
    for (const item of selected) {
      if (!byRef.has(item.ref)) byRef.set(item.ref, item);
    }
    return { ok: true, items: [...byRef.values()] };
  }

  private async executePhase(
    instance: TaskInstanceRecord,
  ): Promise<TaskInstanceRecord> {
    const { crypto, connectors } = this.deps;
    await this.transition(instance, "executing");

    // Materialize context and emit the inference-transmission audit event -
    // the single recorded exit for local context (04 section 7.3). Hashes and
    // metadata only, never content.
    // Structured facts, carrying their declared type AND where they came from.
    // Not rendered into a prompt: composing that text is where domain knowledge
    // lives, and it belongs to the product, not to the runtime.
    //
    // The origin matters because the runtime is the only layer that knows it —
    // by the time this text reaches a model it is just text, and a tender
    // document was written by whoever issued it, not by our user.
    const context: ContextFacts = [];
    let transmissionItems: Array<Record<string, unknown>>;
    if (instance.contextSet) {
      transmissionItems = [];
      for (const meta of instance.contextSet) {
        const connectorId = itemConnector(meta);
        const connector = connectors.get(connectorId);
        if (!connector) {
          return this.fail(instance, `connector for item "${meta.id}" unavailable`);
        }
        const item = await connector.read(meta);
        context.push({
          type: item.type,
          name: item.name,
          content: toFactContent(item.content, crypto),
          origin:
            connectorId === LOCAL_FS
              ? { kind: "local_file", connector: connectorId }
              : { kind: "connector", connector: connectorId, source: item.source },
        });
        transmissionItems.push({
          id: item.id,
          type: item.type,
          source: item.source,
          // 经哪个连接器出去的。ADR-005：每次连接器调用落审计（连接器、资源、
          // 内容哈希，不落原文）—— 资源与哈希本来就在这条记录里，这里补上连接器。
          connector: connectorId,
          // The full local reference stays here, in the audit - it is not sent
          // to the provider, which has no business knowing the user''s paths.
          ref: item.ref,
          origin: "local_file",
          // What is leaving, in the terms that decide how much leaves. An
          // item we could not read has no content hash: hashing the reason
          // would put a digest of our own sentence in the trail and make it
          // look like something was transmitted.
          ...describeForAudit(item.content, crypto),
          bytes: item.bytes,
        });
        await this.journal(instance, "context_read", { item: item.id });
      }
    } else {
      // Manual mode: the caller supplied the context directly.
      const inputs = instance.inputs ?? {};
      transmissionItems = Object.entries(inputs).map(([type, value]) => {
        const text = typeof value === "string" ? value : JSON.stringify(value);
        context.push({
          type,
          name: type,
          content: { kind: "text", text },
          origin: { kind: "caller" },
        });
        return {
          id: type,
          type,
          source: "caller",
          content_hash: `sha256:${crypto.sha256(text)}`,
          bytes: text.length,
        };
      });
    }
    await this.audit(instance, "transmission.inference", {
      context_items: transmissionItems,
      destination: "vxture-inference",
      persistence: "none",
      confirmed_by: instance.contextConfirmed ? "user" : "policy",
    });

    // One conversation for the whole task: every capability appends to it, so
    // capability N sees N-1's output. The straight-line predecessor handed all
    // of them the same inputs - with a mock that returned a fixed string that
    // looked fine, and with a real model it would produce unrelated fragments.
    // A parked conversation wins over a rebuilt one: it holds a turn the
    // capability has not answered yet, which capabilityOutputs cannot express.
    const messages =
      instance.conversation ?? this.rebuildConversation(instance);
    // Consumed: from here the conversation lives in the local variable, and
    // anything that suspends puts it back explicitly.
    instance.conversation = undefined;

    // Coming back from a tool_ask: run what the user approved, then carry on
    // in the capability that was parked.
    if (instance.pendingToolCalls?.length) {
      const decided = instance.pendingToolCalls;
      const approved = instance.pendingToolsApproved === true;
      const parked = instance.pendingCapability;
      instance.pendingToolCalls = undefined;
      instance.pendingToolsApproved = undefined;
      instance.pendingCapability = undefined;
      instance.conversation = undefined;
      const results = approved
        ? await this.runTools(instance, decided)
        : decided.map<TurnMessage>((call) => ({
            role: "tool",
            callId: call.id,
            content: `the user declined "${call.tool}"`,
            isError: true,
          }));
      messages.push(...results);
      if (parked) {
        const outcome = await this.runCapability(instance, parked, messages, context);
        if (outcome.kind === "failed") return this.fail(instance, outcome.reason);
        if (outcome.kind === "cancelled") return this.stopCancelled(instance);
        if (outcome.kind === "suspended") return instance;
        instance.capabilityOutputs[parked] = outcome.content;
        await this.persist(instance);
      }
    }

    for (const capability of instance.definition.capabilities) {
      // Already answered before an interruption: its output is persisted and
      // the conversation was restored with it, so re-asking would only burn a
      // call and produce a different answer for a step that already succeeded.
      if (capability in instance.capabilityOutputs) continue;
      // Safe point: between capabilities.
      if (this.deps.isCancelled?.(instance.id)) return this.stopCancelled(instance);
      const outcome = await this.runCapability(instance, capability, messages, context);
      if (outcome.kind === "failed") return this.fail(instance, outcome.reason);
      if (outcome.kind === "cancelled") return this.stopCancelled(instance);
      if (outcome.kind === "suspended") return instance;
      instance.capabilityOutputs[capability] = outcome.content;
      await this.persist(instance);
    }
    return this.verifyPhase(instance, messages, context);
  }

  /**
   * The conversation as it stood: every capability answer already on record.
   *
   * It does NOT open with a rendered prompt - the objective, constraints and
   * context travel as structured fields on the request, and the provider
   * decides how to put them to a model. On a fresh run this is simply empty.
   */
  private rebuildConversation(instance: TaskInstanceRecord): TurnMessage[] {
    const messages: TurnMessage[] = [];
    for (const capability of instance.definition.capabilities) {
      const answer = instance.capabilityOutputs[capability];
      if (answer !== undefined) {
        messages.push({ role: "assistant", content: answer });
      }
    }
    return messages;
  }

  /**
   * One capability, run as a loop (50-harness section 4): the provider answers
   * "what next" and the runtime decides. Bounded by MAX_TURNS so a provider
   * that keeps asking for tools cannot spin forever.
   */
  private async runCapability(
    instance: TaskInstanceRecord,
    capability: string,
    messages: TurnMessage[],
    context: ContextFacts,
  ): Promise<CapabilityOutcome> {
    await this.journal(instance, "capability", { capability });
    await this.audit(instance, "capability.invoked", { capability });
    const offers = this.toolOffers(instance);

    for (let step = 1; step <= MAX_TURNS; step++) {
      // Safe point: between turns, with nothing in flight.
      if (this.deps.isCancelled?.(instance.id)) return { kind: "cancelled" };
      const turn = await this.turnWithRetry(
        {
          capability,
          product: this.deps.contract.product.id,
          taskId: instance.id,
          workspace: this.deps.projectId,
          objective: instance.definition.objective,
          constraints: instance.definition.constraints ?? [],
          context,
          messages,
          tools: offers,
          ...(instance.pendingRevision
            ? { revision: instance.pendingRevision }
            : {}),
        },
        instance,
      );

      if (turn.kind === "content") {
        messages.push({ role: "assistant", content: turn.content });
        await this.audit(instance, "capability.completed", { capability, turns: step });
        return { kind: "content", content: turn.content };
      }

      if (turn.kind === "verdict") {
        // A verdict answers a verification rule, not a generation step. The
        // provider used the wrong reply shape; saying so beats inventing a
        // meaning for it.
        return {
          kind: "failed",
          reason: `capability "${capability}" answered with a verdict, which only verification rules use`,
        };
      }

      messages.push({ role: "assistant", content: "", toolCalls: turn.calls });
      const gated = await this.gateCalls(instance, turn.calls);

      if (gated.needsApproval.length > 0) {
        // Park the whole batch: the conversation holds an unanswered turn, so
        // it has to persist. Refused calls in the same batch are carried along
        // and reported together once the user answers.
        instance.conversation = messages;
        instance.pendingCapability = capability;
        instance.pendingToolCalls = gated.needsApproval;
        await this.raise(instance, "tool_ask", {
          capability,
          calls: gated.needsApproval.map((c) => ({
            tool: c.tool,
            arguments: c.arguments,
          })),
          refused: gated.refusals.map((r) => ({ tool: r.tool, reason: r.reason })),
          // The arguments were proposed by a model that had just read the
          // context - which is material someone else may have written. Saying
          // so lets the person judge the request on that basis rather than
          // assuming it originated from their own intent.
          proposedAfterReading: [
            ...new Set(context.map((c) => c.name)),
          ],
        });
        return { kind: "suspended" };
      }

      const results = await this.runTools(instance, gated.allowed);
      messages.push(...gated.refusalMessages, ...results);
    }
    return {
      kind: "failed",
      reason: `capability "${capability}" exceeded ${MAX_TURNS} turns without producing a result`,
    };
  }

  /**
   * 记下一份任务产出，让下游任务能把它当上下文用（`sources: [project]`）。
   *
   * 类型来自**产出它的那个任务的 `output_types`**：契约已经说了这个任务产出
   * 什么类别，没必要让模型再说一遍（说了还可能说错）。
   *
   * 只在任务恰好声明一种产出类型时登记。声明了多种就无从判断这一份是哪一种，
   * 而**猜一个类型比不登记更糟**：下游会拿到一份被标错类别的资料，然后正常地
   * 用它。这种情况留一条审计，不留一个猜测。
   */
  private async registerArtifact(
    instance: TaskInstanceRecord,
    artifact: { path: string; bytes: number },
  ): Promise<void> {
    const types = instance.definition.output_types;
    if (types.length !== 1 || !types[0]) {
      await this.audit(
        instance,
        "artifact.untyped",
        {
          path: artifact.path,
          declared: types,
          reason:
            types.length === 0
              ? "task declares no output type"
              : "task declares more than one output type",
        },
        "success",
      );
      return;
    }
    const registry = jsonArray<ProjectArtifact>(
      await this.deps.store.getArtifacts(),
    );
    // 同一路径重写就是同一份成果的新版本，不是第二份。
    const rest = registry.filter((a) => a.path !== artifact.path);
    rest.push({
      type: types[0],
      path: artifact.path,
      bytes: artifact.bytes,
      producedAt: this.deps.clock.now(),
      taskInstance: instance.id,
    });
    await this.deps.store.putArtifacts(JSON.stringify(rest));
  }

  /** Tools this task may use, as declared by the contract for this task. */
  private toolOffers(instance: TaskInstanceRecord): ToolOffer[] {
    const declared = new Set(instance.definition.tools);
    return this.deps.contract.tools
      .filter((t) => declared.has(t.id))
      // A tool no host can run is not on offer: promising it and failing later
      // costs a turn and teaches the provider nothing.
      .filter((t) => this.deps.tools?.supports(t.id) ?? false)
      .map((t) => ({ id: t.id, description: `${t.category} (risk: ${t.risk})` }));
  }

  /**
   * Run each requested call past the gate: decide, then validate. Refusals
   * come back as tool results so the provider can see why and change plan -
   * that is what the `retryable`-style feedback loop is for.
   */
  private async gateCalls(
    instance: TaskInstanceRecord,
    calls: ToolCall[],
  ): Promise<{
    allowed: ToolCall[];
    needsApproval: ToolCall[];
    refusals: Array<{ tool: string; reason: string }>;
    refusalMessages: TurnMessage[];
  }> {
    const allowed: ToolCall[] = [];
    const needsApproval: ToolCall[] = [];
    const refusals: Array<{ tool: string; reason: string }> = [];
    const refusalMessages: TurnMessage[] = [];
    // 工具校验的是路径参数，看的是目录授权；连接器授权与它无关。
    const grants = folderGrants(jsonArray<Grant>(await this.deps.store.getGrants()));
    const askCache = new Set(instance.askCache ?? []);

    for (const call of calls) {
      const tool = this.deps.contract.tools.find((t) => t.id === call.tool);
      const refuse = async (reason: string, kind: string) => {
        refusals.push({ tool: call.tool, reason });
        refusalMessages.push({
          role: "tool",
          callId: call.id,
          content: reason,
          isError: true,
        });
        await this.audit(
          instance,
          "tool.decision",
          { tool: call.tool, decision: "deny", source: kind, reason },
          "rejected",
        );
      };

      await this.audit(instance, "tool.requested", {
        tool: call.tool,
        arguments: Object.keys(call.arguments),
      });

      if (!tool) {
        await refuse(`tool "${call.tool}" is not declared in the contract`, "contract");
        continue;
      }
      if (!instance.definition.tools.includes(tool.id)) {
        await refuse(
          `tool "${tool.id}" is not available to task "${instance.taskId}"`,
          "contract",
        );
        continue;
      }

      const decision = decideTool({
        tool,
        permissions: this.deps.contract.permissions,
        // Workspace-level user policy has no store yet; the layer exists in
        // decideTool and is exercised by its unit tests.
        userPolicy: undefined,
        askCache,
      });
      if (decision.value === "deny") {
        await refuse(`tool "${tool.id}" denied: ${decision.reason}`, decision.source);
        continue;
      }

      // Validate before asking: there is no point putting an illegal call in
      // front of the user, and an argument outside the granted folders is a
      // refusal regardless of what the user would have said.
      const valid = validateToolCall({
        tool,
        args: call.arguments,
        grants,
        contextSet: instance.contextSet ?? [],
      });
      if (!valid.ok) {
        await refuse(`tool "${tool.id}" rejected: ${valid.reason}`, "parameter_check");
        continue;
      }

      await this.audit(
        instance,
        "tool.decision",
        { tool: tool.id, decision: decision.value, source: decision.source },
        // 这一支是「闸门放行或转人工确认」——都不是拒绝。deny 走上面那条。
        "success",
      );
      if (decision.value === "allow") allowed.push(call);
      else needsApproval.push(call);
    }
    return { allowed, needsApproval, refusals, refusalMessages };
  }

  /** Execute approved calls, journalling the intent before any side effect. */
  private async runTools(
    instance: TaskInstanceRecord,
    calls: ToolCall[],
  ): Promise<TurnMessage[]> {
    const out: TurnMessage[] = [];
    const grants = folderGrants(jsonArray<Grant>(await this.deps.store.getGrants()));
    for (const call of calls) {
      // journal-before-write (50-harness 8.2): the intent is on record before
      // the effect, so recovery can tell "never ran" from "ran, unrecorded".
      await this.journal(instance, "tool", { tool: call.tool, callId: call.id });
      let result: ToolExecutionResult;
      try {
        if (!this.deps.tools) throw new Error("no tool executor is configured");
        result = await this.deps.tools.execute({
          tool: call.tool,
          arguments: call.arguments,
          workspace: this.deps.projectId,
          taskId: instance.id,
          grants,
          contextSet: instance.contextSet ?? [],
        });
      } catch (cause) {
        result = {
          content: cause instanceof Error ? cause.message : String(cause),
          isError: true,
        };
      }
      await this.journal(instance, "tool.done", { tool: call.tool, callId: call.id });
      if (!result.isError && result.artifact) {
        await this.registerArtifact(instance, result.artifact);
      }
      await this.audit(
        instance,
        "tool.executed",
        { tool: call.tool },
        // 工具报错是 failed，不是 rejected —— 没有谁拒绝它，是它自己没做成。
        result.isError ? "failed" : "success",
      );
      out.push({
        role: "tool",
        callId: call.id,
        content: result.content,
        // Whatever came back is data, and it may have been written by someone
        // other than the user - the same reason context items carry an origin.
        origin: { kind: "tool_result", tool: call.tool },
        ...(result.isError ? { isError: true } : {}),
      });
    }
    return out;
  }

  private async verifyPhase(
    instance: TaskInstanceRecord,
    messages: TurnMessage[],
    context: ContextFacts,
  ): Promise<TaskInstanceRecord> {
    await this.transition(instance, "verifying");

    // Cost-ascending, fail fast (50-harness 7.1): the cheap deterministic
    // checks before the ones that cost a model call, and a person last.
    const ordered = [...instance.definition.verification].sort(
      (a, b) => VERIFICATION_ORDER[a.kind] - VERIFICATION_ORDER[b.kind],
    );

    for (const rule of ordered) {
      // Idempotent per rule (50-harness 8.3): recovery reruns only what has
      // no recorded outcome yet.
      if (instance.verification.some((v) => v.id === rule.id)) continue;
      await this.audit(instance, "verification.run", {
        rule: rule.id,
        kind: rule.kind,
      });

      // Both machine kinds go to the product's capability surface (ADR-010):
      // the contract says WHAT to check by name, the product knows what that
      // name means, and the runtime only orchestrates. `kind` is a cost hint -
      // it decides ordering, not where the check runs.
      const outcome: VerificationOutcome =
        rule.kind === "human"
          ? { id: rule.id, kind: rule.kind, status: "pending_human" }
          : await this.runProviderVerification(rule.id, rule.kind, instance, messages, context);

      instance.verification.push(outcome);
      await this.persist(instance);
      await this.audit(
        instance,
        "verification.result",
        {
          rule: rule.id,
          status: outcome.status,
          ...(outcome.feedback ? { feedback: outcome.feedback } : {}),
        },
        // 没过就是没过。pending_human 尚无结论，记 unknown 而不是替人先判一个。
        outcome.status === "passed"
          ? "success"
          : outcome.status === "failed"
            ? "rejected"
            : "unknown",
      );

      // Fail fast: a failed rule ends this pass, no point paying for the rest.
      if (outcome.status === "failed") break;
    }

    const failed = instance.verification.filter((v) => v.status === "failed");
    const round = instance.revisionRound ?? 0;

    if (failed.length > 0 && round < MAX_REVISIONS) {
      // Revision round (50-harness 7.2): the feedback goes back into the
      // conversation and the work is regenerated. Not a silent retry - the
      // model is told what was wrong.
      instance.revisionRound = round + 1;
      // Handed to the next round as data on the request, not as a sentence
      // appended to the conversation: asking for a fix is phrasing, and
      // phrasing is the product''s job.
      instance.pendingRevision = {
        round: instance.revisionRound,
        failures: failed.map((v) => ({
          rule: v.id,
          reason: v.feedback ?? "failed",
        })),
      };
      // Discard what failed review so it is produced again; keep the
      // conversation, which now carries the reason.
      instance.verification = instance.verification.filter(
        (v) => v.status !== "failed",
      );
      instance.capabilityOutputs = {};
      instance.conversation = messages;
      await this.persist(instance);
      await this.audit(instance, "task.revision", {
        round: instance.revisionRound,
        rules: failed.map((v) => v.id),
      });
      return this.executePhase(instance);
    }

    const pending = instance.verification.filter(
      (v) => v.status === "pending_human" || v.status === "failed",
    );
    if (pending.length > 0) {
      // The end of a failed verification is always a person, never a silent
      // discard and never an endless retry (50-harness 7.2).
      await this.raise(instance, "verification_review", {
        rules: pending.map((v) => ({
          id: v.id,
          kind: v.kind,
          status: v.status,
          ...(v.note ? { note: v.note } : {}),
          ...(v.feedback ? { feedback: v.feedback } : {}),
        })),
        revisionRounds: round,
        outcomes: instance.verification,
      });
      return instance;
    }
    return this.finalize(instance);
  }

  /**
   * Ask the product's capability surface to run a verification rule.
   *
   * The answer must arrive as a `verdict` turn - a field, not a sentence to be
   * parsed (ADR-011). Any other shape escalates to a person: an answer we
   * cannot read is an answer we have not got, and guessing in the passing
   * direction is how a verification step becomes decoration.
   */
  private async runProviderVerification(
    ruleId: string,
    kind: "automated" | "ai_assisted",
    instance: TaskInstanceRecord,
    messages: TurnMessage[],
    context: ContextFacts,
  ): Promise<VerificationOutcome> {
    const turn = await this.turnWithRetry(
      {
        capability: `verify:${ruleId}`,
        product: this.deps.contract.product.id,
        taskId: instance.id,
        workspace: this.deps.projectId,
        objective: instance.definition.objective,
        constraints: instance.definition.constraints ?? [],
        context,
        // The reviewer sees the same conversation the generator produced.
        messages,
        tools: [],
      },
      instance,
    );
    if (turn.kind === "verdict") {
      return turn.passed
        ? { id: ruleId, kind, status: "passed" }
        : {
            id: ruleId,
            kind,
            status: "failed",
            feedback: turn.reason ?? "no reason given",
          };
    }
    // Anything else is not a verdict, and the runtime does not try to read one
    // out of it. Escalating is the safe direction: guessing "passed" is how a
    // verification step becomes decoration.
    return {
      id: ruleId,
      kind,
      status: "pending_human",
      note: `verification capability answered with "${turn.kind}", not a verdict`,
    };
  }

  private async finalize(
    instance: TaskInstanceRecord,
  ): Promise<TaskInstanceRecord> {
    await this.transition(instance, "finalizing");
    instance.result = {
      content: instance.capabilityOutputs,
      sources: instance.contextSet
        ? instance.contextSet.map((i) => i.id)
        : instance.definition.input_types,
      provenance: {
        task: instance.taskId,
        capabilities: instance.definition.capabilities,
        finishedAt: this.deps.clock.now(),
      },
    };
    await this.persist(instance);
    await this.transition(instance, "completed");
    await this.audit(instance, "task.completed", { task: instance.taskId });
    return instance;
  }

  private async fail(
    instance: TaskInstanceRecord,
    reason: string,
  ): Promise<TaskInstanceRecord> {
    instance.error = reason;
    await this.transition(instance, "failed");
    await this.audit(instance, "task.failed", { reason }, "failed");
    return instance;
  }

  private async transition(
    instance: TaskInstanceRecord,
    to: TaskInstanceState,
  ): Promise<void> {
    const from = instance.state;
    instance.state = to;
    instance.updatedAt = this.deps.clock.now();
    await this.persist(instance);
    await this.audit(instance, "task.state_changed", { from, to });
  }

  private persist(instance: TaskInstanceRecord): Promise<void> {
    return this.deps.store.putTaskInstance(
      instance.id,
      JSON.stringify(instance),
    );
  }

  private async journal(
    instance: TaskInstanceRecord,
    step: string,
    detail: unknown,
  ): Promise<void> {
    await this.deps.store.appendJournal({
      taskInstance: instance.id,
      step,
      detail,
      at: this.deps.clock.now(),
    });
  }

  /**
   * 记一条审计。`outcome` 对结果不定的事件是必填的（见 OUTCOME_MUST_BE_STATED）：
   * 缺省成 success 会让每一次拒绝都被记成通过。
   */
  private audit(
    instance: TaskInstanceRecord,
    kind: string,
    payload: unknown,
    outcome?: AuditOutcome,
  ): Promise<unknown> {
    if (outcome === undefined && OUTCOME_MUST_BE_STATED.has(kind)) {
      throw new Error(
        `audit "${kind}": outcome must be stated - its result is not a foregone conclusion`,
      );
    }
    return emitAudit(
      this.deps.store,
      this.deps.crypto,
      this.deps.clock,
      this.deps.id,
      {
        workspace: this.deps.projectId,
        task_instance: instance.id,
        kind,
        actor: "harness",
        actorId: RUNTIME_ACTOR,
        outcome: outcome ?? "success",
        payload,
      },
    );
  }
}

function jsonArray<T>(raw: string | undefined): T[] {
  return raw ? (JSON.parse(raw) as T[]) : [];
}

/**
 * Connector id an item was discovered through.
 *
 * 新记录自带 `connector`（ADR-005 接缝 ②）。旧记录 —— 这个字段出现之前就
 * 停在人工检查点、重启后恢复的任务 —— 按旧约定回退：本地与项目产出都是落在
 * 授权目录里的文件，走 local-fs；其余把 source 当 id 用（那正是旧约定撞车的
 * 地方，但对已存的记录只能这么解读）。
 */
function itemConnector(meta: ContextItemMeta): string {
  if (meta.connector) return meta.connector;
  if (meta.source === "local" || meta.source === "project") return LOCAL_FS;
  return meta.source;
}

/**
 * Carrier form -> wire form. Bytes become base64 because the turn request is
 * JSON; nothing else changes shape.
 *
 * `unavailable` crosses the wire as itself. The runtime does not substitute a
 * sentence for the missing material and does not drop the item silently: the
 * provider has to know an input it asked for is not there, or it will reason
 * as though it had been given everything.
 *
 * Turning an unreadable format into text is not attempted here. That is a
 * model capability the product supplies (ADR-008); a parser in the framework
 * would also be the framework deciding what the material *says*.
 */
function toFactContent(content: ContextContent, crypto: CryptoPort): FactContent {
  switch (content.kind) {
    case "text":
      return content.truncated
        ? { kind: "text", text: content.text, truncated: true }
        : { kind: "text", text: content.text };
    case "binary":
      return {
        kind: "binary",
        mediaType: content.mediaType,
        base64: crypto.base64(content.bytes),
        bytes: content.bytes.byteLength,
      };
    case "unavailable":
      return content.mediaType
        ? {
            kind: "unavailable",
            reason: content.reason,
            mediaType: content.mediaType,
          }
        : { kind: "unavailable", reason: content.reason };
  }
}

/**
 * What the audit records about one item's content.
 *
 * The volume and the kind of what leaves, in the terms a person would use to
 * judge it: a whole scanned PDF and a paragraph of notes are not the same
 * event even when both are "one context item" (see TD-018).
 */
function describeForAudit(
  content: ContextContent,
  crypto: CryptoPort,
): Record<string, unknown> {
  switch (content.kind) {
    case "text":
      return {
        content_kind: "text",
        content_hash: `sha256:${crypto.sha256(content.text)}`,
        ...(content.truncated ? { truncated: true } : {}),
      };
    case "binary":
      return {
        content_kind: "binary",
        media_type: content.mediaType,
        // Hashed over the real bytes - a hash of a stand-in string would be a
        // digest of our own words presented as a record of the user's file.
        content_hash: `sha256:${crypto.sha256(content.bytes)}`,
        transmitted_bytes: content.bytes.byteLength,
      };
    case "unavailable":
      // No content_hash on purpose: there is no content. A hash here would
      // read as "something was sent".
      return {
        content_kind: "unavailable",
        reason: content.reason,
        ...(content.mediaType ? { media_type: content.mediaType } : {}),
      };
  }
}
