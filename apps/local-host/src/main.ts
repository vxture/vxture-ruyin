#!/usr/bin/env node
/**
 * Runtime daemon entry point (dev mode).
 *
 * Env:
 *   RUYIN_DATA_DIR      data root (default: ~/.ruyin/dev)
 *   RUYIN_PRODUCTS_DIR  unpacked products dir (default: ./products)
 *   RUYIN_PORT          listen port on 127.0.0.1 (default: 7420)
 *   RUYIN_TOKEN         session token override (default: random per launch)
 *   RUYIN_UI_DIR        built Workspace UI dir (default: sibling
 *                       ui-workspace/dist when it exists; dev console at /dev)
 *   RUYIN_ACCOUNTS_ISSUER    OIDC issuer (default https://accounts.vxture.com)
 *   RUYIN_OIDC_CLIENT_ID     public client id (default ruyin; beta: ruyin-beta)
 *   RUYIN_PLATFORM_API_BASE  entitlements API base (unset = C2 disabled)
 *   RUYIN_CONSOLE_BASE       console deep-link base (default https://vxture.com)
 *   RUYIN_UPDATE_FEED        update feed base (default: stable channel on dl)
 *   RUYIN_CAPABILITY_BASE    business-product capability surface (unset = mock);
 *                            also the source for contract fetch (ADR-012)
 */

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ProjectRuntime, type ConnectorPort } from "@vxture/ruyin-core";
import { SqliteStoragePort } from "./storage.js";
import { MockAIGateway, nodeClock, nodeCrypto, nodeId } from "./host-ports.js";
import {
  ProductRegistry,
  projectSubscriptionFacts,
  type CommercialEnvelope,
  type SubscriptionFacts,
} from "./product-registry.js";
import { createLocalApi } from "./server.js";
import { TaskRunner } from "./task-runner.js";
import { LocalFsConnector } from "./connector-fs.js";
import { FtsRanker, reindexBinding, searchContext } from "./fts.js";
import { shellPdfRenderer } from "./pdf.js";
import { LocalToolExecutor } from "./tool-executor.js";
import { CapabilityClient } from "./capability-client.js";
import { fetchContract } from "./contract-fetch.js";
import { InstallIntentBox } from "./updates.js";
import { EventBus } from "./events.js";
import { KeyManager } from "./keys.js";
import { PlatformService, platformConfigFromEnv } from "./platform.js";

const VERSION = "0.1.0";

const dataDir = resolve(
  process.env["RUYIN_DATA_DIR"] ?? join(homedir(), ".ruyin", "dev"),
);
const productsDir = resolve(process.env["RUYIN_PRODUCTS_DIR"] ?? "products");
const port = Number(process.env["RUYIN_PORT"] ?? 7420);
const token = process.env["RUYIN_TOKEN"] ?? randomBytes(24).toString("hex");

// Capability provider base (ADR-009: the business product''s own cloud service
// holds the credentials for Atlas). Unset = mock, and the daemon says so -
// "not wired up" must never look like "working".
const capabilityBase = process.env["RUYIN_CAPABILITY_BASE"] ?? "";

const keys = await KeyManager.open(dataDir);
const storage = new SqliteStoragePort(dataDir, keys);
console.log(`[ruyin] master key protection: ${keys.protection}`);
// Native binding self-check (TD-010): fail fast if the SQLite binding does
// not load in this runtime (Electron utilityProcess vs host Node ABI).
try {
  const sqlite = storage.selfCheck();
  console.log(`[ruyin] sqlite binding: ${sqlite.binding} (SQLite ${sqlite.sqliteVersion})`);
} catch (cause) {
  // stdio is a pipe under the shell's utilityProcess: flush before exiting,
  // or the message is lost with the process.
  process.stderr.write(
    `[ruyin] FATAL: sqlite native binding failed to load: ${cause instanceof Error ? cause.message : cause}
`,
    () => process.exit(1),
  );
  await new Promise(() => {}); // never resolves - exit happens in the callback
}
const localFs = new LocalFsConnector();
const connectors = new Map<string, ConnectorPort>([["local-fs", localFs]]);

// Shared with the TaskRunner: cancellation is an in-memory signal so the
// running loop cannot overwrite it on its next persist.
const cancelledTasks = new Set<string>();

// 同一个执行器：任务写产出与导出写记录走同一套授权护栏。检索接的是本机 FTS
// 索引，范围由调用方给的上下文集限定（TD-022）。
// PDF 排版在壳里（ADR-017）：这里拿到的是通往壳的通道，脱离壳跑时为 undefined。
const toolExecutor = new LocalToolExecutor(
  (projectId, query, scope, limit) =>
    searchContext(storage, projectId, query, scope, limit),
  shellPdfRenderer(),
);

const runtime = new ProjectRuntime({
  storage,
  clock: nodeClock,
  id: nodeId,
  crypto: nodeCrypto,
  gateway: capabilityBase
    ? new CapabilityClient({
        baseUrl: capabilityBase,
        // Late binding: `platform` is constructed below, and the gateway is
        // only called once a task runs - long after startup.
        token: () => platform.bearerToken(),
      })
    : new MockAIGateway(),
  connectors,
  ranker: new FtsRanker(storage),
  tools: toolExecutor,
  isCancelled: (id) => cancelledTasks.has(id),
});

const defaultUiDir = resolve(
  fileURLToPath(new URL("../../ui-workspace/dist", import.meta.url)),
);
const uiDir =
  process.env["RUYIN_UI_DIR"] ??
  (existsSync(defaultUiDir) ? defaultUiDir : undefined);

// 受管产品资产：已装 + 启用态 + 订阅可用性（30-contract-schema §18）。
const registry = new ProductRegistry(productsDir, dataDir);
for (const failure of registry.failures) {
  console.error(`[ruyin] product failed contract validation: ${failure.path}`);
  for (const e of failure.errors) {
    console.error(`  ${e.rule} ${e.path}: ${e.message}`);
  }
}

const platform = new PlatformService(platformConfigFromEnv(port), keys, dataDir);
// Config values are env-derived - keep them out of logs (issuer/client are
// inspectable via GET /auth/session); log only readiness facts.
console.log(
  `[ruyin] platform: oidc client ready, entitlements api ${
    platform.config.platformApiBase ? "configured" : "NOT configured"
  }`,
);

// 事件总线（TD-027）：任务动了就通知订阅者，替掉界面那几处轮询。
const events = new EventBus();
const tasks = new TaskRunner(runtime, cancelledTasks, events);

// 用户点「安装更新」后的意图，壳轮询取走（TD-021）。只在内存里：这是一次点击，
// 不是一条设置——守护进程重启后它该消失。
const updateIntent = new InstallIntentBox();

const server = createLocalApi({
  runtime,
  registry,
  tasks,
  token,
  version: VERSION,
  reindex: (projectId, binding) => reindexBinding(storage, projectId, binding, localFs),
  uiDir,
  platform,
  // 开发模式放行未签名包（RUYIN_ALLOW_UNSIGNED_PACKAGES=1）；缺省要求副署。
  requireSignedPackages: process.env["RUYIN_ALLOW_UNSIGNED_PACKAGES"] !== "1",
  updateIntent,
  events,
  writeArtifact: (path, bytes, grants) =>
    toolExecutor.writeArtifact(path, bytes, grants),
  supportsTool: (tool) => toolExecutor.supports(tool),
  refreshEntitlements: () => syncEntitlements(),
  ...(process.env["RUYIN_UPDATE_FEED"]
    ? { updateFeedBase: process.env["RUYIN_UPDATE_FEED"] }
    : {}),
  // 一级供给：与能力调用同一条通路、同一个设置（ADR-012）。未配置能力面就没有
  // 可拉的地方，此时不注入——服务端据此如实回答，而不是静默无事发生。
  ...(capabilityBase
    ? {
        fetchContract: (productId: string) =>
          fetchContract(productId, {
            baseUrl: capabilityBase,
            token: () => platform.bearerToken(),
            storeDir: registry.storeDir,
          }),
      }
    : {}),
  systemInfo: {
    version: VERSION,
    platform: process.platform,
    arch: process.arch,
    dataDir,
    productsDir,
    keyProtection: keys.protection,
    startedAt: new Date().toISOString(),
  },
});

// 订阅 → 本地可用（owner 口径：平台订阅了本地可用，0 订阅本地无可用产品，
// 环境仍在）。订阅数据面未接通时 refreshEntitlements 保持「未知」，不锁用户。
// 信封 -> SubscriptionFacts 的投影本身在 product-registry.ts（projectSubscriptionFacts），
// 挨着它产出的类型放，也因此能脱离整个守护进程启动被单独测试。
async function syncEntitlements(): Promise<void> {
  await registry.refreshEntitlements(async (ids) => {
    const batch = (await platform.entitlements(ids)) as {
      entitlements?: Record<string, CommercialEnvelope>;
    } | null;
    if (!batch?.entitlements) return null;
    const out: Record<string, SubscriptionFacts> = {};
    for (const id of ids) {
      const env = batch.entitlements![id];
      if (!env) continue; // 平台没给这个产品的信封 = 未知，别当成「没有」
      out[id] = projectSubscriptionFacts(env);
    }
    return out;
  });
}
void syncEntitlements().catch(() => {});
setInterval(() => void syncEntitlements().catch(() => {}), 5 * 60_000).unref();

// Pick up tasks a previous process died holding (50-harness §8.3). Failing
// this sweep must not stop the daemon: an un-recovered task is a stuck task,
// a daemon that will not start is every task stuck.
void tasks
  .recoverAll()
  .then((picked) => {
    if (picked > 0) console.log(`[ruyin] resumed ${picked} interrupted task(s)`);
  })
  .catch((cause) => {
    console.error("[ruyin] task recovery sweep failed:", cause);
  });

/**
 * 打包冒烟时真的排一份 PDF（ADR-017）。
 *
 * 走的是生产上那条完整链路：守护进程 -> parentPort -> 壳 -> Chromium ->
 * 字节回来。这条链只有在打包形态下才是完整的，单元测试到不了它 —— 而它断掉
 * 的症状是用户导出时拿到一个错误，那时才发现太晚。
 *
 * **不能放在顶层 await 里。** utilityProcess 要等入口模块求值完才投递消息，
 * 而顶层 await 恰恰把求值挂在那里 —— 于是守护进程等壳的应答，应答等模块求值
 * 完，模块求值等守护进程：一个静静挂住、什么也不打印的死锁。所以它跑在 listen
 * 回调里，由壳等它的标记。
 */
async function pdfSelfCheck(): Promise<void> {
  const render = toolExecutor.pdfRenderer;
  if (!render) {
    console.log("[ruyin] pdf self-check: no shell attached");
    return;
  }
  const bytes = await render(
    "<!doctype html><html><head><meta charset=\"utf-8\"></head><body><p>如影</p></body></html>",
  );
  const ok = [0x25, 0x50, 0x44, 0x46, 0x2d].every((b, i) => bytes[i] === b);
  if (!ok) throw new Error("the shell returned something that is not a PDF");
  console.log(`[ruyin] pdf self-check: ok (${bytes.byteLength} bytes)`);
}

server.listen(port, "127.0.0.1", () => {
  console.log(`[ruyin] local runtime ${VERSION}`);
  console.log(`[ruyin] data dir: ${dataDir}`);
  console.log(
    `[ruyin] products: ${registry
      .installed()
      .map((p) => `${p.id}@${p.version}`)
      .join(", ") || "(none)"}`,
  );
  console.log(`[ruyin] listening on http://127.0.0.1:${port}`);
  console.log(`[ruyin] session token: ${token}`);
  if (process.env["RUYIN_SMOKE"] === "1") {
    void pdfSelfCheck().catch((cause) => {
      console.error("[ruyin] pdf self-check failed:", cause);
      process.exit(1);
    });
  }
});
