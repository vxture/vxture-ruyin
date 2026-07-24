/**
 * Business Runtime Harness - task-scoped execution kernel (Phase A skeleton).
 * Design authority: docs/30-design/50-harness.md.
 *
 * Implemented in this phase: task instantiation, the main state machine
 * (created -> selecting -> executing -> verifying -> finalizing -> completed,
 * plus failed and the waiting_human suspension), required-context startability
 * (04 section 6.3), capability invocation through the AIGatewayPort (mock in
 * Phase A), verification pipeline with human checkpoints, journal entries,
 * and audit emission for every step. A fresh Harness is constructed per call -
 * decideCheckpoint on a new instance IS the rebuild-on-resume semantics of
 * 50-harness section 8.
 *
 * Not yet implemented (later phases): real context selection, Tool Gate,
 * revision rounds, transmission gate, recovery replay from journal.
 */

import type { RuyinContract, TaskDefinition } from "@vxture/ruyin-contract-schema";
import { emitAudit } from "./audit.js";
import type {
  AIGatewayPort,
  ClockPort,
  CryptoPort,
  IdPort,
  WorkspaceStore,
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

export interface VerificationOutcome {
  id: string;
  kind: "automated" | "ai_assisted" | "human";
  status: "passed" | "failed" | "pending_human";
  note?: string;
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
  inputs: Record<string, unknown>;
  state: TaskInstanceState;
  capabilityOutputs: Record<string, string>;
  verification: VerificationOutcome[];
  result?: TaskResult;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface HarnessDeps {
  store: WorkspaceStore;
  contract: RuyinContract;
  workspaceId: string;
  clock: ClockPort;
  id: IdPort;
  crypto: CryptoPort;
  gateway: AIGatewayPort;
}

export class HarnessError extends Error {}

export class Harness {
  constructor(private readonly deps: HarnessDeps) {}

  async startTask(
    taskId: string,
    inputs: Record<string, unknown>,
  ): Promise<TaskInstanceRecord> {
    const { contract, clock, id } = this.deps;
    const definition = contract.tasks.find((t) => t.id === taskId);
    if (!definition) {
      throw new HarnessError(`task "${taskId}" is not declared in the contract`);
    }
    const instance: TaskInstanceRecord = {
      id: id.newId("ti"),
      workspace: this.deps.workspaceId,
      taskId,
      definition,
      inputs,
      state: "created",
      capabilityOutputs: {},
      verification: [],
      createdAt: clock.now(),
      updatedAt: clock.now(),
    };
    await this.persist(instance);
    await this.audit(instance, "task.created", { task: taskId });

    // -- selecting: required-context startability (04 section 6.3) ----------
    await this.transition(instance, "selecting");
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
      types: Object.keys(inputs),
    });

    // -- executing: capability loop through the gateway ---------------------
    await this.transition(instance, "executing");
    for (const capability of definition.capabilities) {
      await this.journal(instance, "capability", { capability });
      await this.audit(instance, "capability.invoked", { capability });
      const result = await this.deps.gateway.invoke({
        capability,
        workspace: this.deps.workspaceId,
        taskInstance: instance.id,
        inputs,
      });
      instance.capabilityOutputs[capability] = result.content;
      await this.persist(instance);
      await this.audit(instance, "capability.completed", { capability });
    }

    // -- verifying: cheap-first pipeline (50-harness section 7.1) -----------
    await this.transition(instance, "verifying");
    for (const rule of definition.verification) {
      await this.audit(instance, "verification.run", { rule: rule.id, kind: rule.kind });
      if (rule.kind === "human") {
        instance.verification.push({
          id: rule.id,
          kind: rule.kind,
          status: "pending_human",
        });
      } else if (rule.kind === "ai_assisted") {
        await this.deps.gateway.invoke({
          capability: `verify:${rule.id}`,
          workspace: this.deps.workspaceId,
          taskInstance: instance.id,
          inputs,
        });
        instance.verification.push({
          id: rule.id,
          kind: rule.kind,
          status: "passed",
          note: "phase-a: ai_assisted verification is a pass-through stub",
        });
      } else {
        instance.verification.push({
          id: rule.id,
          kind: rule.kind,
          status: "passed",
          note: "phase-a: automated verification is a pass-through stub",
        });
      }
      const latest = instance.verification[instance.verification.length - 1]!;
      await this.persist(instance);
      await this.audit(instance, "verification.result", {
        rule: rule.id,
        status: latest.status,
      });
    }

    const pending = instance.verification.filter(
      (v) => v.status === "pending_human",
    );
    if (pending.length > 0) {
      await this.transition(instance, "waiting_human");
      await this.audit(instance, "checkpoint.raised", {
        kind: "verification_review",
        rules: pending.map((v) => v.id),
      });
      return instance;
    }
    return this.finalize(instance);
  }

  /**
   * Decide the pending verification-review checkpoint. Safe to call on a
   * freshly constructed Harness - instances are reloaded from the store
   * (rebuild-on-resume).
   */
  async decideCheckpoint(
    taskInstanceId: string,
    approve: boolean,
  ): Promise<TaskInstanceRecord> {
    const raw = await this.deps.store.getTaskInstance(taskInstanceId);
    if (!raw) {
      throw new HarnessError(`task instance "${taskInstanceId}" not found`);
    }
    const instance = JSON.parse(raw) as TaskInstanceRecord;
    if (instance.state !== "waiting_human") {
      throw new HarnessError(
        `task instance "${taskInstanceId}" is not waiting for a decision (state: ${instance.state})`,
      );
    }
    await this.audit(instance, "checkpoint.decided", {
      kind: "verification_review",
      approve,
      by: "user",
    });
    for (const outcome of instance.verification) {
      if (outcome.status === "pending_human") {
        outcome.status = approve ? "passed" : "failed";
      }
    }
    if (!approve) {
      return this.fail(instance, "human review rejected the result");
    }
    return this.finalize(instance);
  }

  // -------------------------------------------------------------------------

  private async finalize(
    instance: TaskInstanceRecord,
  ): Promise<TaskInstanceRecord> {
    await this.transition(instance, "finalizing");
    instance.result = {
      content: instance.capabilityOutputs,
      sources: instance.definition.input_types,
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
    await this.audit(instance, "task.failed", { reason });
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

  private audit(
    instance: TaskInstanceRecord,
    kind: string,
    payload: unknown,
  ): Promise<unknown> {
    return emitAudit(
      this.deps.store,
      this.deps.crypto,
      this.deps.clock,
      this.deps.id,
      {
        workspace: this.deps.workspaceId,
        task_instance: instance.id,
        kind,
        actor: "harness",
        payload,
      },
    );
  }
}
