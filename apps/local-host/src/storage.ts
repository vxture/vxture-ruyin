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

import Database from "better-sqlite3-multiple-ciphers";
import { mkdirSync, existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { KeyManager } from "./keys.js";
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
CREATE VIRTUAL TABLE IF NOT EXISTS fts_index USING fts5(
  item_id UNINDEXED,
  type UNINDEXED,
  name,
  content
);
`;

const require = createRequire(import.meta.url);

/**
 * Native binding selection (TD-010).
 *
 * Under plain Node the package's own binding is used (build/Release, fetched
 * for the host ABI at install time; what `node --test` and `node dist/main.js`
 * run). Under Electron the daemon runs in the shell's utilityProcess, i.e. in
 * Electron's bundled Node with its *own* ABI, so the host binding cannot load;
 * scripts/native/sqlite-electron-binding.mjs drops the matching electron
 * prebuilt next to it and this picks it by the running ABI. Returns the
 * binding path for Electron, undefined for the package default.
 */
export function resolveNativeBinding(): string | undefined {
  if (!process.versions["electron"]) return undefined;
  const pkgDir = dirname(
    require.resolve("better-sqlite3-multiple-ciphers/package.json"),
  );
  const label = `electron-v${process.versions.modules}-${process.platform}-${process.arch}`;
  const binding = join(pkgDir, "build", label, "better_sqlite3.node");
  if (!existsSync(binding)) {
    throw new Error(
      `SQLite native binding for ${label} not found at ${binding} - run "pnpm native:electron" ` +
        `(apps/shell start/smoke run it automatically; the installer pack chain runs it in scripts/release/pack.mjs)`,
    );
  }
  return binding;
}

function openDatabase(file: string): Database.Database {
  const nativeBinding = resolveNativeBinding();
  return nativeBinding ? new Database(file, { nativeBinding }) : new Database(file);
}

export class SqliteWorkspaceStore implements WorkspaceStore {
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

  async putGrants(grantsJson: string): Promise<void> {
    this.kvPut("grants", grantsJson);
  }
  async getGrants(): Promise<string | undefined> {
    return this.kvGet("grants");
  }
  async putBindings(bindingsJson: string): Promise<void> {
    this.kvPut("bindings", bindingsJson);
  }
  async getBindings(): Promise<string | undefined> {
    return this.kvGet("bindings");
  }

  // -- FTS index (host-specific surface, 04 section 5.1) --------------------

  replaceIndexForType(
    type: string,
    rows: Array<{ id: string; name: string; content: string }>,
  ): void {
    this.db.prepare("DELETE FROM fts_index WHERE type = ?").run(type);
    const insert = this.db.prepare(
      "INSERT INTO fts_index (item_id, type, name, content) VALUES (?, ?, ?, ?)",
    );
    for (const row of rows) insert.run(row.id, type, row.name, row.content);
  }

  searchIndex(matchQuery: string, limit = 50): string[] {
    const rows = this.db
      .prepare(
        "SELECT item_id FROM fts_index WHERE fts_index MATCH ? ORDER BY rank LIMIT ?",
      )
      .all(matchQuery, limit) as Array<{ item_id: string }>;
    return rows.map((r) => r.item_id);
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

  constructor(
    private readonly dataDir: string,
    private readonly keys: KeyManager,
  ) {
    mkdirSync(join(dataDir, "workspaces"), { recursive: true });
  }

  /**
   * Prove the native binding loads in THIS runtime by opening and querying a
   * throwaway in-memory database (TD-010). Called once at daemon startup so
   * an ABI mismatch fails the process (and the shell smoke) immediately
   * instead of on the first workspace open.
   */
  selfCheck(): { binding: string; sqliteVersion: string } {
    const nativeBinding = resolveNativeBinding();
    const db = openDatabase(":memory:");
    try {
      const row = db.prepare("SELECT sqlite_version() AS v").get() as { v: string };
      return {
        binding: nativeBinding ?? `package default (node ABI ${process.versions.modules})`,
        sqliteVersion: row.v,
      };
    } finally {
      db.close();
    }
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
    const dir = this.wsDir(workspaceId);
    const db = openDatabase(join(dir, "workspace.db"));
    // At-rest encryption (TD-009): SQLCipher-compatible scheme, raw hex key
    // per workspace. Cipher selection must precede the key pragma, both
    // before any other statement.
    db.pragma(`cipher='sqlcipher'`);
    db.pragma(`key="x'${this.keys.workspaceKeyHex(dir)}'"`);
    try {
      db.pragma("user_version");
    } catch (cause) {
      db.close();
      throw new Error(
        `workspace "${workspaceId}" database cannot be unlocked - wrong key or a pre-encryption dev database (delete the dev data dir to reset): ${cause instanceof Error ? cause.message : cause}`,
      );
    }
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

  /** Host-side access to the concrete store (FTS index surface). */
  openHostStore(workspaceId: string): SqliteWorkspaceStore | undefined {
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
