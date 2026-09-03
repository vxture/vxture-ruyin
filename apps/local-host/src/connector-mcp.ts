/**
 * MCP connector - context from a LAN / private-service MCP server
 * (ADR-005 path two; docs/30-design/40-context-architecture.md §4.2).
 *
 * The same contract as local-fs, seen from the other side of a process
 * boundary: `discover()` lists the server's resources under the binding's URI
 * prefix, `read()` fetches one. Same content discipline as local-fs - text as
 * text with a truncation flag, bytes with their media type, and everything
 * else `unavailable` with the reason. No parsing here either (ADR-011).
 *
 * A transport failure is an `unavailable` item, not an exception: the harness
 * treats a thrown read as "task failed", while what actually happened is that
 * this one resource could not be fetched - the provider should be told that
 * and reason with the rest. Discovery failing wholesale does throw: with no
 * list at all there is no item to attach an answer to.
 */

import { createHash } from "node:crypto";
import type {
  Binding,
  ConnectorHealth,
  ConnectorPort,
  ContextItem,
  ContextItemMeta,
} from "@vxture/ruyin-core";
import { McpStdioClient, type McpResource, type McpServerSpec } from "./mcp-client.js";

/** Mirrors local-fs: what one text item may bring into a turn. */
const MAX_CONTENT_BYTES = 256_000;
/** Mirrors local-fs: a larger cap for bytes, still a cap - truncated bytes are a corrupt document. */
const MAX_BINARY_BYTES = 20_000_000;
/** Mirrors local-fs's MAX_FILES: an item list is a selection input, not a dump. */
const MAX_ITEMS = 500;

export interface McpConnectorSpec extends McpServerSpec {
  /** Connector id the host registers it under; items carry it (ADR-005 seam ②). */
  id: string;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function unavailable(item: ContextItemMeta, reason: string, mediaType?: string): ContextItem {
  return {
    ...item,
    content: { kind: "unavailable", reason, ...(mediaType ? { mediaType } : {}) },
  };
}

/** Last path-ish segment of a URI, for a display name when the server gives none. */
function tailOf(uri: string): string {
  const stripped = uri.replace(/[/?#]+$/, "");
  const idx = Math.max(stripped.lastIndexOf("/"), stripped.lastIndexOf(":"));
  return idx >= 0 ? stripped.slice(idx + 1) || uri : uri;
}

export class McpConnector implements ConnectorPort {
  readonly id: string;
  private readonly client: McpStdioClient;

  constructor(spec: McpConnectorSpec, options: { timeoutMs?: number } = {}) {
    this.id = spec.id;
    const { id: _id, ...server } = spec;
    this.client = new McpStdioClient(server, {
      ...options,
      clientInfo: { name: "ruyin", version: "0.1.0" },
    });
  }

  async start(): Promise<void> {
    await this.client.start();
  }

  async stop(): Promise<void> {
    await this.client.stop();
  }

  async health(): Promise<ConnectorHealth> {
    const checkedAt = new Date().toISOString();
    if (!this.client.running) {
      return { ok: false, detail: "not running", checkedAt };
    }
    try {
      await this.client.ping();
      const info = this.client.serverInfo;
      const name = info?.serverInfo?.name;
      return {
        ok: true,
        ...(name ? { detail: `${name} ${info?.serverInfo?.version ?? ""}`.trim() } : {}),
        checkedAt,
      };
    } catch (cause) {
      const stderr = this.client.diagnostics;
      return {
        ok: false,
        detail: stderr ? `${describe(cause)}; stderr: ${stderr.slice(-300)}` : describe(cause),
        checkedAt,
      };
    }
  }

  async discover(binding: Binding): Promise<ContextItemMeta[]> {
    const resources = await this.client.listResources();
    const items: ContextItemMeta[] = [];
    for (const r of resources) {
      if (items.length >= MAX_ITEMS) break;
      // The binding root is a URI prefix: the project bound "crm://accounts/",
      // and nothing outside it is this project's business.
      if (!r.uri.startsWith(binding.root)) continue;
      items.push(this.metaFor(r, binding));
    }
    return items;
  }

  async read(item: ContextItemMeta): Promise<ContextItem> {
    let contents;
    try {
      contents = await this.client.readResource(item.ref);
    } catch (cause) {
      return unavailable(item, `connector "${this.id}" could not read: ${describe(cause)}`);
    }
    const first = contents[0];
    if (!first) {
      return unavailable(item, `connector "${this.id}" returned no content`);
    }
    if ("text" in first && typeof first.text === "string") {
      const buffer = Buffer.from(first.text, "utf8");
      const truncated = buffer.byteLength > MAX_CONTENT_BYTES;
      return {
        ...item,
        content: {
          kind: "text",
          text: truncated ? buffer.subarray(0, MAX_CONTENT_BYTES).toString("utf8") : first.text,
          ...(truncated ? { truncated: true } : {}),
        },
      };
    }
    if ("blob" in first && typeof first.blob === "string") {
      const mediaType = first.mimeType ?? "application/octet-stream";
      const bytes = Buffer.from(first.blob, "base64");
      if (bytes.byteLength > MAX_BINARY_BYTES) {
        return unavailable(
          item,
          `too large to carry (${bytes.byteLength} bytes > ${MAX_BINARY_BYTES})`,
          mediaType,
        );
      }
      return {
        ...item,
        // Size from what actually arrived, not from the listing: the listing's
        // `size` is optional and may be stale, and the audit reports what left.
        bytes: bytes.byteLength,
        content: { kind: "binary", mediaType, bytes: new Uint8Array(bytes) },
      };
    }
    return unavailable(item, `connector "${this.id}" returned content with neither text nor blob`);
  }

  private metaFor(r: McpResource, binding: Binding): ContextItemMeta {
    return {
      // Stable across restarts and distinct per connector: two servers may
      // both expose "crm://accounts/1".
      id: `itm_${createHash("sha256").update(`${this.id}\n${r.uri}`).digest("hex").slice(0, 16)}`,
      type: binding.type,
      source: binding.source,
      connector: this.id,
      ref: r.uri,
      name: r.title ?? r.name ?? tailOf(r.uri),
      bytes: typeof r.size === "number" ? r.size : 0,
      // MCP resources carry no mtime unless the server annotates one. Empty
      // means "unknown" - not "now", which would fake a fact the ranker and
      // the audit would then repeat.
      modifiedAt: r.annotations?.lastModified ?? "",
    };
  }
}
