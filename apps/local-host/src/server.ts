/**
 * Local API - loopback-only HTTP surface of the Runtime daemon
 * (docs/30-design/60-technical-architecture.md section 8). Every request
 * except /health must carry the per-session bearer token; the server binds
 * 127.0.0.1 only. WebSocket event stream arrives in a later batch.
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import {
  ContractInvalidError,
  HarnessError,
  NeedsHumanConfirmationError,
  WorkspaceNotFoundError,
  type Binding,
  type WorkspaceRuntime,
} from "@vxture/ruyin-core";
import type { LoadedProduct } from "./products.js";
import { DEV_UI_HTML } from "./dev-ui.js";

export interface LocalApiDeps {
  runtime: WorkspaceRuntime;
  products: LoadedProduct[];
  token: string;
  version: string;
  /** Rebuild the FTS index rows for one binding; returns indexed count. */
  reindex: (workspaceId: string, binding: Binding) => Promise<number>;
  /** Built Workspace UI directory; when set, served at / (dev console moves to /dev). */
  uiDir?: string;
}

const STATIC_MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".map": "application/json",
  ".ico": "image/x-icon",
};

function serveStatic(res: ServerResponse, root: string, rel: string): void {
  // Normalize and refuse traversal outside the UI root.
  const full = resolvePath(root, rel);
  if (!full.startsWith(resolvePath(root)) || !existsSync(full)) {
    send(res, 404, { error: "not_found" });
    return;
  }
  const ext = full.slice(full.lastIndexOf("."));
  res.writeHead(200, {
    "content-type": STATIC_MIME[ext] ?? "application/octet-stream",
  });
  res.end(readFileSync(full));
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
  });
  res.end(data);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim().length === 0) return {};
  return JSON.parse(text) as Record<string, unknown>;
}

function errorStatus(cause: unknown): { status: number; body: unknown } {
  if (cause instanceof ContractInvalidError) {
    return { status: 400, body: { error: "contract_invalid", details: cause.errors } };
  }
  if (cause instanceof WorkspaceNotFoundError) {
    return { status: 404, body: { error: "workspace_not_found", message: cause.message } };
  }
  if (cause instanceof NeedsHumanConfirmationError) {
    return { status: 409, body: { error: "needs_human_confirmation", message: cause.message } };
  }
  if (cause instanceof HarnessError) {
    return { status: 400, body: { error: "harness_error", message: cause.message } };
  }
  if (cause instanceof SyntaxError) {
    return { status: 400, body: { error: "bad_json", message: cause.message } };
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/illegal state transition/.test(message)) {
    return { status: 409, body: { error: "illegal_transition", message } };
  }
  if (
    /outside every granted folder|not declared in the contract|does not allow the local source/.test(
      message,
    )
  ) {
    return { status: 400, body: { error: "binding_invalid", message } };
  }
  return { status: 500, body: { error: "internal", message } };
}

export function createLocalApi(deps: LocalApiDeps): Server {
  return createServer((req, res) => {
    void handle(deps, req, res).catch((cause) => {
      const { status, body } = errorStatus(cause);
      send(res, status, body);
    });
  });
}

async function handle(
  deps: LocalApiDeps,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const method = req.method ?? "GET";
  const path = url.pathname.replace(/\/+$/, "") || "/";

  // Workspace UI (built React app) at /, when present; the plain dev console
  // stays reachable at /dev. Both are static shells - the token arrives via
  // ?token= and is only used by the page's own API calls (token-gated below).
  if (method === "GET" && (path === "/" || path === "/dev")) {
    if (path === "/" && deps.uiDir) {
      serveStatic(res, deps.uiDir, "index.html");
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(DEV_UI_HTML);
    return;
  }
  // UI asset files (vite emits under assets/).
  if (method === "GET" && deps.uiDir && path.startsWith("/assets/")) {
    serveStatic(res, deps.uiDir, path.slice(1));
    return;
  }

  if (method === "GET" && path === "/health") {
    send(res, 200, { ok: true, version: deps.version });
    return;
  }

  const auth = req.headers.authorization ?? "";
  if (auth !== `Bearer ${deps.token}`) {
    send(res, 401, { error: "unauthorized" });
    return;
  }

  const segments = path.split("/").filter((s) => s.length > 0);

  // GET /products
  if (method === "GET" && path === "/products") {
    send(
      res,
      200,
      deps.products.map((p) => ({ id: p.id, name: p.name, version: p.version })),
    );
    return;
  }

  // POST /workspaces  { product, name }
  if (method === "POST" && path === "/workspaces") {
    const body = await readJson(req);
    const product = deps.products.find((p) => p.id === body["product"]);
    if (!product) {
      send(res, 404, { error: "product_not_found", product: body["product"] });
      return;
    }
    const name = typeof body["name"] === "string" && body["name"].length > 0
      ? body["name"]
      : product.name;
    const meta = await deps.runtime.createWorkspace(product.contract, name);
    send(res, 201, meta);
    return;
  }

  // GET /workspaces
  if (method === "GET" && path === "/workspaces") {
    send(res, 200, await deps.runtime.listWorkspaces());
    return;
  }

  // /workspaces/:id[...]
  if (segments[0] === "workspaces" && segments.length >= 2) {
    const wsId = segments[1]!;

    if (method === "GET" && segments.length === 2) {
      const view = await deps.runtime.openWorkspace(wsId);
      send(res, 200, {
        meta: view.meta,
        businessState: view.businessState,
        product: view.contract.product,
        tasks: view.contract.tasks.map((t) => ({
          id: t.id,
          objective: t.objective,
          input_types: t.input_types,
        })),
        states: view.contract.states,
      });
      return;
    }

    // GET /workspaces/:id/tasks - task instances
    if (method === "GET" && segments.length === 3 && segments[2] === "tasks") {
      send(res, 200, await deps.runtime.listTaskInstances(wsId));
      return;
    }

    // POST /workspaces/:id/state  { to, humanConfirmed? }
    if (method === "POST" && segments.length === 3 && segments[2] === "state") {
      const body = await readJson(req);
      const to = String(body["to"] ?? "");
      const state = await deps.runtime.transitionBusinessState(wsId, to, {
        humanConfirmed: body["humanConfirmed"] === true,
      });
      send(res, 200, { businessState: state });
      return;
    }

    // GET/POST /workspaces/:id/grants  { path, mode? }
    if (segments.length === 3 && segments[2] === "grants") {
      if (method === "GET") {
        send(res, 200, await deps.runtime.listGrants(wsId));
        return;
      }
      if (method === "POST") {
        const body = await readJson(req);
        const grant = await deps.runtime.addGrant(
          wsId,
          String(body["path"] ?? ""),
          body["mode"] === "readwrite" ? "readwrite" : "read",
        );
        send(res, 201, grant);
        return;
      }
    }

    // GET/POST /workspaces/:id/bindings  { type, root }
    if (segments.length === 3 && segments[2] === "bindings") {
      if (method === "GET") {
        send(res, 200, await deps.runtime.listBindings(wsId));
        return;
      }
      if (method === "POST") {
        const body = await readJson(req);
        const binding = await deps.runtime.setBinding(wsId, {
          type: String(body["type"] ?? ""),
          root: String(body["root"] ?? ""),
        });
        // Index the newly bound content right away (04 section 5.1).
        const indexed = await deps.reindex(wsId, binding);
        send(res, 201, { ...binding, indexed });
        return;
      }
    }

    // POST /workspaces/:id/tasks  { task, inputs? }  (inputs absent => selection)
    if (method === "POST" && segments.length === 3 && segments[2] === "tasks") {
      const body = await readJson(req);
      const harness = await deps.runtime.createHarness(wsId);
      const instance = await harness.startTask(
        String(body["task"] ?? ""),
        body["inputs"] === undefined
          ? undefined
          : (body["inputs"] as Record<string, unknown>),
      );
      send(res, 201, instance);
      return;
    }

    // POST /workspaces/:id/tasks/:tid/decision  { approve }
    if (
      method === "POST" &&
      segments.length === 5 &&
      segments[2] === "tasks" &&
      segments[4] === "decision"
    ) {
      const body = await readJson(req);
      const harness = await deps.runtime.createHarness(wsId);
      const instance = await harness.decideCheckpoint(
        segments[3]!,
        body["approve"] === true,
      );
      send(res, 200, instance);
      return;
    }

    // GET /workspaces/:id/audit
    if (method === "GET" && segments.length === 3 && segments[2] === "audit") {
      send(res, 200, await deps.runtime.listAuditEvents(wsId));
      return;
    }
  }

  send(res, 404, { error: "not_found", path });
}
