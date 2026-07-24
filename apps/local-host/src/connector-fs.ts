/**
 * local-fs connector - grant-scoped local file access
 * (docs/30-design/40-context-architecture.md section 4).
 *
 * Grant containment is validated by the kernel when a binding is created and
 * revalidated at selection time; this connector additionally never walks
 * outside the binding root it is given. Text content only in this phase;
 * binary files surface as metadata-only items with a placeholder body.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import type {
  Binding,
  ConnectorPort,
  ContextItem,
  ContextItemMeta,
} from "@vxture/ruyin-core";

const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown", ".yaml", ".yml", ".json", ".csv", ".xml", ".html",
]);
const MAX_DEPTH = 4;
const MAX_FILES = 500;
const MAX_CONTENT_BYTES = 256_000;

function itemId(absPath: string): string {
  return `itm_${createHash("sha256").update(absPath).digest("hex").slice(0, 16)}`;
}

export class LocalFsConnector implements ConnectorPort {
  async discover(binding: Binding): Promise<ContextItemMeta[]> {
    const items: ContextItemMeta[] = [];
    const walk = (dir: string, depth: number): void => {
      if (depth > MAX_DEPTH || items.length >= MAX_FILES) return;
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return; // unreadable subdir - skip, never fail discovery wholesale
      }
      for (const entry of entries) {
        if (items.length >= MAX_FILES) return;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
            walk(full, depth + 1);
          }
          continue;
        }
        if (!entry.isFile()) continue;
        const stat = statSync(full);
        items.push({
          id: itemId(full),
          type: binding.type,
          source: "local",
          ref: full,
          name: relative(binding.root, full).split(sep).join("/"),
          bytes: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        });
      }
    };
    walk(binding.root, 0);
    return items;
  }

  async read(item: ContextItemMeta): Promise<ContextItem> {
    if (!TEXT_EXTENSIONS.has(extname(item.ref).toLowerCase())) {
      return {
        ...item,
        content: `[binary or unsupported file type: ${item.name}]`,
      };
    }
    const buffer = readFileSync(item.ref);
    const truncated = buffer.byteLength > MAX_CONTENT_BYTES;
    const content = buffer.subarray(0, MAX_CONTENT_BYTES).toString("utf8");
    return {
      ...item,
      content: truncated ? `${content}\n[truncated at ${MAX_CONTENT_BYTES} bytes]` : content,
    };
  }
}
