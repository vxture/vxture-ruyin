/**
 * 产品界面的静态服务器（ADR-022 片三 a）—— **每个产品一个 origin，只出静态文件**。
 *
 * **为什么产品界面要有自己的 origin。** 工作台把会话令牌存在 `localStorage` 里
 * （`App.tsx`）。产品界面若与工作台同源，产品代码一行 `localStorage.getItem(
 * "ruyin-token")` 就拿到整台守护进程的钥匙 —— 而界面**照常能用**，看不出异常。
 *
 * **为什么是每个产品一个，而不是所有产品共用一个。** 第一版让所有产品共用这台服务器
 * 的一个 origin、按路径 `/<productId>/…` 分开，结果**按路径分产品根本不是边界**：
 * 浏览器的同源策略把同一 origin 下的所有产品当成同一个主体。实测推出一条完整的
 * 越权路径 —— 产品 A 拿 `parent.frames[i]` 摸到同源的产品 B，往 B 的文档里插一个
 * `<script src="/A/evil.js">`（CSP 的 `script-src 'self'` 放行，因为同源），那段
 * 脚本在 B 的环境里调 `parent.postMessage`，`event.source` 就是 B 的窗口，片二的桥
 * 核 `source` 对得上 → **拿 B 的凭据替 A 办事**。片二的筛子没写错，是它的前提
 * （每个产品一个 origin）没被满足。
 *
 * 所以按 **`Host` 头**分产品：`http://<productId>.localhost:<port>/`。这与云端的
 * 做法**同一个模型**（owner 2026-09-11：「云端已经是一个产品一个二级域名」），也是
 * 设计正文 §4.2 第 3 条 Same Package, Any Runtime 的落点 —— 产品代码里凡是按
 * origin 做的事，本地与云端行为相同。`*.localhost` 由浏览器解析到回环（Chromium /
 * Electron、Firefox 都这么做），不需要改 hosts。
 *
 * **这台服务器只做一件事：出静态文件。** 没有 API、没有 `/bridge`、没有 `/projects`
 * —— 产品界面从不直连守护进程，只通过 postMessage 跟父窗口说话（片二的桥）。
 * 把任何一个 API 挂到这些 origin 上，都等于在沙箱墙上开一扇门。
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { isInside } from "./path-guard.js";

/**
 * 产品 id 的样子。**比契约 schema 更严**：它会成为子域名、也会被拼进文件路径 ——
 * 只收字母数字与 `-`，不许以 `-` 开头结尾（DNS 标签规则），不许有点（否则
 * `a.b.localhost` 能冒充成嵌套的子域）。
 */
const PRODUCT_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

export interface ProductUiServerOptions {
  /** 各产品界面包的总根：`<root>/<productId>/index.html`。 */
  root: string;
  /** 这台服务器监听的端口 —— 子域名的 origin 里要带它。 */
  port: number;
  /**
   * 工作台的 origin —— 写进 CSP 的 `frame-ancestors`：**只有工作台能把产品界面
   * 装进 iframe**。别的网页想把它嵌进去，浏览器会拒。
   */
  workspaceOrigin: string;
}

/** 产品界面的 origin。工作台据此设 iframe 的 src 与桥的 `targetOrigin`。 */
export function productOrigin(productId: string, port: number): string {
  return `http://${productId.toLowerCase()}.localhost:${port}`;
}

/**
 * 从 `Host` 头认出是哪个产品。**只认 `<label>.localhost:<本端口>` 这一种形状**：
 * 裸的 `127.0.0.1`、`localhost`、别的端口、别的域名 —— 一律不认，回 404。
 *
 * 端口也要对上：`Host` 是客户端说了算的，只比子域不比端口，等于默许一个指向
 * 别处的 Host 头也能在这里取到文件。
 */
export function productFromHost(host: string | undefined, port: number): string | undefined {
  if (!host) return undefined;
  const m = /^([^.:]+)\.localhost:(\d+)$/i.exec(host.trim());
  if (!m) return undefined;
  const [, label, hostPort] = m;
  if (Number(hostPort) !== port) return undefined;
  const id = label!.toLowerCase();
  return PRODUCT_LABEL.test(id) ? id : undefined;
}

/**
 * 每一个回应都带的安全头。**失败的回应也带** —— 一个 404 页如果不带 CSP，那一页就是
 * 沙箱墙上的一个缺口。
 *
 * - `connect-src 'none'`：产品界面**一个请求都发不出去**。要什么都走父窗口的桥。
 * - `frame-ancestors`：只许工作台嵌它。
 * - `base-uri` / `form-action` `'none'`：堵掉两条不经 JS 也能改写去向的老路。
 *
 * `script-src 'self'` 现在是安全的 —— `'self'` 只是**这一个产品**的 origin。第一版
 * 所有产品共用 origin 时，`'self'` 把别的产品的脚本也算了进来，那正是越权路径的
 * 第三步。
 */
function securityHeaders(workspaceOrigin: string): Record<string, string> {
  return {
    "content-security-policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      `frame-ancestors ${workspaceOrigin}`,
    ].join("; "),
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  };
}

export function createProductUiServer(options: ProductUiServerOptions): Server {
  const headers = securityHeaders(options.workspaceOrigin);

  return createServer((req, res) => {
    const reply = (status: number, body: string) => {
      res.writeHead(status, { ...headers, "content-type": "text/plain; charset=utf-8" });
      res.end(req.method === "HEAD" ? undefined : body);
    };

    // 只读。没有任何写入面 —— 这台服务器上一个 POST 都不该能被处理。
    if (req.method !== "GET" && req.method !== "HEAD") {
      reply(405, "method not allowed");
      return;
    }

    const productId = productFromHost(req.headers.host, options.port);
    if (!productId) {
      reply(404, "not found");
      return;
    }

    const url = new URL(req.url ?? "/", "http://placeholder");
    const rel = url.pathname.split("/").filter((s) => s.length > 0).join("/") || "index.html";
    const productDir = join(options.root, productId);
    const full = join(productDir, rel);
    // **对着该产品自己的目录判断**。路径里的 `..` 在这一步之前多半已经被 URL 解析
    // 规整掉了，但照样把关，不靠它。
    if (!isInside(productDir, full) || !existsSync(full) || !statSync(full).isFile()) {
      reply(404, "not found");
      return;
    }

    const ext = full.slice(full.lastIndexOf(".")).toLowerCase();
    res.writeHead(200, {
      ...headers,
      "content-type": MIME[ext] ?? "application/octet-stream",
    });
    res.end(req.method === "HEAD" ? undefined : readFileSync(full));
  });
}
