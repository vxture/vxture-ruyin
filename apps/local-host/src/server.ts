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
  unrunnableTools,
  NeedsHumanConfirmationError,
  ProjectNotFoundError,
  type Binding,
  type FolderGrant,
  type ProjectRuntime,
} from "@vxture/ruyin-core";
import { DEV_UI_HTML } from "./dev-ui.js";
import type { ProductRegistry } from "./product-registry.js";
import type { TaskRunner } from "./task-runner.js";
import { installPackage } from "./installer.js";
import { ContractFetchError, type FetchOutcome } from "./contract-fetch.js";
import { AlreadyAttributedError } from "@vxture/ruyin-core";
import { apiError, REJECTION } from "./errors.js";
import { join as joinPath } from "node:path";
import type { EventBus } from "./events.js";
import { checkForUpdate } from "./updates.js";
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
  /**
   * 强制拉一次订阅（TD-014 D5）。轮询周期 5 分钟，而用户付完款回到应用时
   * **不该等 5 分钟**；C2 的 45 秒缓存仍然生效，所以频繁调用不会打爆平台。
   * 未接通订阅面时缺省。
   */
  refreshEntitlements?: () => Promise<void>;
  /** 更新 feed 基址覆盖（dl 主机未落地前可指向测试 feed）；缺省见 updates.ts。 */
  updateFeedBase?: string;
  /** 运行时事件总线（TD-027）。不接就没有 /events，消费方回到轮询。 */
  events?: EventBus;
  /**
   * 把字节写进授权目录。导出用它 —— **导出不是特权动作**，它写的仍然是用户
   * 授权过的目录，凭什么绕过同一套护栏。
   */
  writeArtifact: (
    path: string,
    bytes: Uint8Array,
    grants: FolderGrant[],
  ) => { content: string; isError?: boolean };
  /**
   * 本宿主实现了哪些工具。任务列表用它标出「这台机器跑不了的任务」——
   * 判据与 startTask 的拒绝判据是同一个（`unrunnableTools`），所以列表上
   * 能启动的，启动时不会再被拒。
   */
  supportsTool: (tool: string) => boolean;
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

/** 守护进程在 index.html 之外还提供的根级 UI 文件。**不含 web app manifest**：
 *  它已随 PWA 一并移除——装成 PWA 会得到一个不启动运行时的应用图标，而桌面
 *  应用只有 Electron 壳一个入口。
 *
 *  这份名单是**页面用 `<img src>`/`<link href>` 直接取的东西**必须登记的地方：
 *  浏览器发这类请求时不会带 Authorization 头，落到令牌闸门上就是 401，图标位置
 *  留一个碎图，而控制台一句报错都没有（img 加载失败不进 console.error）。
 *  往 public/ 里加根级资源时，这里要跟着加一条。 */
const UI_ROOT_FILES = new Set(["logo.svg", "favicon.ico"]);

function serveStatic(res: ServerResponse, root: string, rel: string): void {
  // Normalize and refuse traversal outside the UI root.
  const full = resolvePath(root, rel);
  if (!full.startsWith(resolvePath(root)) || !existsSync(full)) {
    send(res, 404, apiError("NOT_FOUND", "资源不存在"));
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
    return {
      status: 400,
      body: { ...apiError("CONTRACT_INVALID", "契约校验未通过"), details: cause.errors },
    };
  }
  if (cause instanceof ProjectNotFoundError) {
    return { status: 404, body: apiError("PROJECT_NOT_FOUND", cause.message) };
  }
  if (cause instanceof NeedsHumanConfirmationError) {
    // X-1 词表：这是一条出路，不是一个错误 —— 引导去确认，别当失败展示。
    return { status: 409, body: apiError(REJECTION.APPROVAL_REQUIRED, cause.message) };
  }
  if (cause instanceof HarnessError) {
    return { status: 400, body: apiError("TASK_REJECTED", cause.message) };
  }
  if (cause instanceof SyntaxError) {
    return { status: 400, body: apiError("REQUEST_MALFORMED", cause.message) };
  }
  if (cause instanceof NotSignedInError) {
    return { status: 401, body: apiError("AUTH_REQUIRED", cause.message) };
  }
  if (cause instanceof PlatformNotConfiguredError) {
    return { status: 503, body: apiError("PLATFORM_NOT_CONFIGURED", cause.message) };
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/illegal state transition/.test(message)) {
    return { status: 409, body: apiError("STATE_TRANSITION_ILLEGAL", message) };
  }
  if (
    /outside every granted folder|not declared in the contract|does not allow the local source/.test(
      message,
    )
  ) {
    return { status: 400, body: apiError("BINDING_INVALID", message) };
  }
  // 内部错误可能是瞬时的（磁盘忙、锁竞争），所以它是少数几个 retryable 之一。
  return { status: 500, body: apiError("INTERNAL", message, { retryable: true }) };
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
    send(res, 401, apiError("AUTH_REQUIRED", "缺少或无效的会话令牌"));
    return;
  }

  const segments = path.split("/").filter((s) => s.length > 0);

  // GET /events - 事件流（TD-027）。SSE 而不是 WebSocket：这些事件全是单向
  // 的，服务端到客户端；WS 要多一套连接管理，换不来任何东西。
  //
  // 事件只说「什么变了」，不带业务数据 —— 带了就等于开出第二条数据通路，而
  // 那条路上的护栏（授权、工作区边界、审计）要重新写一遍。
  if (method === "GET" && path === "/events") {
    if (!deps.events) {
      send(res, 503, apiError("EVENTS_UNAVAILABLE", "此运行时未接事件流"));
      return;
    }
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
      // 环回也可能经过缓冲代理；关掉它，否则事件会被攒着一起发。
      "x-accel-buffering": "no",
    });
    res.write(": ok\n\n");
    const unsubscribe = deps.events.subscribe((event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    // 心跳：连接死了要让两边都知道。没有它，一条断掉的流看起来就是「一直
    // 没有事件发生」—— 和「一切正常」长得一模一样。
    const beat = setInterval(() => res.write(": beat\n\n"), 25_000);
    beat.unref?.();
    const stop = (): void => {
      clearInterval(beat);
      unsubscribe();
    };
    req.on("close", stop);
    res.on("close", stop);
    return;
  }

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
          ...apiError("REQUEST_MALFORMED", "缺少 products 查询参数", {
            field: "products",
          }),
        });
        return;
      }
      send(res, 200, await deps.platform.entitlements(products));
      return;
    }
  }

  // GET /updates/check - 拉渠道 feed 比版本，并附上此刻能不能装（TD-021）。
  // **只回答问题，不下载不安装**：操作权归用户（策略 2）。
  // GET /updates/check - 有没有新版本、去哪儿拿。**不下载、不安装。**
  //
  // MVP 阶段不做自动更新（2026-09-02，owner 定）：electron-updater 在 Windows
  // 默认校验更新包签名，而 owner 定了不采购证书（TD-001 转 standing）。要么关掉
  // 那道校验（等于让更新通道接受任何来自 feed 的包），要么不做自动安装 —— 选了
  // 后者。原先的 POST /updates/install 与 GET /updates/intent 随之整段拆掉：
  // **没有安装动作，就没有要闸的东西**，留着一个判不到任何事的闸门只是噪音。
  if (method === "GET" && path === "/updates/check") {
    const check = await checkForUpdate({
      currentVersion: deps.version,
      ...(deps.updateFeedBase ? { feedBase: deps.updateFeedBase } : {}),
    });
    send(res, 200, check);
    return;
  }

  // GET /pending - 跨项目的「在等我」清单（50-harness §6）。
  // 桌面壳轮询它发系统通知，界面用它做未决入口；两者看的是同一份事实。
  if (method === "GET" && path === "/pending") {
    send(res, 200, await deps.runtime.listPendingConfirmations());
    return;
  }

  // POST /entitlements/refresh - 立刻拉一次订阅（D5 的时点之一：窗口重新
  // 获得焦点，也就是用户付完款回到应用的那一刻）。失败不报错：拉不到就沿用
  // 上一次的判定（ADR-003），而不是把用户锁住。
  if (method === "POST" && path === "/entitlements/refresh") {
    await deps.refreshEntitlements?.().catch(() => {});
    send(res, 200, deps.registry.list());
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
      send(
        res,
        400,
        apiError(
          "PACKAGE_REJECTED",
          cause instanceof Error ? cause.message : String(cause),
        ),
      );
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
      send(
        res,
        503,
        apiError(
          "CAPABILITY_BASE_NOT_CONFIGURED",
          "契约拉取需要已配置的产品能力面（RUYIN_CAPABILITY_BASE）；当前未配置",
        ),
      );
      return;
    }
    try {
      const outcome = await deps.fetchContract(segments[1]!);
      // 只有真落了新版本才需要重扫；current/offline 没动过库。
      if (outcome.status === "fetched") deps.registry.rescan();
      send(res, outcome.status === "fetched" ? 201 : 200, outcome);
    } catch (cause) {
      // 契约本身不可接受 —— 产品的问题，说清楚是哪一条不过。
      send(
        res,
        cause instanceof ContractFetchError ? 422 : 500,
        apiError(
          "CONTRACT_INVALID",
          cause instanceof Error ? cause.message : String(cause),
        ),
      );
    }
    return;
  }

  // POST /products/:id/pin-version  { version } - 钉住生效版本（§18.4 回滚）。
  // 曾叫 activate —— 与通则 B-3 撞名（那里 activate/deactivate 是生效开关）。
  // X-4：撞名必须改名，不得靠上下文区分。
  if (
    method === "POST" &&
    segments[0] === "products" &&
    segments.length === 3 &&
    segments[2] === "pin-version"
  ) {
    const body = await readJson(req);
    try {
      deps.registry.activate(segments[1]!, String(body["version"] ?? ""));
    } catch (cause) {
      send(
        res,
        404,
        apiError(
          "PRODUCT_VERSION_NOT_FOUND",
          cause instanceof Error ? cause.message : String(cause),
        ),
      );
      return;
    }
    send(res, 200, deps.registry.list().find((p) => p.id === segments[1]));
    return;
  }

  // POST /products/:id/activate|deactivate - 本机生效开关（不卸载，数据不动）。
  // 通则 B-3 规定二元开关就叫这两个名字；本仓原本叫 enable/disable。
  if (
    method === "POST" &&
    segments[0] === "products" &&
    segments.length === 3 &&
    (segments[2] === "activate" || segments[2] === "deactivate")
  ) {
    try {
      deps.registry.setActive(segments[1]!, segments[2] === "activate");
    } catch (cause) {
      send(
        res,
        404,
        apiError(
          "PRODUCT_NOT_FOUND",
          cause instanceof Error ? cause.message : String(cause),
        ),
      );
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
      send(res, 404, {
        ...apiError("PRODUCT_NOT_FOUND", `产品未安装：${String(body["product"] ?? "")}`),
        product: body["product"],
      });
      return;
    }
    // D5 的另一个时点：**打开产品前**先拉一次。判定就发生在下一行，用一份
    // 最多 5 分钟旧的快照挡住刚付完款的用户，是这条最难解释的失败。
    // 拉不到不阻塞（ADR-003），沿用现有判定。
    await deps.refreshEntitlements?.().catch(() => {});
    // §18.5：退订 / 停用的产品不可打开；已有工作空间的数据仍可读可导出。
    const blocked = deps.registry.blockedReason(product.id);
    if (blocked) {
      // D2：两种「不可用」用两个码。未订阅 → 引导去 console 订阅；本机停用 →
      // 本地策略，去设置里重新启用。同一个码会让界面永远显示错的那个入口。
      send(
        res,
        403,
        apiError(
          blocked.availability === "not_entitled"
            ? REJECTION.NOT_ENTITLED
            : REJECTION.POLICY_DENIED,
          blocked.reason,
        ),
      );
      return;
    }
    // 项目必须归属工作区（ADR-015）。没有登录态就没有工作区，也就无从新建 ——
    // 这不是把功能藏起来，是这个动作缺少它的主体。
    const workspaceId = activeWorkspace(deps);
    if (!workspaceId) {
      send(
        res,
        409,
        apiError(
          "WORKSPACE_REQUIRED",
          "项目须归属于一个工作区；请先登录 Vxture 账号并选择工作区后再新建",
        ),
      );
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

    // 工作区边界要在**每一条**按 id 访问的路由上成立，不只在列表上。
    //
    // `GET /projects` 一直很小心地按当前工作区过滤，然后任何一个项目凭 id 就能
    // 被完整读写 —— 那不是边界，那是一层遮挡。可达的场景不用假设攻击者：用户
    // 切换工作区时项目面板还开着，它会继续操作旧工作区的项目，**包括把它导出**。
    //
    // 没有归属的项目是 attribution 之前的记录，属**待导入队列**，任何工作区下
    // 都看得见（ADR-015），所以这里放行 —— 挡住它，导入这条路就没了。
    const owner = (await deps.runtime.listProjects()).find(
      (p) => p.id === projectId,
    )?.workspaceId;
    const active = activeWorkspace(deps);
    if (owner && owner !== active) {
      // 同样是拒绝，理由要分清楚 —— 没登录时说「属于另一个工作区」不是实话，
      // 而一句不实的拒绝会把人送去切工作区，那里什么也解决不了。
      //
      // 两种都说清是「在别处 / 还没登录」而不是「不存在」：这是用户自己的
      // 数据，报 404 会让人以为数据丢了 —— 正是列表那边「只报数量不报名字」
      // 要避免的那种误解。
      const [status, body] = active
        ? [403, apiError(REJECTION.POLICY_DENIED, "该项目属于另一个工作区；切换过去再打开")]
        : [409, apiError("WORKSPACE_REQUIRED", "请先登录并选择工作区，再打开这个项目")];
      send(res, status, body);
      return;
    }

    // POST /projects/:id/export  { path } - 导出项目记录（TD-020）。
    //
    // 导的是**被锁在存储里的那部分**：meta / 契约 / 业务状态 / 任务实例 / 审计链。
    // 产出文档由 writeArtifact 写进用户自己的目录，本来就在他手里。
    //
    // 落盘走 writeArtifact —— 授权护栏、大小上限、原子改名一个不少。**导出不是
    // 特权动作**：它写的仍然是用户授权过的目录，凭什么例外。
    if (
      method === "POST" &&
      segments.length === 3 &&
      segments[2] === "export"
    ) {
      // 导出是**认证过的操作**（owner 定）：一份带完整审计链的项目档案离开
      // 本机，不该在没有账号的情况下发生。注销本身就该先备份、导完再注销，
      // 而不是反过来给「离线随便导」开一条路。
      if (!activeWorkspace(deps)) {
        send(
          res,
          409,
          apiError("WORKSPACE_REQUIRED", "请先登录并选择工作区，再导出项目"),
        );
        return;
      }
      const body = await readJson(req);
      const dir = String(body["path"] ?? "");
      if (!dir) {
        send(
          res,
          400,
          apiError("REQUEST_MALFORMED", "缺少导出目录 path", { field: "path" }),
        );
        return;
      }
      const grants = await deps.runtime.listGrants(projectId);
      const bundle = await deps.runtime.exportProject(projectId, {
        runtimeVersion: deps.version,
      });

      const written = [];
      const failed = [];
      for (const [name, content] of Object.entries({
        ...bundle.files,
        "envelope.json": JSON.stringify(bundle.envelope, null, 2),
      })) {
        const r = deps.writeArtifact(
          joinPath(dir, name),
          Buffer.from(content, "utf8"),
          grants,
        );
        if (r.isError) failed.push(`${name}: ${r.content}`);
        else written.push(name);
      }

      // 一次导出是一次数据离开本机的事件，必须留痕 —— 成败都留。
      await deps.runtime.auditExport(
        projectId,
        {
          path: dir,
          files: written,
          events: bundle.statement.predicate.auditChain.events,
        },
        failed.length === 0 ? "success" : "failed",
      );

      if (failed.length > 0) {
        send(res, 403, {
          ...apiError(REJECTION.POLICY_DENIED, `导出未完成：${failed[0]}`),
          written,
          failed,
        });
        return;
      }
      send(res, 200, {
        path: dir,
        files: written,
        chain: bundle.statement.predicate.auditChain,
        // 明写：这份导出可验篡改，但还不可归属。
        signed: false,
      });
      return;
    }

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
        send(
          res,
          409,
          apiError("WORKSPACE_REQUIRED", "请先登录并选择工作区，再把该项目导入其中"),
        );
        return;
      }
      try {
        send(res, 200, await deps.runtime.importProject(projectId, workspaceId));
      } catch (cause) {
        send(
          res,
          cause instanceof AlreadyAttributedError ? 409 : 404,
          apiError(
            cause instanceof AlreadyAttributedError
              ? "PROJECT_ALREADY_ATTRIBUTED"
              : "PROJECT_NOT_FOUND",
            cause instanceof Error ? cause.message : String(cause),
          ),
        );
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
          // 本宿主跑不了的工具。列出来，是为了让「启动不了」在点击之前就看得
          // 见 —— 而不是点下去之后拿到一个错误。判据和 startTask 是同一个。
          unrunnable: unrunnableTools(t.tools, deps.supportsTool),
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
        send(res, 404, {
          ...apiError("TASK_NOT_FOUND", `任务不存在：${segments[3]}`),
          task: segments[3],
        });
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

  send(res, 404, { ...apiError("NOT_FOUND", `无此路由：${path}`), path });
}
