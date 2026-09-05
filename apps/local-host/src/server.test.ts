/**
 * HTTP surface tests for routes integration.test.ts's milestone flow never
 * reaches: identity (auth/session, auth/login, auth/logout, oauth/callback),
 * entitlements, updates/check, product lifecycle
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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { MemorySkills, ProjectRuntime, type ConnectorPort } from "@vxture/ruyin-core";
import { SqliteStoragePort } from "./storage.js";
import { MockAIGateway, nodeClock, nodeCrypto, nodeId } from "./host-ports.js";
import { KeyManager } from "./keys.js";
import { LocalFsConnector } from "./connector-fs.js";
import { ConnectorRegistry } from "./connector-registry.js";
import { FtsRanker, reindexBinding, searchContext } from "./fts.js";
import { FolderPick } from "./folder-pick.js";
import { EventBus } from "./events.js";
import { LocalToolExecutor } from "./tool-executor.js";
import { loadProducts } from "./products.js";
import { ProductRegistry } from "./product-registry.js";
import { createLocalApi, type LocalApiDeps } from "./server.js";
import { TaskRunner } from "./task-runner.js";
import { SkillRegistry } from "./skill-registry.js";
import { ToolRegistryView } from "./tool-registry.js";
import { BundledToolServers } from "./tool-servers.js";
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
  capabilitySurface: "mock" as const,
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

async function startServer(
  overrides: Partial<LocalApiDeps> = {},
  // The lookup the kernel reads; a test that installs connectors hands in the
  // same Map its registry writes to.
  lookup: Map<string, ConnectorPort> = new Map([["local-fs", new LocalFsConnector()]]),
): Promise<Rig> {
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
    connectors: lookup,
    ranker: new FtsRanker(storage),
    tools: executor,
    // 样例契约声明了技能：测试装配用内存登记册应答，不要求先拉预置层。
    skills: MemorySkills.forContract(loadProducts(productsDir).loaded.find((p) => p.id === "bidproposal")!.contract),
  });
  const token = "srv-test-token";
  const server = createLocalApi({
    runtime,
    registry: new ProductRegistry(productsDir, dataDir),
    tasks: new TaskRunner(runtime),
    token,
    version: "test",
    writeArtifact: (p, b, g) => executor.writeArtifact(p, b, g),
    supportsTool: (t) => executor.supports(t),
    systemInfo: testSystemInfo,
    reindex: (pid, b) => reindexBinding(storage, pid, b, lookup.get(b.connector)!),
    connectors: new ConnectorRegistry(dataDir, new Map(), { allowUnsigned: false }),
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

test("connectors: list is empty, install is refused in production with 403 naming TD-012, unknown id is 404", async () => {
  const rig = await startServer();
  try {
    const list = await fetch(`${rig.base}/connectors`, { headers: rig.headers });
    assert.equal(list.status, 200);
    assert.deepEqual(await list.json(), { items: [] });

    const install = await fetch(`${rig.base}/connectors`, {
      method: "POST",
      headers: rig.json,
      body: JSON.stringify({ id: "crm", command: process.execPath, args: [], source: "lan" }),
    });
    assert.equal(install.status, 403);
    const body = (await install.json()) as { code: string; message: string; retryable: boolean };
    assert.equal(body.code, "CONNECTOR_INSTALL_REFUSED");
    assert.match(body.message, /TD-012/);

    const health = await fetch(`${rig.base}/connectors/crm/health`, { headers: rig.headers });
    assert.equal(health.status, 200);
    assert.equal(((await health.json()) as { ok: boolean }).ok, false);

    const del = await fetch(`${rig.base}/connectors/crm`, { method: "DELETE", headers: rig.headers });
    assert.equal(del.status, 404);
    assert.equal(((await del.json()) as { code: string }).code, "CONNECTOR_NOT_FOUND");
  } finally {
    closeRig(rig);
  }
});

test("connectors: without a registry the routes answer 503, not an empty list", async () => {
  const rig = await startServer({ connectors: undefined });
  try {
    const list = await fetch(`${rig.base}/connectors`, { headers: rig.headers });
    assert.equal(list.status, 503);
    assert.equal(((await list.json()) as { code: string }).code, "CONNECTORS_NOT_AVAILABLE");
  } finally {
    closeRig(rig);
  }
});

test("connectors: development install -> project grant -> lan binding -> discover and index through MCP; then removal", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "ruyin-srv-conn-"));
  const lookup = new Map<string, ConnectorPort>([["local-fs", new LocalFsConnector()]]);
  const registry = new ConnectorRegistry(dataDir, lookup, { allowUnsigned: true, timeoutMs: 5000 });
  const rig = await startServer({ platform: signedInTo("wsp_x"), connectors: registry }, lookup);
  const fake = fileURLToPath(new URL("./fake-mcp-server.js", import.meta.url));
  try {
    const bad = await fetch(`${rig.base}/connectors`, {
      method: "POST",
      headers: rig.json,
      body: JSON.stringify({ id: "Bad Id", command: process.execPath, source: "lan" }),
    });
    assert.equal(bad.status, 400);
    assert.equal(((await bad.json()) as { code: string }).code, "CONNECTOR_INVALID");

    const install = await fetch(`${rig.base}/connectors`, {
      method: "POST",
      headers: rig.json,
      body: JSON.stringify({ id: "crm", command: process.execPath, args: [fake], source: "lan" }),
    });
    assert.equal(install.status, 201);
    const view = (await install.json()) as { id: string; health: { ok: boolean } };
    assert.equal(view.id, "crm");
    assert.equal(view.health.ok, true);
    assert.ok(lookup.has("crm"), "the kernel sees what the registry installed");

    const pid = await projectIn(rig, "wsp_x");
    // Binding through an ungranted connector is refused - authorization is per project.
    const ungranted = await fetch(`${rig.base}/projects/${pid}/bindings`, {
      method: "POST",
      headers: rig.json,
      body: JSON.stringify({ type: "enterprise_capability", root: "crm://accounts/", connector: "crm", source: "lan" }),
    });
    assert.equal(ungranted.status, 400);
    assert.match(((await ungranted.json()) as { message: string }).message, /not granted to this project/);

    const grant = await fetch(`${rig.base}/projects/${pid}/grants`, {
      method: "POST",
      headers: rig.json,
      body: JSON.stringify({ connector: "crm" }),
    });
    assert.equal(grant.status, 201);
    assert.equal(((await grant.json()) as { kind: string }).kind, "connector");

    // The contract decides which source kinds a type may take: tender_document is local-only.
    const wrongSource = await fetch(`${rig.base}/projects/${pid}/bindings`, {
      method: "POST",
      headers: rig.json,
      body: JSON.stringify({ type: "tender_document", root: "crm://", connector: "crm", source: "lan" }),
    });
    assert.equal(wrongSource.status, 400);
    assert.match(((await wrongSource.json()) as { message: string }).message, /does not allow the lan source/);

    const bound = await fetch(`${rig.base}/projects/${pid}/bindings`, {
      method: "POST",
      headers: rig.json,
      body: JSON.stringify({ type: "enterprise_capability", root: "crm://accounts/", connector: "crm", source: "lan" }),
    });
    assert.equal(bound.status, 201);
    const binding = (await bound.json()) as { source: string; connector: string; indexed: number };
    assert.equal(binding.source, "lan");
    assert.equal(binding.connector, "crm");
    // Three resources under crm://accounts/ - one unreadable, still indexed by name.
    assert.equal(binding.indexed, 3);

    const items = (await (
      await fetch(`${rig.base}/projects/${pid}/context/enterprise_capability`, { headers: rig.headers })
    ).json()) as Array<{ connector: string; source: string; ref: string }>;
    assert.equal(items.length, 3);
    assert.ok(items.every((i) => i.connector === "crm" && i.source === "lan" && i.ref.startsWith("crm://accounts/")));

    const removed = await fetch(`${rig.base}/connectors/crm`, { method: "DELETE", headers: rig.headers });
    assert.equal(removed.status, 200);
    assert.ok(!lookup.has("crm"));
    // The binding is still on record; discovering through it now says the connector is gone.
    const after = await fetch(`${rig.base}/projects/${pid}/context/enterprise_capability`, { headers: rig.headers });
    assert.notEqual(after.status, 200);
    assert.match(((await after.json()) as { message: string }).message, /connector "crm" is not available/);
  } finally {
    await registry.stopAll();
    closeRig(rig);
    rmSync(dataDir, { recursive: true, force: true });
  }
});

/**
 * 流 C 静态产品库的两个口。真跑 CLI 产出一份 registry 目录，用注入的 fetch 从
 * 磁盘上"提供"它 —— 走的是真清单、真包、真安装管线。
 */
function buildRegistryFixture(): { dir: string; base: string; fetchImpl: typeof fetch } {
  const root = mkdtempSync(join(tmpdir(), "ruyin-srv-reg-"));
  const cli = fileURLToPath(new URL("../../../packages/cli/dist/main.js", import.meta.url));
  const base = "https://dl.example.test/ruyin/products";
  const built = spawnSync(process.execPath, [cli, "registry", productsDir, "--out", join(root, "reg"), "--base-url", base], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr);
  const fetchImpl = (async (input: string | URL | Request) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!href.startsWith(base + "/")) return new Response("", { status: 404 });
    const file = join(root, "reg", decodeURIComponent(href.slice(base.length + 1)));
    return existsSync(file) ? new Response(readFileSync(file), { status: 200 }) : new Response("", { status: 404 });
  }) as unknown as typeof fetch;
  return { dir: root, base, fetchImpl };
}

test("HTTP /registry: unreachable is a 200 with status unreachable (not an empty catalog); a good index marks installed versions and installability", async () => {
  const down = await startServer({
    registryBase: "https://dl.example.test/ruyin/products",
    registryFetch: (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch,
  });
  try {
    const res = await fetch(`${down.base}/registry`, { headers: down.headers });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status: string; reason: string };
    assert.equal(body.status, "unreachable");
    assert.match(body.reason, /ECONNREFUSED/);
  } finally {
    closeRig(down);
  }

  const fixture = buildRegistryFixture();
  const rig = await startServer({ registryBase: fixture.base, registryFetch: fixture.fetchImpl });
  try {
    const res = await fetch(`${rig.base}/registry`, { headers: rig.headers });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      status: string;
      installable: boolean;
      items: Array<{ id: string; version: string; signed: boolean; installed: boolean; installedVersions: string[] }>;
    };
    assert.equal(body.status, "ok");
    // The rig requires signatures (production posture): the catalog is visible, not installable.
    assert.equal(body.installable, false);
    const bid = body.items.find((i) => i.id === "bidproposal");
    assert.ok(bid);
    assert.equal(bid.signed, false);
    // products/bidproposal is the dev-mode builtin in this rig, so 1.0.0 shows as installed.
    assert.equal(bid.installed, true);
    assert.deepEqual(bid.installedVersions, ["1.0.0"]);
  } finally {
    closeRig(rig);
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("HTTP POST /registry/install: 503 when the index is unreachable, 404 for an unlisted entry, 403 unsigned in production, 201 in development", async () => {
  const fixture = buildRegistryFixture();
  const prod = await startServer({ registryBase: fixture.base, registryFetch: fixture.fetchImpl });
  try {
    const missing = await fetch(`${prod.base}/registry/install`, {
      method: "POST",
      headers: prod.json,
      body: JSON.stringify({ id: "bidproposal", version: "9.9.9" }),
    });
    assert.equal(missing.status, 404);
    assert.equal(((await missing.json()) as { code: string }).code, "REGISTRY_ENTRY_NOT_FOUND");

    const refused = await fetch(`${prod.base}/registry/install`, {
      method: "POST",
      headers: prod.json,
      body: JSON.stringify({ id: "bidproposal", version: "1.0.0" }),
    });
    assert.equal(refused.status, 403);
    const body = (await refused.json()) as { code: string; message: string };
    assert.equal(body.code, "PACKAGE_UNSIGNED");
    assert.match(body.message, /not countersigned/);
  } finally {
    closeRig(prod);
  }

  const dev = await startServer({ registryBase: fixture.base, registryFetch: fixture.fetchImpl, requireSignedPackages: false });
  try {
    // 1.0.0 is already installed as the dev builtin in this rig; a registry
    // install of the same version is refused by the installer, honestly.
    const dup = await fetch(`${dev.base}/registry/install`, {
      method: "POST",
      headers: dev.json,
      body: JSON.stringify({ id: "bidproposal", version: "1.0.0" }),
    });
    assert.equal(dup.status, 422);
    assert.equal(((await dup.json()) as { code: string }).code, "PACKAGE_INVALID");
  } finally {
    closeRig(dev);
  }

  const down = await startServer({
    registryBase: fixture.base,
    registryFetch: (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch,
  });
  try {
    const res = await fetch(`${down.base}/registry/install`, {
      method: "POST",
      headers: down.json,
      body: JSON.stringify({ id: "bidproposal", version: "1.0.0" }),
    });
    assert.equal(res.status, 503);
    assert.equal(((await res.json()) as { code: string }).code, "REGISTRY_UNREACHABLE");
  } finally {
    closeRig(down);
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

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
  const bid = loadProducts(productsDir).loaded.find((p) => p.id === "bidproposal")!;
  const meta = await rig.runtime.createProject(bid.contract, "投标项目", workspaceId);
  return meta.id;
}

/** 归属之前的记录：待导入队列，不属于任何工作区（同integration.test.ts的构造方式）。 */
async function unattributedProject(rig: Rig, id: string): Promise<void> {
  const bid = loadProducts(productsDir).loaded.find((p) => p.id === "bidproposal")!;
  const store = await rig.storage.createProjectStore(id);
  await store.putMeta({
    id,
    productId: "bidproposal",
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
  writeFileSync(join(uiDir, "secret.txt"), "not a whitelisted root file");
  const rig = await startServer({ uiDir });
  try {
    for (const name of ["logo.svg"]) {
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
    const deactivate = await fetch(`${rig.base}/products/bidproposal/deactivate`, {
      method: "POST",
      headers: rig.headers,
    });
    assert.equal(deactivate.status, 200);
    assert.equal(((await deactivate.json()) as { state: string }).state, "inactive");

    const activate = await fetch(`${rig.base}/products/bidproposal/activate`, {
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

    const badPin = await fetch(`${rig.base}/products/bidproposal/pin-version`, {
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


/**
 * 更新检查（MVP 不做自动更新之后）。
 *
 * 端点只回答「有没有新版本、去哪儿拿」。**没有安装动作，也就没有闸门**——
 * 原先的 gate/intent 随 electron-updater 一并拆掉了（TD-021，owner 定
 * 2026-09-02）。
 */
void test("HTTP GET /updates/check 只作答，不安装；已无 gate 字段", async () => {
  const rig = await startServer();
  try {
    const res = await fetch(`${rig.base}/updates/check`, { headers: rig.headers });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body["current"], "test");
    // 渠道必须在答案里：不写明渠道的下载链接是有害的。
    assert.equal(typeof body["channel"], "string");
    // 闸门是安装时代的遗物，不该再出现。
    assert.equal(body["gate"], undefined);
    assert.ok(["current", "available", "unreachable"].includes(String(body["status"])));
  } finally {
    closeRig(rig);
  }
});

void test("HTTP: 安装与意图两个端点已经不存在（不是留着不用）", async () => {
  const rig = await startServer();
  try {
    // 留着一条走不通的路，下一个人会以为它还能走。
    const install = await fetch(`${rig.base}/updates/install`, {
      method: "POST",
      headers: rig.json,
      body: JSON.stringify({ version: "9.9.9" }),
    });
    assert.equal(install.status, 404);
    const intent = await fetch(`${rig.base}/updates/intent`, { headers: rig.headers });
    assert.equal(intent.status, 404);
  } finally {
    closeRig(rig);
  }
});

test("ui theme relay: GET defaults to dark, POST stores it and publishes once per real change", async () => {
  const events = new EventBus();
  const seen: string[] = [];
  events.subscribe((e) => seen.push(e.kind));
  let theme: "dark" | "light" = "dark";
  const rig = await startServer({
    events,
    chromeTheme: { get: () => theme, set: (t) => { theme = t; } },
  });
  try {
    const read = async () =>
      (await (await fetch(`${rig.base}/ui/theme`, { headers: rig.headers })).json()) as {
        theme: string;
      };
    assert.deepEqual(await read(), { theme: "dark" });

    const post = (value: unknown) =>
      fetch(`${rig.base}/ui/theme`, {
        method: "POST",
        headers: rig.json,
        body: JSON.stringify({ theme: value }),
      });

    assert.deepEqual(await (await post("light")).json(), { theme: "light" });
    assert.deepEqual(await read(), { theme: "light" });
    // 同一个值再报一次不广播：<html> 的 class 会因为密度 / 字号反复变动，
    // 每次都广播等于把一条通知通道当轮询用。
    await post("light");
    assert.deepEqual(seen, ["ui-theme"]);
    await post("dark");
    assert.deepEqual(seen, ["ui-theme", "ui-theme"]);
    // 认不出的值一律当深色 —— 绝不因为一句读不懂的话把窗口按钮翻成亮的。
    assert.deepEqual(await (await post("neon")).json(), { theme: "dark" });
    assert.equal(theme, "dark");
  } finally {
    rig.server.close();
  }
});

/** 轮到条件成立为止。这个文件跑在 node:test 上，没有 vitest 的 waitFor。 */
async function vi_waitFor(fn: () => Promise<void>, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  for (;;) {
    try {
      await fn();
      return;
    } catch (e) {
      if (Date.now() > deadline) throw e;
      await new Promise((r) => setTimeout(r, 20));
    }
  }
}

test("data dir move: 校验→排队→撤销三步；排队之前再校验一次，不给必定失败的搬家排队", async () => {
  const calls: string[] = [];
  let pending: string | undefined;
  // 「目标可用不可用」由宿主那一侧真的去摸文件系统（data-location.ts），这里
  // 钉的是**路由的行为**：谁在什么时候被问、拒绝时给什么状态码。
  const rig = await startServer({
    dataMove: {
      check: (target: string) => {
        calls.push(`check:${target}`);
        return target === "D:\ok"
          ? { ok: true, sameVolume: false, bytes: 1024 }
          : { ok: false, reason: "目标目录里已经有东西了。" };
      },
      request: (target: string) => {
        calls.push(`request:${target}`);
        pending = target;
      },
      cancel: () => {
        calls.push("cancel");
        pending = undefined;
      },
    },
  });
  try {
    const post = (path: string, body: unknown) =>
      fetch(`${rig.base}${path}`, { method: "POST", headers: rig.json, body: JSON.stringify(body) });

    const bad = await post("/system/data-dir/check", { target: "D:\taken" });
    assert.equal(bad.status, 200);
    assert.equal(((await bad.json()) as { reason: string }).reason, "目标目录里已经有东西了。");
    // 校验没有副作用：问一句不该把任何东西排上队。
    assert.equal(pending, undefined);

    const refused = await post("/system/data-dir", { target: "D:\taken" });
    assert.equal(refused.status, 400);
    assert.equal(((await refused.json()) as { code: string }).code, "DATA_DIR_UNUSABLE");
    assert.equal(pending, undefined);

    const queued = await post("/system/data-dir", { target: "D:\ok" });
    assert.equal(queued.status, 202);
    assert.deepEqual(await queued.json(), {
      pending: "D:\ok",
      ok: true,
      sameVolume: false,
      bytes: 1024,
    });
    assert.equal(pending, "D:\ok");

    const cancelled = await fetch(`${rig.base}/system/data-dir`, {
      method: "DELETE",
      headers: rig.headers,
    });
    assert.equal(cancelled.status, 200);
    assert.equal(pending, undefined);
    // 排队之前那一次校验是**独立的一次**：界面那次与这次之间隔着用户的犹豫，
    // 目录可能已经不是原来的样子了。
    assert.deepEqual(calls, [
      "check:D:\taken",
      "check:D:\taken",
      "check:D:\ok",
      "request:D:\ok",
      "cancel",
    ]);
  } finally {
    closeRig(rig);
  }
});

test("data dir move: 宿主没注入搬家能力时，这几个端点根本不存在", async () => {
  const rig = await startServer({});
  try {
    const check = await fetch(`${rig.base}/system/data-dir/check`, {
      method: "POST",
      headers: rig.json,
      body: JSON.stringify({ target: "D:\ok" }),
    });
    // 404 而不是「假装排上了」：没有指针文件的部署搬不了家，说清楚比含糊好。
    assert.equal(check.status, 404);
  } finally {
    closeRig(rig);
  }
});

test("ui restart: 请壳重启就是发一条事件 —— 界面是纯 Web 客户端，做不到这件事", async () => {
  const events = new EventBus();
  const seen: string[] = [];
  events.subscribe((e) => seen.push(e.kind));
  const rig = await startServer({ events });
  try {
    const res = await fetch(`${rig.base}/ui/restart`, { method: "POST", headers: rig.headers });
    assert.equal(res.status, 202);
    assert.deepEqual(seen, ["app-restart"]);
  } finally {
    closeRig(rig);
  }
});

test("ui open-data-dir: 只发一条不带路径的事件 —— 打开哪个目录由守护进程说", async () => {
  const events = new EventBus();
  const seen: unknown[] = [];
  events.subscribe((e) => seen.push(e));
  const rig = await startServer({ events });
  try {
    const res = await fetch(`${rig.base}/ui/open-data-dir`, {
      method: "POST",
      headers: rig.json,
      // 界面就算硬塞一个路径进来，也不该有任何效果。
      body: JSON.stringify({ path: "C:\Windows\System32" }),
    });
    assert.equal(res.status, 202);
    // 事件里**只有 kind**：路径要是跟着事件走，界面就成了「让壳打开任意目录」
    // 的一条通路，而同一个页面在浏览器里也开着。
    assert.deepEqual(seen, [{ kind: "app-open-data-dir" }]);
  } finally {
    closeRig(rig);
  }
});

test("pick-folder: 请求挂着等壳送结果；壳先问起始目录；没接这个能力时端点不存在", async () => {
  const events = new EventBus();
  const seen: string[] = [];
  events.subscribe((e) => seen.push(e.kind));
  const pick = new FolderPick(2000, () => events.publish({ kind: "app-pick-folder" }));
  const rig = await startServer({ events, folderPick: pick });
  try {
    // 界面发起：这条请求会挂着，所以**先不 await**。
    const asking = fetch(`${rig.base}/ui/pick-folder`, {
      method: "POST",
      headers: rig.json,
      body: JSON.stringify({ start: "C:/data" }),
    });
    // 壳收到事件后来问「弹在哪儿」——事件本身不带数据。
    await vi_waitFor(async () => {
      const r = await fetch(`${rig.base}/ui/pick-folder`, { headers: rig.headers });
      const body = (await r.json()) as { start?: string };
      assert.equal(body.start, "C:/data");
    });
    assert.deepEqual(seen, ["app-pick-folder"]);

    // 壳把用户选的送回来 -> 界面那条请求这才回。
    const back = await fetch(`${rig.base}/ui/pick-folder/result`, {
      method: "POST",
      headers: rig.json,
      body: JSON.stringify({ path: "D:/RuyinData" }),
    });
    assert.equal(back.status, 200);
    assert.deepEqual(await (await asking).json(), { path: "D:/RuyinData" });
  } finally {
    closeRig(rig);
  }

  const bare = await startServer({});
  try {
    const r = await fetch(`${bare.base}/ui/pick-folder`, {
      method: "POST",
      headers: bare.json,
      body: "{}",
    });
    // 没有壳的部署弹不出系统框 —— 404 而不是挂在那儿等一个永远不来的答复。
    assert.equal(r.status, 404);
  } finally {
    closeRig(bare);
  }
});

// ───────────────────────── 能力平台（ADR-018）：/skills 与 /tools ─────────────────────────

function skillFixture(): { dataDir: string; registry: SkillRegistry } {
  const dataDir = mkdtempSync(join(tmpdir(), "ruyin-srv-skills-"));
  const user = join(dataDir, "skills", "user", "tender-style");
  mkdirSync(join(user, "references"), { recursive: true });
  writeFileSync(join(user, "SKILL.md"), "---\nname: tender-style\ndescription: House style for tenders\n---\n# Style\n");
  writeFileSync(join(user, "references", "tone.md"), "# Tone\n");
  return { dataDir, registry: new SkillRegistry({ bundledDir: join(dataDir, "no-bundle"), dataDir, ttlMs: 0 }) };
}

test("skills: without a registry the surface says so (503), never an empty list", async () => {
  const rig = await startServer();
  try {
    const res = await fetch(`${rig.base}/skills`, { headers: rig.headers });
    assert.equal(res.status, 503);
    assert.equal(((await res.json()) as { code: string }).code, "SKILLS_NOT_AVAILABLE");
    const tools = await fetch(`${rig.base}/tools`, { headers: rig.headers });
    assert.equal(tools.status, 503);
  } finally {
    closeRig(rig);
  }
});

test("skills: list / read / disable / refresh, and the tool registry view", async () => {
  const { dataDir, registry } = skillFixture();
  const rig = await startServer({
    skills: registry,
    tools: new ToolRegistryView({
      supportsBuiltin: (id) => id !== "export_result",
      hasSkills: () => true,
      bundledServers: () => [
        { id: "microsoft.playwright-mcp", tier: "default", license: "Apache-2.0", launch: null, launchNote: "测试里不启动" },
        { id: "tavily-ai.tavily-mcp", tier: "runos-registered", needsKey: true, launch: null },
      ],
    }),
  });
  try {
    const list = await fetch(`${rig.base}/skills`, { headers: rig.headers });
    assert.equal(list.status, 200);
    const listing = (await list.json()) as { items: Array<{ name: string; layer: string; enabled: boolean }>; layers: Array<{ layer: string; present: boolean }> };
    assert.deepEqual(listing.items.map((s) => [s.name, s.layer, s.enabled]), [["tender-style", "user", true]]);
    assert.equal(listing.layers.find((l) => l.layer === "bundled")?.present, false);

    const one = await fetch(`${rig.base}/skills/tender-style`, { headers: rig.headers });
    assert.equal(one.status, 200);
    const doc = (await one.json()) as { content: string; resources: string[] };
    assert.match(doc.content, /^---\nname: tender-style/);
    assert.deepEqual(doc.resources, ["references/tone.md"]);

    const badLayer = await fetch(`${rig.base}/skills/tender-style/disable`, { method: "POST", headers: rig.json, body: JSON.stringify({ layer: "cloud", source: "user" }) });
    assert.equal(badLayer.status, 400);
    assert.equal(((await badLayer.json()) as { code: string }).code, "SKILL_LAYER_INVALID");

    const off = await fetch(`${rig.base}/skills/tender-style/disable`, { method: "POST", headers: rig.json, body: JSON.stringify({ layer: "user", source: "user" }) });
    assert.equal(off.status, 200);
    assert.equal(((await off.json()) as { enabled: boolean }).enabled, false);
    // 停用了就读不到：对任务来说它不在。
    const gone = await fetch(`${rig.base}/skills/tender-style`, { headers: rig.headers });
    assert.equal(gone.status, 404);
    assert.equal(((await gone.json()) as { code: string }).code, "SKILL_NOT_FOUND");

    const missing = await fetch(`${rig.base}/skills/no-such/enable`, { method: "POST", headers: rig.json, body: JSON.stringify({ layer: "user", source: "user" }) });
    assert.equal(missing.status, 404);

    // 没有能力面：刷新只重扫本机，并说清分发层没有来源。
    const refresh = await fetch(`${rig.base}/skills/refresh`, { method: "POST", headers: rig.json });
    assert.equal(refresh.status, 200);
    const refreshed = (await refresh.json()) as { items: unknown[]; distributed: { unavailable?: string } };
    assert.equal(refreshed.items.length, 1);
    assert.match(refreshed.distributed.unavailable ?? "", /没有配置能力面/);

    const tools = await fetch(`${rig.base}/tools`, { headers: rig.headers });
    assert.equal(tools.status, 200);
    const items = ((await tools.json()) as { items: Array<{ id: string; kind: string; status: string }> }).items;
    const byId = new Map(items.map((t) => [t.id, t]));
    assert.equal(byId.get("read_file")?.status, "available");
    assert.equal(byId.get("export_result")?.status, "unavailable");
    assert.equal(byId.get("use_skill")?.status, "available");
    assert.equal(byId.get("microsoft.playwright-mcp")?.status, "registered");
    assert.equal(byId.get("tavily-ai.tavily-mcp")?.status, "runos");
  } finally {
    closeRig(rig);
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("bundled tool servers: /connectors lists them, activate starts, deactivate stops, DELETE is refused as CONNECTOR_BUNDLED, /tools shows launchable status", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "ruyin-srv-tools-"));
  const toolsDir = join(dataDir, "bundle");
  const fake = fileURLToPath(new URL("./fake-mcp-server.js", import.meta.url));
  mkdirSync(join(toolsDir, "fake.server", "node_modules", "fake-mcp"), { recursive: true });
  writeFileSync(join(toolsDir, "fake.server", "node_modules", "fake-mcp", "cli.js"), readFileSync(fake));
  writeFileSync(
    join(toolsDir, "index.json"),
    JSON.stringify({
      servers: [
        { id: "fake.server", tier: "default", license: "MIT", launch: { runtime: "node", package: "fake-mcp", version: "1.0.0", bin: "cli.js" }, vendored: { dir: "fake.server", package: "fake-mcp@1.0.0", entry: "node_modules/fake-mcp/cli.js" } },
        { id: "registered.only", tier: "default", license: "MIT", launch: null, launchNote: "发行形态未核实" },
      ],
    }),
  );
  const bundled = new BundledToolServers({ toolsDir, dataDir, execPath: process.execPath, hasUvx: () => false });
  const connectors = new ConnectorRegistry(dataDir, new Map(), { allowUnsigned: false, bundled, timeoutMs: 5000 });
  const rig = await startServer({
    connectors,
    tools: new ToolRegistryView({
      supportsBuiltin: () => true,
      hasSkills: () => true,
      connectors: () => connectors.list(),
      bundledServers: () => bundled.list(),
    }),
  });
  try {
    const list = (await (await fetch(`${rig.base}/connectors`, { headers: rig.headers })).json()) as { items: Array<{ id: string; source: string; state: string }> };
    assert.deepEqual(list.items.map((c) => [c.id, c.source, c.state]), [["fake.server", "bundled", "stashed"]]);

    let tools = (await (await fetch(`${rig.base}/tools`, { headers: rig.headers })).json()) as { items: Array<{ id: string; status: string; launchable?: boolean; detail?: string }> };
    assert.equal(tools.items.find((t) => t.id === "fake.server")?.status, "registered");
    assert.equal(tools.items.find((t) => t.id === "fake.server")?.launchable, true);
    assert.equal(tools.items.find((t) => t.id === "registered.only")?.launchable, undefined);
    assert.equal(tools.items.find((t) => t.id === "registered.only")?.detail, "发行形态未核实");

    const on = await fetch(`${rig.base}/connectors/fake.server/activate`, { method: "POST", headers: rig.json });
    assert.equal(on.status, 200);
    assert.equal(((await on.json()) as { state: string }).state, "active");
    tools = (await (await fetch(`${rig.base}/tools`, { headers: rig.headers })).json()) as typeof tools;
    assert.equal(tools.items.find((t) => t.id === "fake.server")?.status, "available");

    const del = await fetch(`${rig.base}/connectors/fake.server`, { method: "DELETE", headers: rig.headers });
    assert.equal(del.status, 400);
    assert.equal(((await del.json()) as { code: string }).code, "CONNECTOR_BUNDLED");

    const off = await fetch(`${rig.base}/connectors/fake.server/deactivate`, { method: "POST", headers: rig.json });
    assert.equal(off.status, 200);
    assert.equal(((await off.json()) as { state: string }).state, "stashed");
    const missing = await fetch(`${rig.base}/connectors/nope/deactivate`, { method: "POST", headers: rig.json });
    assert.equal(missing.status, 404);

    const env = await fetch(`${rig.base}/connectors/fake.server/env`, { method: "POST", headers: rig.json, body: JSON.stringify({ env: { SEARXNG_URL: "http://x" } }) });
    assert.equal(env.status, 200);
    assert.deepEqual(bundled.envFor("fake.server"), { SEARXNG_URL: "http://x" });
  } finally {
    await connectors.stopAll();
    closeRig(rig);
    rmSync(dataDir, { recursive: true, force: true });
  }
});
