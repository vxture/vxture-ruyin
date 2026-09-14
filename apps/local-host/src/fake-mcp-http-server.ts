/**
 * A tiny MCP server over Streamable HTTP, for tests only (mcp-http-client.ts,
 * workplan "通路二 E", TD-035).
 *
 * Unlike fake-mcp-server.ts (stdio), this one runs **in the test process**
 * rather than as a spawned child: HTTP has no process boundary for the client
 * to cross, so spawning would buy nothing here and would only hide this file
 * from the coverage collector for no reason. Misbehaviour is selected by
 * options instead of argv flags, one instance per test.
 *
 * Session handling mirrors what the spec requires of a real server: a session
 * id is handed out on `initialize` via `Mcp-Session-Id`, and every later
 * request must echo it or get a 400 - that is the failure path
 * `mcp-http-client.ts` has to survive, same as stdio surviving a server that
 * writes prose to stdout.
 */

import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

const RESOURCES = [
  {
    uri: "crm://accounts/1",
    name: "acme",
    title: "Acme 工业",
    mimeType: "text/markdown",
    size: 48,
    annotations: { lastModified: "2026-09-01T08:00:00Z" },
  },
  { uri: "crm://accounts/2", name: "globex", mimeType: "text/markdown" },
  { uri: "crm://contracts/7", name: "contract-7.pdf", mimeType: "application/pdf" },
  { uri: "crm://accounts/empty", name: "empty" },
];

const TEXT: Record<string, string> = {
  "crm://accounts/1": "# Acme 工业\n\n年度采购预算 1200 万，储能项目意向明确。",
  "crm://accounts/2": "# Globex\n\n" + "x".repeat(300_000),
};

export interface FakeMcpHttpServerOptions {
  /** Paginate resources/list into this many pages. Default 1. */
  pages?: number;
  /** Answer tools/list with an empty list. */
  noTools?: boolean;
  /** tools/call "huge" returns 400,000 bytes (connector must truncate, TD-046). */
  hugeToolResult?: boolean;
  /** Require and enforce Mcp-Session-Id on every request after initialize. Default true. */
  requireSession?: boolean;
  /** Answer every request via text/event-stream instead of a single JSON body. */
  useSse?: boolean;
  /** Mid-stream, send a server request (sampling) before the real answer; expect -32601 back. */
  askClient?: boolean;
  /** Never answer resources/read - the client must time out. */
  hangRead?: boolean;
  /** After answering initialize, stop the listener - later requests get ECONNREFUSED. */
  exitAfterInit?: boolean;
  /** Answer with a body that never completes a JSON-RPC message (byte-cap test, TD-046). */
  floodBody?: boolean;
  /** Answer 200 with a non-JSON body regardless of what was asked. */
  malformedBody?: boolean;
  /** After this many requests carrying the session id, start answering 404 (session expired). */
  expireSessionAfterRequests?: number;
  /** Answer every request past initialize with a bare 404 (no JSON-RPC error body). */
  bareNotFound?: boolean;
  /** initialize answers without a protocolVersion - a server that skipped negotiation. */
  omitProtocolVersion?: boolean;
  /** Answer every real request (not just notifications) with a bare 202 - a server with nothing to say. */
  accept202?: boolean;
}

export interface FakeMcpHttpServer {
  url: string;
  /** JSON-RPC methods this server has been asked, in order - for assertions. */
  requests: string[];
  close(): Promise<void>;
}

export async function startFakeMcpHttpServer(
  opts: FakeMcpHttpServerOptions = {},
): Promise<FakeMcpHttpServer> {
  const requireSession = opts.requireSession ?? true;
  const pages = opts.pages ?? 1;
  const requests: string[] = [];
  let sessionId: string | undefined;
  let requestsWithSession = 0;
  let server: Server;

  function send(res: ServerResponse, status: number, body: unknown, contentType = "application/json"): void {
    const text = typeof body === "string" ? body : JSON.stringify(body);
    res.writeHead(status, { "content-type": contentType, ...(sessionId ? { "mcp-session-id": sessionId } : {}) });
    res.end(text);
  }

  function sseFrame(message: unknown): string {
    return `data: ${JSON.stringify(message)}\n\n`;
  }

  async function readBody(req: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString("utf8");
  }

  function toolsList(): unknown[] {
    if (opts.noTools) return [];
    return [
      {
        name: "lookup_account",
        description: "按名称查客户",
        inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
      },
      ...(opts.hugeToolResult ? [{ name: "huge", description: "回一个特别大的结果（测上限用）" }] : []),
    ];
  }

  function resultFor(method: string, params: Record<string, unknown> | undefined): unknown {
    switch (method) {
      case "initialize":
        return {
          ...(opts.omitProtocolVersion ? {} : { protocolVersion: params?.["protocolVersion"] }),
          capabilities: { resources: {} },
          serverInfo: { name: "fake-crm-http", version: "0.0.1" },
        };
      case "ping":
        return {};
      case "tools/list":
        return { tools: toolsList() };
      case "tools/call": {
        const name = String(params?.["name"]);
        const args = (params?.["arguments"] ?? {}) as Record<string, unknown>;
        if (name === "huge") return { content: [{ type: "text", text: "y".repeat(400_000) }] };
        if (name === "lookup_account") {
          return {
            content: [
              { type: "text", text: `Acme 工业（查询：${String(args["q"])}）：年度预算 1200 万` },
              { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
            ],
          };
        }
        return { error: { code: -32602, message: `Unknown tool: ${name}` } };
      }
      case "resources/list": {
        const per = Math.ceil(RESOURCES.length / pages);
        const page = params?.["cursor"] ? Number(params["cursor"]) : 0;
        const slice = RESOURCES.slice(page * per, (page + 1) * per);
        const next = (page + 1) * per < RESOURCES.length ? String(page + 1) : undefined;
        return { resources: slice, ...(next ? { nextCursor: next } : {}) };
      }
      case "resources/read": {
        const uri = String(params?.["uri"]);
        if (uri in TEXT) return { contents: [{ uri, mimeType: "text/markdown", text: TEXT[uri] }] };
        if (uri === "crm://contracts/7") {
          return {
            contents: [{ uri, mimeType: "application/pdf", blob: Buffer.from("%PDF-1.7 fake").toString("base64") }],
          };
        }
        if (uri === "crm://accounts/empty") return { contents: [] };
        return { error: { code: -32002, message: `Resource not found: ${uri}` } };
      }
      default:
        return { error: { code: -32601, message: `Method not found: ${method}` } };
    }
  }

  server = createServer((req, res) => {
    void handle(req, res).catch((cause) => {
      if (!res.headersSent) send(res, 500, { jsonrpc: "2.0", error: { code: -32000, message: describe(cause) } });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === "DELETE") {
      res.writeHead(204).end();
      return;
    }
    const bodyText = await readBody(req);
    const msg = JSON.parse(bodyText) as { id?: number; method?: string; params?: Record<string, unknown> };
    const isInitialize = msg.method === "initialize";

    if (requireSession && !isInitialize && msg.method !== undefined) {
      const got = req.headers["mcp-session-id"];
      if (!sessionId || got !== sessionId) {
        send(res, 400, { jsonrpc: "2.0", error: { code: -32000, message: "missing or unknown Mcp-Session-Id" } });
        return;
      }
      requestsWithSession++;
      if (opts.expireSessionAfterRequests !== undefined && requestsWithSession > opts.expireSessionAfterRequests) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "session expired" } }));
        return;
      }
    }

    if (msg.method === undefined) {
      // A reply to our sampling request, or a bare notification's echo. Nothing to answer.
      res.writeHead(202).end();
      return;
    }
    requests.push(msg.method);

    if (msg.id === undefined) {
      // A notification (e.g. notifications/initialized): 202, no body.
      if (isInitialize) sessionId ??= randomUUID();
      res.writeHead(202, sessionId ? { "mcp-session-id": sessionId } : {}).end();
      return;
    }

    if (opts.accept202) {
      res.writeHead(202, sessionId ? { "mcp-session-id": sessionId } : {}).end();
      return;
    }

    if (opts.bareNotFound) {
      // 404 with no JSON-RPC error body - the client's generic fallback, not
      // the "server told us why" path a real session-aware server takes.
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }

    if (opts.hangRead && msg.method === "resources/read") {
      // Never respond - the client must time out. Leave the connection open.
      return;
    }

    if (opts.malformedBody) {
      send(res, 200, "not json at all", "application/json");
      return;
    }

    if (opts.floodBody && !isInitialize) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      // No blank line ever follows - an event that never completes.
      const chunk = "data: " + "x".repeat(64 * 1024) + "\n";
      const timer = setInterval(() => res.write(chunk), 5);
      res.on("close", () => clearInterval(timer));
      return;
    }

    if (isInitialize) sessionId ??= randomUUID();

    const result = resultFor(msg.method, msg.params);
    const asError = (result as { error?: { code: number; message: string } })?.error;
    const message = asError
      ? { jsonrpc: "2.0", id: msg.id, error: asError }
      : { jsonrpc: "2.0", id: msg.id, result };

    if (opts.useSse) {
      res.writeHead(200, { "content-type": "text/event-stream", ...(sessionId ? { "mcp-session-id": sessionId } : {}) });
      if (opts.askClient) {
        res.write(sseFrame({ jsonrpc: "2.0", id: "srv-1", method: "sampling/createMessage", params: {} }));
      }
      res.write(sseFrame(message));
      res.end();
      if (opts.exitAfterInit && isInitialize) setTimeout(() => server.close(), 20);
      return;
    }

    send(res, 200, message);
    if (opts.exitAfterInit && isInitialize) setTimeout(() => server.close(), 20);
  }

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
