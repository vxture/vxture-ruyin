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
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
const { TaskRunner } = await import(`${ROOT}/apps/local-host/dist/task-runner.js`);
const { LocalFsConnector } = await import(`${ROOT}/apps/local-host/dist/connector-fs.js`);
const { FtsRanker, reindexBinding, searchContext } = await import(
  `${ROOT}/apps/local-host/dist/fts.js`
);
const { LocalToolExecutor } = await import(`${ROOT}/apps/local-host/dist/tool-executor.js`);
const { InstallIntentBox } = await import(`${ROOT}/apps/local-host/dist/updates.js`);
const { EventBus } = await import(`${ROOT}/apps/local-host/dist/events.js`);
const { readFileSync } = await import("node:fs");

const PORT = Number(process.env.PORT ?? 17470);
const TOKEN = "uiharness";
const repo = repoRoot.replaceAll("\\", "/").replace(/\/$/, "");
const dataDir = mkdtempSync(join(tmpdir(), "ruyin-uiharness-"));
const work = mkdtempSync(join(tmpdir(), "ruyin-uiwork-"));
mkdirSync(join(work, "招标"), { recursive: true });
writeFileSync(
  join(work, "招标", "某储能电站EPC招标文件.md"),
  "# 招标文件\n\n1. 一级资质\n2. 储能业绩\n",
  "utf8",
);

const storage = new SqliteStoragePort(dataDir, await KeyManager.open(dataDir));
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

const bid = parseContract(readFileSync(`${repo}/products/bid/ruyin.product.yaml`, "utf8"));
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
const registry = new ProductRegistry(`${repo}/products`, dataDir);
const server = createLocalApi({
  runtime,
  registry,
  tasks: new TaskRunner(runtime, new Set(), events),
  token: TOKEN,
  version: "0.1.0-uiharness",
  events,
  updateIntent: new InstallIntentBox(),
  writeArtifact: (p, b, g) => executor.writeArtifact(p, b, g),
  supportsTool: (t) => executor.supports(t),
  uiDir: `${repo}/apps/ui-workspace/dist`,
  platform,
  reindex: (pid, b) => reindexBinding(storage, pid, b, new LocalFsConnector()),
  systemInfo: {
    version: "0.1.0-uiharness",
    platform: process.platform,
    arch: process.arch,
    dataDir,
    productsDir: `${repo}/products`,
    keyProtection: "dpapi",
    startedAt: new Date().toISOString(),
  },
});
server.listen(PORT, "127.0.0.1", () => {
  console.log(`[uiharness] http://127.0.0.1:${PORT}/?token=${TOKEN}`);
  console.log(`[uiharness] project=${first}`);
});
