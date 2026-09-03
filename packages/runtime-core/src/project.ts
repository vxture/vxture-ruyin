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
import {
  emitAudit,
  OUTCOME_MUST_BE_STATED,
  RUNTIME_ACTOR,
} from "./audit.js";
import { buildProjectExport, type ProjectExport } from "./export.js";
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
  AuditOutcome,
  Binding,
  StoredAuditEvent,
  ConnectorGrant,
  ContextItemMeta,
  ContextSource,
  FolderGrant,
  Grant,
  RuntimePorts,
  ProjectMeta,
  ProjectStore,
} from "./ports.js";

function parseJsonArray<T>(raw: string | undefined): T[] {
  return raw ? (JSON.parse(raw) as T[]) : [];
}

/**
 * 选择期复核：绑定建立时对得上的授权，现在还对得上吗。对不上就给出原因 ——
 * 目录授权撤了、或连接器授权撤了，是两句不同的话，用户去不同的地方解决。
 */
export function bindingRevoked(binding: Binding, grants: Grant[]): string | undefined {
  if (binding.connector === LOCAL_FS) {
    return isPathGranted(binding.root, grants)
      ? undefined
      : `binding for "${binding.type}" points outside the granted folders (grant revoked?)`;
  }
  return hasConnectorGrant(binding.connector, grants)
    ? undefined
    : `binding for "${binding.type}" uses connector "${binding.connector}" which this project no longer grants (grant revoked?)`;
}

/** Normalized prefix containment; grants are folder roots (04 section 4.3). */
/** 内建文件连接器的 id。目录授权只对它成立；其余连接器走连接器授权。 */
export const LOCAL_FS = "local-fs";

/** 文件夹授权没有 `kind`（先于连接器授权存在，旧记录不回填）。 */
export function isFolderGrant(grant: Grant): grant is FolderGrant {
  return !("kind" in grant);
}

export function folderGrants(grants: Grant[]): FolderGrant[] {
  return grants.filter(isFolderGrant);
}

/** 这个项目授权过该连接器吗（ADR-005：授权以项目为边界）。 */
export function hasConnectorGrant(connector: string, grants: Grant[]): boolean {
  return grants.some((g) => !isFolderGrant(g) && g.connector === connector);
}

export function isPathGranted(path: string, grants: Grant[]): boolean {
  const norm = (p: string) =>
    p.replaceAll("\\", "/").toLowerCase().replace(/\/+$/, "") + "/";
  const target = norm(path);
  return folderGrants(grants).some((g) => target.startsWith(norm(g.path)));
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

/** No workspace to put a project in - the caller is not signed in to one. */
export class NoWorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoWorkspaceError";
  }
}

/** Attribution already settled; changing it is not an import (ADR-015). */
export class AlreadyAttributedError extends Error {
  constructor(id: string, workspaceId: string) {
    super(`project "${id}" already belongs to workspace "${workspaceId}"`);
    this.name = "AlreadyAttributedError";
  }
}

export interface ProjectView {
  meta: ProjectMeta;
  businessState: string;
  contract: RuyinContract;
}

export class ProjectRuntime {
  constructor(private readonly ports: RuntimePorts) {}

  /**
   * Create a project inside a workspace.
   *
   * `workspaceId` is required, and that is the whole point: a project with no
   * workspace is not a supported state (ADR-015). Making it a parameter rather
   * than something inferred later means the invariant is held by the type -
   * there is no code path that produces an unattributed project, so there is
   * none to audit later.
   */
  async createProject(
    rawContract: unknown,
    name: string,
    workspaceId: string,
  ): Promise<ProjectMeta> {
    if (!workspaceId) {
      throw new NoWorkspaceError(
        "a project must belong to a workspace; sign in and select one first",
      );
    }
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
      workspaceId,
    };
    await store.putMeta(meta);
    await store.putContract(JSON.stringify(contract));
    await store.setBusinessState(contract.states.initial);
    // 事件名也是 action（X-3）。`workspace` 这个词已让给平台（ADR-007），
    // 本地容器叫项目 —— 旧记录里的 workspace.created 不回写，新记录用新名字。
    await this.audit(store, id, "project.created", "user", {
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

  async listGrants(id: string): Promise<Grant[]> {
    const { store } = await this.load(id);
    return parseJsonArray<Grant>(await store.getGrants());
  }

  async addGrant(
    id: string,
    path: string,
    mode: FolderGrant["mode"] = "read",
  ): Promise<FolderGrant> {
    const { store } = await this.load(id);
    const grants = parseJsonArray<Grant>(await store.getGrants());
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

  /**
   * 授权本项目使用一个连接器（ADR-005：授权以项目为边界，与文件夹授权同级）。
   *
   * 连接器必须已经装在宿主上 —— 授权一个不存在的东西不是「提前授权」，是一条
   * 永远对不上的记录。授权本身不启动任何读取；读发生在绑定与选择那一步。
   */
  async addConnectorGrant(id: string, connector: string): Promise<ConnectorGrant> {
    if (connector === LOCAL_FS) {
      throw new Error("local-fs is granted per folder, not as a connector");
    }
    if (!this.ports.connectors?.get(connector)) {
      throw new Error(`connector "${connector}" is not installed`);
    }
    const { store } = await this.load(id);
    const grants = parseJsonArray<Grant>(await store.getGrants());
    if (hasConnectorGrant(connector, grants)) {
      throw new Error(`connector "${connector}" is already granted to this project`);
    }
    const grant: ConnectorGrant = {
      id: this.ports.id.newId("grant"),
      kind: "connector",
      connector,
      mode: "read",
      createdAt: this.ports.clock.now(),
    };
    grants.push(grant);
    await store.putGrants(JSON.stringify(grants));
    await this.audit(store, id, "grant.changed", "user", {
      action: "added",
      connector,
      mode: "read",
    });
    return grant;
  }

  async listBindings(id: string): Promise<Binding[]> {
    const { store } = await this.load(id);
    return parseJsonArray<Binding>(await store.getBindings());
  }

  /**
   * Bind a contract context type to a root inside a connector. Validated
   * against the contract (type exists, allows this source kind) and against
   * the grants: a local-fs root must be inside a granted folder (the runtime
   * never touches paths the user did not grant, 04 section 4.3); any other
   * connector must be granted to this project (ADR-005). Both are re-checked
   * at selection time - a grant revoked later invalidates the binding.
   */
  async setBinding(
    id: string,
    input: {
      type: string;
      root: string;
      connector?: string;
      source?: ContextSource;
    },
  ): Promise<Binding> {
    const { store, contract } = await this.load(id);
    const ctxType = contract.context.types.find((t) => t.id === input.type);
    if (!ctxType) {
      throw new Error(`context type "${input.type}" is not declared in the contract`);
    }
    const connector = input.connector ?? LOCAL_FS;
    const source: ContextSource = input.source ?? "local";
    if (!ctxType.sources.includes(source)) {
      throw new Error(`context type "${input.type}" does not allow the ${source} source`);
    }
    const grants = parseJsonArray<Grant>(await store.getGrants());
    if (connector === LOCAL_FS) {
      if (!isPathGranted(input.root, grants)) {
        throw new Error(
          `binding root is outside every granted folder: ${input.root}`,
        );
      }
    } else {
      if (!this.ports.connectors?.get(connector)) {
        throw new Error(`connector "${connector}" is not installed`);
      }
      if (!hasConnectorGrant(connector, grants)) {
        throw new Error(`connector "${connector}" is not granted to this project`);
      }
    }
    const bindings = parseJsonArray<Binding>(await store.getBindings()).filter(
      (b) => b.type !== input.type,
    );
    const binding: Binding = {
      type: input.type,
      source,
      connector,
      root: input.root,
    };
    bindings.push(binding);
    await store.putBindings(JSON.stringify(bindings));
    await this.audit(store, id, "binding.changed", "user", {
      type: input.type,
      root: input.root,
      connector,
      source,
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
    const grants = parseJsonArray<Grant>(await store.getGrants());
    const revoked = bindingRevoked(binding, grants);
    if (revoked) throw new Error(revoked);
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

  /**
   * 审计事件，**按存储原样返回**（可能含 X-3 之前的旧形状）。
   *
   * 链校验必须拿原样的记录 —— 哈希是按存进去时的字段名算的。要统一词表给
   * 消费方看，用 `toAuditView` 投影，**别回写存储**。
   */
  async listAuditEvents(id: string): Promise<StoredAuditEvent[]> {
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
  /**
   * Import a project written before attribution existed into a workspace.
   *
   * Only ever fills a blank. Re-homing an already-attributed project would
   * move data across a subscription and entitlement boundary, which is a
   * different operation with different consequences - and one an "import"
   * button must not quietly perform. It is refused here rather than guarded
   * at the caller, because the next caller would have to remember.
   */
  async importProject(id: string, workspaceId: string): Promise<ProjectMeta> {
    if (!workspaceId) {
      throw new NoWorkspaceError(
        "a project must belong to a workspace; sign in and select one first",
      );
    }
    const { store, meta } = await this.load(id);
    if (meta.workspaceId) {
      throw new AlreadyAttributedError(id, meta.workspaceId);
    }
    const updated: ProjectMeta = { ...meta, workspaceId };
    await store.putMeta(updated);
    await this.audit(store, id, "project.imported", "user", { workspaceId });
    return updated;
  }

  /**
   * 组装一份项目导出，并把这次导出记进审计（TD-020）。
   *
   * 内核出包、宿主落盘：装什么、怎么绑定摘要、留什么痕，都是运行时的规矩；
   * 把字节写到哪个目录是宿主的事（内核不许引 Node API）。
   *
   * **导出本身是一次数据离开本机的事件**，所以它自己也要进链——成败都记。
   */
  async exportProject(
    id: string,
    opts: { runtimeVersion: string },
  ): Promise<ProjectExport> {
    const { store } = await this.load(id);
    const bundle = await buildProjectExport(store, this.ports.crypto, id, {
      runtimeVersion: opts.runtimeVersion,
      exportedAt: this.ports.clock.now(),
    });
    return bundle;
  }

  /** 记一条导出结果。宿主写完盘才知道成没成，所以分两步。 */
  async auditExport(
    id: string,
    detail: { path: string; files: string[]; events: number },
    outcome: AuditOutcome,
  ): Promise<void> {
    const { store } = await this.load(id);
    await this.audit(store, id, "project.exported", "user", detail, outcome);
  }

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
    outcome: AuditOutcome = "success",
  ): Promise<unknown> {
    if (OUTCOME_MUST_BE_STATED.has(kind)) {
      throw new Error(`audit "${kind}": outcome must be stated here`);
    }
    return emitAudit(store, this.ports.crypto, this.ports.clock, this.ports.id, {
      workspace,
      kind,
      actor,
      // 项目级写操作都由用户动作触发，但这一层拿不到会话身份 —— 宿主在
      // API 边界上知道谁在调，内核不知道。填运行时常量而不是编一个 sub。
      actorId: RUNTIME_ACTOR,
      outcome,
      payload,
    });
  }
}
