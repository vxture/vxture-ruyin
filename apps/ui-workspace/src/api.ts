/**
 * Typed client over the daemon's Local API. The session token arrives via
 * ?token= (shell) or is pasted once (browser access) and is held in memory.
 */

/**
 * 受管产品资产（daemon /products）。已安装 ≠ 可用：
 * availability = installed ∧ enabled ∧ entitled ≠ false（30-contract-schema §18.5）。
 * entitled 为 null 表示未知（未登录或订阅数据面未接通），此时按可用处理。
 */
export interface ProductInfo {
  id: string;
  name: string;
  version: string;
  installed: boolean;
  enabled: boolean;
  entitled: boolean | null;
  availability: "available" | "disabled" | "not_entitled";
  reason?: string;
}

export interface ProjectMeta {
  id: string;
  productId: string;
  productVersion: string;
  name: string;
  projectType: string;
  createdAt: string;
  /**
   * 所属平台工作区（ADR-015）。缺失 = attribution 之前写下的记录，属**待导入
   * 队列**而非一种受支持的状态。新建的项目一律有值。
   */
  workspaceId?: string;
}

/**
 * 更新检查结果（daemon /updates/check）。**`current` 只在真拉到 feed 并比对过
 * 之后才会出现**——查不到就是 `unreachable`，不是「已是最新」。
 */
export interface InstallGate {
  installable: boolean;
  /** 不可安装时的人可读原因。 */
  reason?: string;
  runningTasks: number;
}

export type UpdateCheck = (
  | { status: "current"; current: string; latest: string; checkedAt: string }
  | {
      status: "available";
      current: string;
      latest: string;
      releasedAt?: string;
      checkedAt: string;
    }
  | { status: "unreachable"; current: string; reason: string; checkedAt: string }
) & { gate: InstallGate };

/**
 * `GET /projects` 的形状。`elsewhere` 只报**数量不报名字**：隔离要照做，但
 * 「切换一下项目全没了」在用户那里和「数据丢了」分不开。
 */
export interface ProjectList {
  items: ProjectMeta[];
  elsewhere: number;
}

/**
 * 跨项目的「在等我」（daemon /pending）。任务停在等人那一刻若无人知晓，等于
 * 没停 —— 而未决确认原先只在它所属的那一个任务界面里看得到。
 */
export interface PendingConfirmation {
  projectId: string;
  projectName: string;
  productId: string;
  taskInstanceId: string;
  taskId: string;
  checkpointId: string;
  kind: "context_confirm" | "verification_review" | "tool_ask";
  raisedAt: string;
}

export interface TaskDef {
  id: string;
  objective: string;
  input_types: string[];
}

export interface StateItem {
  name: string;
  transitions: Array<{ to: string; confirm?: "human" }>;
}

export interface ProjectView {
  meta: ProjectMeta;
  businessState: string;
  product: { id: string; name: string; version: string };
  tasks: TaskDef[];
  states?: { object: string; initial: string; items: StateItem[] };
}

export interface ContextItemMeta {
  id: string;
  type: string;
  source: string;
  name: string;
  bytes: number;
  modifiedAt: string;
}

export interface VerificationOutcome {
  id: string;
  kind: string;
  status: "passed" | "failed" | "pending_human";
  note?: string;
}

export type CheckpointKind =
  | "context_confirm"
  | "verification_review"
  | "tool_ask";

export interface Checkpoint {
  id: string;
  kind: CheckpointKind;
  subject: unknown;
  options: Array<"approve" | "reject" | "modify">;
  raisedAt: string;
  decision?: { by: string; choice: string; at: string };
}

/** The confirmation in front of the user, if any. */
export function pendingCheckpoint(
  instance: TaskInstance,
): Checkpoint | undefined {
  return instance.checkpoints?.find((c) => !c.decision);
}

export interface TaskInstance {
  id: string;
  taskId: string;
  state: string;
  /** Confirmation queue, oldest first; undecided entries are still waiting. */
  checkpoints: Checkpoint[];
  contextSet?: ContextItemMeta[];
  verification: VerificationOutcome[];
  capabilityOutputs: Record<string, string>;
  result?: { content: Record<string, string>; sources: string[] };
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FolderGrant {
  id: string;
  path: string;
  mode: string;
  createdAt: string;
}

export interface Binding {
  type: string;
  root: string;
  connector: string;
}

export interface AuditEvent {
  event_id: string;
  workspace: string;
  kind: string;
  actor: string;
  timestamp: string;
  task_instance?: string;
  prev_hash: string;
  hash: string;
  payload: unknown;
}

export interface SessionInfo {
  signedIn: boolean;
  profile?: { sub: string; name?: string; email?: string; picture?: string };
  org?: { id?: string; name?: string };
  workspace?: { id?: string; name?: string };
  issuer: string;
  consoleBase: string;
  entitlementsConfigured: boolean;
}

/** C2 envelope (integration spec; consumed read-only, never persisted). */
export interface EntitlementEnvelope {
  status: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  data_retention_until: string | null;
  tier: string | null;
  bundled: boolean;
  limits: Record<string, number>;
  quota_pools: Array<{
    metric: string;
    limit: number;
    remaining: number;
    priority: number;
  }>;
}

export interface EntitlementsBatch {
  workspace_id: string;
  entitlements: Record<string, EntitlementEnvelope>;
}

export interface SystemInfo {
  version: string;
  platform: string;
  arch: string;
  dataDir: string;
  productsDir: string;
  keyProtection: "dpapi" | "plaintext";
  startedAt: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: { error?: string; message?: string; details?: unknown },
  ) {
    super(body.message ?? body.error ?? `HTTP ${status}`);
  }
}

export class Api {
  constructor(private readonly token: string) {}

  private async call<T>(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(path, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json()) as T;
    if (!res.ok) {
      throw new ApiError(res.status, data as ApiError["body"]);
    }
    return data;
  }

  pending = () => this.call<PendingConfirmation[]>("/pending");
  checkUpdate = () => this.call<UpdateCheck>("/updates/check");
  /** 记下安装意图（策略 2：操作与时机都归用户）。守护进程会再判一次闸门。 */
  requestInstall = (version: string) =>
    this.call<{ version: string; requestedAt: string }>(
      "/updates/install",
      "POST",
      { version },
    );
  products = () => this.call<ProductInfo[]>("/products");
  projects = () => this.call<ProjectList>("/projects");
  createProject = (product: string, name: string) =>
    this.call<ProjectMeta>("/projects", "POST", { product, name });
  /** 把 attribution 之前的项目导入当前工作区（ADR-015）。 */
  importProject = (id: string) =>
    this.call<ProjectMeta>(`/projects/${id}/import`, "POST");
  workspace = (id: string) => this.call<ProjectView>(`/projects/${id}`);
  taskInstances = (id: string) =>
    this.call<TaskInstance[]>(`/projects/${id}/tasks`);
  startTask = (id: string, task: string, inputs?: Record<string, unknown>) =>
    this.call<TaskInstance>(`/projects/${id}/tasks`, "POST", {
      task,
      ...(inputs !== undefined ? { inputs } : {}),
    });
  cancelTask = (id: string, taskInstance: string) =>
    this.call<TaskInstance>(
      `/projects/${id}/tasks/${taskInstance}/cancel`,
      "POST",
    );
  decide = (id: string, taskInstance: string, approve: boolean) =>
    this.call<TaskInstance>(
      `/projects/${id}/tasks/${taskInstance}/decision`,
      "POST",
      { approve },
    );
  transition = (id: string, to: string, humanConfirmed: boolean) =>
    this.call<{ businessState: string }>(`/projects/${id}/state`, "POST", {
      to,
      humanConfirmed,
    });
  grants = (id: string) => this.call<FolderGrant[]>(`/projects/${id}/grants`);
  addGrant = (id: string, path: string) =>
    this.call<FolderGrant>(`/projects/${id}/grants`, "POST", { path });
  bindings = (id: string) => this.call<Binding[]>(`/projects/${id}/bindings`);
  setBinding = (id: string, type: string, root: string) =>
    this.call<Binding & { indexed: number }>(
      `/projects/${id}/bindings`,
      "POST",
      { type, root },
    );
  audit = (id: string) => this.call<AuditEvent[]>(`/projects/${id}/audit`);
  contextItems = (id: string, type: string) =>
    this.call<ContextItemMeta[]>(`/projects/${id}/context/${type}`);
  system = () => this.call<SystemInfo>("/system");
  session = () => this.call<SessionInfo>("/auth/session");
  login = () => this.call<{ authorizeUrl: string }>("/auth/login", "POST");
  logout = () => this.call<{ ok: boolean }>("/auth/logout", "POST");
  entitlements = (products: string[]) =>
    this.call<EntitlementsBatch>(
      `/entitlements?products=${encodeURIComponent(products.join(","))}`,
    );
}
