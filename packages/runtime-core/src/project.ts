/**
 * Workspace Runtime - workspace-scoped, long-lived kernel surface.
 * Design authority: docs/30-design/10-workspace-runtime.md section 7.
 *
 * Owns workspace lifecycle (create/open/list), the business state machine
 * (contract-declared, human-confirm transitions enforced), and acts as the
 * Harness factory. Contract validation is re-run on create: the kernel is the
 * last line of defense regardless of what the host already checked.
 */

import {
  validateContract,
  type RuyinContract,
  type ValidationError,
} from "@vxture/ruyin-contract-schema";
import { emitAudit } from "./audit.js";
import {
  Harness,
  interruptedResumePoint,
  pendingCheckpoint,
  type CheckpointKind,
  type TaskInstanceRecord,
} from "./harness.js";

/** One thing waiting on a person, with enough to find it. */
export interface PendingConfirmation {
  projectId: string;
  projectName: string;
  productId: string;
  taskInstanceId: string;
  taskId: string;
  checkpointId: string;
  kind: CheckpointKind;
  raisedAt: string;
}
import type {
  AuditEvent,
  Binding,
  ContextItemMeta,
  FolderGrant,
  RuntimePorts,
  ProjectMeta,
  ProjectStore,
} from "./ports.js";

function parseJsonArray<T>(raw: string | undefined): T[] {
  return raw ? (JSON.parse(raw) as T[]) : [];
}

/** Normalized prefix containment; grants are folder roots (04 section 4.3). */
export function isPathGranted(path: string, grants: FolderGrant[]): boolean {
  const norm = (p: string) =>
    p.replaceAll("\\", "/").toLowerCase().replace(/\/+$/, "") + "/";
  const target = norm(path);
  return grants.some((g) => target.startsWith(norm(g.path)));
}

export class ContractInvalidError extends Error {
  constructor(public readonly errors: ValidationError[]) {
    super(
      `contract failed validation: ${errors
        .map((e) => `${e.rule} ${e.path}`)
        .join("; ")}`,
    );
  }
}

export class ProjectNotFoundError extends Error {
  constructor(id: string) {
    super(`workspace "${id}" not found`);
  }
}

export class NeedsHumanConfirmationError extends Error {
  constructor(from: string, to: string) {
    super(
      `state transition ${from} -> ${to} is declared confirm: human and requires humanConfirmed: true`,
    );
  }
}

export interface ProjectView {
  meta: ProjectMeta;
  businessState: string;
  contract: RuyinContract;
}

export class ProjectRuntime {
  constructor(private readonly ports: RuntimePorts) {}

  async createProject(
    rawContract: unknown,
    name: string,
  ): Promise<ProjectMeta> {
    const validation = validateContract(rawContract);
    if (!validation.ok) {
      throw new ContractInvalidError(validation.errors);
    }
    const contract = rawContract as RuyinContract;
    // New containers get the `prj_` prefix. Existing `ws_` ids are NOT rewritten:
    // the audit chain''s genesis hash is sha256("genesis:" + id), so changing an
    // id would invalidate every chain already written. Ids are opaque, so the
    // two prefixes coexist without meaning anything.
    const id = this.ports.id.newId("prj");
    const store = await this.ports.storage.createProjectStore(id);
    const meta: ProjectMeta = {
      id,
      productId: contract.product.id,
      productVersion: contract.product.version,
      contractVersion: contract.contract,
      name,
      projectType: contract.project.type,
      createdAt: this.ports.clock.now(),
    };
    await store.putMeta(meta);
    await store.putContract(JSON.stringify(contract));
    await store.setBusinessState(contract.states.initial);
    await this.audit(store, id, "workspace.created", "user", {
      product: contract.product.id,
      productVersion: contract.product.version,
      name,
      initialState: contract.states.initial,
    });
    return meta;
  }

  async openProject(id: string): Promise<ProjectView> {
    const { store, meta, contract } = await this.load(id);
    const businessState =
      (await store.getBusinessState()) ?? contract.states.initial;
    return { meta, businessState, contract };
  }

  async listProjects(): Promise<ProjectMeta[]> {
    const out: ProjectMeta[] = [];
    for (const id of await this.ports.storage.listProjectIds()) {
      const store = await this.ports.storage.openProjectStore(id);
      const meta = await store?.getMeta();
      if (meta) out.push(meta);
    }
    return out;
  }

  /**
   * Business state transition per the contract's state machine
   * (docs/30-design/30-contract-schema.md section 8). Transitions declared
   * `confirm: human` refuse to run unless humanConfirmed is set.
   */
  async transitionBusinessState(
    id: string,
    to: string,
    options?: { humanConfirmed?: boolean },
  ): Promise<string> {
    const { store, contract } = await this.load(id);
    const current =
      (await store.getBusinessState()) ?? contract.states.initial;
    const item = contract.states.items.find((s) => s.name === current);
    const transition = item?.transitions.find((t) => t.to === to);
    if (!transition) {
      throw new Error(`illegal state transition ${current} -> ${to}`);
    }
    if (transition.confirm === "human" && !options?.humanConfirmed) {
      throw new NeedsHumanConfirmationError(current, to);
    }
    await store.setBusinessState(to);
    await this.audit(store, id, "state.writeback", "user", {
      from: current,
      to,
      humanConfirmed: transition.confirm === "human",
    });
    return to;
  }

  // -- Context configuration (docs/30-design/40-context-architecture.md) ----

  async listGrants(id: string): Promise<FolderGrant[]> {
    const { store } = await this.load(id);
    return parseJsonArray<FolderGrant>(await store.getGrants());
  }

  async addGrant(
    id: string,
    path: string,
    mode: FolderGrant["mode"] = "read",
  ): Promise<FolderGrant> {
    const { store } = await this.load(id);
    const grants = parseJsonArray<FolderGrant>(await store.getGrants());
    const grant: FolderGrant = {
      id: this.ports.id.newId("grant"),
      path,
      mode,
      createdAt: this.ports.clock.now(),
    };
    grants.push(grant);
    await store.putGrants(JSON.stringify(grants));
    await this.audit(store, id, "grant.changed", "user", {
      action: "added",
      path,
      mode,
    });
    return grant;
  }

  async listBindings(id: string): Promise<Binding[]> {
    const { store } = await this.load(id);
    return parseJsonArray<Binding>(await store.getBindings());
  }

  /**
   * Bind a contract context type to a local root. Validated against the
   * contract (type exists, allows the local source) and against the grants
   * (root must be inside a granted folder - the runtime never touches paths
   * the user did not grant, 04 section 4.3).
   */
  async setBinding(
    id: string,
    input: { type: string; root: string; connector?: string },
  ): Promise<Binding> {
    const { store, contract } = await this.load(id);
    const ctxType = contract.context.types.find((t) => t.id === input.type);
    if (!ctxType) {
      throw new Error(`context type "${input.type}" is not declared in the contract`);
    }
    if (!ctxType.sources.includes("local")) {
      throw new Error(`context type "${input.type}" does not allow the local source`);
    }
    const grants = parseJsonArray<FolderGrant>(await store.getGrants());
    if (!isPathGranted(input.root, grants)) {
      throw new Error(
        `binding root is outside every granted folder: ${input.root}`,
      );
    }
    const bindings = parseJsonArray<Binding>(await store.getBindings()).filter(
      (b) => b.type !== input.type,
    );
    const binding: Binding = {
      type: input.type,
      source: "local",
      connector: input.connector ?? "local-fs",
      root: input.root,
    };
    bindings.push(binding);
    await store.putBindings(JSON.stringify(bindings));
    await this.audit(store, id, "binding.changed", "user", {
      type: input.type,
      root: input.root,
    });
    return binding;
  }

  /**
   * Preview the items a binding currently resolves to (04 section 6.2
   * transparency: what the AI could see, the user can see - before any task
   * runs). Empty when the type has no binding.
   */
  async discoverContext(
    id: string,
    type: string,
  ): Promise<ContextItemMeta[]> {
    const { store } = await this.load(id);
    const bindings = parseJsonArray<Binding>(await store.getBindings());
    const binding = bindings.find((b) => b.type === type);
    if (!binding) return [];
    const grants = parseJsonArray<FolderGrant>(await store.getGrants());
    if (!isPathGranted(binding.root, grants)) {
      throw new Error(
        `binding for "${type}" points outside the granted folders (grant revoked?)`,
      );
    }
    const connector = this.ports.connectors?.get(binding.connector);
    if (!connector) {
      throw new Error(`connector "${binding.connector}" is not available`);
    }
    return connector.discover(binding);
  }

  /** Harness factory (docs/30-design/50-harness.md section 2). */
  async createHarness(id: string): Promise<Harness> {
    const { store, contract } = await this.load(id);
    return new Harness({
      store,
      contract,
      projectId: id,
      clock: this.ports.clock,
      id: this.ports.id,
      crypto: this.ports.crypto,
      gateway: this.ports.gateway,
      connectors: this.ports.connectors ?? new Map(),
      ranker: this.ports.ranker,
      tools: this.ports.tools,
      isCancelled: this.ports.isCancelled,
    });
  }

  async listAuditEvents(id: string): Promise<AuditEvent[]> {
    const { store } = await this.load(id);
    return store.listAuditEvents();
  }

  async listTaskInstances(id: string): Promise<TaskInstanceRecord[]> {
    const { store } = await this.load(id);
    const raw = await store.listTaskInstances();
    return raw.map((r) => JSON.parse(r) as TaskInstanceRecord);
  }

  /**
   * Instances a previous process died holding. Hosts sweep these on startup
   * and hand each to `Harness.recover` - without it an interrupted task stays
   * mid-flight forever, and the user sees a task that never finishes and
   * cannot be restarted.
   */
  async listInterruptedTasks(id: string): Promise<TaskInstanceRecord[]> {
    const instances = await this.listTaskInstances(id);
    return instances.filter((t) => interruptedResumePoint(t) !== null);
  }

  /**
   * Everything, across every project, currently waiting on a person.
   *
   * A task that stops for a confirmation nobody is told about has not stopped
   * for a person - it has just stopped. Until now a pending checkpoint was
   * only visible from inside the task that raised it, which means the user had
   * to already be looking at the one place that would have told them.
   *
   * Oldest first: the thing that has been blocked longest is the thing most
   * likely to be forgotten.
   *
   * The subject is not included. It can be large, and a list is for deciding
   * where to look - the full subject is shown at the decision point, which is
   * where "a confirmation the user cannot inspect is not a confirmation"
   * applies.
   */
  async listPendingConfirmations(): Promise<PendingConfirmation[]> {
    const out: PendingConfirmation[] = [];
    for (const project of await this.listProjects()) {
      let instances: TaskInstanceRecord[];
      try {
        instances = await this.listTaskInstances(project.id);
      } catch {
        // One unreadable project must not blank the whole list: a partial
        // answer still gets the user to the other confirmations.
        continue;
      }
      for (const instance of instances) {
        const checkpoint = pendingCheckpoint(instance);
        if (!checkpoint) continue;
        out.push({
          projectId: project.id,
          projectName: project.name,
          productId: project.productId,
          taskInstanceId: instance.id,
          taskId: instance.taskId,
          checkpointId: checkpoint.id,
          kind: checkpoint.kind,
          raisedAt: checkpoint.raisedAt,
        });
      }
    }
    return out.sort((a, b) => a.raisedAt.localeCompare(b.raisedAt));
  }

  // -------------------------------------------------------------------------

  private async load(id: string): Promise<{
    store: ProjectStore;
    meta: ProjectMeta;
    contract: RuyinContract;
  }> {
    const store = await this.ports.storage.openProjectStore(id);
    if (!store) throw new ProjectNotFoundError(id);
    const meta = await store.getMeta();
    const contractJson = await store.getContract();
    if (!meta || !contractJson) throw new ProjectNotFoundError(id);
    return { store, meta, contract: JSON.parse(contractJson) as RuyinContract };
  }

  private audit(
    store: ProjectStore,
    workspace: string,
    kind: string,
    actor: "harness" | "user" | "system",
    payload: unknown,
  ): Promise<unknown> {
    return emitAudit(store, this.ports.crypto, this.ports.clock, this.ports.id, {
      workspace,
      kind,
      actor,
      payload,
    });
  }
}
