/**
 * UI 观察台：带登录桩的本地守护进程。
 *
 * 项目面板与产品页都在登录之后，而平台在这台机器上不可达 —— 于是每一次界面
 * 改动都只能靠类型和构建，视觉从没过眼。这里用和集成用例同一个 PlatformService
 * 替身把那道门顶开，好让界面真的能被看见和量。
 *
 * **只在本机、只用桩数据、不碰真凭据库，也不进安装包。** 它顶开的是登录这道
 * 门，不是任何一道安全门：服务端的授权护栏、工作区边界、审计全都照常生效。
 *
 * 用法：pnpm dev:ui —— 它会打印一个带令牌的地址，浏览器打开即可。
 * 前置：先 pnpm -r build（它读的是各包的 dist）。
 *
 * **改这个文件之后跑一次 `pnpm test:ui-harness`**（构建之后）。这里是唯一一处把真
 * 组件按装机态拼起来的地方，于是每加一件东西都要动它 —— 而它坏掉时 `pnpm test`
 * 照样全绿（`scripts/` 不是 workspace 包）。旁边的 ui-harness.test.mjs 就为这件事：
 * 只钉「能不能起来」，不钉这里的任何逻辑（TD-054）。
 *
 * 两个可选环境变量，都只为**看清与时序有关的界面**：
 *   RUYIN_CAPABILITY_BASE       接一个真的能力面（不给就是瞬间返回的 mock）
 *   RUYIN_MAX_CONCURRENT_TASKS  同时驱动几个任务（TD-045；缺省 3）
 *   RUYIN_CONTEXT_BUDGET_KB     一个任务能带走多少上下文（TD-044；缺省 800，
 *                               要不限得明写 unlimited）
 *   RUYIN_MAX_TOOL_SERVERS      同时几个工具服务器子进程（TD-046；缺省 6）
 *   RUYIN_MAX_INDEX_ITEMS       一次索引读几条（TD-046；缺省 5000）
 * 例：起一个每回合几秒的本地假能力面，再把上限压到 1，排队就看得见了 ——
 * 用 mock 看排队，看到的会是「没有排队」，而那不是因为上限生效，是没人排。
 */
import { existsSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const ROOT = pathToFileURL(repoRoot).toString().replace(/\/$/, "");
const { ProjectRuntime } = await import(`${ROOT}/packages/runtime-core/dist/index.js`);
const { parseContract } = await import(`${ROOT}/packages/contract-schema/dist/index.js`);
const { SqliteStoragePort } = await import(`${ROOT}/apps/local-host/dist/storage.js`);
const { KeyManager } = await import(`${ROOT}/apps/local-host/dist/keys.js`);
const { CapabilityClient } = await import(`${ROOT}/apps/local-host/dist/capability-client.js`);
const { MockAIGateway, nodeClock, nodeCrypto, nodeId } = await import(
  `${ROOT}/apps/local-host/dist/host-ports.js`
);
const { ProductRegistry } = await import(`${ROOT}/apps/local-host/dist/product-registry.js`);
const { createLocalApi } = await import(`${ROOT}/apps/local-host/dist/server.js`);
const { checkTarget, readLocation, writeLocation } = await import(
  `${ROOT}/apps/local-host/dist/data-location.js`
);
const { TaskRunner } = await import(`${ROOT}/apps/local-host/dist/task-runner.js`);
const { mediaTypeOf } = await import(`${ROOT}/apps/local-host/dist/file-store.js`);
const { contextBudgetFromEnv } = await import(
  `${ROOT}/apps/local-host/dist/context-budget-config.js`
);
const { resourceLimitsFromEnv } = await import(
  `${ROOT}/apps/local-host/dist/resource-limits.js`
);
const { LocalFsConnector } = await import(`${ROOT}/apps/local-host/dist/connector-fs.js`);
const { FtsRanker, reindexBinding, searchContext } = await import(
  `${ROOT}/apps/local-host/dist/fts.js`
);
const { LocalToolExecutor } = await import(`${ROOT}/apps/local-host/dist/tool-executor.js`);
const { EventBus } = await import(`${ROOT}/apps/local-host/dist/events.js`);
const { ConnectorRegistry } = await import(`${ROOT}/apps/local-host/dist/connector-registry.js`);
const { SkillRegistry } = await import(`${ROOT}/apps/local-host/dist/skill-registry.js`);
const { ToolRegistryView } = await import(`${ROOT}/apps/local-host/dist/tool-registry.js`);
const { BundledToolServers } = await import(`${ROOT}/apps/local-host/dist/tool-servers.js`);
const { readFileSync } = await import("node:fs");

const PORT = Number(process.env.PORT ?? 17470);
const TOKEN = "uiharness";
const repo = repoRoot.replaceAll("\\", "/").replace(/\/$/, "");
const dataDir = mkdtempSync(join(tmpdir(), "ruyin-uiharness-"));
// 指针文件放在数据目录**之外**（与装机态同一条道理：它不能跟着数据搬走）。
const locationFile = join(tmpdir(), `ruyin-uiharness-location-${process.pid}.json`);
let harnessLocation = readLocation(locationFile);
const work = mkdtempSync(join(tmpdir(), "ruyin-uiwork-"));
mkdirSync(join(work, "招标"), { recursive: true });
writeFileSync(
  join(work, "招标", "某储能电站EPC招标文件.md"),
  "# 招标文件\n\n1. 一级资质\n2. 储能业绩\n",
  "utf8",
);

const storage = new SqliteStoragePort(dataDir, await KeyManager.open(dataDir));
// 观察台允许装未签名连接器（它本来就只用桩数据、只在本机）。要试的话，dist 里有
// 一个假的 MCP 服务器：命令 node，参数 apps/local-host/dist/fake-mcp-server.js。
const connectorLookup = new Map([["local-fs", new LocalFsConnector()]]);
// 预置的 MCP 服务器（pnpm tools:pull 才有）：观察台里能真的启动 / 停止。
const bundledTools = new BundledToolServers({
  toolsDir: `${repo}/resources/tools`,
  dataDir,
  log: (l) => console.error(l),
});
const resourceLimits = resourceLimitsFromEnv();
const connectorRegistry = new ConnectorRegistry(dataDir, connectorLookup, {
  allowUnsigned: true,
  log: (l) => console.error(l),
  bundled: bundledTools,
  // 本机资源上限（TD-046）：调小 RUYIN_MAX_TOOL_SERVERS 能在观察台上看见拒绝的措辞。
  limits: resourceLimits.limits,
});
const executor = new LocalToolExecutor((pid, q, scope, limit) =>
  searchContext(storage, pid, q, scope, limit),
);
// 能力平台（ADR-018）：预置层读仓内 resources/skills（先 pnpm skills:pull 才有）。
// 样例契约声明了预置层的技能；开发机没拉过（pnpm skills:pull）时在用户层放几份桩，
// 否则观察台一启动任务就被按名拒绝。桩只有前言，看得出是桩。
const bid = parseContract(readFileSync(`${repo}/products/bidproposal/ruyin.product.yaml`, "utf8"));
if (!existsSync(`${repo}/resources/skills/index.json`)) {
  for (const task of bid.tasks) {
    for (const name of task.skills ?? []) {
      const dir = join(dataDir, "skills", "user", name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: 观察台桩（真的在预置层，先 pnpm skills:pull）\n---\n# ${name}\n`);
    }
  }
  console.error("[uiharness] resources/skills not pulled - stub skills placed in the user layer");
}
const skillRegistry = new SkillRegistry({
  bundledDir: `${repo}/resources/skills`,
  dataDir,
  log: (l) => console.error(l),
});
/**
 * 观察台的网关：缺省仍是 MockAIGateway，**给了 `RUYIN_CAPABILITY_BASE` 就用真的
 * 客户端**。
 *
 * 为什么加这一条：这个观察台存在的理由是「让界面真的能被看见和量」，而它此前只能
 * 接瞬间返回的 mock —— 于是**任何与时序有关的界面都看不见**：任务在跑的样子、排队
 * 的样子、等人那一刻的样子，全在同一帧里过去了。用它去看排队，看到的会是「没有
 * 排队」，而那不是因为上限生效，是因为根本没人排。
 *
 * 只是把已有的 CapabilityClient 接上，不改它；观察台仍然只在本机、只用桩身份。
 */
const capabilityBase = process.env.RUYIN_CAPABILITY_BASE ?? "";
const contextBudget = contextBudgetFromEnv();
const gateway = capabilityBase
  ? new CapabilityClient({ baseUrl: capabilityBase })
  : new MockAIGateway();

const runtime = new ProjectRuntime({
  storage,
  clock: nodeClock,
  id: nodeId,
  crypto: nodeCrypto,
  gateway,
  connectors: connectorLookup,
  ranker: new FtsRanker(storage),
  tools: executor,
  skills: skillRegistry,
  // 上下文预算（TD-044）：调小它能在观察台上直接看见选进去的条目变少。
  contextBudgetBytes: contextBudget.bytes,
});

const names = ["某储能电站 EPC 投标", "城市轨道信号系统投标", "数据中心机电总包投标"];
let first;
for (const name of names) {
  const meta = await runtime.createProject(bid, name, "wsp_demo");
  first ??= meta.id;
  await runtime.addGrant(meta.id, work, "readwrite");
}
const binding = await runtime.setBinding(first, {
  type: "tender_document",
  root: join(work, "招标"),
});
await reindexBinding(storage, first, binding, new LocalFsConnector(), resourceLimits.limits);
// 跑一个任务，好让项目面板上有真实内容（会停在人工检查点）。
const harness = await runtime.createHarness(first);
const created = await harness.startTask("analyze_tender");
await harness.advance(created.id);

// 登录态是**可变的**，不是一个常量 true。
//
// 原来这里写死了 signedIn: true，也没有 beginLogin / logout —— 于是观察台上
// 「退出登录」按下去打到 `/auth/logout`，那一路 `deps.platform.logout()` 是
// undefined，直接 500。换句话说：**观察台从来走不了退出这条路**，而退出恰恰
// 是 2026-09-10 出问题的那条路（退出只退了侧栏那一格，工作台原地不动）。
// 又一次「一条从没被走过的路径，坏了和好了长得一模一样」。
//
// 现在给它一个真的开关。登录这一端也是桩：真流程要过系统浏览器 + 平台
// 授权码，观察台上没有那两样，所以 beginLogin 直接把开关拨回已登录并回一个
// about:blank —— 界面那边本来就是「开个窗口，然后轮询 session 等它翻」，
// 轮询照旧生效。**这是观察台专用的桩，不是产品行为**。
let signedIn = true;
const platform = {
  session: () =>
    signedIn
      ? {
          signedIn: true,
          profile: { sub: "u_demo", name: "郭彦豪", email: "yanhaoguo@gmail.com" },
          org: { id: "org_demo", name: "Vxture" },
          workspace: { id: "wsp_demo", name: "演示工作区" },
        }
      : { signedIn: false, issuer: "(stub)", consoleBase: "https://vxture.com", entitlementsConfigured: false },
  beginLogin: async () => {
    signedIn = true;
    return "about:blank";
  },
  logout: async () => {
    signedIn = false;
  },
  config: { issuer: "(stub)", clientId: "ruyin", platformApiBase: "" },
  bearerToken: () => undefined,
};

const events = new EventBus();
let chromeTheme = "dark";
const registry = new ProductRegistry(`${repo}/products`, dataDir);
const server = createLocalApi({
  runtime,
  registry,
  tasks: new TaskRunner(runtime, new Set(), events),
  token: TOKEN,
  version: "0.1.0-uiharness",
  events,
  // 更新检查指向哪个 feed：不设就是真渠道（在开发机上多半是 unreachable）。
  // 设成本地一份 latest.yml，就能把「有新版本」那一路真的看一遍。
  ...(process.env.RUYIN_UPDATE_FEED
    ? { updateFeedBase: process.env.RUYIN_UPDATE_FEED }
    : {}),
  writeArtifact: (p, b, g) => executor.writeArtifact(p, b, g),
  supportsTool: (t) => executor.supports(t),
  uiDir: `${repo}/apps/ui-workspace/dist`,
  platform,
  // 项目文件区（TD-041）。观察台接的是**真的**存储与加密 —— 这一段的价值全在
  // 「磁盘上到底存了什么」，接个桩就只能看见界面画得对不对。
  files: {
    list: (pid) => storage.openHostStore(pid)?.listFiles() ?? [],
    get: (pid, fileId) => storage.openHostStore(pid)?.getFile(fileId),
    add: async (pid, path) => {
      const store = storage.openHostStore(pid);
      const area = storage.openFileStore(pid);
      const { hash, bytes } = await area.put(path);
      const record = {
        id: nodeId.newId("file"),
        hash,
        name: basename(path),
        bytes,
        mediaType: mediaTypeOf(path),
        addedAt: nodeClock.now(),
        sourceRef: path,
      };
      store.addFile(record);
      return record;
    },
    read: async (pid, fileId) => {
      const record = storage.openHostStore(pid).getFile(fileId);
      return storage.openFileStore(pid).read(record.hash);
    },
    remove: (pid, fileId) => {
      const store = storage.openHostStore(pid);
      const area = storage.openFileStore(pid);
      const gone = store.removeFile(fileId);
      if (gone.removed && gone.hash && !gone.stillReferenced) area.remove(gone.hash);
      return gone.removed;
    },
  },
  reindex: (pid, b) =>
    reindexBinding(storage, pid, b, connectorLookup.get(b.connector), resourceLimits.limits),
  connectors: connectorRegistry,
  skills: skillRegistry,
  tools: new ToolRegistryView({
    supportsBuiltin: (id) => executor.supports(id),
    hasSkills: () => true,
    connectors: () => connectorRegistry.list(),
    bundledServers: () => bundledTools.list(),
  }),
  // 主题中转：界面上报，壳取值给窗口按钮上色（观察台里没有壳，但端点要在，
  // 否则那条通路在这儿看不见）。
  chromeTheme: {
    get: () => chromeTheme,
    set: (t) => {
      chromeTheme = t;
    },
  },
  // 数据目录搬家（TD-039）：观察台里也接上，否则「换目录」那条路在这儿是
  // 404，而它恰恰是最需要在真实文件系统上看一眼的一条 —— 校验的每一句拒绝
  // 都来自真的去摸了一下磁盘。观察台的指针文件跟着临时数据目录一起丢弃。
  dataMove: {
    check: (target) => checkTarget(harnessLocation.dataDir ?? dataDir, target),
    request: (target) => {
      harnessLocation = { dataDir: harnessLocation.dataDir ?? dataDir, pending: resolve(target) };
      writeLocation(locationFile, harnessLocation);
    },
    cancel: () => {
      harnessLocation = { dataDir: harnessLocation.dataDir ?? dataDir };
      writeLocation(locationFile, harnessLocation);
    },
  },
  systemInfo: {
    version: "0.1.0-uiharness",
    platform: process.platform,
    arch: process.arch,
    dataDir,
    productsDir: `${repo}/products`,
    keyProtection: "dpapi",
    // 照实说用的是哪一个：不配 base 时仍是 mock，首页产品卡的「未接通」
    // （TD-033）在这里就能看见，而不是只在装机后才第一次出现。
    capabilitySurface: capabilityBase ? "configured" : "mock",
    startedAt: new Date().toISOString(),
    get dataDirPending() {
      return harnessLocation.pending;
    },
    get lastMove() {
      return harnessLocation.lastMove;
    },
  },
});
server.listen(PORT, "127.0.0.1", () => {
  // 端口取自**真的监听结果**，不是那个请求值：PORT=0 时两者不一样，而这一行就是
  // 观察台对外的全部接口 —— 人照它开浏览器，烟测照它发请求。印一个没在听的端口，
  // 和印一个对的长得一模一样。
  const bound = server.address();
  const port = typeof bound === "object" && bound !== null ? bound.port : PORT;
  console.log(`[uiharness] http://127.0.0.1:${port}/?token=${TOKEN}`);
  console.log(`[uiharness] project=${first}`);
});
