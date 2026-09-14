/**
 * Minimal MCP client over the Streamable HTTP transport (ADR-005 path two,
 * batch E; workplan "通路二 E"; TD-035 explains why it waited for stdio to
 * ship first).
 *
 * Same subset as mcp-client.ts's stdio client - `initialize` +
 * `notifications/initialized`, `resources/list` (paginated), `resources/read`,
 * `ping`, `tools/list`, `tools/call` - carried over the wire shape MCP calls
 * "Streamable HTTP": one endpoint that takes POST, a response that is either
 * a single JSON object or a Server-Sent Events stream, and an
 * `Mcp-Session-Id` header the server may hand out at `initialize` and the
 * client must echo on every later request until it explicitly ends the
 * session with DELETE.
 *
 * Failure posture matches the stdio client: a request either resolves with
 * the server's `result`, or rejects with a `McpError` naming the method -
 * network refused, non-2xx status, malformed body, or timeout. `stop()` best-
 * effort tells the server the session is done; a server that never hears it
 * will time the session out on its own, same as a client that vanishes.
 *
 * No dependency added for this: Node's built-in `fetch` speaks HTTP, and the
 * SSE half of the wire format is "lines starting with `data:`, blank line
 * ends the event" - small enough to parse by hand with the same
 * bounded-buffer discipline `mcp-client.ts` uses for stdio (TD-046): a server
 * that never sends a blank line must not be allowed to grow this process's
 * memory without limit.
 */

import {
  MCP_PROTOCOL_VERSION,
  McpError,
  type McpClient,
  type McpResource,
  type McpResourceContent,
  type McpServerInfo,
  type McpTool,
  type McpToolResult,
} from "./mcp-client.js";
import { DEFAULT_RESOURCE_LIMITS } from "./resource-limits.js";

export interface McpHttpServerSpec {
  url: string;
  /** Extra request headers - e.g. an auth token the target service wants. Never logged. */
  headers?: Record<string, string>;
}

const DEFAULT_TIMEOUT_MS = 15_000;
/** Pages of resources/list we will follow before giving up on a runaway server. */
const MAX_LIST_PAGES = 50;

interface RpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** One parsed SSE event's `data:` field, joined per the SSE spec (multiple `data:` lines join with `\n`). */
function parseSseEvent(block: string): string | undefined {
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
    // `event:` / `id:` / `retry:` / comments (`:...`) carry nothing this
    // client's protocol subset needs - JSON-RPC framing lives entirely in
    // `data:`, so anything else is silently not ours to interpret.
  }
  return dataLines.length > 0 ? dataLines.join("\n") : undefined;
}

export class McpHttpClient implements McpClient {
  private nextId = 1;
  private sessionId: string | undefined;
  private negotiated = false;
  private started = false;
  private stopped = false;
  private info: McpServerInfo | undefined;
  private diagnosticsTail = "";

  constructor(
    private readonly spec: McpHttpServerSpec,
    private readonly options: {
      timeoutMs?: number;
      clientInfo?: { name: string; version: string };
      /** 一次响应体（含 SSE 事件缓冲）的字节上限（TD-046，与 stdio 那条同一个数）。 */
      maxResponseBytes?: number;
    } = {},
  ) {}

  get serverInfo(): McpServerInfo | undefined {
    return this.info;
  }

  /** No child process to watch here - "running" is "session open, not yet stopped". */
  get running(): boolean {
    return this.started && !this.stopped;
  }

  get diagnostics(): string {
    return this.diagnosticsTail.trim();
  }

  async start(): Promise<McpServerInfo> {
    if (this.started) throw new McpError("start", "already started");
    this.started = true;
    let info: McpServerInfo;
    try {
      info = (await this.request("initialize", {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: this.options.clientInfo ?? { name: "ruyin", version: "0.1.0" },
      })) as McpServerInfo;
    } catch (cause) {
      this.started = false;
      throw cause;
    }
    if (typeof info?.protocolVersion !== "string") {
      this.started = false;
      throw new McpError("initialize", "server returned no protocolVersion");
    }
    this.negotiated = true;
    this.info = info;
    await this.notify("notifications/initialized", {});
    return info;
  }

  /** Best-effort session teardown. Safe to call twice. */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (!this.sessionId) return;
    try {
      await fetch(this.spec.url, { method: "DELETE", headers: this.headers() });
    } catch {
      // Fire and forget: the server GCs an idle session on its own timeout,
      // and a client that already decided to stop should not fail on that.
    }
  }

  async ping(): Promise<void> {
    await this.request("ping", {});
  }

  async listResources(): Promise<McpResource[]> {
    const out: McpResource[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const result = (await this.request(
        "resources/list",
        cursor ? { cursor } : {},
      )) as { resources?: McpResource[]; nextCursor?: string };
      out.push(...(result.resources ?? []));
      if (!result.nextCursor) return out;
      cursor = result.nextCursor;
    }
    throw new McpError("resources/list", `more than ${MAX_LIST_PAGES} pages`);
  }

  async listTools(): Promise<McpTool[]> {
    const out: McpTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const result = (await this.request("tools/list", cursor ? { cursor } : {})) as {
        tools?: McpTool[];
        nextCursor?: string;
      };
      out.push(...(result.tools ?? []));
      if (!result.nextCursor) return out;
      cursor = result.nextCursor;
    }
    throw new McpError("tools/list", `more than ${MAX_LIST_PAGES} pages`);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const result = (await this.request("tools/call", { name, arguments: args })) as McpToolResult;
    return { ...result, content: Array.isArray(result?.content) ? result.content : [] };
  }

  async readResource(uri: string): Promise<McpResourceContent[]> {
    const result = (await this.request("resources/read", { uri })) as {
      contents?: McpResourceContent[];
    };
    return result.contents ?? [];
  }

  // -- wire --------------------------------------------------------------

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
      ...(this.negotiated ? { "mcp-protocol-version": MCP_PROTOCOL_VERSION } : {}),
      ...(this.spec.headers ?? {}),
    };
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    if (this.stopped) throw new McpError(method, "stopped");
    if (!this.started && method !== "initialize") {
      throw new McpError(method, "not started");
    }
    const id = this.nextId++;
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(this.spec.url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: controller.signal,
      });
      const sid = res.headers.get("mcp-session-id");
      if (sid) this.sessionId = sid;
      return await this.consume(res, method, id);
    } catch (cause) {
      if (cause instanceof McpError) throw cause;
      if (cause instanceof Error && cause.name === "AbortError") {
        throw new McpError(method, `no reply within ${timeoutMs}ms`);
      }
      throw new McpError(method, describe(cause));
    } finally {
      clearTimeout(timer);
    }
  }

  private async notify(method: string, params: unknown): Promise<void> {
    try {
      const res = await fetch(this.spec.url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ jsonrpc: "2.0", method, params }),
      });
      // A notification has no answer - the body (if any) is not ours to read.
      await res.body?.cancel().catch(() => {});
    } catch {
      // Fire and forget, same as the stdio client's notify() over stdin.
    }
  }

  /** Read one HTTP response and pull out the JSON-RPC message with this id. */
  private async consume(res: Response, method: string, id: number): Promise<unknown> {
    if (!res.ok) {
      const bodyText = await this.readBounded(res.body, `HTTP ${res.status}`);
      const parsed = tryParseJson(bodyText);
      const errorMessage = !Array.isArray(parsed) ? parsed?.error : undefined;
      if (errorMessage) throw new McpError(method, errorMessage.message, errorMessage.code);
      if (res.status === 404) throw new McpError(method, "session not found or expired (HTTP 404)");
      throw new McpError(
        method,
        `HTTP ${res.status}${res.statusText ? " " + res.statusText : ""}${bodyText ? ": " + bodyText.slice(0, 300) : ""}`,
      );
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("text/event-stream")) {
      return this.consumeSse(res, method, id);
    }
    if (res.status === 202 || !res.body) {
      // Accepted-with-no-body is valid for a notification, not for a request
      // that expects a result - the honest read is "no answer came back".
      throw new McpError(method, `server accepted without a result (HTTP ${res.status})`);
    }
    const bodyText = await this.readBounded(res.body, method);
    const message = this.pickMessage(tryParseJson(bodyText), id);
    if (!message) throw new McpError(method, "response carried no message for this request");
    if (message.error) throw new McpError(method, message.error.message, message.error.code);
    return message.result;
  }

  /** A batch reply is an array; a single reply is one object. Either way, find our id. */
  private pickMessage(parsed: RpcMessage | RpcMessage[] | undefined, id: number): RpcMessage | undefined {
    if (!parsed) return undefined;
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list.find((m) => m.id === id);
  }

  /**
   * Server-initiated messages arrive as SSE events until ours shows up.
   * Anything with our id and a result/error is the answer; a server request
   * (has `method` and an `id`) gets an honest "not implemented" the same way
   * the stdio client answers one on its own channel - this client offers no
   * sampling/roots/elicitation capability, and silence would hang the server.
   * A notification (`method`, no `id`) is ignored, same as stdio.
   */
  private async consumeSse(res: Response, method: string, id: number): Promise<unknown> {
    const reader = res.body?.getReader();
    if (!reader) throw new McpError(method, "event-stream response had no body");
    const decoder = new TextDecoder();
    const max = this.options.maxResponseBytes ?? DEFAULT_RESOURCE_LIMITS.maxServerLineBytes;
    let buffer = "";
    let bufferBytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        bufferBytes += Buffer.byteLength(chunk, "utf8");
        for (;;) {
          const at = buffer.indexOf("\n\n");
          if (at < 0) break;
          const block = buffer.slice(0, at);
          buffer = buffer.slice(at + 2);
          bufferBytes -= Buffer.byteLength(block, "utf8") + 2;
          const data = parseSseEvent(block);
          if (data === undefined) continue;
          const message = tryParseJson(data);
          if (!message || Array.isArray(message)) continue;
          if (message.id === id && (message.result !== undefined || message.error !== undefined)) {
            if (message.error) throw new McpError(method, message.error.message, message.error.code);
            return message.result;
          }
          if (message.method && message.id !== undefined && message.id !== null) {
            this.replyNotImplemented(message.method, message.id);
            continue;
          }
          // A notification meant for someone else's subscription - ignored.
        }
        if (bufferBytes > max) {
          throw new McpError(
            method,
            `server sent more than ${max} bytes without completing an event - stopping`,
          );
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    throw new McpError(method, "event stream ended before answering this request");
  }

  /** Fire-and-forget reply to a server request this client cannot serve. */
  private replyNotImplemented(method: string, id: number | string): void {
    this.diagnosticsTail = (
      this.diagnosticsTail + `\n[server asked ${method}, replied -32601]`
    ).slice(-4000);
    fetch(this.spec.url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `client does not implement ${method}` },
      }),
    })
      .then((r) => r.body?.cancel())
      .catch(() => {});
  }

  /** Read a body stream into a string, refusing to buffer past the cap (TD-046). */
  private async readBounded(body: ReadableStream<Uint8Array> | null, label: string): Promise<string> {
    if (!body) return "";
    const max = this.options.maxResponseBytes ?? DEFAULT_RESOURCE_LIMITS.maxServerLineBytes;
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > max) {
          throw new McpError(label, `response exceeded ${max} bytes - stopping`);
        }
        text += decoder.decode(value, { stream: true });
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    return text;
  }
}

function tryParseJson(text: string | undefined): RpcMessage | RpcMessage[] | undefined {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as RpcMessage | RpcMessage[];
  } catch {
    return undefined;
  }
}
