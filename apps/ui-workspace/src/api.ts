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

/** 静态产品库（daemon /registry）的一条。`installable` 在外层：这台机器装不装得了未签名包。 */
export interface RegistryItem {
  id: string;
  name: string;
  version: string;
  publisher: string;
  runtime: { minimum: string };
  size: number;
  signed: boolean;
  installed: boolean;
  installedVersions: string[];
}

export type RegistryCatalog =
  | { status: "ok"; base: string; generatedAt: string; checkedAt: string; installable: boolean; items: RegistryItem[] }
  | { status: "unreachable"; base: string; reason: string; checkedAt: string };

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
  | { kind: "pending" }
  /** 界面主题变了；壳据此重画窗口按钮（见 chrome-theme.ts）。 */
  | { kind: "ui-theme" }
  | { kind: "app-restart" }
  | { kind: "app-open-data-dir" }
  | { kind: "app-pick-folder" };

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
  /** 发现它的连接器 id（ADR-005 接缝 ②）。 */
  connector: string;
  /** 连接器理解的引用：local-fs 是绝对路径，进程外连接器是资源 URI。 */
  ref: string;
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

/**
 * 项目级的连接器授权（ADR-005：授权以项目为边界，与文件夹授权同级、同一张表）。
 * 文件夹授权没有 `kind`——它先于这个存在，旧记录不回填。
 */
export interface ConnectorGrant {
  id: string;
  kind: "connector";
  connector: string;
  mode: "read";
  createdAt: string;
}

export type Grant = FolderGrant | ConnectorGrant;

export function isConnectorGrant(grant: Grant): grant is ConnectorGrant {
  return "kind" in grant && grant.kind === "connector";
}

/** 宿主上装了哪些进程外连接器（daemon /connectors）。健康是问出来的，不是记的。 */
export interface ConnectorView {
  id: string;
  transport: "stdio";
  command: string;
  args: string[];
  source: "lan" | "private";
  installedAt: string;
  /** 本机生效态（通则 B-3）。`stashed` = 存下来但没启用（添加时没连上）。 */
  state: "active" | "stashed";
  health: { ok: boolean; detail?: string; checkedAt: string };
  /** 运行中的服务器暴露的工具名；契约里 provider: connector 的工具靠同名接上。 */
  tools: string[];
}

export interface Binding {
  type: string;
  /** 契约的来源种类（local / lan / private …）。 */
  source: string;
  connector: string;
  root: string;
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
  /** 身份投射（daemon `session()`）。字段缺失 = 平台没在 token 里给。 */
  profile?: {
    sub: string;
    name?: string;
    username?: string;
    email?: string;
    emailVerified?: boolean;
    phone?: string;
    phoneVerified?: boolean;
    locale?: string;
    roles?: string[];
    picture?: string;
  };
  org?: { id?: string; name?: string; type?: string };
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
  /**
   * 能力面接没接（daemon 判定，界面不重算）。`mock` = 任务只会拿到占位输出，
   * 产品卡据此标「未接通」（TD-033）。**缺失 ≠ mock**：拿不到 /system 时是「不知道」，
   * 不是「没接上」。
   */
  capabilitySurface: "configured" | "mock";
  startedAt: string;
  /** 排着一次搬家（重启时生效）。TD-039。 */
  dataDirPending?: string;
  /** 上一次搬家的结果 —— 重启后要能说清楚成没成。 */
  lastMove?: {
    status: "moved" | "failed" | "none";
    from?: string;
    to?: string;
    at?: string;
    reason?: string;
    /** 这一次启动刚搬完的。回执只给这一次 —— 之后它只是历史。 */
    justNow?: boolean;
  };
}

/** 目标目录能不能用。守护进程算，界面照抄 —— 只有它摸得到文件系统。 */
export interface DataDirCheck {
  ok: boolean;
  reason?: string;
  /** 同卷（改名，瞬间完成）还是跨卷（复制 + 核对，要等）。 */
  sameVolume?: boolean;
  bytes?: number;
  freeBytes?: number;
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
  /**
   * 一级供给：从产品能力面拉一次契约（ADR-012）。`fetched` = 落了新版本，
   * `current` = 没变，`offline` = 拉不到（本地那份照用）。能力面未配置时 503。
   */
  fetchProduct = (id: string) =>
    this.call<{ status: "fetched" | "current" | "offline"; version?: string; reason?: string }>(
      `/products/${id}/fetch`,
      "POST",
    );
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
  grants = (id: string) => this.call<Grant[]>(`/projects/${id}/grants`);
  addGrant = (id: string, path: string) =>
    this.call<FolderGrant>(`/projects/${id}/grants`, "POST", { path });
  addConnectorGrant = (id: string, connector: string) =>
    this.call<ConnectorGrant>(`/projects/${id}/grants`, "POST", { connector });
  bindings = (id: string) => this.call<Binding[]>(`/projects/${id}/bindings`);
  /**
   * 不带 `via` = 本地文件夹（local-fs，来源 local）。带了 = 经某个连接器，
   * `source` 是它服务的来源种类；由内核对照契约校验，界面只透传。
   */
  setBinding = (
    id: string,
    type: string,
    root: string,
    via?: { connector: string; source: string },
  ) =>
    this.call<Binding & { indexed: number }>(
      `/projects/${id}/bindings`,
      "POST",
      via ? { type, root, connector: via.connector, source: via.source } : { type, root },
    );
  registry = () => this.call<RegistryCatalog>("/registry");
  installFromRegistry = (id: string, version: string) =>
    this.call<InstalledPackage & { from: "registry" }>("/registry/install", "POST", { id, version });
  connectors = () => this.call<{ items: ConnectorView[] }>("/connectors");
  installConnector = (input: {
    id: string;
    command: string;
    args: string[];
    source: "lan" | "private";
    /** `stashed` = 存下来但不启用（测试没通过时用户选择先留着）。 */
    state?: "stashed";
  }) => this.call<ConnectorView>("/connectors", "POST", input);
  /** 试连一次（添加页的第一步）。不写任何东西，也不注册。 */
  testConnector = (input: {
    id: string;
    command: string;
    args?: string[];
  }) =>
    this.call<{ ok: boolean; tools: string[]; detail?: string }>(
      "/connectors/test",
      "POST",
      input,
    );
  /** 启用一个暂存的连接器：守护进程会重新试一次，通不过仍是暂存。 */
  activateConnector = (id: string) =>
    this.call<ConnectorView>(`/connectors/${id}/activate`, "POST");
  removeConnector = (id: string) =>
    this.call<{ removed: string }>(`/connectors/${id}`, "DELETE");
  audit = (id: string) => this.call<StoredAuditEvent[]>(`/projects/${id}/audit`);
  contextItems = (id: string, type: string) =>
    this.call<ContextItemMeta[]>(`/projects/${id}/context/${type}`);
  system = () => this.call<SystemInfo>("/system");
  /** 目标目录能不能用。**没有副作用** —— 用户按确认之前先问这一句。 */
  checkDataDir = (target: string) =>
    this.call<DataDirCheck>("/system/data-dir/check", "POST", { target });
  /**
   * 排一次搬家。真正的搬移发生在**下一次启动、开库之前**（TD-039）——
   * 这里只写下意图，所以这个调用不会动任何数据。
   */
  requestDataDir = (target: string) =>
    this.call<{ pending: string } & DataDirCheck>("/system/data-dir", "POST", { target });
  cancelDataDir = () => this.call<{ pending: null }>("/system/data-dir", "DELETE");
  /** 请壳重启（界面自己做不到）。搬家要靠它才能生效。 */
  restartApp = () => this.call<{ ok: boolean }>("/ui/restart", "POST");
  /**
   * 请壳在资源管理器里打开数据目录。**不传路径** —— 打开哪个目录由守护进程说
   * （它才是知道 dataDir 的那个），界面只是提出这个请求。
   */
  openDataDir = () => this.call<{ ok: boolean }>("/ui/open-data-dir", "POST");
  /**
   * 弹系统目录选择框，等用户选完。
   *
   * 这是一个**长等待**的请求：守护进程把它挂着，直到壳把结果送回来（或者超时）。
   * 界面因此可以直接 `await`，不必自己轮询 —— 「选个目录」在用户眼里是一个动作，
   * 代码里也该是一个动作。
   */
  pickFolder = (start?: string) =>
    this.call<{ path?: string; cancelled?: boolean }>(
      "/ui/pick-folder",
      "POST",
      start ? { start } : {},
    );
  /**
   * 上报生效主题，供壳给 Windows 的窗口按钮上色。**中转，不是设置** ——
   * 偏好本身存在本机 localStorage（DS 的 ThemeProvider）。
   */
  setChromeTheme = (theme: "dark" | "light") =>
    this.call<{ theme: string }>("/ui/theme", "POST", { theme });
  session = () => this.call<SessionInfo>("/auth/session");
  login = () => this.call<{ authorizeUrl: string }>("/auth/login", "POST");
  logout = () => this.call<{ ok: boolean }>("/auth/logout", "POST");
  entitlements = (products: string[]) =>
    this.call<EntitlementsBatch>(
      `/entitlements?products=${encodeURIComponent(products.join(","))}`,
    );
}
