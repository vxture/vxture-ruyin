/**
 * FTS5-backed relevance ranking + index maintenance
 * (docs/30-design/40-context-architecture.md sections 5.1, 6.1).
 *
 * Keyword/structure indexing is built and stored locally - no data leaves the
 * device. Note: the default unicode61 tokenizer does not segment Chinese
 * text; CJK relevance is therefore coarse in this phase (candidates that
 * don't match fall back to recency order, so selection still works).
 */

import type { Binding, ConnectorPort, ContextItemMeta, RankerPort } from "@vxture/ruyin-core";
import type { SqliteStoragePort } from "./storage.js";

/** Rebuild the index rows for one binding's type from connector content. */
export async function reindexBinding(
  storage: SqliteStoragePort,
  projectId: string,
  binding: Binding,
  connector: ConnectorPort,
): Promise<number> {
  const store = storage.openHostStore(projectId);
  if (!store) throw new Error(`workspace "${projectId}" not found`);
  const metas = await connector.discover(binding);
  const rows = [];
  for (const meta of metas) {
    const item = await connector.read(meta);
    // Only text has words to match. Non-text items stay in the index by name
    // so they remain findable and selectable - dropping them would quietly
    // remove the user's file from consideration. What must NOT go in is a
    // stand-in body: indexing "unrecognized file type" made every such file
    // match a search for those words.
    rows.push({
      id: item.id,
      name: item.name,
      content: item.content.kind === "text" ? item.content.text : "",
    });
  }
  store.replaceIndexForType(binding.type, rows);
  return rows.length;
}

/** Escape user text into a safe OR-of-phrases FTS5 MATCH expression. */
function toMatchQuery(text: string): string {
  const tokens = text
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2)
    .slice(0, 12);
  if (tokens.length === 0) return "";
  return tokens.map((t) => `"${t.replaceAll('"', '""')}"`).join(" OR ");
}

export class FtsRanker implements RankerPort {
  constructor(private readonly storage: SqliteStoragePort) {}

  async rank(
    projectId: string,
    query: string,
    candidates: ContextItemMeta[],
  ): Promise<ContextItemMeta[]> {
    const store = this.storage.openHostStore(projectId);
    const match = toMatchQuery(query);
    let orderedIds: string[] = [];
    if (store && match.length > 0) {
      try {
        orderedIds = store.searchIndex(match);
      } catch {
        orderedIds = []; // malformed MATCH - fall back to recency
      }
    }
    const position = new Map(orderedIds.map((id, i) => [id, i]));
    return [...candidates].sort((a, b) => {
      const pa = position.get(a.id);
      const pb = position.get(b.id);
      if (pa !== undefined && pb !== undefined) return pa - pb;
      if (pa !== undefined) return -1;
      if (pb !== undefined) return 1;
      return b.modifiedAt.localeCompare(a.modifiedAt);
    });
  }
}

/** 一条命中：给模型看的最小单位。 */
export interface SearchHit {
  /** 上下文项 id —— 模型可以据此回到完整资料。 */
  id: string;
  name: string;
  /** 命中处的摘录，不是整篇。 */
  excerpt: string;
}

export interface SearchOutcome {
  hits: SearchHit[];
  /**
   * 匹配上、但**不在本任务上下文集内**因而没有返回的条数。
   *
   * 报这个数而不是悄悄丢掉：一次查询在库里有二十条、只有两条在范围内，模型
   * 拿到两条会以为案例库就这么薄，然后写出一份更弱的方案。说出来，不给内容。
   */
  outOfScope: number;
}

/** trigram 的下限。低于它 MATCH 一律不中，要走子串扫描。 */
const TRIGRAM_MIN = 3;

/**
 * 在**本任务的上下文集内**检索。
 *
 * 范围就是上下文集，不是整个项目索引：上下文集是这次任务选出来、必要时经用户
 * 确认过的那一批资料。让检索伸到它之外，等于让工具绕过那道确认 —— 那道闸门也
 * 就成了摆设。
 */
export function searchContext(
  storage: SqliteStoragePort,
  projectId: string,
  query: string,
  scope: ContextItemMeta[],
  limit: number,
): SearchOutcome {
  const store = storage.openHostStore(projectId);
  if (!store || scope.length === 0) return { hits: [], outOfScope: 0 };
  const inScope = new Set(scope.map((item) => item.id));

  // 多取一些再按范围过滤：先截断再过滤会让范围外的命中挤掉范围内的。
  const wide = Math.max(limit * 4, 40);
  const trimmed = query.trim();
  let found: Array<{ id: string; name: string; excerpt: string }> = [];
  const match = toMatchQuery(trimmed);
  if (match.length > 0) {
    try {
      found = store.searchExcerpts(match, wide);
    } catch {
      found = []; // malformed MATCH
    }
  }
  // trigram 查不到两字词，而「储能」「案例」这类恰恰是中文里最常查的。
  if (found.length === 0 && trimmed.length > 0 && trimmed.length < TRIGRAM_MIN) {
    found = store.scanIndex(trimmed, wide);
  }

  const hits = found.filter((row) => inScope.has(row.id));
  return {
    hits: hits.slice(0, limit),
    outOfScope: found.length - hits.length,
  };
}
