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
  type SubscriptionFacts,
} from "./product-registry.js";
import { createLocalApi } from "./server.js";
import { TaskRunner } from "./task-runner.js";
import { LocalFsConnector } from "./connector-fs.js";
import { FtsRanker, reindexBinding } from "./fts.js";
import { LocalToolExecutor } from "./tool-executor.js";
import { CapabilityClient } from "./capability-client.js";
import { fetchContract } from "./contract-fetch.js";
import { InstallIntentBox } from "./updates.js";
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

// 同一个执行器：任务写产出与导出写记录走同一套授权护栏。
const toolExecutor = new LocalToolExecutor();

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

const tasks = new TaskRunner(runtime, cancelledTasks);

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
  writeArtifact: (path, bytes, grants) =>
    toolExecutor.writeArtifact(path, bytes, grants),
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

/** C2 信封里 Ruyin 会读的那几项（limits / quota_pools 有意不列）。 */
interface C2Envelope {
  status?: string | null;
  tier?: string | null;
  bundled?: boolean;
  trial_ends_at?: string | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean;
}

// 订阅 → 本地可用（owner 口径：平台订阅了本地可用，0 订阅本地无可用产品，
// 环境仍在）。订阅数据面未接通时 refreshEntitlements 保持「未知」，不锁用户。
async function syncEntitlements(): Promise<void> {
  await registry.refreshEntitlements(async (ids) => {
    const batch = (await platform.entitlements(ids)) as {
      entitlements?: Record<string, C2Envelope>;
    } | null;
    if (!batch?.entitlements) return null;
    // 信封原样投影，**不在这里压成布尔**（TD-014 D4）：压扁之后界面就再也
    // 分不出「从未订阅」与「已失效」，只能永远显示同一个错的行动入口。
    // limits / quota_pools 刻意不取：配额归 SaaS，Ruyin 不读不执行不展示。
    const out: Record<string, SubscriptionFacts> = {};
    for (const id of ids) {
      const env = batch.entitlements![id];
      if (!env) continue; // 平台没给这个产品的信封 = 未知，别当成「没有」
      out[id] = {
        status: env.status ?? null,
        tier: env.tier ?? null,
        bundled: env.bundled === true,
        trialEndsAt: env.trial_ends_at ?? null,
        currentPeriodEnd: env.current_period_end ?? null,
        cancelAtPeriodEnd: env.cancel_at_period_end === true,
      };
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
});
