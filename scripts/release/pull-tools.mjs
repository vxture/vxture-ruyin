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
 * 用法：node scripts/release/pull-tools.mjs [--only <id>] [--force] [--out <目录>]
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const manifest = JSON.parse(readFileSync(join(repoRoot, "resources", "skill-manifest.json"), "utf8"));
const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;
const force = args.includes("--force");
const outDir = args.includes("--out") ? resolve(args[args.indexOf("--out") + 1]) : join(repoRoot, "resources", "tools");
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

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
  const pruned = pruneForeignPlatforms(join(target, "node_modules")) + pruneDevArtifacts(join(target, "node_modules"));
  const bytes = dirSize(target);
  console.log(`${(bytes / 1048576).toFixed(1)} MB${pruned ? ` (pruned ${(pruned / 1048576).toFixed(1)} MB of other-platform binaries / dev files)` : ""}${license ? "" : " (no LICENSE file in package!)"}`);
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
writeFileSync(indexFile, JSON.stringify(index, null, 2));
const vendored = index.servers.filter((s) => s.vendored);
const total = vendored.reduce((n, s) => n + s.vendored.bytes, 0);
console.log(
  `[pull-tools] ${vendored.length} node server(s) vendored (${(total / 1048576).toFixed(1)} MB), ` +
    `${index.servers.filter((s) => s.launch?.runtime === "uvx").length} via uvx (not bundled), ` +
    `${index.servers.filter((s) => !s.launch).length} registered only -> ${outDir}`,
);
if (failures) {
  console.error(`[pull-tools] ${failures} server(s) failed to vendor`);
  process.exit(1);
}
