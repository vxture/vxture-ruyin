/**
 * Typed client over the daemon's Local API. The session token arrives via
 * ?token= (shell) or is pasted once (browser access) and is held in memory.
 */

export interface ProductInfo {
  id: string;
  name: string;
  version: string;
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
}
