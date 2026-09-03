/**
 * A tiny MCP server over stdio, for tests only. Speaks exactly the subset
 * mcp-client.ts uses, plus a few misbehaviours switched on by argv so the
 * client's failure paths are exercised for real:
 *
 *   --exit-after-init     exit right after answering initialize
 *   --hang-read           never answer resources/read (client must time out)
 *   --prose-on-stdout     write a non-JSON line before answering
 *   --ask-client          send the client a request (sampling) and expect -32601
 *   --pages N             paginate resources/list into N pages
 *
 * Excluded from coverage (package.json): it runs in a child process, where
 * the coverage collector cannot see it.
 */

import { createInterface } from "node:readline";

const argv = new Set(process.argv.slice(2));
const pagesArg = process.argv.indexOf("--pages");
const PAGES = pagesArg >= 0 ? Number(process.argv[pagesArg + 1]) : 1;

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

function write(message: unknown): void {
  process.stdout.write(JSON.stringify(message) + "\n");
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line) as {
    id?: number;
    method?: string;
    params?: Record<string, unknown>;
    error?: unknown;
    result?: unknown;
  };
  if (msg.method === undefined) {
    // A reply to something we asked the client.
    if (argv.has("--ask-client")) {
      process.stderr.write(`client replied: ${JSON.stringify(msg.error ?? msg.result)}\n`);
    }
    return;
  }
  switch (msg.method) {
    case "initialize":
      if (argv.has("--prose-on-stdout")) process.stdout.write("hello from a chatty server\n");
      write({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: msg.params?.["protocolVersion"],
          capabilities: { resources: {} },
          serverInfo: { name: "fake-crm", version: "0.0.1" },
        },
      });
      if (argv.has("--exit-after-init")) setTimeout(() => process.exit(0), 20);
      if (argv.has("--ask-client")) {
        write({ jsonrpc: "2.0", id: 9001, method: "sampling/createMessage", params: {} });
      }
      return;
    case "notifications/initialized":
      return;
    case "ping":
      write({ jsonrpc: "2.0", id: msg.id, result: {} });
      return;
    case "resources/list": {
      const per = Math.ceil(RESOURCES.length / PAGES);
      const page = msg.params?.["cursor"] ? Number(msg.params["cursor"]) : 0;
      const slice = RESOURCES.slice(page * per, (page + 1) * per);
      const next = (page + 1) * per < RESOURCES.length ? String(page + 1) : undefined;
      write({
        jsonrpc: "2.0",
        id: msg.id,
        result: { resources: slice, ...(next ? { nextCursor: next } : {}) },
      });
      return;
    }
    case "resources/read": {
      if (argv.has("--hang-read")) return;
      const uri = String(msg.params?.["uri"]);
      if (uri in TEXT) {
        write({
          jsonrpc: "2.0",
          id: msg.id,
          result: { contents: [{ uri, mimeType: "text/markdown", text: TEXT[uri] }] },
        });
      } else if (uri === "crm://contracts/7") {
        write({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            contents: [
              { uri, mimeType: "application/pdf", blob: Buffer.from("%PDF-1.7 fake").toString("base64") },
            ],
          },
        });
      } else if (uri === "crm://accounts/empty") {
        write({ jsonrpc: "2.0", id: msg.id, result: { contents: [] } });
      } else {
        write({ jsonrpc: "2.0", id: msg.id, error: { code: -32002, message: `Resource not found: ${uri}` } });
      }
      return;
    }
    default:
      write({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
  }
});
