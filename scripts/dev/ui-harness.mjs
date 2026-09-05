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
 */
import { existsSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const ROOT = pathToFileURL(repoRoot).toString().replace(/\/$/, "");
const { ProjectRuntime } = await import(`${ROOT}/packages/runtime-core/dist/index.js`);
const { parseContract } = await import(`${ROOT}/packages/contract-schema/dist/index.js`);
const { SqliteStoragePort } = await import(`${ROOT}/apps/local-host/dist/storage.js`);
const { KeyManager } = await import(`${ROOT}/apps/local-host/dist/keys.js`);
const { MockAIGateway, nodeClock, nodeCrypto, nodeId } = await import(
  `${ROOT}/apps/local-host/dist/host-ports.js`
);
const { ProductRegistry } = await import(`${ROOT}/apps/local-host/dist/product-registry.js`);
const { createLocalApi } = await import(`${ROOT}/apps/local-host/dist/server.js`);
const { checkTarget, readLocation, writeLocation } = await import(
  `${ROOT}/apps/local-host/dist/data-location.js`
);
const { TaskRunner } = await import(`${ROOT}/apps/local-host/dist/task-runner.js`);
const { LocalFsConnector } = await import(`${ROOT}/apps/local-host/dist/connector-fs.js`);
const { FtsRanker, reindexBinding, searchContext } = await import(
  `${ROOT}/apps/local-host/dist/fts.js`
);
const { LocalToolExecutor } = await import(`${ROOT}/apps/local-host/dist/tool-executor.js`);
const { EventBus } = await import(`${ROOT}/apps/local-host/dist/events.js`);
const { ConnectorRegistry } = await import(`${ROOT}/apps/local-host/dist/connector-registry.js`);
const { SkillRegistry } = await import(`${ROOT}/apps/local-host/dist/skill-registry.js`);
const { ToolRegistryView } = await import(`${ROOT}/apps/local-host/dist/tool-registry.js`);
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
const connectorRegistry = new ConnectorRegistry(dataDir, connectorLookup, {
  allowUnsigned: true,
  log: (l) => console.error(l),
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
const runtime = new ProjectRuntime({
  storage,
  clock: nodeClock,
  id: nodeId,
  crypto: nodeCrypto,
  gateway: new MockAIGateway(),
  connectors: connectorLookup,
  ranker: new FtsRanker(storage),
  tools: executor,
  skills: skillRegistry,
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
await reindexBinding(storage, first, binding, new LocalFsConnector());
// 跑一个任务，好让项目面板上有真实内容（会停在人工检查点）。
const harness = await runtime.createHarness(first);
const created = await harness.startTask("analyze_tender");
await harness.advance(created.id);

const platform = {
  session: () => ({
    signedIn: true,
    profile: { sub: "u_demo", name: "郭彦豪", email: "yanhaoguo@gmail.com" },
    org: { id: "org_demo", name: "Vxture" },
    workspace: { id: "wsp_demo", name: "演示工作区" },
  }),
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
  reindex: (pid, b) => reindexBinding(storage, pid, b, connectorLookup.get(b.connector)),
  connectors: connectorRegistry,
  skills: skillRegistry,
  tools: new ToolRegistryView({
    supportsBuiltin: (id) => executor.supports(id),
    hasSkills: () => true,
    connectors: () => connectorRegistry.list(),
    bundledIndex: () => skillRegistry.bundledIndex(),
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
    // 观察台跑的就是 MockAIGateway，所以照实说 mock —— 首页产品卡的「未接通」
    // （TD-033）在这里就能看见，而不是只在装机后才第一次出现。
    capabilitySurface: "mock",
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
  console.log(`[uiharness] http://127.0.0.1:${PORT}/?token=${TOKEN}`);
  console.log(`[uiharness] project=${first}`);
});
