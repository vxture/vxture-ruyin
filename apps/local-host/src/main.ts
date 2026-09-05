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
 *   RUYIN_REGISTRY_BASE      static product registry base (default: products dir on dl)
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
import { ConnectorRegistry } from "./connector-registry.js";
import { FtsRanker, reindexBinding, searchContext } from "./fts.js";
import { shellPdfRenderer } from "./pdf.js";
import { LocalToolExecutor } from "./tool-executor.js";
import { CapabilityClient } from "./capability-client.js";
import { SkillRegistry } from "./skill-registry.js";
import { refreshDistributedSkills } from "./skill-distribution.js";
import { ToolRegistryView } from "./tool-registry.js";
import { BundledToolServers } from "./tool-servers.js";
import { fetchContract } from "./contract-fetch.js";
import { EventBus } from "./events.js";
import { KeyManager } from "./keys.js";
import { PlatformService, platformConfigFromEnv } from "./platform.js";
import { FolderPick } from "./folder-pick.js";
import {
  startMigrationServer,
  stopMigrationServer,
  type MigrationStatus,
} from "./migration-server.js";
import {
  applyPendingMove,
  checkTarget,
  readLocation,
  resolveDataDir,
  writeLocation,
} from "./data-location.js";

const VERSION = "0.1.0";

/**
 * 指针文件：**数据目录搬到哪儿了，权威在这里**（TD-039）。它必须待在一个不会
 * 跟着数据一起搬走的地方 —— 宿主给（装机态是 userData 根，与数据目录同级但不
 * 在其中）；没给就落到开发态的默认位置。
 */
const locationFile = resolve(
  process.env["RUYIN_LOCATION_FILE"] ?? join(homedir(), ".ruyin", "location.json"),
);
const preferredDataDir = resolve(
  process.env["RUYIN_DATA_DIR"] ?? join(homedir(), ".ruyin", "dev"),
);
/**
 * 老的默认位置（漫游 `%APPDATA%Ruyindata`）。宿主给，因为只有它知道
 * userData 在哪儿。**有它、且那儿有数据，就钉在那儿** —— 已经在用的机器一个
 * 字节都不搬（owner 2026-09-05）。
 */
const legacyDataDir = process.env["RUYIN_LEGACY_DATA_DIR"];
const resolved = resolveDataDir(locationFile, preferredDataDir, legacyDataDir);
if (resolved.pinnedLegacy) {
  console.log(`[ruyin] data dir pinned to the existing location: ${resolved.dataDir}`);
}
// 端口与令牌要在搬家之前定下来：搬家期间那个小服务用的是同一对。
const port = Number(process.env["RUYIN_PORT"] ?? 7420);
const token = process.env["RUYIN_TOKEN"] ?? randomBytes(24).toString("hex");

/**
 * 搬家在这一段发生 —— **在 KeyManager 与 SqliteStoragePort 之前**，也就是在任何
 * 库被打开之前。这个顺序是整件事成立的前提，别把它挪到下面去（data-location.ts
 * 的头注释写了为什么）。
 *
 * 搬之前先把那个只答两条的小服务支起来（migration-server.ts）：搬 GB 级数据要
 * 几分钟，这段时间里壳唯一能做的就是问「搬到哪儿了」。没有它，那一屏只能显示一
 * 个不确定的进度条 —— 而不确定的进度条和卡死长得一模一样。
 */
const moved = await (async () => {
  const pendingTo = readLocation(locationFile).pending;
  if (!pendingTo) return applyPendingMove(locationFile, resolved.dataDir);

  let progress: MigrationStatus = {
    phase: "copy",
    copiedBytes: 0,
    totalBytes: readLocation(locationFile).pendingBytes ?? 0,
    from: resolved.dataDir,
    to: pendingTo,
  };
  let mini;
  try {
    mini = await startMigrationServer(port, token, () => progress);
    // 这一行是给「搬家期间到底有没有人应答」这个问题用的：没有它，进度报不
    // 出来时分不清是服务没起来、还是壳没问。
    console.log(`[ruyin] migration progress endpoint listening on ${port}`);
  } catch (cause) {
    // 端口被占（比如有人手工起了一个守护进程）：搬家照做，只是没有进度可报 ——
    // 不能因为「报不了进度」就不搬，那会把用户卡在一个待搬状态里。
    console.error(`[ruyin] migration progress endpoint unavailable: ${String(cause)}`);
  }
  try {
    // 顺手把进度写进日志（每秒最多一条）：搬 GB 级数据要几分钟，那段时间里
    // 日志如果一行不动，看日志的人无法判断它是在干活还是卡住了。
    let lastLog = 0;
    // **`return await`，不是 `return`。** 在 try/finally 里 `return 一个 Promise`
    // 不会等它 —— finally 立刻执行，于是那个报进度的小服务在起来几毫秒后就被关
    // 掉了，而搬家还在后台跑。2026-09-05 实测到的现象正是这个：日志里「已在
    // 监听」是真的，探针一次也探不到也是真的。
    return await applyPendingMove(locationFile, resolved.dataDir, (p) => {
      progress = { ...progress, ...p };
      const now = Date.now();
      if (now - lastLog < 1000) return;
      lastLog = now;
      const mb = (n: number) => Math.round(n / 1024 / 1024);
      console.log(
        `[ruyin] migrating (${p.phase}): ${mb(p.copiedBytes)} / ${mb(p.totalBytes)} MB`,
      );
    });
  } finally {
    if (mini) await stopMigrationServer(mini);
  }
})();
const dataDir = moved.dataDir;
if (moved.movedNow && moved.outcome.status === "moved") {
  console.log(`[ruyin] data dir moved: ${moved.outcome.from} -> ${moved.outcome.to}`);
} else if (moved.movedNow && moved.outcome.status === "failed") {
  // 如实播报并从原目录启动：一次失败的搬家不该换来一个空应用。
  console.error(`[ruyin] data dir move FAILED: ${moved.outcome.reason ?? ""}`);
}
const productsDir = resolve(process.env["RUYIN_PRODUCTS_DIR"] ?? "products");

// Capability provider base (ADR-009: the business product''s own cloud service
// holds the credentials for Atlas). Unset = mock, and the daemon says so -
// "not wired up" must never look like "working".
const capabilityBase = process.env["RUYIN_CAPABILITY_BASE"] ?? "";

// 技能登记册的预置层（ADR-018 §2.3）：packaged 在 <resources>/skills（壳给
// RUYIN_SKILLS_DIR）；开发态是仓内 resources/skills —— 拉过（pnpm skills:pull）才有，
// 没拉过就是没有预置层，启动日志会说。
const bundledSkillsDir = process.env["RUYIN_SKILLS_DIR"] ?? resolve("resources/skills");
// 预置的 MCP 服务器（ADR-018 §2.2）：packaged 在 <resources>/tools（壳给 RUYIN_TOOLS_DIR），
// 开发态是仓内 resources/tools —— pnpm tools:pull 才有。
const bundledToolsDir = process.env["RUYIN_TOOLS_DIR"] ?? resolve("resources/tools");

/**
 * 目录选择框的中转。事件发出去、请求挂着等 —— 详见 folder-pick.ts 的头注释。
 * 在 events 建好之后才能发通知，所以用一个惰性引用：这一行在 events 之前。
 */
const folderPick = new FolderPick(5 * 60_000, () => events.publish({ kind: "app-pick-folder" }));

/** 界面生效主题的中转值（见下面 chromeTheme 与 events.ts 的 ui-theme）。 */
let chromeTheme: "dark" | "light" = "dark";

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
// 内核拿着这同一份表；宿主注册表在运行时往里放进程外连接器（ADR-005 接缝 ④）。
const connectors = new Map<string, ConnectorPort>([["local-fs", localFs]]);
const bundledTools = new BundledToolServers({
  toolsDir: bundledToolsDir,
  dataDir,
  log: (line) => console.error(line),
});
const connectorRegistry = new ConnectorRegistry(dataDir, connectors, {
  // 与包的先例同一姿态：签名信任锚（TD-012）就位前生产拒装，开发显式放行。
  allowUnsigned: process.env["RUYIN_ALLOW_UNSIGNED_CONNECTORS"] === "1",
  log: (line) => console.error(line),
  // 预置的 MCP 服务器就是来源为 bundled 的连接器：起进程、列工具、接 Tool Gate 都走同一条路。
  bundled: bundledTools,
});
process.on("exit", () => {
  // 子进程不该活得比守护进程久。同步 kill 就够：exit 里等不了 promise。
  void connectorRegistry.stopAll();
});

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
  // 连接器工具面（ADR-005 D）：契约 provider: connector 的工具经它路由。
  connectorRegistry,
);

// 四层技能目录，近者优先；启用状态记在 <dataDir>/skills/state.json（ADR-018）。
const skillRegistry = new SkillRegistry({
  bundledDir: bundledSkillsDir,
  dataDir,
  log: (line) => console.error(line),
});

/**
 * 产品分发层：逐个已装产品问它的能力面（ADR-020 §3c）。要能力面；没有就没有
 * 来源。启动时跑一次（不阻塞开门），设置里「刷新」再跑。
 */
async function refreshAllDistributed(): Promise<unknown[]> {
  if (!capabilityBase) return [];
  const outcomes = [];
  for (const product of registry.installed()) {
    outcomes.push(
      await refreshDistributedSkills(
        { baseUrl: capabilityBase, token: () => platform.bearerToken() },
        product.id,
        join(skillRegistry.distributedDir, product.id),
      ),
    );
  }
  skillRegistry.refresh();
  return outcomes;
}

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
  skills: skillRegistry,
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

const server = createLocalApi({
  runtime,
  registry,
  tasks,
  token,
  version: VERSION,
  reindex: (projectId, binding) => {
    // 按绑定记的连接器取，不再钉死 local-fs（ADR-005 接缝 ②）。
    const connector = connectors.get(binding.connector);
    if (!connector) throw new Error(`connector "${binding.connector}" is not available`);
    return reindexBinding(storage, projectId, binding, connector);
  },
  connectors: connectorRegistry,
  // 能力平台（ADR-018）：技能四层清单 + 工具登记册视图；分发层刷新要能力面。
  skills: skillRegistry,
  tools: new ToolRegistryView({
    supportsBuiltin: (id) => toolExecutor.supports(id),
    hasSkills: () => true,
    connectors: () => connectorRegistry.list(),
    bundledServers: () => bundledTools.list(),
  }),
  ...(capabilityBase ? { refreshDistributedSkills: refreshAllDistributed } : {}),
  uiDir,
  platform,
  // 开发模式放行未签名包（RUYIN_ALLOW_UNSIGNED_PACKAGES=1）；缺省要求副署。
  requireSignedPackages: process.env["RUYIN_ALLOW_UNSIGNED_PACKAGES"] !== "1",
  events,
  writeArtifact: (path, bytes, grants) =>
    toolExecutor.writeArtifact(path, bytes, grants),
  supportsTool: (tool, provider) => toolExecutor.supports(tool, provider),
  refreshEntitlements: () => syncEntitlements(),
  ...(process.env["RUYIN_UPDATE_FEED"]
    ? { updateFeedBase: process.env["RUYIN_UPDATE_FEED"] }
    : {}),
  // 流 C 静态产品库（70-repo-organization §7.4）；不设就是 dl 主机的 products 目录。
  ...(process.env["RUYIN_REGISTRY_BASE"]
    ? { registryBase: process.env["RUYIN_REGISTRY_BASE"] }
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
  // 界面主题的中转值。内存里的一个词，重启即回到默认深色 —— 界面渲染第一帧
  // 就会再告诉一次（apps/ui-workspace/src/chrome-theme.ts）。
  chromeTheme: {
    get: () => chromeTheme,
    set: (theme) => {
      chromeTheme = theme;
    },
  },
  // 目录选择框的中转：界面请求挂着等，壳弹框、送结果回来。
  folderPick: {
    ask: (start?: string) => folderPick.ask(start),
    settle: (picked?: string) => folderPick.settle(picked),
    start: () => folderPick.start(),
  },
  // 搬家的三个动作都落在宿主这一侧：守护进程知道目录布局，指针文件的位置由
  // 宿主给（见 locationFile）。校验没有副作用，请求只写意图 —— 真正的搬移永远
  // 发生在下一次启动的那一行。
  dataMove: {
    check: (target: string) => checkTarget(dataDir, target),
    request: (target: string) => {
      // 顺手把「要搬多少」记下来：壳靠它算等多久（shell/migration-wait.ts）。
      // 这里算一次很便宜（checkTarget 本来就要走一遍目录树），而启动那一刻壳
      // 没有别的办法知道 —— 那时守护进程还没开始服务。
      const size = checkTarget(dataDir, target).bytes;
      writeLocation(locationFile, {
        dataDir,
        pending: resolve(target),
        ...(size === undefined ? {} : { pendingBytes: size }),
      });
    },
    cancel: () => {
      const loc = readLocation(locationFile);
      writeLocation(locationFile, {
        dataDir,
        ...(loc.lastMove ? { lastMove: loc.lastMove } : {}),
      });
    },
  },
  systemInfo: {
    version: VERSION,
    platform: process.platform,
    arch: process.arch,
    dataDir,
    productsDir,
    keyProtection: keys.protection,
    capabilitySurface: capabilityBase ? "configured" : "mock",
    startedAt: new Date().toISOString(),
    // 这两条是**给界面讲清楚状态**用的：有没有排着一次搬家、上一次搬得怎么样。
    // 每次问 /system 都重新读指针文件，而不是缓存启动那一刻的值 —— 用户可能刚
    // 刚在设置页里排了一次。
    get dataDirPending() {
      return readLocation(locationFile).pending;
    },
    get lastMove() {
      const stored = readLocation(locationFile).lastMove ?? moved.outcome;
      // **回执要有寿命。** 「搬完了」只在真正搬了的那一次启动里算一条消息 ——
      // 再往后它就只是历史，而历史已经写在「数据目录」那一行的路径里了（owner
      // 2026-09-05：搬完之后设置页里一直挂着一行「上次搬移已完成」）。失败
      // 不受这条限制：数据还在原处，那是个要人处理的状态，不是回执。
      const justNow =
        moved.movedNow && stored.status === "moved" && stored.at === moved.outcome.at;
      return justNow ? { ...stored, justNow: true } : stored;
    },
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

/**
 * 打包冒烟时真的起一个 vendored 的 MCP 服务器（ADR-018 §2.2，TD-042）。
 *
 * 装进包不等于起得来：入口路径、Electron 当 Node 用（ELECTRON_RUN_AS_NODE）、
 * 依赖树有没有被 electron-builder 拷散，只有真起一次才知道。挑第一个 node 形态、
 * 不要环境变量的；起 → 握手 → tools/list → 停，不碰网络。没有 vendored 的就如实说。
 */
async function toolsSelfCheck(): Promise<void> {
  const candidate = bundledTools
    .launchable()
    .find((s) => s.launch?.runtime === "node" && !(s.launch.requiresEnv?.length) && s.vendored);
  if (!candidate) {
    console.log("[ruyin] tools self-check: no vendored node server to try");
    return;
  }
  const plan = bundledTools.plan(candidate.id);
  if (!plan.ok) throw new Error(`${candidate.id}: ${plan.reason}`);
  const probe = await connectorRegistry.probe({ id: candidate.id, command: plan.command, args: plan.args, env: plan.env });
  if (!probe.ok) throw new Error(`${candidate.id}: ${probe.detail ?? "did not come up"}`);
  console.log(`[ruyin] tools self-check: ok (${candidate.id}, ${probe.tools.length} tool(s))`);
}

// 装好的进程外连接器先起来再开门：起不来的照样登记（健康为 false），只记日志。
await connectorRegistry.load();

// 产品分发层：开门后对一次，不阻塞启动；拉不到就用本地那份（离线可用）。
if (capabilityBase) {
  void refreshAllDistributed()
    .then((outcomes) => {
      for (const o of outcomes as Array<{ product: string; status: string; fetched: string[]; reason?: string }>) {
        console.log(
          `[ruyin] skills: distributed layer for ${o.product}: ${o.status}${o.fetched.length ? ` (+${o.fetched.length})` : ""}${o.reason ? ` - ${o.reason}` : ""}`,
        );
      }
    })
    .catch((cause) => console.error("[ruyin] skills: distributed refresh failed:", cause));
}

server.listen(port, "127.0.0.1", () => {
  console.log(`[ruyin] local runtime ${VERSION}`);
  console.log(`[ruyin] data dir: ${dataDir}`);
  // 上面 `capabilityBase` 处的注释写着「不接就说不接，『没接上』绝不能看起来像
  // 『在工作』」—— **而在这一行加上之前，守护进程一个字都没说过**。注释承诺了一
  // 个不存在的保障，这比没有注释更糟：它让人以为这道口子被看住了。
  //
  // 没接能力面时跑任务，`MockAIGateway` 回的是字面量 `[mock:...]` 文本，而它会
  // 一路走到用户面前当成工作成果。至少要在启动时说清楚用的是哪一条。
  console.log(
    capabilityBase
      ? `[ruyin] capability surface: ${capabilityBase}`
      : "[ruyin] capability surface: NOT configured - tasks will return mock output",
  );
  {
    const installed = [...connectors.keys()].filter((id) => id !== "local-fs");
    console.log(
      `[ruyin] connectors: local-fs${installed.length ? `, ${installed.join(", ")}` : ""}${
        process.env["RUYIN_ALLOW_UNSIGNED_CONNECTORS"] === "1"
          ? " (unsigned installs ALLOWED - development only)"
          : ""
      }`,
    );
  }
  console.log(
    `[ruyin] products: ${registry
      .installed()
      .map((p) => `${p.id}@${p.version}`)
      .join(", ") || "(none)"}`,
  );
  {
    const n = skillRegistry.counts();
    console.log(
      `[ruyin] skills: bundled ${n.bundled}${skillRegistry.bundledDir ? ` (${skillRegistry.bundledDir})` : " (no bundled layer)"}, distributed ${n.distributed}, user ${n.user}`,
    );
  }
  {
    const all = bundledTools.list();
    const launchable = bundledTools.launchable();
    console.log(
      `[ruyin] tools: bundled ${all.length} server definition(s)${bundledTools.toolsDir ? ` (${bundledTools.toolsDir})` : " (no bundled tools layer)"}, ${launchable.length} launchable, ${bundledTools.enabledIds().length} enabled`,
    );
  }
  console.log(`[ruyin] listening on http://127.0.0.1:${port}`);
  console.log(`[ruyin] session token: ${token}`);
  if (process.env["RUYIN_SMOKE"] === "1") {
    void pdfSelfCheck().catch((cause) => {
      console.error("[ruyin] pdf self-check failed:", cause);
      process.exit(1);
    });
    void toolsSelfCheck().catch((cause) => {
      console.error("[ruyin] tools self-check failed:", cause);
      process.exit(1);
    });
  }
});
