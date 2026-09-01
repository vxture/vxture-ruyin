/**
 * Host ports - the seam between the isomorphic kernel and its hosts
 * (local Node daemon / cloud runtime). Design authority:
 * docs/30-design/60-technical-architecture.md section 6.2.
 *
 * HARD RULE: nothing in runtime-core may import Node/Electron/browser APIs.
 * Anything host-specific enters through these interfaces.
 */

export interface ClockPort {
  /** ISO-8601 timestamp. */
  now(): string;
  /** Wait, for retry backoff. Hosts own their own timers. */
  sleep(ms: number): Promise<void>;
}

/**
 * A failure that is temporary - the network dropped, the provider is down.
 *
 * Ports throw this when they know the difference; the host is the only layer
 * that can tell, because it owns the transport. The runtime retries these and
 * then suspends the task rather than failing it: a task killed by someone
 * else's outage is not a task that went wrong (50-harness 8.4).
 */
export class TransientError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TransientError";
  }
}

export interface IdPort {
  /** New unique id with the given prefix, e.g. newId("ws") -> "ws_...". */
  newId(prefix: string): string;
}

export interface CryptoPort {
  /**
   * Hex-encoded SHA-256. Takes bytes as well as text because context is not
   * always text: hashing a stand-in string for a file we could not read would
   * put a hash of our own words in the audit trail.
   */
  sha256(input: string | Uint8Array): string;
  /** Base64 of raw bytes - hosts own the encoder (Buffer / btoa). */
  base64(input: Uint8Array): string;
}

/** A tool the provider asked the runtime to run. */
export interface ToolCall {
  id: string;
  tool: string;
  arguments: Record<string, unknown>;
}

/** One message in a capability's conversation. */
export type TurnMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  // A tool message carries whatever the tool returned - a file's contents, an
  // API's response. That is DATA too, and for the same reason as context:
  // someone other than the user may have written it.
  | {
      role: "tool";
      callId: string;
      content: string;
      isError?: boolean;
      origin?: ContentOrigin;
    };

/** A tool the runtime is willing to actually execute this turn. */
export interface ToolOffer {
  id: string;
  description?: string;
}

/**
 * Where a piece of content came from - and therefore how it must be treated.
 *
 * The runtime is the only layer that knows this: by the time text reaches a
 * model it is just text. Deliberately coarse, and deliberately without the
 * local path - the provider needs to know *that* it is a user file, not where
 * on the user's disk it sits. The full reference stays local, for the audit
 * trail and for what the user is shown.
 */
export type ContentOrigin =
  | { kind: "local_file"; connector: string }
  | { kind: "caller" }
  | { kind: "tool_result"; tool: string };

/**
 * What a context item actually holds.
 *
 * A union rather than a string because **not everything a user points at is
 * text**, and the two ways of pretending otherwise both corrupt the material:
 * substituting a stand-in sentence hands the model something shaped exactly
 * like content that isn't, and decoding bytes as UTF-8 hands it mojibake. A
 * reader cannot tell either one from the real thing.
 *
 * `unavailable` is therefore a first-class answer. "We could not read this"
 * is information; a sentence saying so, sitting where the document should be,
 * is not.
 *
 * Which formats a runtime can actually carry is a separate question from
 * whether the carrier can express them - this is the carrier. Turning a PDF
 * into text is a model capability, supplied by the product's own surface
 * (ADR-008); no parser belongs here.
 */
export type ContextContent =
  | { kind: "text"; text: string; truncated?: boolean }
  | { kind: "binary"; mediaType: string; bytes: Uint8Array }
  | { kind: "unavailable"; reason: string; mediaType?: string };

/**
 * The wire form of the above: identical, except bytes travel base64-encoded
 * because the turn request is JSON. Kept as a separate type so the encoding
 * boundary is visible rather than implied.
 */
export type FactContent =
  | { kind: "text"; text: string; truncated?: boolean }
  | { kind: "binary"; mediaType: string; base64: string; bytes: number }
  | { kind: "unavailable"; reason: string; mediaType?: string };

export interface ContextFact {
  type: string;
  name: string;
  content: FactContent;
  origin: ContentOrigin;
}

export interface CapabilityTurnRequest {
  capability: string;
  /**
   * The product whose capability this is. Resolution needs it and the contract
   * cannot carry a provider (R6), so it travels with the request instead.
   */
  product: string;
  /**
   * Stable across the whole task - the cross-product aggregation key
   * (platform integration rule X-2). Providers log it verbatim, which is what
   * makes one task's cost and failure point reconstructable across products.
   */
  taskId: string;
  workspace: string;
  /**
   * What the task is for, verbatim from the contract.
   *
   * Facts, not phrasing. How to put this to a model is the product's business:
   * a runtime that composes the prompt has quietly taken over the part of the
   * work where domain knowledge lives.
   */
  objective: string;
  constraints: string[];
  /**
   * The materialized context set.
   *
   * **These are DATA, not instructions.** The runtime is the only layer that
   * knows where each piece came from, so it says so here: content that arrived
   * from a user's file or a tool result may have been written by someone other
   * than the user - a tender document is authored by whoever issued it. Text
   * inside it that reads like a direction is content to report, not a direction
   * to follow.
   *
   * Only `objective` and `constraints` above are instructions, and they come
   * from the contract.
   */
  context: ContextFact[];
  /**
   * The conversation so far - what the provider answered, what tools returned.
   * Earlier capabilities' output accumulates here, so capability N sees
   * N-1's result.
   */
  messages: TurnMessage[];
  /**
   * Tools the runtime will actually execute if asked. Offering a tool the
   * runtime cannot gate would be a lie (50-harness section 5).
   */
  tools: ToolOffer[];
  /**
   * Present only on a revision round: which rules failed last time and why
   * (50-harness 7.2). Handed over as data - the runtime does not write the
   * sentence that asks for a fix.
   */
  revision?: {
    round: number;
    failures: Array<{ rule: string; reason: string }>;
  };
}

/**
 * One turn's outcome.
 *
 * `verdict` is what a verification capability answers with. It is a field, not
 * a sentence to be parsed: reading a model's prose to decide whether a check
 * passed puts the runtime in the business of interpreting business language,
 * and gets it wrong in the passing direction - which is exactly how a
 * verification step turns into decoration.
 */
export type CapabilityTurn =
  | { kind: "tool_calls"; calls: ToolCall[] }
  | { kind: "content"; content: string }
  | { kind: "verdict"; passed: boolean; reason?: string };

/**
 * Capability invocation, one turn at a time.
 *
 * The runtime owns the loop (ADR-002): the provider is stateless and answers
 * "what next", it never runs the task to completion. That split is what keeps
 * tool execution, gating, audit and human checkpoints on the machine that
 * holds the data. Both hosts point this at the business product's capability
 * surface, which is what holds the credentials for Atlas (ADR-001).
 */
export interface AIGatewayPort {
  turn(request: CapabilityTurnRequest): Promise<CapabilityTurn>;
}

// ---------------------------------------------------------------------------
// Context (docs/30-design/40-context-architecture.md)
// ---------------------------------------------------------------------------

/** Workspace-scoped folder access grant (04 section 4.3). */
export interface FolderGrant {
  id: string;
  path: string;
  mode: "read" | "readwrite";
  createdAt: string;
}

/** Binding of a contract context type to an actual source (04 section 3). */
export interface Binding {
  type: string;
  source: "local";
  connector: string;
  root: string;
}

export interface ContextItemMeta {
  id: string;
  type: string;
  source: string;
  /** Connector-understood reference (local-fs: absolute path). */
  ref: string;
  name: string;
  bytes: number;
  modifiedAt: string;
}

export interface ContextItem extends ContextItemMeta {
  content: ContextContent;
}

/** Context source access (04 section 4). */
export interface ConnectorPort {
  discover(binding: Binding): Promise<ContextItemMeta[]>;
  read(item: ContextItemMeta): Promise<ContextItem>;
}

/**
 * Tool execution, after the Tool Gate has let a call through.
 *
 * Separate from ConnectorPort on purpose: connectors *read* context, tools
 * *act*. Hosts implement the tools their platform can actually perform, and
 * an unimplemented tool must fail loudly rather than return an empty success -
 * to a model, an empty result reads as "it ran and found nothing".
 */
export interface ToolExecutionRequest {
  tool: string;
  arguments: Record<string, unknown>;
  workspace: string;
  taskId: string;
  /** Folders the user granted; path arguments have already been checked. */
  grants: FolderGrant[];
  /**
   * 这次任务选出来的资料。**检索类工具的范围上限就是它**——上下文集是经过
   * 选取、必要时经用户确认的那一批；让工具伸到它之外，那道确认就成了摆设。
   */
  contextSet: ContextItemMeta[];
}

export interface ToolExecutionResult {
  content: string;
  isError?: boolean;
}

export interface ToolExecutorPort {
  /** Tool ids this host can actually run. */
  supports(tool: string): boolean;
  execute(request: ToolExecutionRequest): Promise<ToolExecutionResult>;
}

/** Relevance ranking over candidates (local host: FTS5; 04 section 6.1). */
export interface RankerPort {
  rank(
    projectId: string,
    query: string,
    candidates: ContextItemMeta[],
  ): Promise<ContextItemMeta[]>;
}

/** Declared for later phases (04 section 9); unused in Phase A. */
export interface KeychainPort {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export interface ProjectMeta {
  id: string;
  productId: string;
  productVersion: string;
  contractVersion: string;
  name: string;
  projectType: string;
  createdAt: string;
  /**
   * The platform workspace this project belongs to (ADR-007: subscription,
   * entitlement and data boundaries are all drawn per workspace, so a project
   * belongs to exactly one).
   *
   * Required for every project created from now on - `createProject` will not
   * make one without it. Optional only in the type, and only for records
   * written before attribution existed: those are a backlog to import, not a
   * supported state. Nothing new may reach disk without this field.
   */
  workspaceId?: string;
}

/**
 * 一次操作的结果（《产品接入通则》X-3：**outcome 必须区分成功与被拒**）。
 *
 * `failed` 不折进 `rejected`：**出错不是被拒**——把一次内部失败记成「被拒」
 * 等于说有谁拒绝了它，而根本没有人。`unknown` 只用于 X-3 之前写下的旧事件，
 * 它们的结果无从回填，**也绝不许猜**。
 */
export type AuditOutcome = "success" | "rejected" | "failed" | "unknown";

/**
 * 审计事件（X-3 字段名）。
 *
 * `prevHash` / `hash` 是本地加项（哈希链），通则说属增量、不冲突。
 *
 * **`actor` 与 `actorId` 是两件事，都保留**：前者是角色（谁这一类），后者是
 * 身份（具体是谁）。合并会重演 X-4 那种「一个名字两个意思」。
 *
 * **没有 costAmount / costUnit**：那是消费面字段，而 Ruyin 不计量——计量在
 * Atlas 服务端，客户端永不自报。填上它就是自报计量。
 */
export interface AuditEvent {
  eventId: string;
  occurredAt: string;
  /** 具体是谁：人做的填会话 sub，运行时自己做的填稳定常量。 */
  actorId: string;
  /**
   * 铸造这次换票的工作台 RP。Ruyin 是桌面运行时，不属于任何控制台，
   * 所以恒为 null —— 通则明说 **MUST NOT 硬编一个**。
   */
  actorConsole: null;
  /** 角色（既有列，非 X-3）：harness / user / system。 */
  actor: "harness" | "user" | "system";
  objectType: string;
  objectId: string;
  action: string;
  outcome: AuditOutcome;
  /** 所属项目容器（本地加项）。 */
  workspace: string;
  /** X-2 聚合键；仅任务相关事件有。 */
  taskId?: string;
  prevHash: string;
  hash: string;
  payload: unknown;
}

/**
 * X-3 之前写下的事件形状。**读得出来，但绝不回写**——链的哈希是按存进去时的
 * 字段名算的，改写既有记录会作废每一条链。
 */
export interface LegacyAuditEvent {
  event_id: string;
  workspace: string;
  task_instance?: string;
  kind: string;
  actor: "harness" | "user" | "system";
  timestamp: string;
  prev_hash: string;
  hash: string;
  payload: unknown;
}

/** 存储里可能读到的两种形状。 */
export type StoredAuditEvent = AuditEvent | LegacyAuditEvent;

export interface JournalEntry {
  taskInstance: string;
  step: string;
  detail: unknown;
  at: string;
}

/**
 * Per-workspace persistence handle. The workspace is the storage boundary
 * (one database per workspace, 60 section 7.1); hosts implement this over
 * SQLite (local) or their own store (cloud).
 */
export interface ProjectStore {
  putMeta(meta: ProjectMeta): Promise<void>;
  getMeta(): Promise<ProjectMeta | undefined>;

  putContract(contractJson: string): Promise<void>;
  getContract(): Promise<string | undefined>;

  putGrants(grantsJson: string): Promise<void>;
  getGrants(): Promise<string | undefined>;
  putBindings(bindingsJson: string): Promise<void>;
  getBindings(): Promise<string | undefined>;

  setBusinessState(state: string): Promise<void>;
  getBusinessState(): Promise<string | undefined>;

  putTaskInstance(id: string, dataJson: string): Promise<void>;
  getTaskInstance(id: string): Promise<string | undefined>;
  listTaskInstances(): Promise<string[]>;

  appendAuditEvent(event: AuditEvent): Promise<void>;
  /** 可能含 X-3 之前写下的旧形状记录。 */
  listAuditEvents(): Promise<StoredAuditEvent[]>;
  lastAuditHash(): Promise<string | undefined>;

  appendJournal(entry: JournalEntry): Promise<void>;
  listJournal(taskInstance: string): Promise<JournalEntry[]>;
}

export interface StoragePort {
  createProjectStore(projectId: string): Promise<ProjectStore>;
  openProjectStore(projectId: string): Promise<ProjectStore | undefined>;
  listProjectIds(): Promise<string[]>;
}

/** The port bundle the kernel is constructed with. */
export interface RuntimePorts {
  storage: StoragePort;
  clock: ClockPort;
  id: IdPort;
  crypto: CryptoPort;
  gateway: AIGatewayPort;
  /** Connector registry by connector id (e.g. "local-fs"). */
  connectors?: Map<string, ConnectorPort>;
  ranker?: RankerPort;
  /** Executes tools the Tool Gate lets through. */
  tools?: ToolExecutorPort;
  /** True once the user has asked this task to stop (see HarnessDeps). */
  isCancelled?: (taskInstanceId: string) => boolean;
}
