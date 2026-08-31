/**
 * local-fs connector - grant-scoped local file access
 * (docs/30-design/40-context-architecture.md section 4).
 *
 * Grant containment is validated by the kernel when a binding is created and
 * revalidated at selection time; this connector additionally never walks
 * outside the binding root it is given.
 *
 * On content: this connector reports what a file **is**, and never invents a
 * body for one it cannot read as text. A recognized non-text format is carried
 * as bytes with its media type; anything else - unknown format, oversized,
 * unreadable - comes back `unavailable` with the reason. No parsing happens
 * here: turning a PDF into text is a model capability the product supplies
 * (ADR-008, TD-018), and a parser in the connector would also be this layer
 * deciding what the material says.
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

/**
 * Formats carried as bytes. Deliberately short: this is a **carrier** table,
 * not a support matrix. An entry here says "these bytes have a name", nothing
 * about whether anything downstream can read them - the provider answers that,
 * and answers it honestly, which a placeholder body would have prevented.
 */
const BINARY_MEDIA_TYPES = new Map<string, string>([
  [".pdf", "application/pdf"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  [".doc", "application/msword"],
  [".xls", "application/vnd.ms-excel"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
]);

const MAX_DEPTH = 4;
const MAX_FILES = 500;
const MAX_CONTENT_BYTES = 256_000;
/**
 * Cap on bytes carried for one non-text item. Larger than the text cap because
 * a document format spends bytes on structure, but still a cap: an oversized
 * file is reported as such, never silently cut. Truncated bytes are not a
 * smaller document - they are a corrupt one, and a reader cannot tell.
 */
const MAX_BINARY_BYTES = 20_000_000;

function itemId(absPath: string): string {
  return `itm_${createHash("sha256").update(absPath).digest("hex").slice(0, 16)}`;
}

function unavailable(
  item: ContextItemMeta,
  reason: string,
  mediaType?: string,
): ContextItem {
  return {
    ...item,
    content: { kind: "unavailable", reason, ...(mediaType ? { mediaType } : {}) },
  };
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
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
    const ext = extname(item.ref).toLowerCase();

    if (TEXT_EXTENSIONS.has(ext)) {
      let buffer: Buffer;
      try {
        buffer = readFileSync(item.ref);
      } catch (cause) {
        return unavailable(item, `unreadable: ${describe(cause)}`);
      }
      const truncated = buffer.byteLength > MAX_CONTENT_BYTES;
      // Truncation is reported as a fact, not appended as a sentence: a note
      // inside the body is indistinguishable from something the document says.
      return {
        ...item,
        content: {
          kind: "text",
          text: buffer.subarray(0, MAX_CONTENT_BYTES).toString("utf8"),
          ...(truncated ? { truncated: true } : {}),
        },
      };
    }

    const mediaType = BINARY_MEDIA_TYPES.get(ext);
    if (!mediaType) {
      return unavailable(item, `unrecognized file type "${ext || "(none)"}"`);
    }
    // Sized here, not from the meta: that size was taken at discovery, and a
    // file that grew since would walk straight past a check made against the
    // old number.
    let size: number;
    try {
      size = statSync(item.ref).size;
    } catch (cause) {
      return unavailable(item, `unreadable: ${describe(cause)}`, mediaType);
    }
    if (size > MAX_BINARY_BYTES) {
      return unavailable(
        item,
        `exceeds the ${MAX_BINARY_BYTES}-byte limit for carried files (${size} bytes)`,
        mediaType,
      );
    }
    let bytes: Buffer;
    try {
      bytes = readFileSync(item.ref);
    } catch (cause) {
      return unavailable(item, `unreadable: ${describe(cause)}`, mediaType);
    }
    return { ...item, content: { kind: "binary", mediaType, bytes } };
  }
}
