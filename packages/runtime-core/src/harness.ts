/**
 * Business Runtime Harness - task-scoped execution kernel.
 * Design authority: docs/30-design/50-harness.md, 40-context-architecture.md.
 *
 * Implemented: task instantiation, the main state machine, real context
 * selection over bindings/connectors with relevance ranking and a per-type
 * budget (04 section 6.1), grant revalidation at selection time, the
 * context_confirm checkpoint for high-sensitivity context (04 section 6.2),
 * the inference-transmission audit event with content hashes (04 section
 * 7.3), capability invocation through the AIGatewayPort (mock in Phase A/B
 * until liaison L3 lands), the verification pipeline with the
 * verification_review checkpoint, journal entries, and audit emission for
 * every step. A fresh Harness per call: decideCheckpoint on a new instance
 * IS the rebuild-on-resume semantics of 50-harness section 8.
 *
 * A caller may still pass explicit `inputs` (dev console manual mode /
 * tests): that path skips selection and marks the transmission as
 * caller-supplied context.
 *
 * Not yet implemented (later batches): Tool Gate over declared tools,
 * revision rounds, redaction hooks, recovery replay from journal.
 */

import type { RuyinContract, TaskDefinition } from "@vxture/ruyin-contract-schema";
import { emitAudit } from "./audit.js";
import { isPathGranted } from "./workspace.js";
import type {
  AIGatewayPort,
  Binding,
  ClockPort,
  ConnectorPort,
  ContextItemMeta,
  CryptoPort,
  FolderGrant,
  IdPort,
  RankerPort,
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

export type CheckpointKind = "context_confirm" | "verification_review";

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
  /** Caller-supplied context (manual mode); undefined = selection pipeline. */
  inputs?: Record<string, unknown>;
  /** Selected context (selection pipeline). */
  contextSet?: ContextItemMeta[];
  checkpoint?: { kind: CheckpointKind };
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
  connectors: Map<string, ConnectorPort>;
  ranker?: RankerPort | undefined;
}

export class HarnessError extends Error {}

const MAX_ITEMS_PER_TYPE = 3;

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
    await this.audit(instance, "task.created", {
      task: taskId,
      mode: inputs ? "manual" : "selection",
    });

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
      instance.checkpoint = { kind: "context_confirm" };
      await this.transition(instance, "waiting_human");
      await this.audit(instance, "checkpoint.raised", {
        kind: "context_confirm",
        items: selection.items.map((i) => i.id),
      });
      return instance;
    }
    return this.executePhase(instance);
  }

  /**
   * Decide the pending checkpoint (context_confirm or verification_review).
   * Safe on a freshly constructed Harness - rebuild-on-resume.
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
    const kind = instance.checkpoint?.kind ?? "verification_review";
    await this.audit(instance, "checkpoint.decided", {
      kind,
      approve,
      by: "user",
    });
    instance.checkpoint = undefined;

    if (kind === "context_confirm") {
      if (!approve) {
        return this.fail(instance, "user declined the selected context");
      }
      return this.executePhase(instance, { userConfirmed: true });
    }

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

  private async selectContext(
    instance: TaskInstanceRecord,
    definition: TaskDefinition,
  ): Promise<
    | { ok: true; items: ContextItemMeta[] }
    | { ok: false; reason: string }
  > {
    const { contract, store, connectors, ranker } = this.deps;
    const bindings = jsonArray<Binding>(await store.getBindings());
    const grants = jsonArray<FolderGrant>(await store.getGrants());
    const requiredIds = new Set(
      contract.context.types.filter((t) => t.required).map((t) => t.id),
    );

    const selected: ContextItemMeta[] = [];
    for (const type of definition.input_types) {
      const binding = bindings.find((b) => b.type === type);
      let candidates: ContextItemMeta[] = [];
      if (binding) {
        // Grants may have changed since the binding was created - revalidate
        // (04 section 4.3: the runtime never reads outside granted folders).
        if (!isPathGranted(binding.root, grants)) {
          return {
            ok: false,
            reason: `binding for "${type}" points outside the granted folders (grant revoked?)`,
          };
        }
        const connector = connectors.get(binding.connector);
        if (!connector) {
          return {
            ok: false,
            reason: `connector "${binding.connector}" is not available`,
          };
        }
        candidates = await connector.discover(binding);
      }
      if (candidates.length === 0) {
        if (requiredIds.has(type)) {
          return {
            ok: false,
            reason: `required context "${type}" has no binding or no items - task cannot start`,
          };
        }
        continue;
      }
      const ranked = ranker
        ? await ranker.rank(this.deps.workspaceId, definition.objective, candidates)
        : [...candidates].sort((a, b) =>
            b.modifiedAt.localeCompare(a.modifiedAt),
          );
      selected.push(...ranked.slice(0, MAX_ITEMS_PER_TYPE));
    }
    return { ok: true, items: selected };
  }

  private async executePhase(
    instance: TaskInstanceRecord,
    options?: { userConfirmed?: boolean },
  ): Promise<TaskInstanceRecord> {
    const { crypto, connectors } = this.deps;
    await this.transition(instance, "executing");

    // Materialize context and emit the inference-transmission audit event -
    // the single recorded exit for local context (04 section 7.3). Hashes and
    // metadata only, never content.
    let gatewayInputs: Record<string, unknown>;
    let transmissionItems: Array<Record<string, unknown>>;
    if (instance.contextSet) {
      const byType: Record<string, Array<{ name: string; content: string }>> = {};
      transmissionItems = [];
      for (const meta of instance.contextSet) {
        const connector = connectors.get(metaConnector(meta));
        if (!connector) {
          return this.fail(instance, `connector for item "${meta.id}" unavailable`);
        }
        const item = await connector.read(meta);
        (byType[item.type] ??= []).push({ name: item.name, content: item.content });
        transmissionItems.push({
          id: item.id,
          type: item.type,
          source: item.source,
          content_hash: `sha256:${crypto.sha256(item.content)}`,
          bytes: item.bytes,
        });
        await this.journal(instance, "context_read", { item: item.id });
      }
      gatewayInputs = byType;
    } else {
      const inputs = instance.inputs ?? {};
      gatewayInputs = inputs;
      transmissionItems = Object.entries(inputs).map(([type, value]) => ({
        id: type,
        type,
        source: "caller",
        content_hash: `sha256:${crypto.sha256(JSON.stringify(value))}`,
        bytes: JSON.stringify(value).length,
      }));
    }
    await this.audit(instance, "transmission.inference", {
      context_items: transmissionItems,
      destination: "vxture-inference",
      persistence: "none",
      confirmed_by: options?.userConfirmed ? "user" : "policy",
    });

    for (const capability of instance.definition.capabilities) {
      await this.journal(instance, "capability", { capability });
      await this.audit(instance, "capability.invoked", { capability });
      const result = await this.deps.gateway.invoke({
        capability,
        workspace: this.deps.workspaceId,
        taskInstance: instance.id,
        inputs: gatewayInputs,
      });
      instance.capabilityOutputs[capability] = result.content;
      await this.persist(instance);
      await this.audit(instance, "capability.completed", { capability });
    }
    return this.verifyPhase(instance, gatewayInputs);
  }

  private async verifyPhase(
    instance: TaskInstanceRecord,
    gatewayInputs: Record<string, unknown>,
  ): Promise<TaskInstanceRecord> {
    await this.transition(instance, "verifying");
    for (const rule of instance.definition.verification) {
      await this.audit(instance, "verification.run", {
        rule: rule.id,
        kind: rule.kind,
      });
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
          inputs: gatewayInputs,
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
      instance.checkpoint = { kind: "verification_review" };
      await this.transition(instance, "waiting_human");
      await this.audit(instance, "checkpoint.raised", {
        kind: "verification_review",
        rules: pending.map((v) => v.id),
      });
      return instance;
    }
    return this.finalize(instance);
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

function jsonArray<T>(raw: string | undefined): T[] {
  return raw ? (JSON.parse(raw) as T[]) : [];
}

/** Connector id an item was discovered through (by source convention). */
function metaConnector(meta: ContextItemMeta): string {
  return meta.source === "local" ? "local-fs" : meta.source;
}
