/**
 * Minimal MCP client over the stdio transport (ADR-005 path two).
 *
 * What it speaks: JSON-RPC 2.0, one message per line, over a child process's
 * stdin/stdout - the MCP "stdio" transport. Of the protocol it implements
 * exactly what a **read-only context connector** needs: `initialize` +
 * `notifications/initialized`, `resources/list` (paginated), `resources/read`,
 * `ping`. Tools are deliberately not here yet (workplan 通路二 D, TD-034): a
 * tool call is an effect, and effects go through the Tool Gate, which has no
 * mapping for connector tools until the owner decides where that mapping
 * comes from.
 *
 * Why not the official SDK: it drags express / hono / cors / jose and friends
 * into a daemon that **ships inside the installer**, for a client that uses
 * four methods. The subset is small enough to test end to end against a fake
 * server (see fake-mcp-server.ts). If HTTP transport or a wider surface is
 * ever needed, this file is what gets replaced - nothing else knows JSON-RPC.
 *
 * Failure posture: a request either resolves with the server's `result`, or
 * rejects with a `McpError` naming the method - transport gone, server said
 * error, or timeout. It never resolves with something that looks like a
 * result but is not one; the connector above turns rejections into
 * `unavailable` items, which is the honest answer at that layer.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";

/** The protocol revision this client negotiates. */
export const MCP_PROTOCOL_VERSION = "2025-06-18";

export interface McpServerSpec {
  command: string;
  args?: string[];
  /** Extra environment for the child. PATH is inherited; nothing else is. */
  env?: Record<string, string>;
  cwd?: string;
}

export interface McpResource {
  uri: string;
  name?: string;
  title?: string;
  description?: string;
  mimeType?: string;
  size?: number;
  annotations?: { lastModified?: string; audience?: string[]; priority?: number };
}

export type McpResourceContent =
  | { uri: string; mimeType?: string; text: string }
  | { uri: string; mimeType?: string; blob: string };

export interface McpServerInfo {
  protocolVersion: string;
  serverInfo?: { name?: string; version?: string };
  capabilities?: Record<string, unknown>;
}

export class McpError extends Error {
  constructor(
    readonly method: string,
    message: string,
    readonly code?: number,
  ) {
    super(`mcp ${method}: ${message}`);
  }
}

interface Pending {
  method: string;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

interface RpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

const DEFAULT_TIMEOUT_MS = 15_000;
/** Pages of resources/list we will follow before giving up on a runaway server. */
const MAX_LIST_PAGES = 50;

export class McpStdioClient {
  private child: ChildProcess | undefined;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private stderrTail = "";
  private exited: string | undefined;
  private info: McpServerInfo | undefined;

  constructor(
    private readonly spec: McpServerSpec,
    private readonly options: {
      timeoutMs?: number;
      clientInfo?: { name: string; version: string };
    } = {},
  ) {}

  get serverInfo(): McpServerInfo | undefined {
    return this.info;
  }

  get running(): boolean {
    return this.child !== undefined && this.exited === undefined;
  }

  /** Spawn the server and complete the initialize handshake. */
  async start(): Promise<McpServerInfo> {
    if (this.child) throw new McpError("start", "already started");
    const child = spawn(this.spec.command, this.spec.args ?? [], {
      cwd: this.spec.cwd,
      // Not the daemon's whole environment: a connector gets PATH so its
      // runtime resolves, plus what its spec names, and nothing else - the
      // daemon's env carries the session token.
      env: {
        ...(process.env["PATH"] ? { PATH: process.env["PATH"] } : {}),
        ...(process.env["SYSTEMROOT"] ? { SYSTEMROOT: process.env["SYSTEMROOT"] } : {}),
        ...(this.spec.env ?? {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    this.exited = undefined;

    child.on("error", (cause) => this.teardown(`spawn failed: ${cause.message}`));
    child.on("exit", (code, signal) =>
      this.teardown(`server exited (${signal ?? `code ${code}`})`),
    );
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      // Keep a bounded tail for diagnostics; a chatty server must not grow memory.
      this.stderrTail = (this.stderrTail + chunk).slice(-4000);
    });
    const lines = createInterface({ input: child.stdout!, crlfDelay: Infinity });
    lines.on("line", (line) => this.onLine(line));

    const info = (await this.request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: this.options.clientInfo ?? { name: "ruyin", version: "0.1.0" },
    })) as McpServerInfo;
    if (typeof info?.protocolVersion !== "string") {
      throw new McpError("initialize", "server returned no protocolVersion");
    }
    this.notify("notifications/initialized", {});
    this.info = info;
    return info;
  }

  /** Terminate the server. Safe to call twice. */
  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.teardown("stopped by client");
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
    }
  }

  async ping(): Promise<void> {
    await this.request("ping", {});
  }

  /** Every resource the server lists, following pagination. */
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

  async readResource(uri: string): Promise<McpResourceContent[]> {
    const result = (await this.request("resources/read", { uri })) as {
      contents?: McpResourceContent[];
    };
    return result.contents ?? [];
  }

  /** Last lines the server wrote to stderr - for the health detail. */
  get diagnostics(): string {
    return this.stderrTail.trim();
  }

  // -- wire --------------------------------------------------------------

  private request(method: string, params: unknown): Promise<unknown> {
    if (!this.child || this.exited !== undefined) {
      return Promise.reject(
        new McpError(method, this.exited ?? "not started"),
      );
    }
    const id = this.nextId++;
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new McpError(method, `no reply within ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  private notify(method: string, params: unknown): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  private write(message: object): void {
    // One message per line, and a message must not contain a raw newline -
    // JSON.stringify never emits one.
    this.child?.stdin?.write(JSON.stringify(message) + "\n");
  }

  private onLine(line: string): void {
    if (line.trim().length === 0) return;
    let message: RpcMessage;
    try {
      message = JSON.parse(line) as RpcMessage;
    } catch {
      // Not ours to interpret. A server that writes prose to stdout is broken,
      // and the pending request will time out with that diagnosis.
      this.stderrTail = (this.stderrTail + `\n[stdout not JSON] ${line.slice(0, 200)}`).slice(-4000);
      return;
    }
    if (typeof message.id === "number" && this.pending.has(message.id)) {
      const p = this.pending.get(message.id)!;
      this.pending.delete(message.id);
      clearTimeout(p.timer);
      if (message.error) {
        p.reject(new McpError(p.method, message.error.message, message.error.code));
      } else {
        p.resolve(message.result);
      }
      return;
    }
    if (message.method && message.id !== undefined && message.id !== null) {
      // A request from the server (sampling, roots, elicitation). This client
      // offers none of those capabilities, so the honest reply is "no such
      // method" rather than silence that would hang the server.
      this.write({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: `client does not implement ${message.method}` },
      });
    }
    // Notifications are ignored: nothing here subscribes to anything.
  }

  private teardown(reason: string): void {
    if (this.exited !== undefined) return;
    this.exited = reason;
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new McpError(p.method, reason));
      this.pending.delete(id);
    }
  }
}
