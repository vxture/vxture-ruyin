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
  ProjectNotFoundError,
  type Binding,
  type ProjectRuntime,
} from "@vxture/ruyin-core";
import { DEV_UI_HTML } from "./dev-ui.js";
import type { ProductRegistry } from "./product-registry.js";
import type { TaskRunner } from "./task-runner.js";
import { installPackage } from "./installer.js";
import { ContractFetchError, type FetchOutcome } from "./contract-fetch.js";
import { AlreadyAttributedError } from "@vxture/ruyin-core";
import {
  NotSignedInError,
  PlatformNotConfiguredError,
  type PlatformService,
} from "./platform.js";

export interface LocalApiDeps {
  runtime: ProjectRuntime;
  /** 受管产品资产（安装 / 启用 / 订阅可用性，30-contract-schema §18）。 */
  registry: ProductRegistry;
  /** 任务在请求之外推进——真实 provider 每回合十秒到一分钟，不能占住 HTTP。 */
  tasks: TaskRunner;
  token: string;
  version: string;
  /** Rebuild the FTS index rows for one binding; returns indexed count. */
  reindex: (projectId: string, binding: Binding) => Promise<number>;
  /** Built Workspace UI directory; when set, served at / (dev console moves to /dev). */
  uiDir?: string;
  /** Vxture platform integration (C1 identity + C2 entitlements); absent in
   *  tests that exercise the runtime surface only. */
  platform?: PlatformService;
  /**
   * 是否要求安装包经 Vxture Registry 副署（§18.2）。缺省 true（安全默认）；
   * 仅开发模式显式置 false 才允许装未签名包。
   */
  requireSignedPackages?: boolean;
  /**
   * 一级供给：从产品能力面拉契约（ADR-012）。未配置能力面时缺省——此时
   * POST /products/:id/fetch 如实回答「没有可拉的地方」，不假装拉过。
   */
  fetchContract?: (productId: string) => Promise<FetchOutcome>;
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

/**
 * The workspace the user is currently signed in to, or undefined when signed
 * out. Read from the session claims, never from the request body: a body field
 * naming a workspace would be the caller choosing its own data boundary.
 */
function activeWorkspace(deps: LocalApiDeps): string | undefined {
  const id = deps.platform?.session().workspace?.id;
  return id && id.length > 0 ? id : undefined;
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
  if (cause instanceof ProjectNotFoundError) {
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

  // GET /pending - 跨项目的「在等我」清单（50-harness §6）。
  // 桌面壳轮询它发系统通知，界面用它做未决入口；两者看的是同一份事实。
  if (method === "GET" && path === "/pending") {
    send(res, 200, await deps.runtime.listPendingConfirmations());
    return;
  }

  // GET /products - 受管资产视图：已装 + 启用态 + 订阅可用性（§18.5）
  if (method === "GET" && path === "/products") {
    send(res, 200, deps.registry.list());
    return;
  }

  // POST /products/install - 安装 .ruyinpkg（请求体为包字节；管线见 installer.ts）
  if (method === "POST" && path === "/products/install") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    try {
      const result = installPackage(Buffer.concat(chunks), {
        storeDir: deps.registry.storeDir,
        runtimeVersion: deps.version,
        // 无 Registry 根证书前，生产口径由宿主注入；缺省要求签名（安全默认）。
        requireSignature: deps.requireSignedPackages !== false,
      });
      deps.registry.rescan();
      send(res, 201, {
        productId: result.productId,
        version: result.version,
        signed: result.signed,
      });
    } catch (cause) {
      send(res, 400, {
        error: "install_rejected",
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
    return;
  }

  // POST /products/:id/fetch - 一级供给：从产品能力面拉契约（ADR-012 §18.3）
  if (
    method === "POST" &&
    segments[0] === "products" &&
    segments.length === 3 &&
    segments[2] === "fetch"
  ) {
    if (!deps.fetchContract) {
      send(res, 503, {
        error: "capability_base_not_configured",
        message:
          "契约拉取需要已配置的产品能力面（RUYIN_CAPABILITY_BASE）；当前未配置",
      });
      return;
    }
    try {
      const outcome = await deps.fetchContract(segments[1]!);
      // 只有真落了新版本才需要重扫；current/offline 没动过库。
      if (outcome.status === "fetched") deps.registry.rescan();
      send(res, outcome.status === "fetched" ? 201 : 200, outcome);
    } catch (cause) {
      // 契约本身不可接受 —— 产品的问题，说清楚是哪一条不过。
      send(res, cause instanceof ContractFetchError ? 422 : 500, {
        error: "contract_rejected",
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
    return;
  }

  // POST /products/:id/activate  { version } - 切换生效版本（§18.4 回滚）
  if (
    method === "POST" &&
    segments[0] === "products" &&
    segments.length === 3 &&
    segments[2] === "activate"
  ) {
    const body = await readJson(req);
    try {
      deps.registry.activate(segments[1]!, String(body["version"] ?? ""));
    } catch (cause) {
      send(res, 404, {
        error: "version_not_installed",
        message: cause instanceof Error ? cause.message : String(cause),
      });
      return;
    }
    send(res, 200, deps.registry.list().find((p) => p.id === segments[1]));
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

  // POST /projects  { product, name }
  if (method === "POST" && path === "/projects") {
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
    // 项目必须归属工作区（ADR-015）。没有登录态就没有工作区，也就无从新建 ——
    // 这不是把功能藏起来，是这个动作缺少它的主体。
    const workspaceId = activeWorkspace(deps);
    if (!workspaceId) {
      send(res, 409, {
        error: "no_active_workspace",
        message:
          "项目须归属于一个工作区；请先登录 Vxture 账号并选择工作区后再新建",
      });
      return;
    }
    const name = typeof body["name"] === "string" && body["name"].length > 0
      ? body["name"]
      : product.name;
    const meta = await deps.runtime.createProject(
      product.contract,
      name,
      workspaceId,
    );
    send(res, 201, meta);
    return;
  }

  // GET /projects - 按当前工作区过滤（ADR-007：订阅、权益、数据边界都按工作区
  // 划）。别的工作区的项目**只报数量不报名字**：隔离照做，但让人知道数据还在
  // ——「切换一下项目全没了」与「数据丢了」在用户那里分不开。
  if (method === "GET" && path === "/projects") {
    const workspaceId = activeWorkspace(deps);
    const all = await deps.runtime.listProjects();
    // `workspaceId &&` 不是多余的：未登录时它是 undefined，而未归属项目的
    // workspaceId 也是 undefined —— 光比相等会把「没有归属」当成「归属于没有」，
    // 于是同一个项目既算我的又算待导入，在列表里出现两次。
    const mine = workspaceId
      ? all.filter((p) => p.workspaceId === workspaceId)
      : [];
    // 归属为空的是 attribution 之前写下的记录：一份**待导入队列**，不是一种
    // 受支持的状态。任何工作区下都看得见，直到用户把它导进某一个。
    const unattributed = all.filter((p) => !p.workspaceId);
    send(res, 200, {
      items: [...mine, ...unattributed],
      elsewhere: all.length - mine.length - unattributed.length,
    });
    return;
  }

  // /projects/:id[...]
  if (segments[0] === "projects" && segments.length >= 2) {
    const projectId = segments[1]!;

    // POST /projects/:id/import - 把 attribution 之前的项目导入当前工作区。
    // 只填空白，不搬家：改变一个已有归属会把数据挪过订阅与权益边界，那是另一
    // 件事，不该由一个「导入」按钮顺手做掉（ADR-015）。
    if (
      method === "POST" &&
      segments.length === 3 &&
      segments[2] === "import"
    ) {
      const workspaceId = activeWorkspace(deps);
      if (!workspaceId) {
        send(res, 409, {
          error: "no_active_workspace",
          message: "请先登录并选择工作区，再把该项目导入其中",
        });
        return;
      }
      try {
        send(res, 200, await deps.runtime.importProject(projectId, workspaceId));
      } catch (cause) {
        send(res, cause instanceof AlreadyAttributedError ? 409 : 404, {
          error:
            cause instanceof AlreadyAttributedError
              ? "already_attributed"
              : "project_not_found",
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
      return;
    }

    if (method === "GET" && segments.length === 2) {
      const view = await deps.runtime.openProject(projectId);
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

    // GET /projects/:id/tasks - task instances
    if (method === "GET" && segments.length === 3 && segments[2] === "tasks") {
      send(res, 200, await deps.runtime.listTaskInstances(projectId));
      return;
    }

    // POST /projects/:id/state  { to, humanConfirmed? }
    if (method === "POST" && segments.length === 3 && segments[2] === "state") {
      const body = await readJson(req);
      const to = String(body["to"] ?? "");
      const state = await deps.runtime.transitionBusinessState(projectId, to, {
        humanConfirmed: body["humanConfirmed"] === true,
      });
      send(res, 200, { businessState: state });
      return;
    }

    // GET/POST /projects/:id/grants  { path, mode? }
    if (segments.length === 3 && segments[2] === "grants") {
      if (method === "GET") {
        send(res, 200, await deps.runtime.listGrants(projectId));
        return;
      }
      if (method === "POST") {
        const body = await readJson(req);
        const grant = await deps.runtime.addGrant(
          projectId,
          String(body["path"] ?? ""),
          body["mode"] === "readwrite" ? "readwrite" : "read",
        );
        send(res, 201, grant);
        return;
      }
    }

    // GET/POST /projects/:id/bindings  { type, root }
    if (segments.length === 3 && segments[2] === "bindings") {
      if (method === "GET") {
        send(res, 200, await deps.runtime.listBindings(projectId));
        return;
      }
      if (method === "POST") {
        const body = await readJson(req);
        const binding = await deps.runtime.setBinding(projectId, {
          type: String(body["type"] ?? ""),
          root: String(body["root"] ?? ""),
        });
        // Index the newly bound content right away (04 section 5.1).
        const indexed = await deps.reindex(projectId, binding);
        send(res, 201, { ...binding, indexed });
        return;
      }
    }

    // GET /projects/:id/tasks/:tid - poll one instance while it runs
    if (
      method === "GET" &&
      segments.length === 4 &&
      segments[2] === "tasks"
    ) {
      const instances = await deps.runtime.listTaskInstances(projectId);
      const found = instances.find((t) => t.id === segments[3]);
      if (!found) {
        send(res, 404, { error: "task_not_found", task: segments[3] });
        return;
      }
      send(res, 200, { ...found, running: deps.tasks.isRunning(found.id) });
      return;
    }

    // POST /projects/:id/tasks  { task, inputs? }  (inputs absent => selection)
    // 202: the instance is recorded, execution continues in the background.
    if (method === "POST" && segments.length === 3 && segments[2] === "tasks") {
      const body = await readJson(req);
      const harness = await deps.runtime.createHarness(projectId);
      const instance = await harness.startTask(
        String(body["task"] ?? ""),
        body["inputs"] === undefined
          ? undefined
          : (body["inputs"] as Record<string, unknown>),
      );
      // Claim before answering: start() is synchronous, so the caller can
      // never poll in the window between "accepted" and "actually running".
      deps.tasks.start(projectId, instance.id);
      send(res, 202, instance);
      return;
    }

    // POST /projects/:id/tasks/:tid/cancel - stop at the next safe point
    if (
      method === "POST" &&
      segments.length === 5 &&
      segments[2] === "tasks" &&
      segments[4] === "cancel"
    ) {
      send(res, 202, await deps.tasks.cancel(projectId, segments[3]!));
      return;
    }

    // POST /projects/:id/tasks/:tid/decision  { approve }
    // Also 202: an approved task keeps running after the decision is durable.
    if (
      method === "POST" &&
      segments.length === 5 &&
      segments[2] === "tasks" &&
      segments[4] === "decision"
    ) {
      const body = await readJson(req);
      const harness = await deps.runtime.createHarness(projectId);
      const instance = await harness.decideCheckpoint(
        segments[3]!,
        body["approve"] === true,
      );
      deps.tasks.start(projectId, instance.id);
      send(res, 202, instance);
      return;
    }

    // GET /projects/:id/context/:type - binding item preview
    if (
      method === "GET" &&
      segments.length === 4 &&
      segments[2] === "context"
    ) {
      send(res, 200, await deps.runtime.discoverContext(projectId, segments[3]!));
      return;
    }

    // GET /projects/:id/audit
    if (method === "GET" && segments.length === 3 && segments[2] === "audit") {
      send(res, 200, await deps.runtime.listAuditEvents(projectId));
      return;
    }
  }

  send(res, 404, { error: "not_found", path });
}
