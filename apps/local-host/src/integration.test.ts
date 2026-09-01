/**
 * Phase A milestone integration test (workplan W2):
 *
 *   "The bid example contract is genuinely validated, loaded, and a
 *    Workspace is created."
 *
 * Two layers: (1) direct kernel-over-SQLite - full task lifecycle with
 * checkpoint resume across REOPENED storage (daemon-restart simulation),
 * audit chain verified; (2) HTTP smoke over the Local API with token auth.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import {
  ProjectRuntime,
  pendingCheckpoint,
  toAuditView,
  verifyAuditChain,
  type FolderGrant,
  type RuntimePorts,
} from "@vxture/ruyin-core";
import { SqliteStoragePort } from "./storage.js";
import { MockAIGateway, nodeClock, nodeCrypto, nodeId } from "./host-ports.js";
import { loadProducts } from "./products.js";
import { ProductRegistry } from "./product-registry.js";
import { createLocalApi } from "./server.js";
import type { PlatformService } from "./platform.js";
import { TaskRunner } from "./task-runner.js";
import { InstallIntentBox } from "./updates.js";

interface PolledTask {
  id: string;
  state: string;
  running: boolean;
  checkpoint?: { kind: string };
}

/**
 * Tasks run outside the request that created them, so POST answers
 * "accepted" rather than "finished". Poll until the runner lets go.
 */
async function pollTask(
  base: string,
  headers: Record<string, string>,
  projectId: string,
  taskId: string,
): Promise<PolledTask> {
  for (let attempt = 0; attempt < 300; attempt++) {
    const res = await fetch(
      `${base}/projects/${projectId}/tasks/${taskId}`,
      { headers },
    );
    const body = (await res.json()) as PolledTask;
    if (!body.running) return body;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`task ${taskId} never settled`);
}
import { LocalFsConnector } from "./connector-fs.js";
import { searchContext, FtsRanker, reindexBinding } from "./fts.js";
import { LocalToolExecutor } from "./tool-executor.js";
import { KeyManager } from "./keys.js";

// Compiled test runs from dist/, so ../../../ is the repo root.
const productsDir = new URL("../../../products", import.meta.url).pathname
  // Windows pathname of a file URL starts with a slash before the drive letter.
  .replace(/^\/([A-Za-z]:)/, "$1");

async function makePorts(dataDir: string): Promise<{
  ports: RuntimePorts;
  storage: SqliteStoragePort;
  executor: LocalToolExecutor;
}> {
  const keys = await KeyManager.open(dataDir);
  const storage = new SqliteStoragePort(dataDir, keys);
  // 照 main.ts 的样子接上检索，并且**只造一个执行器**：生产上任务执行与任务
  // 列表用的是同一个，测试里造两个就会验出一套现实中不存在的装配。
  const executor = new LocalToolExecutor((projectId, query, scope, limit) =>
    searchContext(storage, projectId, query, scope, limit),
  );
  return {
    ports: {
      storage,
      clock: nodeClock,
      id: nodeId,
      crypto: nodeCrypto,
      gateway: new MockAIGateway(),
      connectors: new Map([["local-fs", new LocalFsConnector()]]),
      ranker: new FtsRanker(storage),
      tools: executor,
    },
    storage,
    executor,
  };
}

const testSystemInfo = {
  version: "test",

  updateIntent: new InstallIntentBox(),

  writeArtifact: (p: string, b: Uint8Array, g: FolderGrant[]) =>
      new LocalToolExecutor().writeArtifact(p, b, g),
    supportsTool: (t: string) => new LocalToolExecutor().supports(t),
  platform: process.platform,
  arch: process.arch,
  dataDir: "(test)",
  productsDir: "(test)",
  keyProtection: "plaintext" as const,
  startedAt: new Date().toISOString(),
};

/**
 * 登录态替身。服务端只用到 session() 里的当前工作区；真 PlatformService 要拉
 * OIDC discovery 与凭据库，那不是这条用例要试的东西。
 */
function signedInTo(workspaceId: string): PlatformService {
  return {
    session: () => ({
      signedIn: true,
      workspace: { id: workspaceId, name: "测试工作区" },
    }),
  } as unknown as PlatformService;
}

test("milestone: bid contract loads, workspace created, task runs over SQLite", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "ruyin-it-"));
  const first = await makePorts(dataDir);
  let second: Awaited<ReturnType<typeof makePorts>> | undefined;
  try {
    const scan = loadProducts(productsDir);
    assert.deepEqual(scan.failed, []);
    const bid = scan.loaded.find((p) => p.id === "vxture.bid");
    assert.ok(bid, "bid product must load");

    const runtime = new ProjectRuntime(first.ports);
    const meta = await runtime.createProject(bid.contract, "投标项目 A", "wsp_test");
    assert.equal(meta.productId, "vxture.bid");
    assert.equal((await runtime.openProject(meta.id)).businessState, "draft");

    // Run a task to the human checkpoint.
    const harness = await runtime.createHarness(meta.id);
    const created2 = await harness.startTask("analyze_tender", {
      tender_document: { ref: "file://tender.pdf" },
    });
    const instance = await harness.advance(created2.id);
    assert.equal(instance.state, "waiting_human");

    // Simulate a daemon restart: close every handle, then brand-new ports
    // over the SAME data dir.
    first.storage.closeAll();
    second = await makePorts(dataDir);
    const reopened = new ProjectRuntime(second.ports);
    const view = await reopened.openProject(meta.id);
    assert.equal(view.meta.name, "投标项目 A");
    const resumed = await reopened.createHarness(meta.id);
    await resumed.decideCheckpoint(instance.id, true);
    const done = await resumed.advance(instance.id);
    assert.equal(done.state, "completed");
    assert.ok(done.result?.content["requirement_analysis"]);

    // Audit chain survives the restart and verifies end-to-end.
    const events = await reopened.listAuditEvents(meta.id);
    assert.ok(events.length >= 10);
    assert.ok(verifyAuditChain(nodeCrypto, meta.id, events));
  } finally {
    first.storage.closeAll();
    second?.storage.closeAll();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("local api: token gate, product listing, workspace + task flow", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "ruyin-api-"));
  const token = "test-token";
  const { ports, storage } = await makePorts(dataDir);
  const runtime = new ProjectRuntime(ports);
  const server = createLocalApi({
    runtime,
    registry: new ProductRegistry(productsDir, dataDir),
    tasks: new TaskRunner(runtime),
    token,
    version: "test",

    updateIntent: new InstallIntentBox(),

    writeArtifact: (p: string, b: Uint8Array, g: FolderGrant[]) =>
      new LocalToolExecutor().writeArtifact(p, b, g),
    supportsTool: (t: string) => new LocalToolExecutor().supports(t),
    systemInfo: testSystemInfo,
    // 登录态替身：服务端只从会话里读当前工作区，绝不从请求体里读 —— 请求体里
    // 带工作区等于让调用方自己挑数据边界。
    platform: signedInTo("wsp_test"),
    reindex: (projectId, binding) =>
      reindexBinding(storage, projectId, binding, new LocalFsConnector()),
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  const authed = { authorization: `Bearer ${token}` };
  const json = { ...authed, "content-type": "application/json" };

  try {
    // /health is open; everything else requires the token.
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    const denied = await fetch(`${base}/products`);
    assert.equal(denied.status, 401);

    const products = (await (
      await fetch(`${base}/products`, { headers: authed })
    ).json()) as Array<{ id: string }>;
    assert.ok(products.some((p) => p.id === "vxture.bid"));

    // System transparency surface for the settings panel.
    const system = await fetch(`${base}/system`, { headers: authed });
    assert.equal(system.status, 200);
    const sysInfo = (await system.json()) as { keyProtection: string };
    assert.ok(["dpapi", "plaintext"].includes(sysInfo.keyProtection));

    // 契约拉取未配置能力面时必须如实回答 503（ADR-012）。「没接通」看起来像
    // 「拉过了、无事发生」是最坏的一种沉默。
    const noBase = await fetch(`${base}/products/vxture.bid/fetch`, {
      method: "POST",
      headers: json,
    });
    assert.equal(noBase.status, 503);
    // X-1 封套：code + message + retryable 三件必到（TD-014 D1）。
    const noBaseBody = (await noBase.json()) as {
      code: string;
      message: string;
      retryable: boolean;
    };
    assert.equal(noBaseBody.code, "CAPABILITY_BASE_NOT_CONFIGURED");
    assert.ok(noBaseBody.message.length > 0);
    assert.equal(noBaseBody.retryable, false);

    // 「在等我」入口的数据面（M4）。桌面壳与界面看的是同一份事实，所以它必须
    // 在任何项目之外也能查得到——那正是原先看不见未决确认的原因。
    const quiet = await fetch(`${base}/pending`, { headers: authed });
    assert.equal(quiet.status, 200);
    assert.deepEqual(await quiet.json(), []);

    const created = await fetch(`${base}/projects`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ product: "vxture.bid", name: "api-ws" }),
    });
    assert.equal(created.status, 201);
    const meta = (await created.json()) as { id: string; workspaceId?: string };
    // 新建的项目一律带工作区（ADR-015）——不变量在 HTTP 面也成立。
    assert.equal(meta.workspaceId, "wsp_test");

    // 列表按当前工作区过滤，且报出别处还有几个（只给数量）。
    const listed = (await (
      await fetch(`${base}/projects`, { headers: authed })
    ).json()) as { items: Array<{ id: string }>; elsewhere: number };
    assert.deepEqual(listed.items.map((p) => p.id), [meta.id]);
    assert.equal(listed.elsewhere, 0);

    const task = await fetch(`${base}/projects/${meta.id}/tasks`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        task: "analyze_tender",
        inputs: { tender_document: {} },
      }),
    });
    // 202, not 201: the instance is recorded, execution continues in the
    // background. A real provider takes minutes, so the request cannot wait.
    assert.equal(task.status, 202);
    const accepted = (await task.json()) as { id: string; state: string };
    assert.equal(accepted.state, "created");

    const instance = await pollTask(base, json, meta.id, accepted.id);
    assert.equal(instance.state, "waiting_human");

    // 停在等人的那一刻，/pending 就报得出来 —— 不需要先打开这个项目。
    const waiting = (await (
      await fetch(`${base}/pending`, { headers: authed })
    ).json()) as Array<{ projectId: string; taskInstanceId: string; kind: string }>;
    assert.equal(waiting.length, 1);
    assert.equal(waiting[0]?.projectId, meta.id);
    assert.equal(waiting[0]?.taskInstanceId, instance.id);

    const decided = await fetch(
      `${base}/projects/${meta.id}/tasks/${instance.id}/decision`,
      { method: "POST", headers: json, body: JSON.stringify({ approve: true }) },
    );
    assert.equal(decided.status, 202);
    const settled = await pollTask(base, json, meta.id, instance.id);
    assert.equal(settled.state, "completed");

    // 决定做完就从清单里消失，否则入口很快变成一堆已处理过的噪音。
    assert.deepEqual(
      await (await fetch(`${base}/pending`, { headers: authed })).json(),
      [],
    );

    // Human-confirm state transition surfaces as 409 until confirmed.
    for (const to of ["planning", "writing", "review"]) {
      const r = await fetch(`${base}/projects/${meta.id}/state`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ to }),
      });
      assert.equal(r.status, 200);
    }
    const refused = await fetch(`${base}/projects/${meta.id}/state`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ to: "submitted" }),
    });
    assert.equal(refused.status, 409);
    const confirmed = await fetch(`${base}/projects/${meta.id}/state`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ to: "submitted", humanConfirmed: true }),
    });
    assert.equal(confirmed.status, 200);

    const audit = await fetch(`${base}/projects/${meta.id}/audit`, {
      headers: authed,
    });
    const events = (await audit.json()) as Parameters<typeof verifyAuditChain>[2];
    assert.ok(verifyAuditChain(nodeCrypto, meta.id, events));
  } finally {
    await new Promise<void>((ok) => server.close(() => ok()));
    storage.closeAll();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("selection over real files: grant -> bind (indexes) -> gate -> complete", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "ruyin-sel-"));
  const filesDir = mkdtempSync(join(tmpdir(), "ruyin-files-"));
  const { ports, storage } = await makePorts(dataDir);
  const runtime = new ProjectRuntime(ports);
  try {
    // Two tender files on disk; the newer/matching one should rank first.
    mkdirSync(join(filesDir, "sub"));
    writeFileSync(
      join(filesDir, "tender-water.md"),
      "智慧水务项目招标文件 technical requirements coverage matrix",
      "utf8",
    );
    writeFileSync(join(filesDir, "sub", "old-notes.txt"), "misc notes", "utf8");

    const scan = loadProducts(productsDir);
    const bid = scan.loaded.find((p) => p.id === "vxture.bid");
    assert.ok(bid);
    const meta = await runtime.createProject(bid.contract, "sel-ws", "wsp_test");

    // Grant, then bind (binding outside the grant is refused).
    await runtime.addGrant(meta.id, filesDir);
    await assert.rejects(
      runtime.setBinding(meta.id, { type: "tender_document", root: tmpdir() }),
      /outside every granted folder/,
    );
    const binding = await runtime.setBinding(meta.id, {
      type: "tender_document",
      root: filesDir,
    });
    const indexed = await reindexBinding(
      storage,
      meta.id,
      binding,
      new LocalFsConnector(),
    );
    assert.equal(indexed, 2);

    // Selection path: no inputs. tender_document is high sensitivity =>
    // context_confirm gate BEFORE any capability invocation.
    const harness = await runtime.createHarness(meta.id);
    const started = await harness.startTask("analyze_tender");
    const instance = await harness.advance(started.id);
    assert.equal(instance.state, "waiting_human");
    assert.equal(pendingCheckpoint(instance)?.kind, "context_confirm");
    assert.ok((instance.contextSet?.length ?? 0) >= 1);
    assert.deepEqual(instance.capabilityOutputs, {});

    await harness.decideCheckpoint(instance.id, true);
    const afterContext = await harness.advance(instance.id);
    assert.equal(pendingCheckpoint(afterContext)?.kind, "verification_review");
    await harness.decideCheckpoint(instance.id, true);
    const done = await harness.advance(instance.id);
    assert.equal(done.state, "completed");

    // Transmission audit carries hashes, not content; chain verifies.
    const events = await runtime.listAuditEvents(meta.id);
    const tx = events.map(toAuditView).find((e) => e.action === "transmission.inference");
    assert.ok(tx);
    const payload = tx.payload as {
      context_items: Array<{ content_hash: string }>;
      confirmed_by: string;
      persistence: string;
    };
    assert.equal(payload.confirmed_by, "user");
    assert.equal(payload.persistence, "none");
    assert.match(payload.context_items[0]!.content_hash, /^sha256:[0-9a-f]{64}$/);
    assert.ok(verifyAuditChain(nodeCrypto, meta.id, events));
  } finally {
    storage.closeAll();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(filesDir, { recursive: true, force: true });
  }
});

test("daemon serves the built workspace ui with traversal guard", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "ruyin-ui-"));
  const uiDir = mkdtempSync(join(tmpdir(), "ruyin-uidist-"));
  const { ports, storage } = await makePorts(dataDir);
  const uiRuntime = new ProjectRuntime(ports);
  const server = createLocalApi({
    runtime: uiRuntime,
    registry: new ProductRegistry(join(uiDir, "no-products"), dataDir),
    tasks: new TaskRunner(uiRuntime),
    token: "t",
    version: "test",

    updateIntent: new InstallIntentBox(),

    writeArtifact: (p: string, b: Uint8Array, g: FolderGrant[]) =>
      new LocalToolExecutor().writeArtifact(p, b, g),
    supportsTool: (t: string) => new LocalToolExecutor().supports(t),
    systemInfo: testSystemInfo,
    reindex: async () => 0,
    uiDir,
  });
  try {
    writeFileSync(join(uiDir, "index.html"), "<!doctype html><title>ui</title>");
    mkdirSync(join(uiDir, "assets"));
    writeFileSync(join(uiDir, "assets", "a.js"), "//js");
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;

    const index = await fetch(`${base}/`);
    assert.equal(index.status, 200);
    assert.match(await index.text(), /<title>ui<\/title>/);

    const asset = await fetch(`${base}/assets/a.js`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get("content-type") ?? "", /javascript/);

    // Traversal collapses via URL normalization and lands on token-gated
    // API space; a raw-path probe hits the static guard. Either way: no file.
    const probe = await fetch(`${base}/assets/%2e%2e/%2e%2e/package.json`);
    assert.notEqual(probe.status, 200);

    // Dev console stays reachable.
    const dev = await fetch(`${base}/dev`);
    assert.match(await dev.text(), /Ruyin Dev Console/);
  } finally {
    await new Promise<void>((ok) => server.close(() => ok()));
    storage.closeAll();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(uiDir, { recursive: true, force: true });
  }
});

test("project database is encrypted at rest (TD-009)", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "ruyin-enc-"));
  const { ports, storage } = await makePorts(dataDir);
  const runtime = new ProjectRuntime(ports);
  try {
    const scan = loadProducts(productsDir);
    const bid = scan.loaded.find((p) => p.id === "vxture.bid");
    assert.ok(bid);
    const meta = await runtime.createProject(bid.contract, "enc-ws", "wsp_test");
    storage.closeAll();

    // A plaintext SQLite file starts with "SQLite format 3\0"; an encrypted
    // one must not.
    const dbPath = join(dataDir, "projects", meta.id, "project.db");
    const header = readFileSync(dbPath).subarray(0, 16).toString("latin1");
    assert.ok(
      !header.startsWith("SQLite format 3"),
      "db file must not have a plaintext SQLite header",
    );

    // The per-workspace key blob exists and reopening with the key works.
    assert.ok(existsSync(join(dataDir, "projects", meta.id, "key.enc")));
    const reopened = await makePorts(dataDir);
    try {
      const view = await new ProjectRuntime(reopened.ports).openProject(
        meta.id,
      );
      assert.equal(view.meta.name, "enc-ws");
    } finally {
      reopened.storage.closeAll();
    }
  } finally {
    storage.closeAll();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("the pre-rename layout migrates in place, ids untouched", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "ruyin-mig-"));
  try {
    // Lay down what a pre-rename install looks like: an existing container
    // under the old names, with the old `ws_` id.
    const legacyId = "ws_legacy0001";
    const legacyDir = join(dataDir, "workspaces", legacyId);
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, "workspace.db"), "not-a-real-db");
    // A live WAL-mode container has these two beside its database. They are
    // the part that used to be left behind.
    writeFileSync(join(legacyDir, "workspace.db-wal"), "pending-commits");
    writeFileSync(join(legacyDir, "workspace.db-shm"), "shared-index");

    // Opening storage performs the move.
    const { storage } = await makePorts(dataDir);
    try {
      assert.ok(!existsSync(join(dataDir, "workspaces")), "old dir is gone");
      const moved = join(dataDir, "projects", legacyId);
      assert.ok(
        existsSync(join(moved, "project.db")),
        "container moved under its ORIGINAL id",
      );
      // The WAL must travel with its database. SQLite locates it by the
      // database's name, so a rename that leaves it behind silently drops
      // every committed-but-uncheckpointed write - the database still opens,
      // just missing its most recent contents.
      assert.equal(
        readFileSync(join(moved, "project.db-wal"), "utf8"),
        "pending-commits",
        "the WAL came along, contents intact",
      );
      assert.ok(
        !existsSync(join(moved, "workspace.db-wal")),
        "no orphaned WAL under the old name",
      );
      // -shm is a rebuildable shared-memory index; a stale one is worse than
      // none, so it is dropped rather than carried.
      assert.ok(!existsSync(join(moved, "workspace.db-shm")));
      // The id is what the audit chain's genesis hash is built from, so a
      // migration that rewrote ids would invalidate every chain on disk.
      assert.deepEqual(await storage.listProjectIds(), [legacyId]);
    } finally {
      storage.closeAll();
    }
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

/**
 * 项目必须归属工作区（ADR-015）。这条用例守的是**没有登录态就没有新建能力**
 * 这个不变量在 HTTP 面上的表现：不是把按钮藏起来，是这个动作缺少它的主体。
 */
test("归属：未登录不能新建项目；老项目可导入当前工作区", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "ruyin-attr-"));
  const { ports, storage } = await makePorts(dataDir);
  const runtime = new ProjectRuntime(ports);

  // attribution 之前写下的记录：那时的 meta 就是没有这个字段的。
  const legacy = await storage.createProjectStore("ws_legacy0002");
  await legacy.putMeta({
    id: "ws_legacy0002",
    productId: "vxture.bid",
    productVersion: "1.0.0",
    contractVersion: "0.1",
    name: "老项目",
    projectType: "project",
    createdAt: "2026-01-01T00:00:00Z",
  });
  const bidProduct = loadProducts(productsDir).loaded.find(
    (p) => p.id === "vxture.bid",
  );
  assert.ok(bidProduct);
  await legacy.putContract(JSON.stringify(bidProduct.contract));
  await legacy.setBusinessState("draft");

  const token = "attr-token";
  const authed = { authorization: `Bearer ${token}` };
  const json = { ...authed, "content-type": "application/json" };
  const deps = {
    runtime,
    registry: new ProductRegistry(productsDir, dataDir),
    tasks: new TaskRunner(runtime),
    token,
    version: "test",

    updateIntent: new InstallIntentBox(),

    writeArtifact: (p: string, b: Uint8Array, g: FolderGrant[]) =>
      new LocalToolExecutor().writeArtifact(p, b, g),
    supportsTool: (t: string) => new LocalToolExecutor().supports(t),
    systemInfo: testSystemInfo,
    reindex: async () => 0,
  };

  // 未登录：没有工作区，新建被拒。
  const signedOut = createLocalApi(deps);
  await new Promise<void>((ok) => signedOut.listen(0, "127.0.0.1", ok));
  const outBase = `http://127.0.0.1:${(signedOut.address() as AddressInfo).port}`;
  try {
    const refused = await fetch(`${outBase}/projects`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ product: "vxture.bid", name: "无主项目" }),
    });
    assert.equal(refused.status, 409);
    assert.equal(
      ((await refused.json()) as { code: string }).code,
      "WORKSPACE_REQUIRED",
    );

    // 未归属的老项目在任何工作区下都看得见 —— 那是待导入队列，不能因为过滤
    // 而消失：用户会以为数据没了。
    const list = (await (
      await fetch(`${outBase}/projects`, { headers: authed })
    ).json()) as { items: Array<{ id: string; workspaceId?: string }> };
    assert.deepEqual(list.items.map((p) => p.id), ["ws_legacy0002"]);
    assert.equal(list.items[0]?.workspaceId, undefined);
  } finally {
    signedOut.close();
  }

  // 登录后：导入成功，且再导一次是搬家，被拒。
  const signedIn = createLocalApi({ ...deps, platform: signedInTo("wsp_a") });
  await new Promise<void>((ok) => signedIn.listen(0, "127.0.0.1", ok));
  const inBase = `http://127.0.0.1:${(signedIn.address() as AddressInfo).port}`;
  try {
    const imported = await fetch(`${inBase}/projects/ws_legacy0002/import`, {
      method: "POST",
      headers: json,
    });
    assert.equal(imported.status, 200);
    assert.equal(
      ((await imported.json()) as { workspaceId: string }).workspaceId,
      "wsp_a",
    );

    const again = await fetch(`${inBase}/projects/ws_legacy0002/import`, {
      method: "POST",
      headers: json,
    });
    assert.equal(again.status, 409);
    assert.equal(
      ((await again.json()) as { code: string }).code,
      "PROJECT_ALREADY_ATTRIBUTED",
    );
  } finally {
    signedIn.close();
    storage.closeAll();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

/**
 * 导出端到端（TD-020）。
 *
 * 内核那边已经钉了信封形状与篡改检测；这里钉的是宿主这一半：**导出写的是用户
 * 授权过的目录，走的是同一套护栏**——导出不是特权动作。
 */
test("导出：落进授权目录、留下审计、未授权目录一律拒绝", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "ruyin-exp-"));
  const outDir = mkdtempSync(join(tmpdir(), "ruyin-out-"));
  const denied = mkdtempSync(join(tmpdir(), "ruyin-nope-"));
  const { ports, storage } = await makePorts(dataDir);
  const runtime = new ProjectRuntime(ports);
  const bid = loadProducts(productsDir).loaded.find((p) => p.id === "vxture.bid");
  assert.ok(bid);
  const meta = await runtime.createProject(bid.contract, "导出", "wsp_test");
  await runtime.addGrant(meta.id, outDir, "readwrite");

  const token = "exp-token";
  const authed = { authorization: `Bearer ${token}` };
  const json = { ...authed, "content-type": "application/json" };
  const server = createLocalApi({
    runtime,
    registry: new ProductRegistry(productsDir, dataDir),
    tasks: new TaskRunner(runtime),
    token,
    version: "test",
    updateIntent: new InstallIntentBox(),
    writeArtifact: (p: string, b: Uint8Array, g: FolderGrant[]) =>
      new LocalToolExecutor().writeArtifact(p, b, g),
    supportsTool: (t: string) => new LocalToolExecutor().supports(t),
    systemInfo: testSystemInfo,
    platform: signedInTo("wsp_test"),
    reindex: async () => 0,
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const res = await fetch(`${base}/projects/${meta.id}/export`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ path: outDir }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      files: string[];
      chain: { events: number; head: string };
      signed: boolean;
    };
    // 明写「还没签」——可验篡改，不可归属。
    assert.equal(body.signed, false);
    assert.ok(body.files.includes("envelope.json"));
    assert.ok(body.files.includes("audit.json"));

    // 收件人只拿这个目录，就能自己走一遍链。
    const events = JSON.parse(
      readFileSync(join(outDir, "audit.json"), "utf8"),
    ) as Parameters<typeof verifyAuditChain>[2];
    assert.ok(verifyAuditChain(nodeCrypto, meta.id, events));

    const envelope = JSON.parse(
      readFileSync(join(outDir, "envelope.json"), "utf8"),
    ) as { payload: string; payloadType: string; signatures: unknown[] };
    assert.equal(envelope.payloadType, "application/vnd.in-toto+json");
    assert.deepEqual(envelope.signatures, []);
    // 信封里的 payload 就是 statement.json，base64 一致。
    assert.equal(
      Buffer.from(envelope.payload, "base64").toString("utf8"),
      readFileSync(join(outDir, "statement.json"), "utf8"),
    );

    // 导出本身进了审计。
    const after = (await runtime.listAuditEvents(meta.id)).map(toAuditView);
    const exported = after.find((e) => e.action === "project.exported");
    assert.ok(exported, "导出没有留痕 —— 一次数据离开本机的事件必须记");
    assert.equal(exported.outcome, "success");

    // 未授权的目录：同一套护栏，导出不例外。
    const refused = await fetch(`${base}/projects/${meta.id}/export`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ path: denied }),
    });
    assert.equal(refused.status, 403);
    assert.equal(
      ((await refused.json()) as { code: string }).code,
      "POLICY_DENIED",
    );
  } finally {
    server.close();
    storage.closeAll();
    for (const d of [dataDir, outDir, denied]) {
      rmSync(d, { recursive: true, force: true });
    }
  }
});

/**
 * 任务列表要在**点击之前**说清哪些任务这台机器跑不了（TD-019 / ADR-016）。
 *
 * 真正要钉的是两处判据不许漂移：**列表上没标红的，启动时不能被拒**。若哪天
 * 有人只改了其中一处，这条会断。
 */
test("任务列表：跑不了的标出来，标了的确实启动不了，没标的确实能启动", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "ruyin-unrun-"));
  const { ports, storage, executor } = await makePorts(dataDir);
  const runtime = new ProjectRuntime(ports);
  const bid = loadProducts(productsDir).loaded.find((p) => p.id === "vxture.bid");
  assert.ok(bid);
  const meta = await runtime.createProject(bid.contract, "任务面", "wsp_test");

  const token = "unrun-token";
  const server = createLocalApi({
    runtime,
    registry: new ProductRegistry(productsDir, dataDir),
    tasks: new TaskRunner(runtime),
    token,
    version: "test",
    updateIntent: new InstallIntentBox(),
    writeArtifact: (p: string, b: Uint8Array, g: FolderGrant[]) =>
      executor.writeArtifact(p, b, g),
    supportsTool: (t: string) => executor.supports(t),
    systemInfo: testSystemInfo,
    platform: signedInTo("wsp_test"),
    reindex: async () => 0,
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const headers = { authorization: `Bearer ${token}` };

  try {
    const view = (await (
      await fetch(`${base}/projects/${meta.id}`, { headers })
    ).json()) as { tasks: Array<{ id: string; unrunnable: string[] }> };

    const byId = new Map(view.tasks.map((t) => [t.id, t.unrunnable]));
    // 这两个曾经是「契约里有、宿主没有」的：export_result（TD-019）与
    // search_knowledge（TD-022）。标书产品的四个任务现在一个不缺。
    for (const [taskId, unrunnable] of byId) {
      assert.deepEqual(unrunnable, [], `${taskId} 仍有跑不了的工具`);
    }
    assert.equal(byId.size, 4);

    for (const [taskId, unrunnable] of byId) {
      const res = await fetch(`${base}/projects/${meta.id}/tasks`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ task: taskId }),
      });
      if (unrunnable.length) {
        assert.equal(res.status, 400, `${taskId} 标了跑不了，却被受理了`);
        const body = (await res.json()) as { code: string; message: string };
        assert.equal(body.code, "TASK_REJECTED");
        assert.match(body.message, new RegExp(unrunnable[0] ?? ""));
      } else {
        // 202 而不是 201：任务在请求之外推进，受理即返回。
        assert.equal(
          res.status,
          202,
          `${taskId} 列表上说能启动，启动时却被拒 —— 两处判据漂了`,
        );
      }
    }
  } finally {
    server.close();
    storage.closeAll();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
