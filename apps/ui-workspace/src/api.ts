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

export interface WorkspaceMeta {
  id: string;
  productId: string;
  productVersion: string;
  name: string;
  workspaceType: string;
  createdAt: string;
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

export interface WorkspaceView {
  meta: WorkspaceMeta;
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

export interface TaskInstance {
  id: string;
  taskId: string;
  state: string;
  checkpoint?: { kind: "context_confirm" | "verification_review" };
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

  products = () => this.call<ProductInfo[]>("/products");
  workspaces = () => this.call<WorkspaceMeta[]>("/workspaces");
  createWorkspace = (product: string, name: string) =>
    this.call<WorkspaceMeta>("/workspaces", "POST", { product, name });
  workspace = (id: string) => this.call<WorkspaceView>(`/workspaces/${id}`);
  taskInstances = (id: string) =>
    this.call<TaskInstance[]>(`/workspaces/${id}/tasks`);
  startTask = (id: string, task: string, inputs?: Record<string, unknown>) =>
    this.call<TaskInstance>(`/workspaces/${id}/tasks`, "POST", {
      task,
      ...(inputs !== undefined ? { inputs } : {}),
    });
  decide = (id: string, taskInstance: string, approve: boolean) =>
    this.call<TaskInstance>(
      `/workspaces/${id}/tasks/${taskInstance}/decision`,
      "POST",
      { approve },
    );
  transition = (id: string, to: string, humanConfirmed: boolean) =>
    this.call<{ businessState: string }>(`/workspaces/${id}/state`, "POST", {
      to,
      humanConfirmed,
    });
  grants = (id: string) => this.call<FolderGrant[]>(`/workspaces/${id}/grants`);
  addGrant = (id: string, path: string) =>
    this.call<FolderGrant>(`/workspaces/${id}/grants`, "POST", { path });
  bindings = (id: string) => this.call<Binding[]>(`/workspaces/${id}/bindings`);
  setBinding = (id: string, type: string, root: string) =>
    this.call<Binding & { indexed: number }>(
      `/workspaces/${id}/bindings`,
      "POST",
      { type, root },
    );
  audit = (id: string) => this.call<AuditEvent[]>(`/workspaces/${id}/audit`);
  contextItems = (id: string, type: string) =>
    this.call<ContextItemMeta[]>(`/workspaces/${id}/context/${type}`);
  system = () => this.call<SystemInfo>("/system");
  session = () => this.call<SessionInfo>("/auth/session");
  login = () => this.call<{ authorizeUrl: string }>("/auth/login", "POST");
  logout = () => this.call<{ ok: boolean }>("/auth/logout", "POST");
  entitlements = (products: string[]) =>
    this.call<EntitlementsBatch>(
      `/entitlements?products=${encodeURIComponent(products.join(","))}`,
    );
}
