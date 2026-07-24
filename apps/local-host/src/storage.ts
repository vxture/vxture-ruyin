/**
 * SQLite StoragePort - one database per workspace under the data directory
 * (docs/30-design/60-technical-architecture.md section 7.1):
 *
 *   <dataDir>/workspaces/ws_<id>/workspace.db
 *
 * Phase A: plain SQLite; at-rest encryption (SQLCipher + OS keychain, 60
 * section 7.3) is TD-009. Tables are the Phase A subset of 60 section 7.2 -
 * kv (meta/contract/business state), task_instances, audit_events, journal.
 */

import Database from "better-sqlite3";
import { mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type {
  AuditEvent,
  JournalEntry,
  StoragePort,
  WorkspaceMeta,
  WorkspaceStore,
} from "@vxture/ruyin-core";

const DDL = `
CREATE TABLE IF NOT EXISTS kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS task_instances (
  id         TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit_events (
  seq      INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  hash     TEXT NOT NULL,
  data     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS journal (
  seq           INTEGER PRIMARY KEY AUTOINCREMENT,
  task_instance TEXT NOT NULL,
  data          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_journal_task ON journal (task_instance);
`;

class SqliteWorkspaceStore implements WorkspaceStore {
  constructor(private readonly db: Database.Database) {}

  private kvGet(key: string): string | undefined {
    const row = this.db
      .prepare("SELECT value FROM kv WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value;
  }

  private kvPut(key: string, value: string): void {
    this.db
      .prepare(
        "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(key, value);
  }

  async putMeta(meta: WorkspaceMeta): Promise<void> {
    this.kvPut("meta", JSON.stringify(meta));
  }
  async getMeta(): Promise<WorkspaceMeta | undefined> {
    const raw = this.kvGet("meta");
    return raw ? (JSON.parse(raw) as WorkspaceMeta) : undefined;
  }

  async putContract(contractJson: string): Promise<void> {
    this.kvPut("contract", contractJson);
  }
  async getContract(): Promise<string | undefined> {
    return this.kvGet("contract");
  }

  async setBusinessState(state: string): Promise<void> {
    this.kvPut("business_state", state);
  }
  async getBusinessState(): Promise<string | undefined> {
    return this.kvGet("business_state");
  }

  async putTaskInstance(id: string, dataJson: string): Promise<void> {
    this.db
      .prepare(
        "INSERT INTO task_instances (id, data, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
      )
      .run(id, dataJson);
  }
  async getTaskInstance(id: string): Promise<string | undefined> {
    const row = this.db
      .prepare("SELECT data FROM task_instances WHERE id = ?")
      .get(id) as { data: string } | undefined;
    return row?.data;
  }
  async listTaskInstances(): Promise<string[]> {
    const rows = this.db
      .prepare("SELECT data FROM task_instances ORDER BY updated_at")
      .all() as Array<{ data: string }>;
    return rows.map((r) => r.data);
  }

  async appendAuditEvent(event: AuditEvent): Promise<void> {
    this.db
      .prepare(
        "INSERT INTO audit_events (event_id, hash, data) VALUES (?, ?, ?)",
      )
      .run(event.event_id, event.hash, JSON.stringify(event));
  }
  async listAuditEvents(): Promise<AuditEvent[]> {
    const rows = this.db
      .prepare("SELECT data FROM audit_events ORDER BY seq")
      .all() as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as AuditEvent);
  }
  async lastAuditHash(): Promise<string | undefined> {
    const row = this.db
      .prepare("SELECT hash FROM audit_events ORDER BY seq DESC LIMIT 1")
      .get() as { hash: string } | undefined;
    return row?.hash;
  }

  async appendJournal(entry: JournalEntry): Promise<void> {
    this.db
      .prepare("INSERT INTO journal (task_instance, data) VALUES (?, ?)")
      .run(entry.taskInstance, JSON.stringify(entry));
  }
  async listJournal(taskInstance: string): Promise<JournalEntry[]> {
    const rows = this.db
      .prepare("SELECT data FROM journal WHERE task_instance = ? ORDER BY seq")
      .all(taskInstance) as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as JournalEntry);
  }
}

export class SqliteStoragePort implements StoragePort {
  private readonly open = new Map<
    string,
    { store: SqliteWorkspaceStore; db: Database.Database }
  >();

  constructor(private readonly dataDir: string) {
    mkdirSync(join(dataDir, "workspaces"), { recursive: true });
  }

  /** Close every open database handle (daemon shutdown / test cleanup). */
  closeAll(): void {
    for (const { db } of this.open.values()) db.close();
    this.open.clear();
  }

  private wsDir(workspaceId: string): string {
    return join(this.dataDir, "workspaces", workspaceId);
  }

  private openDb(workspaceId: string): SqliteWorkspaceStore {
    const cached = this.open.get(workspaceId);
    if (cached) return cached.store;
    const db = new Database(join(this.wsDir(workspaceId), "workspace.db"));
    db.pragma("journal_mode = WAL");
    db.exec(DDL);
    const store = new SqliteWorkspaceStore(db);
    this.open.set(workspaceId, { store, db });
    return store;
  }

  async createWorkspaceStore(workspaceId: string): Promise<WorkspaceStore> {
    const dir = this.wsDir(workspaceId);
    if (existsSync(dir)) {
      throw new Error(`workspace directory already exists: ${dir}`);
    }
    mkdirSync(join(dir, "files"), { recursive: true });
    return this.openDb(workspaceId);
  }

  async openWorkspaceStore(
    workspaceId: string,
  ): Promise<WorkspaceStore | undefined> {
    if (!existsSync(join(this.wsDir(workspaceId), "workspace.db"))) {
      return undefined;
    }
    return this.openDb(workspaceId);
  }

  async listWorkspaceIds(): Promise<string[]> {
    const root = join(this.dataDir, "workspaces");
    return readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => existsSync(join(root, name, "workspace.db")))
      .sort();
  }
}
