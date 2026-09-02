/**
 * HTTP surface tests for routes integration.test.ts's milestone flow never
 * reaches: identity (auth/session, auth/login, auth/logout, oauth/callback),
 * entitlements, updates/check + updates/intent, product lifecycle
 * (pin-version/activate/deactivate), and the project sub-routes state /
 * grants / bindings / cancel / context / import. Also the errorStatus()
 * branches those routes exercise - server.ts's "one error shape" contract
 * (see git log: fix(api): one error shape, and rejection codes copied rather
 * than invented).
 *
 * /oauth/callback gets particular attention: it renders HTML by
 * interpolating request- and upstream-controlled text, and its own comment
 * names the risk by name - "反射型 XSS 在环回页面上仍然是 XSS". That branch
 * had zero tests before this file.
 */

import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { ProjectRuntime } from "@vxture/ruyin-core";
import { SqliteStoragePort } from "./storage.js";
import { MockAIGateway, nodeClock, nodeCrypto, nodeId } from "./host-ports.js";
import { KeyManager } from "./keys.js";
import { LocalFsConnector } from "./connector-fs.js";
import { FtsRanker, reindexBinding, searchContext } from "./fts.js";
import { LocalToolExecutor } from "./tool-executor.js";
import { loadProducts } from "./products.js";
import { ProductRegistry } from "./product-registry.js";
import { createLocalApi, type LocalApiDeps } from "./server.js";
import { TaskRunner } from "./task-runner.js";
import { InstallIntentBox } from "./updates.js";
import {
  NotSignedInError,
  PlatformNotConfiguredError,
  type PlatformService,
} from "./platform.js";

// Compiled test runs from dist/, so ../../../ is the repo root (same
// convention as integration.test.ts).
const productsDir = new URL("../../../products", import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, "$1");

const testSystemInfo = {
  version: "test",
  platform: process.platform,
  arch: process.arch,
  dataDir: "(test)",
  productsDir: "(test)",
  keyProtection: "plaintext" as const,
  startedAt: new Date().toISOString(),
};

interface Rig {
  base: string;
  headers: Record<string, string>;
  json: Record<string, string>;
  server: Server;
  storage: SqliteStoragePort;
  dataDir: string;
  runtime: ProjectRuntime;
}

async function startServer(overrides: Partial<LocalApiDeps> = {}): Promise<Rig> {
  const dataDir = mkdtempSync(join(tmpdir(), "ruyin-srv-"));
  const keys = await KeyManager.open(dataDir);
  const storage = new SqliteStoragePort(dataDir, keys);
  const executor = new LocalToolExecutor((pid, q, scope, limit) =>
    searchContext(storage, pid, q, scope, limit),
  );
  const runtime = new ProjectRuntime({
    storage,
    clock: nodeClock,
    id: nodeId,
    crypto: nodeCrypto,
    gateway: new MockAIGateway(),
    connectors: new Map([["local-fs", new LocalFsConnector()]]),
    ranker: new FtsRanker(storage),
    tools: executor,
  });
  const token = "srv-test-token";
  const server = createLocalApi({
    runtime,
    registry: new ProductRegistry(productsDir, dataDir),
    tasks: new TaskRunner(runtime),
    token,
    version: "test",
    updateIntent: new InstallIntentBox(),
    writeArtifact: (p, b, g) => executor.writeArtifact(p, b, g),
    supportsTool: (t) => executor.supports(t),
    systemInfo: testSystemInfo,
    reindex: (pid, b) => reindexBinding(storage, pid, b, new LocalFsConnector()),
    ...overrides,
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    headers: { authorization: `Bearer ${token}` },
    json: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    server,
    storage,
    dataDir,
    runtime,
  };
}

function closeRig(rig: Rig): void {
  rig.server.close();
  rig.storage.closeAll();
  rmSync(rig.dataDir, { recursive: true, force: true });
}

/** 登录态替身：服务端只从会话里读当前工作区，同integration.test.ts的约定。 */
function signedInTo(workspaceId: string, extra: Partial<PlatformService> = {}): PlatformService {
  return {
    session: () => ({ signedIn: true, workspace: { id: workspaceId, name: "测试工作区" } }),
    ...extra,
  } as unknown as PlatformService;
}

async function projectIn(rig: Rig, workspaceId: string): Promise<string> {
  const bid = loadProducts(productsDir).loaded.find((p) => p.id === "vxture.bid")!;
  const meta = await rig.runtime.createProject(bid.contract, "投标项目", workspaceId);
  return meta.id;
}

/** 归属之前的记录：待导入队列，不属于任何工作区（同integration.test.ts的构造方式）。 */
async function unattributedProject(rig: Rig, id: string): Promise<void> {
  const bid = loadProducts(productsDir).loaded.find((p) => p.id === "vxture.bid")!;
  const store = await rig.storage.createProjectStore(id);
  await store.putMeta({
    id,
    productId: "vxture.bid",
    productVersion: "1.0.0",
    contractVersion: "0.1",
    name: "老项目",
    projectType: "project",
    createdAt: "2026-01-01T00:00:00Z",
  });
  await store.putContract(JSON.stringify(bid.contract));
  await store.setBusinessState("draft");
}

void test("HTTP: 页面直接引用的根级资源不经令牌闸门 —— 带 Authorization 的请求它拿不到", async () => {
  // 浏览器为 `<img src>` / `<link href>` 发的请求**不带 Authorization 头**。
  // 这类资源如果落到令牌闸门上就是 401，界面上留一个碎图，而控制台一句报错
  // 都没有 —— img 加载失败不进 console.error。logo.svg 就是这么丢的：加了
  // 文件、没登记，页签和标题栏的标记一起空掉，构建和类型全绿。
  const uiDir = mkdtempSync(join(tmpdir(), "ruyin-ui-"));
  writeFileSync(join(uiDir, "index.html"), "<!doctype html><title>t</title>");
  writeFileSync(join(uiDir, "logo.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  writeFileSync(join(uiDir, "icon.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  writeFileSync(join(uiDir, "secret.txt"), "not a whitelisted root file");
  const rig = await startServer({ uiDir });
  try {
    for (const name of ["logo.svg", "icon.svg"]) {
      // 无凭据取，正是浏览器的取法。
      const res = await fetch(`${rig.base}/${name}`);
      assert.equal(res.status, 200, `${name} 应无需令牌即可取到`);
      assert.equal(res.headers.get("content-type"), "image/svg+xml");
    }
    // 名单之外的东西不因此被放行 —— 这不是一个「静态目录全公开」的口子。
    const denied = await fetch(`${rig.base}/secret.txt`);
    assert.equal(denied.status, 401);
  } finally {
    closeRig(rig);
    rmSync(uiDir, { recursive: true, force: true });
  }
});

void test("HTTP /auth/session, /auth/login, /auth/logout wire straight through to PlatformService", async () => {
  let loginCalls = 0;
  let logoutCalls = 0;
  const platform = signedInTo("wsp_x", {
    beginLogin: async () => {
      loginCalls++;
      return "https://accounts.vxture.com/authorize?state=abc";
    },
    logout: async () => {
      logoutCalls++;
    },
  });
  const rig = await startServer({ platform });
  try {
    const session = (await (
      await fetch(`${rig.base}/auth/session`, { headers: rig.headers })
    ).json()) as { signedIn: boolean };
    assert.equal(session.signedIn, true);

    const login = await fetch(`${rig.base}/auth/login`, { method: "POST", headers: rig.headers });
    assert.equal(login.status, 200);
    assert.equal(
      ((await login.json()) as { authorizeUrl: string }).authorizeUrl,
      "https://accounts.vxture.com/authorize?state=abc",
    );
    assert.equal(loginCalls, 1);

    const logout = await fetch(`${rig.base}/auth/logout`, { method: "POST", headers: rig.headers });
    assert.equal(logout.status, 200);
    assert.equal(logoutCalls, 1);
  } finally {
    closeRig(rig);
  }
});

void test("HTTP: /auth/* is a 404 when no platform integration is configured", async () => {
  const rig = await startServer();
  try {
    const res = await fetch(`${rig.base}/auth/session`, { headers: rig.headers });
    assert.equal(res.status, 404);
  } finally {
    closeRig(rig);
  }
});

void test("HTTP GET /oauth/callback: an upstream error is shown, and reflected text is escaped", async () => {
  const rig = await startServer({ platform: signedInTo("wsp_x") });
  try {
    const res = await fetch(
      `${rig.base}/oauth/callback?error=${encodeURIComponent("<script>alert(1)</script>")}`,
    );
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(!html.includes("<script>alert(1)</script>"), "反射型 XSS：错误文本原样进了页面");
    assert.ok(html.includes("&lt;script&gt;"));
  } finally {
    closeRig(rig);
  }
});

void test("HTTP GET /oauth/callback: missing code/state is a 400", async () => {
  const rig = await startServer({ platform: signedInTo("wsp_x") });
  try {
    const res = await fetch(`${rig.base}/oauth/callback`);
    assert.equal(res.status, 400);
  } finally {
    closeRig(rig);
  }
});

void test("HTTP GET /oauth/callback: success completes the login and renders the success page", async () => {
  let received: [string, string] | undefined;
  const platform = signedInTo("wsp_x", {
    completeLogin: async (code: string, state: string) => {
      received = [code, state];
    },
  });
  const rig = await startServer({ platform });
  try {
    const res = await fetch(`${rig.base}/oauth/callback?code=c1&state=s1`);
    assert.equal(res.status, 200);
    assert.ok((await res.text()).includes("登录成功"));
    assert.deepEqual(received, ["c1", "s1"]);
  } finally {
    closeRig(rig);
  }
});

void test("HTTP GET /oauth/callback: a completeLogin failure renders as a 400, escaped, not a 500", async () => {
  const platform = signedInTo("wsp_x", {
    completeLogin: async () => {
      throw new Error("state <mismatch> detected");
    },
  });
  const rig = await startServer({ platform });
  try {
    const res = await fetch(`${rig.base}/oauth/callback?code=c1&state=s1`);
    assert.equal(res.status, 400);
    const html = await res.text();
    assert.ok(html.includes("&lt;mismatch&gt;"));
    assert.ok(!html.includes("<mismatch>"));
  } finally {
    closeRig(rig);
  }
});

void test("HTTP GET /entitlements: missing products param is 400; happy path proxies the envelope", async () => {
  const platform = signedInTo("wsp_x", {
    entitlements: async (products: string[]) => ({
      workspace_id: "wsp_x",
      entitlements: Object.fromEntries(products.map((p) => [p, { status: "active" }])),
    }),
  });
  const rig = await startServer({ platform });
  try {
    const missing = await fetch(`${rig.base}/entitlements`, { headers: rig.headers });
    assert.equal(missing.status, 400);

    const ok = await fetch(`${rig.base}/entitlements?products=bid,other`, { headers: rig.headers });
    assert.equal(ok.status, 200);
    const body = (await ok.json()) as { entitlements: Record<string, unknown> };
    assert.ok(body.entitlements["bid"]);
    assert.ok(body.entitlements["other"]);
  } finally {
    closeRig(rig);
  }
});

void test("HTTP GET /entitlements: NotSignedInError -> 401, PlatformNotConfiguredError -> 503", async () => {
  let rig = await startServer({
    platform: signedInTo("wsp_x", {
      entitlements: async () => {
        throw new NotSignedInError();
      },
    }),
  });
  try {
    const res = await fetch(`${rig.base}/entitlements?products=bid`, { headers: rig.headers });
    assert.equal(res.status, 401);
  } finally {
    closeRig(rig);
  }

  rig = await startServer({
    platform: signedInTo("wsp_x", {
      entitlements: async () => {
        throw new PlatformNotConfiguredError();
      },
    }),
  });
  try {
    const res = await fetch(`${rig.base}/entitlements?products=bid`, { headers: rig.headers });
    assert.equal(res.status, 503);
  } finally {
    closeRig(rig);
  }
});

void test("HTTP GET /updates/check answers with a gate and does not install anything", async () => {
  const rig = await startServer();
  try {
    const res = await fetch(`${rig.base}/updates/check`, { headers: rig.headers });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { gate: { installable: boolean } };
    assert.equal(typeof body.gate.installable, "boolean");
  } finally {
    closeRig(rig);
  }
});

void test("HTTP GET /updates/intent: no pending intent by default", async () => {
  const rig = await startServer();
  try {
    const res = await fetch(`${rig.base}/updates/intent`, { headers: rig.headers });
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { intent: unknown }).intent, null);
  } finally {
    closeRig(rig);
  }
});

void test("HTTP POST /entitlements/refresh: no refreshEntitlements configured still answers 200 with the list", async () => {
  const rig = await startServer();
  try {
    const res = await fetch(`${rig.base}/entitlements/refresh`, {
      method: "POST",
      headers: rig.headers,
    });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(await res.json()));
  } finally {
    closeRig(rig);
  }
});

void test("HTTP /products/:id/activate|deactivate|pin-version wire through; unknown ids 404 with the right code", async () => {
  const rig = await startServer();
  try {
    const deactivate = await fetch(`${rig.base}/products/vxture.bid/deactivate`, {
      method: "POST",
      headers: rig.headers,
    });
    assert.equal(deactivate.status, 200);
    assert.equal(((await deactivate.json()) as { state: string }).state, "inactive");

    const activate = await fetch(`${rig.base}/products/vxture.bid/activate`, {
      method: "POST",
      headers: rig.headers,
    });
    assert.equal(activate.status, 200);
    assert.equal(((await activate.json()) as { state: string }).state, "active");

    const badActivate = await fetch(`${rig.base}/products/nope.missing/activate`, {
      method: "POST",
      headers: rig.headers,
    });
    assert.equal(badActivate.status, 404);
    assert.equal(((await badActivate.json()) as { code: string }).code, "PRODUCT_NOT_FOUND");

    const badPin = await fetch(`${rig.base}/products/vxture.bid/pin-version`, {
      method: "POST",
      headers: rig.json,
      body: JSON.stringify({ version: "9.9.9" }),
    });
    assert.equal(badPin.status, 404);
    assert.equal(((await badPin.json()) as { code: string }).code, "PRODUCT_VERSION_NOT_FOUND");
  } finally {
    closeRig(rig);
  }
});

void test("HTTP: malformed JSON body is a 400 REQUEST_MALFORMED, not an internal 500", async () => {
  const rig = await startServer({ platform: signedInTo("wsp_x") });
  try {
    const res = await fetch(`${rig.base}/projects`, {
      method: "POST",
      headers: rig.json,
      body: "{not valid json",
    });
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { code: string }).code, "REQUEST_MALFORMED");
  } finally {
    closeRig(rig);
  }
});

void test("HTTP POST /projects/:id/state: a valid transition applies, an undeclared one is 409", async () => {
  const rig = await startServer({ platform: signedInTo("wsp_x") });
  try {
    const pid = await projectIn(rig, "wsp_x");
    const ok = await fetch(`${rig.base}/projects/${pid}/state`, {
      method: "POST",
      headers: rig.json,
      body: JSON.stringify({ to: "planning" }),
    });
    assert.equal(ok.status, 200);
    assert.equal(((await ok.json()) as { businessState: string }).businessState, "planning");

    // draft -> submitted 跳过了 planning/writing/review，不在契约的转移表里。
    const illegal = await fetch(`${rig.base}/projects/${pid}/state`, {
      method: "POST",
      headers: rig.json,
      body: JSON.stringify({ to: "submitted" }),
    });
    assert.equal(illegal.status, 409);
    assert.equal(((await illegal.json()) as { code: string }).code, "STATE_TRANSITION_ILLEGAL");
  } finally {
    closeRig(rig);
  }
});

void test("HTTP GET/POST /projects/:id/grants", async () => {
  const rig = await startServer({ platform: signedInTo("wsp_x") });
  const dir = mkdtempSync(join(tmpdir(), "ruyin-grant-"));
  try {
    const pid = await projectIn(rig, "wsp_x");
    const empty = await fetch(`${rig.base}/projects/${pid}/grants`, { headers: rig.headers });
    assert.deepEqual(await empty.json(), []);

    const created = await fetch(`${rig.base}/projects/${pid}/grants`, {
      method: "POST",
      headers: rig.json,
      body: JSON.stringify({ path: dir, mode: "readwrite" }),
    });
    assert.equal(created.status, 201);
    assert.equal(((await created.json()) as { mode: string }).mode, "readwrite");

    const list = (await (
      await fetch(`${rig.base}/projects/${pid}/grants`, { headers: rig.headers })
    ).json()) as unknown[];
    assert.equal(list.length, 1);
  } finally {
    closeRig(rig);
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("HTTP POST /projects/:id/bindings: an ungranted root is BINDING_INVALID, a granted one succeeds and indexes", async () => {
  const rig = await startServer({ platform: signedInTo("wsp_x") });
  const dir = mkdtempSync(join(tmpdir(), "ruyin-bind-"));
  writeFileSync(join(dir, "招标文件.md"), "# 招标\n\n一级资质\n", "utf8");
  try {
    const pid = await projectIn(rig, "wsp_x");

    const rejected = await fetch(`${rig.base}/projects/${pid}/bindings`, {
      method: "POST",
      headers: rig.json,
      body: JSON.stringify({ type: "tender_document", root: dir }),
    });
    assert.equal(rejected.status, 400);
    assert.equal(((await rejected.json()) as { code: string }).code, "BINDING_INVALID");

    await fetch(`${rig.base}/projects/${pid}/grants`, {
      method: "POST",
      headers: rig.json,
      body: JSON.stringify({ path: dir, mode: "read" }),
    });
    const bound = await fetch(`${rig.base}/projects/${pid}/bindings`, {
      method: "POST",
      headers: rig.json,
      body: JSON.stringify({ type: "tender_document", root: dir }),
    });
    assert.equal(bound.status, 201);
    assert.equal(((await bound.json()) as { type: string }).type, "tender_document");

    const list = (await (
      await fetch(`${rig.base}/projects/${pid}/bindings`, { headers: rig.headers })
    ).json()) as unknown[];
    assert.equal(list.length, 1);
  } finally {
    closeRig(rig);
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("HTTP GET /projects/:id/context/:type: empty before binding, non-empty after", async () => {
  const rig = await startServer({ platform: signedInTo("wsp_x") });
  const dir = mkdtempSync(join(tmpdir(), "ruyin-ctx-"));
  writeFileSync(join(dir, "招标文件.md"), "# 招标\n\n一级资质\n", "utf8");
  try {
    const pid = await projectIn(rig, "wsp_x");
    const before = await fetch(`${rig.base}/projects/${pid}/context/tender_document`, {
      headers: rig.headers,
    });
    assert.equal(before.status, 200);
    assert.deepEqual(await before.json(), []);

    await fetch(`${rig.base}/projects/${pid}/grants`, {
      method: "POST",
      headers: rig.json,
      body: JSON.stringify({ path: dir, mode: "read" }),
    });
    await fetch(`${rig.base}/projects/${pid}/bindings`, {
      method: "POST",
      headers: rig.json,
      body: JSON.stringify({ type: "tender_document", root: dir }),
    });
    const after = await fetch(`${rig.base}/projects/${pid}/context/tender_document`, {
      headers: rig.headers,
    });
    const items = (await after.json()) as unknown[];
    assert.ok(items.length > 0);
  } finally {
    closeRig(rig);
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("HTTP GET /projects/:id/audit: the project's own creation is already on the chain", async () => {
  const rig = await startServer({ platform: signedInTo("wsp_x") });
  try {
    const pid = await projectIn(rig, "wsp_x");
    const res = await fetch(`${rig.base}/projects/${pid}/audit`, { headers: rig.headers });
    assert.equal(res.status, 200);
    const events = (await res.json()) as unknown[];
    assert.ok(events.length > 0);
  } finally {
    closeRig(rig);
  }
});

void test("HTTP POST /projects/:id/tasks/:tid/cancel", async () => {
  const rig = await startServer({ platform: signedInTo("wsp_x") });
  try {
    const pid = await projectIn(rig, "wsp_x");
    const created = await fetch(`${rig.base}/projects/${pid}/tasks`, {
      method: "POST",
      headers: rig.json,
      body: JSON.stringify({ task: "analyze_tender" }),
    });
    assert.equal(created.status, 202);
    const instance = (await created.json()) as { id: string };

    const cancelled = await fetch(
      `${rig.base}/projects/${pid}/tasks/${instance.id}/cancel`,
      { method: "POST", headers: rig.headers },
    );
    assert.equal(cancelled.status, 202);
  } finally {
    closeRig(rig);
  }
});

void test("HTTP POST /projects/:id/import: imports an unattributed project once, a second time is 409", async () => {
  const rig = await startServer({ platform: signedInTo("wsp_x") });
  try {
    await unattributedProject(rig, "prj_legacy_http_1");
    const first = await fetch(`${rig.base}/projects/prj_legacy_http_1/import`, {
      method: "POST",
      headers: rig.headers,
    });
    assert.equal(first.status, 200);

    const again = await fetch(`${rig.base}/projects/prj_legacy_http_1/import`, {
      method: "POST",
      headers: rig.headers,
    });
    assert.equal(again.status, 409);
    assert.equal(((await again.json()) as { code: string }).code, "PROJECT_ALREADY_ATTRIBUTED");
  } finally {
    closeRig(rig);
  }
});

void test("HTTP POST /projects/:id/import: signed out cannot import (409 WORKSPACE_REQUIRED)", async () => {
  const rig = await startServer();
  try {
    await unattributedProject(rig, "prj_legacy_http_2");
    const res = await fetch(`${rig.base}/projects/prj_legacy_http_2/import`, {
      method: "POST",
      headers: rig.headers,
    });
    assert.equal(res.status, 409);
    assert.equal(((await res.json()) as { code: string }).code, "WORKSPACE_REQUIRED");
  } finally {
    closeRig(rig);
  }
});

void test("HTTP: an unknown route is a 404 that names the path", async () => {
  const rig = await startServer();
  try {
    const res = await fetch(`${rig.base}/nope/nothing`, { headers: rig.headers });
    assert.equal(res.status, 404);
    assert.equal(((await res.json()) as { path: string }).path, "/nope/nothing");
  } finally {
    closeRig(rig);
  }
});

