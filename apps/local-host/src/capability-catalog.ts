/**
 * Runos 能力清单（ADR-020 §6.2，RY-204）—— 本机保有的一份与平台 Runos 能力目录一致的
 * **清单**。清单，不是安装：条目不触发下载、不进登记册；本机能跑什么仍由登记册说了算，
 * 这里只**读**登记册的事实来标「本机可运行」，从不喂它。
 *
 * owner 2026-09-15 定（RY-204）：
 *   D1 平台源是唯一正式源 —— 不随包带快照，不从构建产物推导。平台端点
 *      （vxture-platform#339）没就位之前，状态就是 `unavailable`，界面如实说。
 *   D3 登录后取一次；窗口重获焦点时距上次成功超过 6 小时才取；手动随时取。
 *   D4 「本机可运行」只按能核对的规则标：技能按 `<owner>.<技能名>` 对 capabilityId；
 *      连接器只认显式对照表；执行器恒为仅云端。
 *
 * 一次同步五步，缺一步都不落盘：取（分页到底）→ 核（条数 = total、必填齐、id 不重复）
 * → 落（整份原子替换，中途失败保留上一份）→ 记（来源、时间、版本或内容哈希）→ 比
 * （新增 / 下线 / 变更）。
 *
 * 「一致」只定义为「与这一次平台返回的 total 相等」，不断言任何写死的条数：877、878、
 * 886 三个数互不相等（§6.2）。
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const PRIMITIVE_TYPES = ["skill", "connector", "executor", "asset"] as const;
export type PrimitiveType = (typeof PRIMITIVE_TYPES)[number];

/** 清单里的一条。只有元数据：完整契约、技能正文、凭证需求、端点实例都不在这里（§6.2 范围）。 */
export interface CatalogEntry {
  capabilityId: string;
  primitiveType: PrimitiveType;
  title: string;
  /** 平台按语言给的显示名（如 `zh-CN` / `en`）；没给就没有，不拿 title 补。 */
  displayName?: Record<string, string>;
  category?: string;
  tags: string[];
  summary?: string;
}

/**
 * - `unavailable` 这套装配没有可取的数据源（今天：平台还没有会话可读的目录端点）
 * - `never`       有数据源，还没成功取到过一次
 * - `synced`      盘上有一份，最近一次刷新成功
 * - `stale`       盘上有一份，此后刷新失败或数据源没了 —— 显示的是旧的，要说出来
 */
export type CatalogState = "unavailable" | "never" | "synced" | "stale";

export interface CatalogSourceStatus {
  kind: "platform";
  state: CatalogState;
  /** 平台给的版本 / ETag；平台不给时是内容哈希（`sha256:` 前缀）。 */
  ref?: string;
  /** 最近一次成功取到的时间。 */
  fetchedAt?: string;
  /** 条数（盘上那一份的）。 */
  total?: number;
  /** `unavailable` / `never` / `stale` 时说为什么。 */
  reason?: string;
  /** 最近一次成功同步相对上一份的变化。 */
  diff?: CatalogDiff;
}

export interface CatalogDiff {
  added: number;
  removed: number;
  changed: number;
}

/** 数据源给的一页。字段按平台最终给的归一（snake / camel 都认），这里不预设。 */
export interface CatalogPage {
  items: unknown[];
  total: number;
  nextCursor?: string;
  /** 目录版本或 ETag，平台给了才有。 */
  version?: string;
}

export interface CatalogSource {
  /** 这套装配有没有可取的数据源。 */
  available(): boolean;
  /** `available()` 为 false 时的原因，界面照抄。 */
  readonly unavailableReason: string;
  fetchPage(cursor: string | undefined): Promise<CatalogPage>;
}

/** D3：焦点回来时的最小间隔。给「目录一天变不了几次」定的量级，不是定数。 */
export const FOCUS_REFRESH_MIN_MS = 6 * 60 * 60 * 1000;
/** 分页上限：一个一直给下一页游标的服务端不能把同步拖成死循环。 */
export const MAX_PAGES = 200;
/** 本地列表分页。 */
export const DEFAULT_LIST_LIMIT = 100;
export const MAX_LIST_LIMIT = 1000;

export type RefreshReason = "login" | "focus" | "manual";
export const REFRESH_REASONS: readonly RefreshReason[] = ["login", "focus", "manual"];

export function catalogPath(dataDir: string): string {
  return join(dataDir, "capabilities", "catalog.json");
}

// ---------------------------------------------------------------------------
// 纯函数
// ---------------------------------------------------------------------------

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** 把数据源给的一条归一成 CatalogEntry；不合格就回一句为什么（不抛）。 */
export function normalizeEntry(raw: unknown): CatalogEntry | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "条目不是对象";
  const r = raw as Record<string, unknown>;
  const id = str(r["capability_id"] ?? r["capabilityId"]);
  if (!id) return "条目缺 capability_id";
  const type = str(r["primitive_type"] ?? r["primitiveType"]);
  if (!type || !(PRIMITIVE_TYPES as readonly string[]).includes(type)) {
    return `${id}: primitive_type 不认识（${type ?? "缺"}）`;
  }
  const title = str(r["title"]);
  if (!title) return `${id}: 缺 title`;

  const entry: CatalogEntry = { capabilityId: id, primitiveType: type as PrimitiveType, title, tags: [] };
  const dn = r["display_name"] ?? r["displayName"];
  if (dn && typeof dn === "object" && !Array.isArray(dn)) {
    const names: Record<string, string> = {};
    for (const [lang, name] of Object.entries(dn)) {
      if (typeof name === "string" && name.length > 0) names[lang] = name;
    }
    if (Object.keys(names).length > 0) entry.displayName = names;
  }
  const category = str(r["category"]);
  if (category) entry.category = category;
  if (Array.isArray(r["tags"])) entry.tags = r["tags"].filter((t): t is string => typeof t === "string");
  const summary = str(r["summary"]);
  if (summary) entry.summary = summary;
  return entry;
}

/** 平台不给版本时的「是否变了」依据：按 id 排序后整份的 sha256。 */
export function contentRef(items: readonly CatalogEntry[]): string {
  const sorted = [...items].sort((a, b) => a.capabilityId.localeCompare(b.capabilityId));
  return `sha256:${createHash("sha256").update(JSON.stringify(sorted)).digest("hex")}`;
}

export function diffCatalog(prev: readonly CatalogEntry[], next: readonly CatalogEntry[]): CatalogDiff {
  const before = new Map(prev.map((e) => [e.capabilityId, JSON.stringify(e)]));
  let added = 0;
  let changed = 0;
  for (const e of next) {
    const old = before.get(e.capabilityId);
    if (old === undefined) added++;
    else if (old !== JSON.stringify(e)) changed++;
    before.delete(e.capabilityId);
  }
  return { added, removed: before.size, changed };
}

/** D3。登录与手动总是取；焦点回来只在距上次成功够久时取。 */
export function shouldRefresh(reason: RefreshReason, lastSuccessAt: string | undefined, now: number): boolean {
  if (reason !== "focus" || !lastSuccessAt) return true;
  const at = Date.parse(lastSuccessAt);
  return Number.isNaN(at) || now - at >= FOCUS_REFRESH_MIN_MS;
}

// ---------------------------------------------------------------------------
// D4：本机可运行
// ---------------------------------------------------------------------------

/**
 * Runos 连接器 → 本机随包 MCP 服务器的**显式**对照。初始为空：两边不同名
 * （本机 `microsoft.markitdown`，Runos `markitdown.document-to-markdown`），按名字猜
 * 会把「看起来像」标成「本机可运行」。要加一条，得先核对过两边真是同一个东西。
 */
export const CONNECTOR_EQUIVALENTS: Readonly<Record<string, string>> = Object.freeze({});

export interface LocalFacts {
  /** 本机技能登记册（`SkillRegistry.list().items` 的子集字段）。 */
  skills: ReadonlyArray<{ name: string; source: string; layer: string; enabled: boolean; shadowedBy?: string }>;
  /** 本机随包服务器：id 与此刻起不起得来。 */
  servers?: ReadonlyArray<{ id: string; available: boolean }>;
}

export interface LocalRunnable {
  runnable: boolean;
  via?: "preset-skill" | "bundled-server";
}

/** 预置层技能的来源是 `<owner>.<repo>`，Runos 台账的 id 是 `<owner>.<技能名>`。 */
export function skillCapabilityId(skill: { name: string; source: string }): string {
  return `${skill.source.split(".")[0]}.${skill.name}`;
}

export function localRunnableIndex(
  facts: LocalFacts,
  equivalents: Readonly<Record<string, string>> = CONNECTOR_EQUIVALENTS,
): (entry: CatalogEntry) => LocalRunnable {
  // 只认预置层、启用着、没被更近一层盖住的那条：用户层同名的技能不是 Runos 目录里那一个。
  const skills = new Set(
    facts.skills
      .filter((s) => s.layer === "bundled" && s.enabled && !s.shadowedBy)
      .map((s) => skillCapabilityId(s)),
  );
  const servers = new Set((facts.servers ?? []).filter((s) => s.available).map((s) => s.id));
  return (entry) => {
    if (entry.primitiveType === "skill" && skills.has(entry.capabilityId)) {
      return { runnable: true, via: "preset-skill" };
    }
    if (entry.primitiveType === "connector") {
      const local = equivalents[entry.capabilityId];
      if (local && servers.has(local)) return { runnable: true, via: "bundled-server" };
    }
    return { runnable: false };
  };
}

// ---------------------------------------------------------------------------
// 清单本体
// ---------------------------------------------------------------------------

interface StoredCatalog {
  version: 1;
  ref: string;
  fetchedAt: string;
  total: number;
  items: CatalogEntry[];
  diff?: CatalogDiff;
}

export interface CatalogQuery {
  type?: string;
  category?: string;
  q?: string;
  cursor?: string;
  limit?: number;
}

export type SyncOutcome =
  | { status: "synced"; total: number; ref: string; diff: CatalogDiff }
  | { status: "skipped" }
  | { status: "unavailable"; reason: string }
  | { status: "failed"; error: string };

export class CapabilityCatalog {
  /** 最近一次同步失败的原因；成功一次就清掉。只在内存里 —— 重启后按盘上那份说话。 */
  private lastError?: string;
  private inflight?: Promise<SyncOutcome>;
  private readonly path: string;

  constructor(
    dataDir: string,
    private readonly source: CatalogSource,
    private readonly now: () => number = Date.now,
  ) {
    this.path = catalogPath(dataDir);
  }

  /** 读坏了（手改过、半截）按「从未取到」处理，不抛：清单拿不到不该拖垮任何东西。 */
  private read(): StoredCatalog | undefined {
    if (!existsSync(this.path)) return undefined;
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf8")) as Partial<StoredCatalog>;
      if (raw.version !== 1 || !Array.isArray(raw.items) || typeof raw.fetchedAt !== "string" || typeof raw.ref !== "string") {
        return undefined;
      }
      return raw as StoredCatalog;
    } catch {
      return undefined;
    }
  }

  status(): CatalogSourceStatus {
    const stored = this.read();
    if (!stored) {
      if (!this.source.available()) return { kind: "platform", state: "unavailable", reason: this.source.unavailableReason };
      return { kind: "platform", state: "never", ...(this.lastError ? { reason: this.lastError } : {}) };
    }
    const base = {
      kind: "platform" as const,
      ref: stored.ref,
      fetchedAt: stored.fetchedAt,
      total: stored.total,
      ...(stored.diff ? { diff: stored.diff } : {}),
    };
    if (!this.source.available()) return { ...base, state: "stale", reason: this.source.unavailableReason };
    if (this.lastError) return { ...base, state: "stale", reason: this.lastError };
    return { ...base, state: "synced" };
  }

  /** 盘上那一份，按条件筛、按 cursor（偏移量）分页。从未取到时就是空的，不是错误。 */
  list(query: CatalogQuery = {}): { items: CatalogEntry[]; total: number; nextCursor?: string } {
    const items = this.read()?.items ?? [];
    const needle = query.q?.trim().toLowerCase();
    const filtered = items.filter((e) => {
      if (query.type && e.primitiveType !== query.type) return false;
      if (query.category && e.category !== query.category) return false;
      if (!needle) return true;
      const hay = [e.capabilityId, e.title, e.summary ?? "", ...e.tags, ...Object.values(e.displayName ?? {})];
      return hay.some((h) => h.toLowerCase().includes(needle));
    });
    const offset = Math.max(0, Number.parseInt(query.cursor ?? "0", 10) || 0);
    const limit = Math.min(MAX_LIST_LIMIT, Math.max(1, query.limit ?? DEFAULT_LIST_LIMIT));
    const page = filtered.slice(offset, offset + limit);
    const next = offset + page.length;
    return { items: page, total: filtered.length, ...(next < filtered.length ? { nextCursor: String(next) } : {}) };
  }

  /** 同时来的几次刷新合成一次：登录后与焦点回来可能挨着到。 */
  sync(reason: RefreshReason): Promise<SyncOutcome> {
    if (!this.source.available()) {
      return Promise.resolve({ status: "unavailable", reason: this.source.unavailableReason });
    }
    if (!shouldRefresh(reason, this.read()?.fetchedAt, this.now())) return Promise.resolve({ status: "skipped" });
    this.inflight ??= this.run().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private async run(): Promise<SyncOutcome> {
    try {
      // 1 · 取
      const raw: unknown[] = [];
      let cursor: string | undefined;
      let total = 0;
      let version: string | undefined;
      for (let page = 0; ; page++) {
        if (page >= MAX_PAGES) throw new Error(`分页超过 ${MAX_PAGES} 页仍没有取完`);
        const res = await this.source.fetchPage(cursor);
        raw.push(...res.items);
        total = res.total;
        version = res.version ?? version;
        if (!res.nextCursor) break;
        if (res.nextCursor === cursor) throw new Error("分页游标没有前进");
        cursor = res.nextCursor;
      }

      // 2 · 核
      const items: CatalogEntry[] = [];
      const problems: string[] = [];
      const seen = new Set<string>();
      for (const r of raw) {
        const e = normalizeEntry(r);
        if (typeof e === "string") problems.push(e);
        else if (seen.has(e.capabilityId)) problems.push(`${e.capabilityId}: id 重复`);
        else {
          seen.add(e.capabilityId);
          items.push(e);
        }
      }
      if (problems.length > 0) {
        throw new Error(`${problems.length} 条不合格：${problems.slice(0, 3).join("；")}${problems.length > 3 ? " …" : ""}`);
      }
      if (items.length !== total) throw new Error(`取到 ${items.length} 条，平台说共 ${total} 条`);

      // 3 · 落 / 4 · 记 / 5 · 比
      const previous = this.read();
      const ref = version ?? contentRef(items);
      const diff = diffCatalog(previous?.items ?? [], items);
      const stored: StoredCatalog = {
        version: 1,
        ref,
        fetchedAt: new Date(this.now()).toISOString(),
        total,
        items,
        diff,
      };
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify(stored));
      renameSync(tmp, this.path);

      this.lastError = undefined;
      return { status: "synced", total, ref, diff };
    } catch (cause) {
      this.lastError = cause instanceof Error ? cause.message : String(cause);
      return { status: "failed", error: this.lastError };
    }
  }
}

// ---------------------------------------------------------------------------
// 平台数据源
// ---------------------------------------------------------------------------

/**
 * 平台会话读的数据源（vxture-platform#339 请求的那一条）。
 *
 * **地址不猜。** 平台还没定端点放哪（函件 70 §2 C 只给了形状建议），所以没配 `path`
 * 就是不可用 —— 不去打一个不存在的地址再把 404 翻译成「平台没有」。平台给了地址后，
 * 默认值填进来，或经 `RUYIN_RUNOS_CATALOG_PATH` 先接上验证。
 */
export function platformCatalogSource(opts: {
  path: string | undefined;
  signedIn: () => boolean;
  read: (pathWithQuery: string) => Promise<{ body: unknown; etag?: string }>;
  pageSize?: number;
}): CatalogSource {
  const pageSize = opts.pageSize ?? 500;
  return {
    available: () => Boolean(opts.path),
    unavailableReason: "平台尚未提供能力目录（vxture-platform#339）",
    async fetchPage(cursor) {
      if (!opts.path) throw new Error("平台尚未提供能力目录（vxture-platform#339）");
      if (!opts.signedIn()) throw new Error("未登录平台，取不到能力目录");
      const q = new URLSearchParams({ limit: String(pageSize) });
      if (cursor) q.set("cursor", cursor);
      const sep = opts.path.includes("?") ? "&" : "?";
      const { body, etag } = await opts.read(`${opts.path}${sep}${q.toString()}`);
      return parsePlatformPage(body, etag);
    },
  };
}

/** 平台一页的归一：`items` 或 `capabilities`、`nextCursor` 或 `next_cursor`、`total` 必须有。 */
export function parsePlatformPage(body: unknown, etag?: string): CatalogPage {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("能力目录响应不是对象");
  const b = body as Record<string, unknown>;
  const items = b["items"] ?? b["capabilities"];
  if (!Array.isArray(items)) throw new Error("能力目录响应缺 items");
  const total = b["total"];
  if (typeof total !== "number" || !Number.isInteger(total) || total < 0) throw new Error("能力目录响应缺 total");
  const next = str(b["nextCursor"] ?? b["next_cursor"]);
  const version = str(b["version"]) ?? str(etag);
  return { items, total, ...(next ? { nextCursor: next } : {}), ...(version ? { version } : {}) };
}
