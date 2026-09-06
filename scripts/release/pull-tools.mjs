#!/usr/bin/env node
/**
 * 构建时按预置清单把 MCP 服务器 vendored 进包（ADR-018 §2.2「工具：拉到本机可运行」）。
 *
 *   resources/skill-manifest.json（servers[].launch）
 *     → resources/tools/<id>/node_modules/…   （runtime = node：npm 安装到位，随包）
 *     → resources/tools/index.json            （每条的启动规格 + vendored 入口 + 许可证）
 *
 * 只 vendored **node** 发行形态的：Ruyin 自带 Node（Electron），起得来、离线可用。
 * **uvx**（Python）形态的不随包 —— 要本机有 uv，索引里照记，守护进程启动时如实报
 * 「需要 uv」。没有 launch 规格的（发行形态未核实 / 经 Runos 注册）只登记不装。
 *
 * npm 安装用 --ignore-scripts：不让任何包的 postinstall 在构建机上跑；需要额外下载
 * 的（playwright 的浏览器）在 launch.note 里写明，由用户决定。
 *
 * 2026-09-06（ADR-018 §7.2）又多做三件事：
 *
 *   1. **`vendored.keepOnly`**：人评审过的显式白名单，剪掉同级的其它平台目录。
 *      起因是 negokaz 被记成「vendored 后 100 MB，不随包」—— 那不是真重量，是剪枝
 *      器漏判：它的平台目录叫 `dist/excel-mcp-server_windows_amd64_v1`，与下面
 *      PLATFORM_DIR 的判断四处不匹配。**没有去放宽那个正则** —— 放宽了会继续漏掉
 *      下一个 GoReleaser / napi 形状；显式白名单加一条体积断言才挡得住这一类。
 *   2. **体积断言**：任何 vendored 树剪枝后仍 > 40 MB 就失败退出，除非清单显式写了
 *      `vendored.sizeAcknowledged`。一个悄悄胖起来的安装包不会有人发现。
 *   3. **工具名对照表**（TD-034 的那一半）：每个 vendored 完的 node 服务器真起一次、
 *      `initialize` + `tools/list`、停掉，把工具名记进 index.json，再生成
 *      `docs/40-implementation/40-bundled-tool-names.md`。契约作者要照着这些名字写
 *      `provider: connector` 的工具声明，而在此之前那份名单只存在于运行中的进程里。
 *      **起不来的记 `toolsUnprobed` 而不是空数组** —— 空数组读起来是「它什么都不暴露」。
 *
 * 组件表（`components` / `allowedOrigins` / `pythonRuntime`）也照抄进 index.json：
 * 守护进程读的是随安装包走的这一份，摘要因此不经网络。
 *
 * 用法：node scripts/release/pull-tools.mjs [--only <id>] [--force] [--out <目录>]
 *       node scripts/release/pull-tools.mjs --docs-only [--check]
 *         只从现有 index.json 重生成文档；--check 是 CI 用的比对模式（过期就红）。
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// 渲染单列一份，因为它要能被测：**生成物必须是确定的** —— 同一份 index.json，
// 今天跑和下个月跑要一字不差，否则 packaged-smoke 里那句 `git diff --exit-code`
// 会在提交的第二天起对每一次无关提交变红（见 tool-name-doc.mjs 的头注释）。
import { renderToolNameDoc, renderToolNameTable } from "./tool-name-doc.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const manifest = JSON.parse(readFileSync(join(repoRoot, "resources", "skill-manifest.json"), "utf8"));
const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;
const force = args.includes("--force");
const docsOnly = args.includes("--docs-only");
const checkDocs = args.includes("--check");
const outDir = args.includes("--out") ? resolve(args[args.indexOf("--out") + 1]) : join(repoRoot, "resources", "tools");
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
/**
 * 剪枝后仍超过这个数就失败。挡的不是某一个包，是「安装包悄悄胖了 100 MB 而
 * 没人发现」这一类 —— 体积不会自己报错。
 */
const VENDOR_SIZE_LIMIT = 40 * 1024 * 1024;


/**
 * 只发 win32-x64（electron-builder 的目标），别的平台的预编译二进制不进包：koffi 一个包
 * 就带 18 个平台 26 MB。只删 build/ prebuilds/ bin/ 下按「平台_架构」命名的目录。
 */
const PLATFORM_DIR = /^(darwin|linux|freebsd|openbsd|musl|android|aix|sunos|win32)[-_](x64|ia32|arm64|armhf|arm|loong64|riscv64d|riscv64|ppc64|ppc64le|s390x)$/;
const KEEP = new Set([`${process.platform}_${process.arch}`, `${process.platform}-${process.arch}`, "win32_x64", "win32-x64"]);
function pruneForeignPlatforms(root) {
  let freed = 0;
  const walk = (dir) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const p = join(dir, d.name);
      if (/^(build|prebuilds|bin)$/.test(d.name)) {
        for (const sub of readdirSync(p, { withFileTypes: true })) {
          if (!sub.isDirectory()) continue;
          const q = join(p, sub.name);
          // koffi 把平台目录放在 build/koffi/<平台>；prebuilds 直接放 <平台>。两层都看。
          const inner = readdirSync(q, { withFileTypes: true }).filter((x) => x.isDirectory());
          const candidates = PLATFORM_DIR.test(sub.name) ? [{ name: sub.name, path: q }] : inner.filter((x) => PLATFORM_DIR.test(x.name)).map((x) => ({ name: x.name, path: join(q, x.name) }));
          for (const c of candidates) {
            if (KEEP.has(c.name)) continue;
            freed += dirSize(c.path);
            rmSync(c.path, { recursive: true, force: true });
          }
        }
      }
      walk(p);
    }
  };
  walk(root);
  return freed;
}

/** 开发期文件不进包：类型声明、source map、文档、测试、示例。许可证文件一律留。 */
const DEV_DIRS = new Set(["test", "tests", "__tests__", "docs", "doc", "example", "examples", ".github"]);
function pruneDevArtifacts(root) {
  let freed = 0;
  const walk = (dir) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, d.name);
      if (d.isDirectory()) {
        if (DEV_DIRS.has(d.name)) { freed += dirSize(p); rmSync(p, { recursive: true, force: true }); continue; }
        walk(p);
      } else if (/.(d.ts|d.mts|d.cts|map|markdown)$/.test(d.name) || (/.md$/i.test(d.name) && !/^(LICENSE|LICENCE|COPYING|NOTICE)/i.test(d.name))) {
        freed += statSync(p).size;
        rmSync(p, { force: true });
      }
    }
  };
  walk(root);
  return freed;
}

function dirSize(dir) {
  let n = 0;
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    n += d.isDirectory() ? dirSize(p) : statSync(p).size;
  }
  return n;
}
/**
 * `keepOnly`：清单里人评审过的显式白名单。列出的每一条是一个**要留下的目录**，
 * 它同级的其它目录一律删掉（文件不动 —— launcher.js 与平台目录是同级的）。
 *
 * 为什么不放宽上面那个正则：那个正则认的是「平台_架构」这一种命名，而
 * GoReleaser 出的是 `<包名>_windows_amd64_v1`、napi 出的又是另一种。每遇到一种新
 * 形状就放宽一次，最后会宽到把不该删的删掉；而漏判的代价只是「悄悄多 87 MB」，
 * 它不出错的时候什么都不说。
 */
function pruneKeepOnly(root, keepOnly) {
  let freed = 0;
  const keep = new Set(keepOnly.map((p) => p.replace(/\\/g, "/")));
  for (const rel of keep) {
    const target = join(root, rel);
    if (!existsSync(target)) {
      throw new Error(`keepOnly 指向的 ${rel} 不存在 —— 上游改了目录布局，白名单要跟着改`);
    }
    const parentRel = rel.split("/").slice(0, -1).join("/");
    const parent = parentRel ? join(root, parentRel) : root;
    for (const d of readdirSync(parent, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const siblingRel = parentRel ? `${parentRel}/${d.name}` : d.name;
      if (keep.has(siblingRel)) continue;
      const p = join(parent, d.name);
      freed += dirSize(p);
      rmSync(p, { recursive: true, force: true });
    }
  }
  return freed;
}

function findLicense(dir) {
  if (!existsSync(dir)) return undefined;
  const hit = readdirSync(dir).find((f) => /^(LICENSE|LICENCE|COPYING)(\.|$)/i.test(f));
  return hit ? join(dir, hit) : undefined;
}

mkdirSync(outDir, { recursive: true });
const indexFile = join(outDir, "index.json");
const previous = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, "utf8")) : { servers: [] };
const index = { generatedAt: new Date().toISOString(), manifestVersion: manifest.version, servers: [] };
let failures = 0;

// --docs-only：不装任何东西，只从现有 index.json 重生成 / 比对文档。CI 用它守着
// 「文档过期就红」，而 CI 上没有 npm 装包的必要。
if (docsOnly) {
  if (!existsSync(indexFile)) {
    console.error(`[pull-tools] ${indexFile} 不存在 —— 先跑一次 pnpm tools:pull`);
    process.exit(1);
  }
  process.exit(writeToolNameDocs(previous, checkDocs) ? 0 : 1);
}

for (const s of manifest.servers) {
  if (only && s.id !== only) {
    const prior = previous.servers?.find((p) => p.id === s.id);
    if (prior) index.servers.push(prior);
    continue;
  }
  const entry = {
    id: s.id,
    repo: s.repo,
    license: s.license,
    tier: s.tier,
    needsKey: s.needsKey === true,
    ...(s.note ? { note: s.note } : {}),
    launch: s.launch ?? null,
    ...(s.launchNote ? { launchNote: s.launchNote } : {}),
  };
  if (!s.launch || s.launch.runtime !== "node") {
    // 不随包的：之前拉过的目录也删掉（清单改了主意）。
    rmSync(join(outDir, s.id), { recursive: true, force: true });
    index.servers.push(entry);
    continue;
  }
  const { package: pkg, version, bin } = s.launch;
  const target = join(outDir, s.id);
  const prior = previous.servers?.find((p) => p.id === s.id);
  const wanted = `${pkg}@${version}`;
  if (!force && prior?.vendored && prior.vendored.package === wanted && existsSync(join(target, prior.vendored.entry))) {
    console.log(`[pull-tools] ${s.id}: up to date (${wanted})`);
    index.servers.push(prior);
    continue;
  }
  process.stdout.write(`[pull-tools] ${s.id}: npm install ${wanted} … `);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  // 一个空 package.json，让 npm 把包装进这个目录自己的 node_modules，而不是往上找工作区。
  writeFileSync(join(target, "package.json"), JSON.stringify({ name: `ruyin-tool-${s.id.replace(/[^a-z0-9-]/g, "-")}`, private: true, version: "0.0.0" }, null, 2));
  // Windows 上 npm 是 .cmd，得经 shell；参数全是清单里核过的包名与固定开关，拼成一串。
  const npmArgs = ["install", wanted, "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock", "--loglevel=error"];
  const res = process.platform === "win32"
    ? spawnSync(`${npmCmd} ${npmArgs.join(" ")}`, { cwd: target, encoding: "utf8", shell: true, windowsHide: true })
    : spawnSync(npmCmd, npmArgs, { cwd: target, encoding: "utf8", windowsHide: true });
  if (res.status !== 0) {
    failures++;
    console.log("FAILED");
    console.error(`[pull-tools]   ${(res.stderr || res.stdout).trim().slice(0, 400)}`);
    index.servers.push({ ...entry, vendorError: (res.stderr || res.stdout).trim().slice(0, 200) });
    continue;
  }
  const entryRel = `node_modules/${pkg}/${bin}`;
  if (!existsSync(join(target, entryRel))) {
    failures++;
    console.log("FAILED");
    console.error(`[pull-tools]   entry ${entryRel} not found after install`);
    index.servers.push({ ...entry, vendorError: `entry ${entryRel} not found` });
    continue;
  }
  const license = findLicense(join(target, "node_modules", pkg));
  let pruned = pruneForeignPlatforms(join(target, "node_modules")) + pruneDevArtifacts(join(target, "node_modules"));
  if (s.vendored?.keepOnly) {
    try {
      pruned += pruneKeepOnly(join(target, "node_modules", pkg), s.vendored.keepOnly);
    } catch (cause) {
      failures++;
      console.log("FAILED");
      console.error(`[pull-tools]   ${cause.message}`);
      index.servers.push({ ...entry, vendorError: cause.message });
      continue;
    }
  }
  const bytes = dirSize(target);
  console.log(`${(bytes / 1048576).toFixed(1)} MB${pruned ? ` (pruned ${(pruned / 1048576).toFixed(1)} MB of other-platform binaries / dev files)` : ""}${license ? "" : " (no LICENSE file in package!)"}`);
  // 体积断言。**不是警告** —— 上一版就是一句 console.log 里的数字，而 100 MB 那条
  // 被人读了一眼就写进 launchNote 当成事实，再没人复核过。
  if (bytes > VENDOR_SIZE_LIMIT && !s.vendored?.sizeAcknowledged) {
    failures++;
    const msg =
      `${s.id} 剪枝后仍有 ${(bytes / 1048576).toFixed(1)} MB，超过 ${(VENDOR_SIZE_LIMIT / 1048576).toFixed(0)} MB —— ` +
      `要么加 vendored.keepOnly 剪掉不该随包的东西，要么在清单里显式写 vendored.sizeAcknowledged 说明为什么值得`;
    console.error(`[pull-tools]   ${msg}`);
    index.servers.push({ ...entry, vendorError: msg });
    continue;
  }
  index.servers.push({
    ...entry,
    vendored: {
      dir: s.id,
      package: wanted,
      entry: entryRel,
      bytes,
      licenseFile: license ? `${s.id}/node_modules/${pkg}/${license.split(/[\\/]/).pop()}` : null,
    },
  });
}

// 清单里没有的目录删掉。
for (const d of readdirSync(outDir, { withFileTypes: true })) {
  if (d.isDirectory() && !manifest.servers.some((s) => s.id === d.name)) {
    rmSync(join(outDir, d.name), { recursive: true, force: true });
    console.log(`[pull-tools] removed ${d.name} (no longer in the manifest)`);
  }
}
await probeToolNames(index.servers);

// 获取通道的组件表随索引进安装包：守护进程读的是这一份，所以那几条 sha256
// **不经网络**。清单里没有 components 就是这一版没有获取通道（不是空列表）。
if (Array.isArray(manifest.components) && manifest.components.length > 0) {
  index.components = manifest.components;
  index.allowedOrigins = manifest.allowedOrigins ?? [];
}
if (manifest.pythonRuntime) index.pythonRuntime = manifest.pythonRuntime;

writeFileSync(indexFile, JSON.stringify(index, null, 2));
if (!writeToolNameDocs(index, false)) failures++;
const vendored = index.servers.filter((s) => s.vendored);
const total = vendored.reduce((n, s) => n + s.vendored.bytes, 0);
const named = index.servers.filter((s) => s.tools?.length).reduce((n, s) => n + s.tools.length, 0);
console.log(
  `[pull-tools] ${vendored.length} node server(s) vendored (${(total / 1048576).toFixed(1)} MB), ` +
    `${named} tool name(s) probed, ` +
    `${index.servers.filter((s) => s.launch?.runtime === "uvx").length} via uvx (not bundled), ` +
    `${index.servers.filter((s) => !s.launch).length} registered only -> ${outDir}`,
);
if (failures) {
  console.error(`[pull-tools] ${failures} server(s) failed to vendor`);
  process.exit(1);
}

/**
 * 预置工具名对照表（TD-034 的那一半）。
 *
 * 每个 vendored 完的 node 服务器真起一次、`initialize` + `tools/list`、停掉。
 * 复用守护进程那个 MCP 客户端（`apps/local-host/dist/mcp-client.js`）而不是另写
 * 一份 JSON-RPC：另写一份，两边对协议的理解迟早会分叉，而分叉的那一次这里报出
 * 的名单就不是运行时真会看到的名单了。
 *
 * `pack.mjs` 先 `pnpm --recursive build` 再跑本脚本，所以那个 dist 一定在；
 * **独立跑 `pnpm tools:pull` 时不保证**，那就跳过并在索引里写明原因 ——
 * 不静默产出空数组（空数组读起来是「它什么都不暴露」）。
 *
 * 目录覆盖率**先告警不硬失败**：硬失败等于「构建机上起不来的服务器永远不许随包」，
 * 那是一条值得单独决定的约束，不该由一个 lint 顺带定下。
 */
async function probeToolNames(servers) {
  const clientPath = join(repoRoot, "apps", "local-host", "dist", "mcp-client.js");
  if (!existsSync(clientPath)) {
    for (const s of servers) {
      if (!s.vendored) continue;
      s.toolsUnprobed = "构建产物 apps/local-host/dist 不在（先 pnpm --recursive build）";
    }
    console.warn("[pull-tools] tool-name probe SKIPPED: apps/local-host/dist/mcp-client.js not built");
    return;
  }
  const { McpStdioClient } = await import(pathToFileURL(clientPath).href);
  // **探测进程不许把仓库当工作目录。** playwright-mcp 起来就往 cwd 里写
  // `.playwright-mcp/`（每次访问一页留一份 .yml 快照）—— 上一轮探测就在仓库根留下
  // 了四个未跟踪文件。给它一个临时目录，探完删掉：构建脚本不该往被 git 看着的树里
  // 写任何东西，而「顺手 .gitignore 掉」只是让下一次看不见，不是不写。
  const probeCwd = mkdtempSync(join(tmpdir(), "ruyin-tool-probe-"));
  try {
  for (const s of servers) {
    if (!s.vendored) {
      if (s.launch) s.toolsUnprobed = `本次构建没有 vendored 它（runtime = ${s.launch.runtime}）`;
      continue;
    }
    const entry = join(outDir, s.vendored.dir, s.vendored.entry);
    const client = new McpStdioClient(
      { command: process.execPath, args: [entry, ...(s.launch.args ?? [])], env: { ELECTRON_RUN_AS_NODE: "1" }, cwd: probeCwd },
      { timeoutMs: 30_000 },
    );
    try {
      await client.start();
      const tools = (await client.listTools()).map((t) => t.name).filter((n) => typeof n === "string" && n);
      if (tools.length === 0) {
        s.toolsUnprobed = "服务器起来了但没报出任何工具";
      } else {
        s.tools = [...new Set(tools)].sort();
        s.toolsProbedAt = new Date().toISOString();
        const info = client.serverInfo?.serverInfo;
        if (info?.name) s.serverInfo = { name: info.name, ...(info.version ? { version: info.version } : {}) };
      }
      console.log(`[pull-tools] ${s.id}: ${s.tools?.length ?? 0} tool(s)`);
    } catch (cause) {
      s.toolsUnprobed = `构建机上起不来：${cause instanceof Error ? cause.message : String(cause)}`.slice(0, 200);
      console.warn(`[pull-tools] ${s.id}: tool-name probe failed - ${s.toolsUnprobed}`);
    } finally {
      await client.stop?.().catch?.(() => {});
    }
  }
  } finally {
    await removeWhenReleased(probeCwd);
  }
}

/**
 * 删探针的临时工作目录 —— **要等，而且等不到也不能让构建挂掉**。
 *
 * Windows 上子进程的工作目录会被句柄锁住，而句柄不是随 `stop()` 同步释放的：
 * CI 上第一次跑就撞了 `EBUSY: rmdir`，把整条 packaged-smoke 打断在「四个服务器
 * 的工具名都已经探到了」之后 —— 探针成功了，收摊失败了，构建报失败。
 *
 * 所以：退避重试几次；仍然删不掉就**只警告**。它在系统临时目录里，操作系统会清；
 * 拿一次临时目录的残留去换一次构建失败，是拿重要的东西换不重要的东西。
 */
async function removeWhenReleased(dir) {
  for (const wait of [0, 50, 150, 400, 1000]) {
    if (wait) await new Promise((done) => setTimeout(done, wait));
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (cause) {
      if (cause?.code !== "EBUSY" && cause?.code !== "ENOTEMPTY" && cause?.code !== "EPERM") throw cause;
    }
  }
  console.warn(`[pull-tools] 临时探针目录没能删掉（子进程句柄未释放），留给系统清理：${dir}`);
}

/**
 * 两处落点，同一份源头（index.json）：
 *
 *   1. `docs/40-implementation/40-bundled-tool-names.md` —— 整篇生成
 *   2. `docs/40-implementation/10-product-integration-guide.md` 里两个标记之间的
 *      那一段 —— 契约作者是在接入指南里找工具名的，让他先跳一次文件是没必要的摩擦
 *
 * `check` 模式只比对不写：文档过期就红。
 */
function writeToolNameDocs(source, check) {
  const generated = renderToolNameDoc(source);
  const table = renderToolNameTable(source);
  const docFile = join(repoRoot, "docs", "40-implementation", "40-bundled-tool-names.md");
  const guideFile = join(repoRoot, "docs", "40-implementation", "10-product-integration-guide.md");
  const guide = readFileSync(guideFile, "utf8");
  const BEGIN = "<!-- BUNDLED-TOOLS:BEGIN -->";
  const END = "<!-- BUNDLED-TOOLS:END -->";
  const from = guide.indexOf(BEGIN);
  const to = guide.indexOf(END);
  if (from < 0 || to < 0) {
    console.error(`[pull-tools] ${guideFile} 里找不到 ${BEGIN} / ${END} 标记`);
    return false;
  }
  const nextGuide = `${guide.slice(0, from + BEGIN.length)}\n${table}\n${guide.slice(to)}`;
  if (check) {
    const stale = [];
    if (!existsSync(docFile) || readFileSync(docFile, "utf8") !== generated) stale.push(docFile);
    if (guide !== nextGuide) stale.push(guideFile);
    if (stale.length) {
      console.error(`[pull-tools] 工具名对照表过期：\n  - ${stale.join("\n  - ")}\n  跑一次 pnpm tools:names 重生成。`);
      return false;
    }
    console.log("[pull-tools] OK - 工具名对照表与 index.json 一致。");
    return true;
  }
  writeFileSync(docFile, generated);
  writeFileSync(guideFile, nextGuide);
  return true;
}
