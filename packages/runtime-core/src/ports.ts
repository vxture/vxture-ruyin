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
}

export interface IdPort {
  /** New unique id with the given prefix, e.g. newId("ws") -> "ws_...". */
  newId(prefix: string): string;
}

export interface CryptoPort {
  /** Hex-encoded SHA-256 of the input string. */
  sha256(input: string): string;
}

export interface CapabilityInvocation {
  capability: string;
  workspace: string;
  taskInstance: string;
  inputs: Record<string, unknown>;
}

export interface CapabilityResult {
  content: string;
}

/**
 * AI capability invocation. Both hosts point this at the Vxture AI Gateway
 * (60 section T10); Phase A uses a mock implementation.
 */
export interface AIGatewayPort {
  invoke(request: CapabilityInvocation): Promise<CapabilityResult>;
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

/** Relevance ranking over candidates (local host: FTS5; 04 section 6.1). */
export interface RankerPort {
  rank(
    workspaceId: string,
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

export interface WorkspaceMeta {
  id: string;
  productId: string;
  productVersion: string;
  contractVersion: string;
  name: string;
  workspaceType: string;
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
export interface WorkspaceStore {
  putMeta(meta: WorkspaceMeta): Promise<void>;
  getMeta(): Promise<WorkspaceMeta | undefined>;

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
  createWorkspaceStore(workspaceId: string): Promise<WorkspaceStore>;
  openWorkspaceStore(workspaceId: string): Promise<WorkspaceStore | undefined>;
  listWorkspaceIds(): Promise<string[]>;
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
}
