/**
 * SQLite StoragePort - one database per workspace under the data directory
 * (docs/30-design/60-technical-architecture.md section 7.1):
 *
 *   <dataDir>/projects/<id>/project.db
 *
 * 落盘即加密（TD-009 已回收）：SQLCipher 方案，每个项目一把密钥，密钥由
 * KeyManager 保管（Windows 上走 DPAPI）。表：kv（meta / 契约 / 业务状态 /
 * 授权 / 绑定 / 成果登记）、task_instances、audit_events、journal、fts_index。
 */

import Database from "better-sqlite3-multiple-ciphers";
import { mkdirSync, existsSync, readdirSync, renameSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { KeyManager } from "./keys.js";
import type {
  AuditEvent,
  JournalEntry,
  StoragePort,
  ProjectMeta,
  ProjectStore,
} from "@vxture/ruyin-core";

/** On-disk home of the local containers (ADR-007: they are projects). */
const PROJECTS_DIR = "projects";
const PROJECT_DB = "project.db";

/**
 * One-time move of the pre-rename layout into place.
 *
 * Only the directory and file names change - **ids are left exactly as they
 * are**. The audit chain''s genesis hash is `sha256("genesis:" + id)`, so
 * rewriting an id would invalidate every chain already written; ids are opaque,
 * so `ws_` and `prj_` coexist meaning nothing.
 *
 * Refuses to act if the new directory already exists: a half-finished move is
 * worse than an unmoved one, and there is no safe way to merge the two.
 *
 * **The `-wal` file must travel with its database.** In WAL mode a committed
 * transaction lives in `<db>-wal` until a checkpoint folds it back; SQLite
 * finds that file by the database's name. Renaming the database alone leaves
 * the WAL orphaned under the old name, and everything still in it is silently
 * gone - the database opens perfectly well, just missing its most recent
 * writes. `-shm` is the opposite case: pure shared-memory index, rebuilt on
 * demand, and a stale one is worse than none, so it is removed rather than
 * carried.
 */
function migrateWorkspaceDirs(dataDir: string): void {
  const from = join(dataDir, "workspaces");
  const to = join(dataDir, PROJECTS_DIR);
  if (!existsSync(from) || existsSync(to)) return;
  renameSync(from, to);
  for (const entry of readdirSync(to, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(to, entry.name);
    const oldDb = join(dir, "workspace.db");
    if (!existsSync(oldDb)) continue;
    renameSync(oldDb, join(dir, PROJECT_DB));
    const oldWal = `${oldDb}-wal`;
    if (existsSync(oldWal)) renameSync(oldWal, `${join(dir, PROJECT_DB)}-wal`);
    rmSync(`${oldDb}-shm`, { force: true });
  }
  console.log(`[ruyin] migrated ${from} -> ${to} (ids unchanged)`);
}

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
  content,
  tokenize='trigram'
);
`;

/**
 * `trigram` 而不是默认的 `unicode61`，因为默认分词器**对中文是零命中**。
 *
 * 这不是推断，是量出来的：一段含「储能项目」的中文正文，用 unicode61 索引后
 * 查「储能」「储能项目」「电化学储能」「案例」，四条全是 0 命中 —— unicode61
 * 把一整串连续汉字当成一个 token，除非查询词与它逐字相同，否则永远不匹配。
 * 也就是说这个索引对中文资料一直是死的，而唯一的症状是排序悄悄退化成按时间，
 * 看起来和「就是没有更相关的」一模一样。
 *
 * trigram 的代价要说清：**它需要至少 3 个字符**。「储能」「案例」这类两字词
 * MATCH 不到，由 `fts.ts` 用 LIKE 扫描兜底。索引也比词级分词更大。
 */
const FTS_TOKENIZER = "trigram";

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

export class SqliteProjectStore implements ProjectStore {
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

  async putMeta(meta: ProjectMeta): Promise<void> {
    this.kvPut("meta", JSON.stringify(meta));
  }
  async getMeta(): Promise<ProjectMeta | undefined> {
    const raw = this.kvGet("meta");
    return raw ? (JSON.parse(raw) as ProjectMeta) : undefined;
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
  async putArtifacts(artifactsJson: string): Promise<void> {
    this.kvPut("artifacts", artifactsJson);
  }
  async getArtifacts(): Promise<string | undefined> {
    return this.kvGet("artifacts");
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

  /**
   * 命中 + 命中处的摘录，按相关度排序。
   *
   * 摘录由 FTS5 的 `snippet()` 从索引里取，**不回读源文件**：索引里存的就是
   * 当时读到的正文，回读一遍既慢又可能读到已经变了的内容。
   */
  searchExcerpts(
    matchQuery: string,
    limit: number,
  ): Array<{ id: string; name: string; excerpt: string }> {
    const rows = this.db
      .prepare(
        `SELECT item_id, name, snippet(fts_index, 3, '', '', '…', 20) AS excerpt
           FROM fts_index WHERE fts_index MATCH ? ORDER BY rank LIMIT ?`,
      )
      .all(matchQuery, limit) as Array<{
      item_id: string;
      name: string;
      excerpt: string;
    }>;
    return rows.map((r) => ({ id: r.item_id, name: r.name, excerpt: r.excerpt }));
  }

  /**
   * 子串扫描兜底。trigram 需要至少 3 个字符，而「储能」「案例」这类两字词在
   * 中文里恰恰是最常查的 —— 少了这条兜底，它们会一律返回「没找到」。
   */
  scanIndex(
    substring: string,
    limit: number,
  ): Array<{ id: string; name: string; excerpt: string }> {
    const like = `%${substring.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    const rows = this.db
      .prepare(
        `SELECT item_id, name, content FROM fts_index
           WHERE content LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' LIMIT ?`,
      )
      .all(like, like, limit) as Array<{
      item_id: string;
      name: string;
      content: string;
    }>;
    return rows.map((r) => ({
      id: r.item_id,
      name: r.name,
      excerpt: around(r.content, substring),
    }));
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
      .run(event.eventId, event.hash, JSON.stringify(event));
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
    { store: SqliteProjectStore; db: Database.Database }
  >();

  constructor(
    private readonly dataDir: string,
    private readonly keys: KeyManager,
  ) {
    migrateWorkspaceDirs(dataDir);
    mkdirSync(join(dataDir, PROJECTS_DIR), { recursive: true });
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

  private projectDir(projectId: string): string {
    return join(this.dataDir, PROJECTS_DIR, projectId);
  }

  private openDb(projectId: string): SqliteProjectStore {
    const cached = this.open.get(projectId);
    if (cached) return cached.store;
    const dir = this.projectDir(projectId);
    const db = openDatabase(join(dir, PROJECT_DB));
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
        `workspace "${projectId}" database cannot be unlocked - wrong key or a pre-encryption dev database (delete the dev data dir to reset): ${cause instanceof Error ? cause.message : cause}`,
      );
    }
    db.pragma("journal_mode = WAL");
    db.exec(DDL);
    migrateFtsTokenizer(db, projectId);
    const store = new SqliteProjectStore(db);
    this.open.set(projectId, { store, db });
    return store;
  }

  async createProjectStore(projectId: string): Promise<ProjectStore> {
    const dir = this.projectDir(projectId);
    if (existsSync(dir)) {
      throw new Error(`workspace directory already exists: ${dir}`);
    }
    mkdirSync(join(dir, "files"), { recursive: true });
    return this.openDb(projectId);
  }

  async openProjectStore(
    projectId: string,
  ): Promise<ProjectStore | undefined> {
    if (!existsSync(join(this.projectDir(projectId), PROJECT_DB))) {
      return undefined;
    }
    return this.openDb(projectId);
  }

  /** Host-side access to the concrete store (FTS index surface). */
  openHostStore(projectId: string): SqliteProjectStore | undefined {
    if (!existsSync(join(this.projectDir(projectId), PROJECT_DB))) {
      return undefined;
    }
    return this.openDb(projectId);
  }

  async listProjectIds(): Promise<string[]> {
    const root = join(this.dataDir, PROJECTS_DIR);
    return readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => existsSync(join(root, name, PROJECT_DB)))
      .sort();
  }
}

/** LIKE 兜底没有 snippet()，自己在命中处切一段。 */
function around(content: string, needle: string, span = 40): string {
  const at = content.indexOf(needle);
  if (at < 0) return content.slice(0, span * 2);
  const from = Math.max(0, at - span);
  const to = Math.min(content.length, at + needle.length + span);
  return `${from > 0 ? "…" : ""}${content.slice(from, to)}${to < content.length ? "…" : ""}`;
}

/**
 * 把已存在的 fts_index 换成 trigram 分词器（见 FTS_TOKENIZER 上的说明）。
 *
 * `CREATE VIRTUAL TABLE IF NOT EXISTS` 碰上已存在的表什么也不做，所以老库会
 * 一直留着那个对中文零命中的索引 —— 而它不报错，只是永远查不到东西。
 *
 * 迁移**不回读源文件**：索引行里本来就存着 name 与 content，原样搬过去即可。
 * 回读要连接器、要磁盘、还可能读到已经变了的内容，而这里要的只是换个分词器。
 */
function migrateFtsTokenizer(db: Database.Database, projectId: string): void {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE name = 'fts_index'")
    .get() as { sql?: string } | undefined;
  const sql = row?.sql ?? "";
  if (!sql || sql.includes(FTS_TOKENIZER)) return;

  const rows = db
    .prepare("SELECT item_id, type, name, content FROM fts_index")
    .all() as Array<{
    item_id: string;
    type: string;
    name: string;
    content: string;
  }>;
  // 一个事务：迁移中途崩了，要么还是旧表，要么已经是新表，不会留下一张空的
  // 新表 —— 那种状态下检索会安静地返回「没找到」。
  db.exec("BEGIN");
  try {
    db.exec("DROP TABLE fts_index");
    db.exec(
      `CREATE VIRTUAL TABLE fts_index USING fts5(
         item_id UNINDEXED, type UNINDEXED, name, content,
         tokenize='${FTS_TOKENIZER}'
       )`,
    );
    const insert = db.prepare(
      "INSERT INTO fts_index (item_id, type, name, content) VALUES (?, ?, ?, ?)",
    );
    for (const r of rows) insert.run(r.item_id, r.type, r.name, r.content);
    db.exec("COMMIT");
  } catch (cause) {
    db.exec("ROLLBACK");
    throw cause;
  }
  console.log(
    `[ruyin] ${projectId}: 检索索引已换用 ${FTS_TOKENIZER} 分词器（${rows.length} 条）`,
  );
}
