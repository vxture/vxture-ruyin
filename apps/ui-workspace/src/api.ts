/**
 * Typed client over the daemon's Local API. The session token arrives via
 * ?token= (shell) or is pasted once (browser access) and is held in memory.
 */

import { extractSseEvents } from "./sse";

/**
 * 受管产品资产（daemon /products）。已安装 ≠ 可用：
 * availability = installed ∧ state=active ∧ entitled ≠ false（30-contract-schema §18.5）。
 * entitled 为 null 表示未知（未登录或订阅数据面未接通），此时按可用处理。
 */
export interface ProductInfo {
  id: string;
  name: string;
  version: string;
  installed: boolean;
  /** 本机生效态（通则 B-3：单一 state 字符串枚举，不用布尔）。 */
  state: "active" | "inactive";
  entitled: boolean | null;
  availability: "available" | "disabled" | "not_entitled";
  reason?: string;
  /**
   * C2 信封的订阅事实（daemon 保真投影，TD-014 D4）。null = 未知。
   * **不含配额**：配额归 SaaS，Ruyin 不读不执行不展示。
   */
  subscription: {
    status: string | null;
    tier: string | null;
    bundled: boolean;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  /**
   * 该显示哪个商业入口，或 null = 不显示。
   *
   * **由 daemon 判定，界面不重算**：界面门控（tier != null）与数据面门控
   * （tier != null || bundled）是两个公式，混用会让被捆绑覆盖的产品显示一个
   * 不该给用户的订阅动作。
   */
  commercialIntent: "subscribe" | "renew" | null;
  /** 库中并存的全部版本（§18.4 保留旧版本用于回滚）；内置产品为单版本。 */
  versions: string[];
  /** true = 来自受管产品库（拉取或安装）；false = 内置/开发目录。 */
  managed: boolean;
  /**
   * 当前生效版本是怎么来的（ADR-012 两级供给）。「拉了一份契约」与「装了一个
   * 含本地技能的包」在信任上不是一回事，界面与审计都需要分得开。
   */
  supply: "contract_fetch" | "package" | "builtin";
}

/** 一次安装的结果。`signed` 要照实说 —— 未签名的包是另一回事。 */
export interface InstalledPackage {
  productId: string;
  version: string;
  signed: boolean;
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

export type UpdateCheck =
  | {
      status: "current";
      current: string;
      latest: string;
      channel: string;
      checkedAt: string;
    }
  | {
      status: "available";
      current: string;
      latest: string;
      releasedAt?: string;
      /** 安装包地址，由守护进程从 feed 自己的 path 拼出。缺 path 时没有这个字段。 */
      downloadUrl?: string;
      /** stable / beta。不写明渠道的下载链接是有害的。 */
      channel: string;
      checkedAt: string;
    }
  | {
      status: "unreachable";
      current: string;
      reason: string;
      channel: string;
      checkedAt: string;
    };

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
  /**
   * 本机跑不了的工具。非空 = 这个任务在这台机器上启动不了，运行时会当场拒绝。
   * 界面据此提前禁用，而不是让人点下去才知道。
   */
  unrunnable: string[];
}

/** 一次导出的结果。`signed` 是要照实说给用户的那一项。 */
export interface ProjectExport {
  path: string;
  files: string[];
  chain: { genesis: string; head: string; events: number };
  /** 客户端零密钥，所以现在恒为 false：**可验篡改，不可归属**。 */
  signed: boolean;
}

/** 运行时事件（daemon /events）。只说什么变了，不带业务数据。 */
export type RuntimeEvent =
  | { kind: "task"; projectId: string; taskInstance: string }
  | { kind: "pending" };

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

/**
 * 审计记录，**存储里的原样**（X-3 词表）。
 *
 * 不是投影后的视图：界面要在本地重算哈希链，而链的哈希是按存进去时的字段名
 * 算的 —— 投影一次字段名就变一次，重算必然对不上。
 */
export interface AuditEvent {
  eventId: string;
  occurredAt: string;
  actorId: string;
  actorConsole: null;
  actor: string;
  objectType: string;
  objectId: string;
  action: string;
  outcome: "success" | "rejected" | "failed" | "unknown";
  workspace: string;
  taskId?: string;
  prevHash: string;
  hash: string;
  payload: unknown;
}

/**
 * X-3 改名之前写下的记录。**读得出来，绝不回写** —— 改写既有记录会作废每一条链。
 */
export interface LegacyAuditEvent {
  event_id: string;
  workspace: string;
  task_instance?: string;
  kind: string;
  actor: string;
  timestamp: string;
  prev_hash: string;
  hash: string;
  payload: unknown;
}

export type StoredAuditEvent = AuditEvent | LegacyAuditEvent;

export function isLegacyAuditEvent(
  event: StoredAuditEvent,
): event is LegacyAuditEvent {
  return typeof (event as LegacyAuditEvent).event_id === "string";
}

/** 两种形状统一成一套字段名，**只用于显示**，绝不用于重算哈希。 */
export function auditView(event: StoredAuditEvent): {
  eventId: string;
  occurredAt: string;
  action: string;
  actor: string;
  outcome: string;
  taskId?: string;
  hash: string;
  payload: unknown;
} {
  if (!isLegacyAuditEvent(event)) return event;
  return {
    eventId: event.event_id,
    occurredAt: event.timestamp,
    action: event.kind,
    actor: event.actor,
    // 旧记录不知道结果。**不猜** —— 把一条不知道结果的记录标成成功，正是审计
    // 存在的意义所要防的那种事。
    outcome: "unknown",
    ...(event.task_instance !== undefined ? { taskId: event.task_instance } : {}),
    hash: event.hash,
    payload: event.payload,
  };
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

  /**
   * 安装一个 .ruyinpkg（§18.2）。请求体就是包字节。
   *
   * 走 file input 而不是原生对话框：**同一个页面在浏览器和壳里都要能用**
   * （Local Web 访问模式是从第一天起就成立的约束）。壳里 file input 一样弹
   * 系统选择框，少一条只有壳能走的路。
   */
  installPackage = async (file: File): Promise<InstalledPackage> => {
    const res = await fetch("/products/install", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/octet-stream",
      },
      body: await file.arrayBuffer(),
    });
    const data = (await res.json()) as InstalledPackage;
    if (!res.ok) throw new ApiError(res.status, data as ApiError["body"]);
    return data;
  };
  pending = () => this.call<PendingConfirmation[]>("/pending");
  /** 立刻拉一次订阅（D5：用户付完款回到应用的那一刻）。 */
  refreshEntitlements = () =>
    this.call<ProductInfo[]>("/entitlements/refresh", "POST");
  /**
   * 本机生效开关（§18.5）。**不卸载，数据不动** —— 停用只是让这台机器上打不开
   * 它；项目、审计、成果都还在，重新启用就回来。
   *
   * 通则 B-3：动作是 activate / deactivate，状态是一个 `state` 字符串，
   * 不用布尔取反。
   */
  activateProduct = (id: string) =>
    this.call<ProductInfo>(`/products/${id}/activate`, "POST");
  deactivateProduct = (id: string) =>
    this.call<ProductInfo>(`/products/${id}/deactivate`, "POST");
  /** 钉住生效版本（§18.4 回滚）。库里保留着旧版本，这是把它切回去的动作。 */
  pinProductVersion = (id: string, version: string) =>
    this.call<ProductInfo>(`/products/${id}/pin-version`, "POST", { version });
  /**
   * 订阅运行时事件（TD-027）。返回一个取消函数。
   *
   * 用 fetch + ReadableStream 而不是 EventSource：EventSource 设不了请求头，
   * 会话令牌就只能塞进 URL —— 令牌不该出现在 URL 里。
   *
   * **调用方仍要保留一个慢轮询兜底**：流断了的样子是「一直没有事件」，
   * 而那和「一切正常」长得一模一样。
   */
  subscribe = (onEvent: (event: RuntimeEvent) => void): (() => void) => {
    const abort = new AbortController();
    void (async () => {
      try {
        const res = await fetch("/events", {
          headers: { authorization: `Bearer ${this.token}` },
          signal: abort.signal,
        });
        if (!res.ok || !res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          const chunk = decoder.decode(value, { stream: true });
          const parsed = extractSseEvents<RuntimeEvent>(buffer, chunk);
          buffer = parsed.buffer;
          for (const event of parsed.events) onEvent(event);
        }
      } catch {
        // 断了就断了：兜底轮询还在，界面不会停在旧数据上。
      }
    })();
    return () => abort.abort();
  };
  checkUpdate = () => this.call<UpdateCheck>("/updates/check");
  products = () => this.call<ProductInfo[]>("/products");
  projects = () => this.call<ProjectList>("/projects");
  createProject = (product: string, name: string) =>
    this.call<ProjectMeta>("/projects", "POST", { product, name });
  /** 把 attribution 之前的项目导入当前工作区（ADR-015）。 */
  importProject = (id: string) =>
    this.call<ProjectMeta>(`/projects/${id}/import`, "POST");
  /**
   * 导出项目记录（TD-020）。**§18.5 那句「本地数据仍可访问、可导出」，可导出
   * 的那一半在此之前界面上无处可点** —— 端点在，用户够不着，等于没有。
   */
  exportProject = (id: string, path: string) =>
    this.call<ProjectExport>(`/projects/${id}/export`, "POST", { path });
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
  audit = (id: string) => this.call<StoredAuditEvent[]>(`/projects/${id}/audit`);
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
