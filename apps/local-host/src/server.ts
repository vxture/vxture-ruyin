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
import { DEV_UI_HTML } from "./dev-ui.js";
import type { ProductRegistry } from "./product-registry.js";
import {
  NotSignedInError,
  PlatformNotConfiguredError,
  type PlatformService,
} from "./platform.js";

export interface LocalApiDeps {
  runtime: WorkspaceRuntime;
  /** 受管产品资产（安装 / 启用 / 订阅可用性，30-contract-schema §18）。 */
  registry: ProductRegistry;
  token: string;
  version: string;
  /** Rebuild the FTS index rows for one binding; returns indexed count. */
  reindex: (workspaceId: string, binding: Binding) => Promise<number>;
  /** Built Workspace UI directory; when set, served at / (dev console moves to /dev). */
  uiDir?: string;
  /** Vxture platform integration (C1 identity + C2 entitlements); absent in
   *  tests that exercise the runtime surface only. */
  platform?: PlatformService;
  /** Runtime transparency surface for the settings panel (GET /system). */
  systemInfo: {
    version: string;
    platform: string;
    arch: string;
    dataDir: string;
    productsDir: string;
    keyProtection: "dpapi" | "plaintext";
    startedAt: string;
  };
}

const STATIC_MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".map": "application/json",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

/** Root-level UI files the daemon serves besides index.html (PWA identity:
 *  manifest enables the installed-app window with Window Controls Overlay,
 *  collapsing the browser title bar so the app header is THE title bar -
 *  the same single-bar contract as the Electron shell). */
const UI_ROOT_FILES = new Set(["manifest.webmanifest", "icon.svg", "favicon.ico"]);

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
  if (cause instanceof NotSignedInError) {
    return { status: 401, body: { error: "not_signed_in", message: cause.message } };
  }
  if (cause instanceof PlatformNotConfiguredError) {
    return { status: 503, body: { error: "platform_not_configured", message: cause.message } };
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
  // Whitelisted UI root files (PWA manifest + icons).
  if (method === "GET" && deps.uiDir && UI_ROOT_FILES.has(path.slice(1))) {
    serveStatic(res, deps.uiDir, path.slice(1));
    return;
  }

  if (method === "GET" && path === "/health") {
    send(res, 200, { ok: true, version: deps.version });
    return;
  }

  // OAuth loopback callback (RFC 8252): hit by the SYSTEM browser, so it sits
  // deliberately outside the bearer gate - the one-shot state value is what
  // ties the request to a flow this daemon itself started.
  if (method === "GET" && path === "/oauth/callback" && deps.platform) {
    const err = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    // Everything interpolated below can carry request-controlled text (query
    // params, upstream error strings) - escape it all; reflected XSS on a
    // loopback page is still XSS.
    const esc = (s: string) =>
      s.replace(/[&<>"']/g, (ch) =>
        ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === '"' ? "&quot;" : "&#39;",
      );
    const page = (title: string, detail: string) =>
      `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title>` +
      `<body style="font:15px system-ui;display:grid;place-items:center;height:96vh;margin:0">` +
      `<div style="text-align:center"><h2>${esc(title)}</h2><p style="color:#666">${esc(detail)}</p></div>`;
    const html = (status: number, body: string) => {
      res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
      res.end(body);
    };
    if (err) {
      html(200, page("登录未完成", `${err} - 可关闭此页,回到如影重试。`));
      return;
    }
    if (!code || !state) {
      html(400, page("请求不完整", "缺少 code / state 参数。"));
      return;
    }
    try {
      await deps.platform.completeLogin(code, state);
      html(200, page("登录成功", "可以关闭此页,回到如影继续。"));
    } catch (cause) {
      html(
        400,
        page("登录失败", cause instanceof Error ? cause.message : String(cause)),
      );
    }
    return;
  }

  const auth = req.headers.authorization ?? "";
  if (auth !== `Bearer ${deps.token}`) {
    send(res, 401, { error: "unauthorized" });
    return;
  }

  const segments = path.split("/").filter((s) => s.length > 0);

  // GET /system - runtime transparency for the settings panel
  if (method === "GET" && path === "/system") {
    send(res, 200, deps.systemInfo);
    return;
  }

  // --- Vxture platform: C1 identity + C2 entitlements (liaison L3) ---
  if (deps.platform) {
    if (method === "GET" && path === "/auth/session") {
      send(res, 200, deps.platform.session());
      return;
    }
    if (method === "POST" && path === "/auth/login") {
      send(res, 200, { authorizeUrl: await deps.platform.beginLogin() });
      return;
    }
    if (method === "POST" && path === "/auth/logout") {
      await deps.platform.logout();
      send(res, 200, { ok: true });
      return;
    }
    // GET /entitlements?products=a,b - daemon-proxied C2 envelope read; the
    // UI never sees platform tokens, only the envelope.
    if (method === "GET" && path === "/entitlements") {
      const products = (url.searchParams.get("products") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (products.length === 0) {
        send(res, 400, {
          error: "bad_request",
          message: "products query parameter required",
        });
        return;
      }
      send(res, 200, await deps.platform.entitlements(products));
      return;
    }
  }

  // GET /products - 受管资产视图：已装 + 启用态 + 订阅可用性（§18.5）
  if (method === "GET" && path === "/products") {
    send(res, 200, deps.registry.list());
    return;
  }

  // POST /products/:id/enable|disable - 本机启用/停用（不卸载，数据不动）
  if (
    method === "POST" &&
    segments[0] === "products" &&
    segments.length === 3 &&
    (segments[2] === "enable" || segments[2] === "disable")
  ) {
    try {
      deps.registry.setEnabled(segments[1]!, segments[2] === "enable");
    } catch (cause) {
      send(res, 404, {
        error: "product_not_found",
        message: cause instanceof Error ? cause.message : String(cause),
      });
      return;
    }
    send(res, 200, deps.registry.list().find((p) => p.id === segments[1]));
    return;
  }

  // POST /workspaces  { product, name }
  if (method === "POST" && path === "/workspaces") {
    const body = await readJson(req);
    const product = deps.registry.find(String(body["product"] ?? ""));
    if (!product) {
      send(res, 404, { error: "product_not_found", product: body["product"] });
      return;
    }
    // §18.5：退订 / 停用的产品不可打开；已有工作空间的数据仍可读可导出。
    const blocked = deps.registry.blockedReason(product.id);
    if (blocked) {
      send(res, 403, { error: "product_unavailable", message: blocked });
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

    // GET /workspaces/:id/context/:type - binding item preview
    if (
      method === "GET" &&
      segments.length === 4 &&
      segments[2] === "context"
    ) {
      send(res, 200, await deps.runtime.discoverContext(wsId, segments[3]!));
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
