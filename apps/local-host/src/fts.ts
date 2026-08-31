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
