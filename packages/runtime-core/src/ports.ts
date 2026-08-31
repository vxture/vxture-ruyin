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
  /** Hex-encoded SHA-256 of the input string. */
  sha256(input: string): string;
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
  | { role: "tool"; callId: string; content: string; isError?: boolean };

/** A tool the runtime is willing to actually execute this turn. */
export interface ToolOffer {
  id: string;
  description?: string;
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
  /** The materialized context set, carrying its declared type. */
  context: Array<{ type: string; name: string; content: string }>;
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
  content: string;
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
}

export interface AuditEvent {
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
  listAuditEvents(): Promise<AuditEvent[]>;
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
