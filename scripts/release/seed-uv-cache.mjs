#!/usr/bin/env node
/**
 * 构建时把 Python 半边预取进包（ADR-018 §7.2；TD-042 未完的那一步）。
 *
 * 为什么要有它：清单里 uvx 形态的服务器在目标客户的机器上**永远是死的** —— 气隙 /
 * 域受限企业装不了 uv，也连不上 PyPI。而 uv 是个**使能件**：机器上没有它，连侧载
 * 来的 wheel 都跑不了。所以这一步随包三样东西：
 *
 *   <resources>/uv/uv.exe + uvx.exe   静态二进制，MIT OR Apache-2.0，无 DLL
 *                                     （uvx.exe 只是壳，离开 uv.exe 跑不了，两个都要）
 *   <resources>/uv/python/…           uv 托管的 CPython，可重定位
 *   <resources>/uv/cache/…            清单 pythonRuntime.seed 里那几个包的 wheel
 *
 * 运行时那一侧的契约在 `apps/local-host/src/tool-servers.ts` 的 uvxPlan()：随包
 * uv.exe 的绝对路径 + `--offline` + UV_CACHE_DIR / UV_PYTHON_INSTALL_DIR /
 * UV_PYTHON_DOWNLOADS=never，**不留联网回退**。两边要一起改，改一边就是一次悄悄
 * 的联网。
 *
 * **本脚本 2026-09-06 写下时没有在 CI 里跑过**，uv / CPython / 缓存也还没进
 * electron-builder 的 extraResources —— 所以清单里那几条 uvx 形态仍记为
 * installed-disabled 而不是 default（档位与「装没装进包」是同一件事）。要让它们
 * 转正，顺序是：跑通这一步 → 加进 electron-builder → packaged-smoke 真起一次 uvx
 * 形态 → 才改 tier。lint:skill-manifest 会在最后一步上把关。
 *
 * 用法：node scripts/release/seed-uv-cache.mjs [--out <resources 目录>]
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const manifest = JSON.parse(readFileSync(join(repoRoot, "resources", "skill-manifest.json"), "utf8"));
const args = process.argv.slice(2);
const resourcesDir = args.includes("--out") ? resolve(args[args.indexOf("--out") + 1]) : join(repoRoot, "resources");
const uvHome = join(resourcesDir, "uv");
const cacheDir = join(uvHome, "cache");
const pythonDir = join(uvHome, "python");
const py = manifest.pythonRuntime;

if (!py?.uv?.version) {
  console.error("[seed-uv-cache] 清单里没有 pythonRuntime.uv —— 这一版不带 Python 半边");
  process.exit(1);
}

const uvExe = join(uvHome, process.platform === "win32" ? "uv.exe" : "uv");
if (!existsSync(uvExe)) {
  // **不自己去下 uv。** 取回上游的字节要过与运行时同一道校验（sha256 + origin 白名单），
  // 而那道校验在 component-store.ts 里；在这里再写一份，两份迟早会漂开。
  // 所以这一步是显式的构建前置：CI 用 astral-sh/setup-uv 或按清单里的 upstream
  // 取回并核对，再放到 <resources>/uv 下。
  console.error(
    `[seed-uv-cache] ${uvExe} 不在。\n` +
      `  先把 uv ${py.uv.version} 放到 ${uvHome}（uv.exe 与 uvx.exe 两个都要）。\n` +
      `  上游：${py.uv.upstream}\n` +
      `  许可证：${py.uv.license}（${py.uv.licenseSource}）—— 许可证正文要随件落到同一个目录。`,
  );
  process.exit(1);
}

mkdirSync(cacheDir, { recursive: true });
mkdirSync(pythonDir, { recursive: true });
const env = {
  ...process.env,
  UV_CACHE_DIR: cacheDir,
  UV_PYTHON_INSTALL_DIR: pythonDir,
  UV_NO_PROGRESS: "1",
};

function uv(argv, { offline = false } = {}) {
  console.log(`[seed-uv-cache] uv ${argv.join(" ")}`);
  const res = spawnSync(uvExe, argv, { env, stdio: "inherit", windowsHide: true });
  if (res.status !== 0) {
    console.error(`[seed-uv-cache] FAILED: uv ${argv.join(" ")}${offline ? "（离线复核那一步）" : ""}`);
    process.exit(res.status ?? 1);
  }
}

// 1. 托管的 CPython。运行时 UV_PYTHON_DOWNLOADS=never，所以它必须在构建时就位。
uv(["python", "install", py.cpython.version.split(".").slice(0, 2).join(".")]);

// 2. 每个 seed 包的 wheel。版本从清单的 launch 里取 —— 钉死的那一个，不是最新的。
const seeds = [];
for (const id of py.seed ?? []) {
  const server = (manifest.servers ?? []).find((s) => s.id === id);
  if (!server?.launch || server.launch.runtime !== "uvx") {
    console.error(`[seed-uv-cache] pythonRuntime.seed 里的 ${id} 不是一个 uvx 形态的服务器`);
    process.exit(1);
  }
  seeds.push(server.launch);
}
for (const l of seeds) {
  uv(["tool", "install", `${l.package}==${l.version}`]);
}

// 3. **离线复核**：这一步才是 `launch.offline.cacheSeeded: true` 的凭据。
//    只把 wheel 放进缓存不算数 —— 断网时真起得来才算，而两者不是同一回事
//    （缺一个传递依赖、缺一个解释器，都要到 --offline 这一跑才现形）。
for (const l of seeds) {
  uv(["tool", "run", "--offline", "--from", `${l.package}==${l.version}`, l.bin ?? l.package, "--help"], { offline: true });
}

console.log(
  `[seed-uv-cache] OK - uv ${py.uv.version} + CPython ${py.cpython.version} + ${seeds.length} 个包的 wheel 已就位（${uvHome}），` +
    `且每一个都在 --offline 下真起过一次。`,
);
