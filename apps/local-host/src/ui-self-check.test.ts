/**
 * ui-self-check.ts 的自测：对着一个几行代码的假服务器，把「端出来的是不是工作台界面」
 * 的每条路都钉住。
 *
 * 假服务器只做三件事：按路由表回 status / content-type / body，路由表里没有的回
 * 守护进程那种 404 JSON，永不应答的路由用来测超时。真路由那一侧另有一条用例在
 * integration.test.ts 里对着 createLocalApi 跑 —— 这里的假服务器要是和真路由漂移了，
 * 那条会先红。
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { assetRefs, checkWorkspaceUi } from "./ui-self-check.js";

type Route = { status?: number; type?: string; body?: string | Buffer } | "hang";

async function serve(routes: Record<string, Route>): Promise<{ base: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const route = routes[req.url ?? ""];
    if (route === "hang") return; // 永不应答
    if (!route) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ code: "NOT_FOUND", message: "资源不存在" }));
      return;
    }
    const body = route.body ?? "";
    res.writeHead(route.status ?? 200, {
      "content-type": route.type ?? "application/octet-stream",
      "content-length": Buffer.byteLength(body),
    });
    res.end(body);
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((ok) => {
        // 挂着的请求是活连接，不是空闲连接：close() 会等它，得先掐掉。
        server.closeAllConnections();
        server.close(() => ok());
      }),
  };
}

/** Vite 构建出来的那种首页：模块脚本 + 样式表 + 根级图标，路径带内容哈希。 */
const BUILT_INDEX =
  '<!doctype html><html><head><link rel="icon" href="/logo.svg" type="image/svg+xml" />' +
  '<title>RUYIN</title><script type="module" crossorigin src="/assets/index-C7OnCSLB.js"></script>' +
  '<link rel="stylesheet" crossorigin href="/assets/index-BwrPn5xZ.css"></head><body><div id="root"></div></body></html>';

const GOOD: Record<string, Route> = {
  "/": { type: "text/html; charset=utf-8", body: BUILT_INDEX },
  "/logo.svg": { type: "image/svg+xml", body: "<svg/>" },
  "/assets/index-C7OnCSLB.js": { type: "text/javascript; charset=utf-8", body: "console.log(1)" },
  "/assets/index-BwrPn5xZ.css": { type: "text/css; charset=utf-8", body: "body{}" },
};

async function expectReject(routes: Record<string, Route>, pattern: RegExp, opts?: { timeoutMs?: number }) {
  const s = await serve(routes);
  try {
    await assert.rejects(checkWorkspaceUi(s.base, opts), pattern);
  } finally {
    await s.close();
  }
}

void test("assetRefs: 只认根相对路径的 src/href，去重、按出现顺序 —— 哈希是按内容算的，不能写死", () => {
  assert.deepEqual(assetRefs(BUILT_INDEX), ["logo.svg", "assets/index-C7OnCSLB.js", "assets/index-BwrPn5xZ.css"]);
  // 源码 index.html 指的是 /src/main.tsx —— 也是根相对路径，会被列出来；「不是构建产物」
  // 由 checkWorkspaceUi 那条「至少一个 /assets/*.js」的规则去判，不在这里判。
  assert.deepEqual(assetRefs('<script type="module" src="/src/main.tsx"></script>'), ["src/main.tsx"]);
  // 带协议的、协议相对的、data: 的都不是守护进程端出来的东西。
  assert.deepEqual(
    assetRefs('<link href="https://x/a.css"><script src="//cdn/b.js"></script><img src="data:image/png;base64,AA">'),
    [],
  );
  assert.deepEqual(assetRefs('<a href="/assets/x.js"></a><a href="/assets/x.js"></a>'), ["assets/x.js"], "去重");
  // 注释里的引用不算；data-src 这类不是 src 的属性也不算。
  assert.deepEqual(
    assetRefs('<!-- 说明：以前这里有 <link href="/old.css"> --><img data-src="/lazy.png"><script src="/assets/a.js"></script>'),
    ["assets/a.js"],
  );
});

void test("checkWorkspaceUi: 真的工作台界面 —— 首页与它引用的每个文件都 200、非空、MIME 对", async () => {
  const s = await serve(GOOD);
  try {
    const r = await checkWorkspaceUi(s.base);
    assert.deepEqual(r.assets, ["logo.svg", "assets/index-C7OnCSLB.js", "assets/index-BwrPn5xZ.css"]);
    assert.equal(
      r.bytes,
      Buffer.byteLength(BUILT_INDEX) + Buffer.byteLength("<svg/>") + Buffer.byteLength("console.log(1)") + Buffer.byteLength("body{}"),
      "字节数是首页加所有引用文件之和 —— 给日志一个能看出「太小了」的数",
    );
  } finally {
    await s.close();
  }
});

void test("checkWorkspaceUi: / 是 404 JSON 时红，并点名 resources/ui 与 RUYIN_UI_DIR —— 打包态 resources/ui 没装进包就长这样", async () => {
  await expectReject({}, /404[\s\S]*resources\/ui[\s\S]*RUYIN_UI_DIR/);
});

void test("checkWorkspaceUi: 端出来的是 Dev Console 时红 —— 200 text/html 不等于工作台界面", async () => {
  await expectReject(
    { "/": { type: "text/html; charset=utf-8", body: "<!doctype html><title>Ruyin Dev Console</title><h1>Ruyin Dev Console</h1>" } },
    /Dev Console[\s\S]*RUYIN_UI_DIR/,
  );
});

void test("checkWorkspaceUi: 首页没引用任何 /assets/*.js 就红 —— 源码 index.html、占位页都不算", async () => {
  await expectReject({ "/": { type: "text/html", body: '<script type="module" src="/src/main.tsx"></script>' } }, /assets\/\*\.js/);
  await expectReject({ "/": { type: "text/html", body: "<p>PLACEHOLDER</p>" } }, /assets\/\*\.js/);
});

void test("checkWorkspaceUi: 引用的文件 404 就红，点名那个路径 —— 首页与 assets/ 不是同一次构建", async () => {
  const { "/assets/index-BwrPn5xZ.css": _drop, ...withoutCss } = GOOD;
  void _drop;
  await expectReject(withoutCss, /assets\/index-BwrPn5xZ\.css 返回 404/);
  // 根级图标走的是另一条白名单路由：它缺了也要红 —— 图标碎掉时控制台一声都不响。
  const { "/logo.svg": _logo, ...withoutLogo } = GOOD;
  void _logo;
  await expectReject(withoutLogo, /logo\.svg 返回 404[\s\S]*UI_ROOT_FILES/);
});

void test("checkWorkspaceUi: 文件是空的、或 MIME 不对，都红 —— 浏览器不会把 octet-stream 当模块脚本", async () => {
  await expectReject({ ...GOOD, "/assets/index-C7OnCSLB.js": { type: "text/javascript", body: "" } }, /index-C7OnCSLB\.js 是空的/);
  await expectReject(
    { ...GOOD, "/assets/index-C7OnCSLB.js": { type: "application/octet-stream", body: "x" } },
    /content-type[\s\S]*模块脚本/,
  );
  await expectReject({ ...GOOD, "/assets/index-BwrPn5xZ.css": { type: "text/plain", body: "x" } }, /不是 text\/css/);
  await expectReject({ ...GOOD, "/logo.svg": { type: "application/octet-stream", body: "x" } }, /不是 image\/svg\+xml/);
});

void test("checkWorkspaceUi: / 不是 text/html 就红；不是 200 也不是 404 的状态照实报", async () => {
  await expectReject({ "/": { type: "application/json", body: "{}" } }, /content-type[\s\S]*不是 text\/html/);
  await expectReject({ "/": { status: 500, type: "text/html", body: "boom" } }, /GET \/ 返回 500/);
});

void test("checkWorkspaceUi: 没有应答就超时，不挂住整条冒烟链 —— 壳的 60 秒窗口是几条自检共用的", async () => {
  await expectReject({ "/": "hang" }, /超过 50 ms 没有应答/, { timeoutMs: 50 });
});

void test("checkWorkspaceUi: 连不上（不是超时）原样抛出 —— 别把 ECONNREFUSED 说成「没有应答」", async () => {
  const s = await serve(GOOD);
  await s.close();
  await assert.rejects(checkWorkspaceUi(s.base), (e: unknown) => {
    assert.doesNotMatch((e as Error).message, /没有应答/);
    // 钉的是「原样抛出」：fetch 的 TypeError 带着 cause.code，不是被我们改写过的错。
    assert.equal((e as { cause?: { code?: string } }).cause?.code, "ECONNREFUSED");
    return true;
  });
});
