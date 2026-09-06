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
import fs from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

/** 目录占多少字节 —— 只为把裁掉了多少如实报出来。 */
function dirSize(dir) {
  let n = 0;
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    n += d.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return n;
}

if (!py?.uv?.version) {
  console.error("[seed-uv-cache] 清单里没有 pythonRuntime.uv —— 这一版不带 Python 半边");
  process.exit(1);
}

const uvExe = join(uvHome, process.platform === "win32" ? "uv.exe" : "uv");
if (!existsSync(uvExe)) await fetchUv();

/**
 * 取字节，**网络抖动要重试**。一次 ECONNRESET 让整条发布链失败，换来的不是安全，
 * 是重跑一遍 CI —— 而钉死的哈希在下面把关，重试多少次都改变不了「取到的必须是
 * 那一份」。
 */
async function getBytes(url, what) {
  let last;
  for (const wait of [0, 1000, 3000, 8000]) {
    if (wait) await new Promise((done) => setTimeout(done, wait));
    try {
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (cause) {
      last = cause;
      console.warn(`[seed-uv-cache] 取 ${what} 失败，重试：${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
  // 退到 curl。**不是因为 curl 更可信** —— 下面那道 sha256 才决定这些字节算不算数，
  // 运输方式无关。加它是因为 Node 的 fetch 在某些网络上到 GitHub 的 release 主机
  // 直接 UND_ERR_CONNECT_TIMEOUT，而同一地址 curl 通（本机 2026-09-06 实测）。
  // curl 在 Windows 10 起随系统、macOS 自带、CI runner 都有。
  const tmp = join(uvHome, ".fetch.part");
  mkdirSync(uvHome, { recursive: true });
  const curl = spawnSync("curl", ["-fsSL", "--retry", "3", "-o", tmp, url], { stdio: "inherit", windowsHide: true });
  if (curl.status === 0 && existsSync(tmp)) {
    const bytes = readFileSync(tmp);
    rmSync(tmp, { force: true });
    console.log(`[seed-uv-cache] ${what}：Node 的 fetch 不通，curl 取到了`);
    return bytes;
  }
  rmSync(tmp, { force: true });
  throw new Error(`取 ${what} 失败（fetch 与 curl 都不行）：${last instanceof Error ? last.message : String(last)}`);
}

/**
 * 取回并**当场校验** uv。
 *
 * 上一版这里是「请人先把 uv 放进来」，理由是「校验那份代码在 component-store.ts
 * 里，这儿再写一份会漂开」。理由不成立到两处：① 构建脚本本来就在取上游字节
 * （`pull-tools.mjs` 跑的 `npm install` 取得多得多，而且**一个哈希都没钉**）；
 * ② 一个要人手动摆件的构建不可复现 —— 谁摆的、摆的是哪一份，事后没有记录。
 *
 * 所以这里取，并且照同一条**规则**（不是同一份代码）：https、钉死的 URL、
 * 逐字节比 sha256、许可证正文随件落盘。规则写在这段注释与 `lint:skill-manifest`
 * 两处；运行时那份在 `component-store.ts`，两边验的是各自取回的字节，本来就
 * 不共享代码。
 */
async function fetchUv() {
  const { sha256, size, upstream } = py.uv;
  if (!/^https:\/\//.test(upstream ?? "")) throw new Error("pythonRuntime.uv.upstream 必须是 https");
  if (!/^[0-9a-f]{64}$/.test(sha256 ?? "")) throw new Error("pythonRuntime.uv.sha256 没有钉死");
  mkdirSync(uvHome, { recursive: true });
  const zip = join(uvHome, "uv-download.zip");
  console.log(`[seed-uv-cache] 取 uv ${py.uv.version}：${upstream}`);
  const bytes = await getBytes(upstream, "uv");
  if (typeof size === "number" && bytes.length !== size) {
    throw new Error(`uv 体积 ${bytes.length} 与清单的 ${size} 不符 —— 字节丢弃`);
  }
  const got = createHash("sha256").update(bytes).digest("hex");
  if (got !== sha256) throw new Error(`uv sha256 ${got} 与清单的 ${sha256} 不符 —— 字节丢弃`);
  writeFileSync(zip, bytes);
  // Windows 10 起自带 bsdtar，认 zip；失败再退到 PowerShell。构建脚本零依赖。
  const untar = spawnSync("tar", ["-xf", zip, "-C", uvHome], { stdio: "inherit", windowsHide: true });
  if (untar.status !== 0) {
    const ps = spawnSync(
      "powershell",
      ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${uvHome}' -Force`],
      { stdio: "inherit", windowsHide: true },
    );
    if (ps.status !== 0) throw new Error("解压 uv 失败（tar 与 Expand-Archive 都不行）");
  }
  rmSync(zip, { force: true });
  if (!existsSync(uvExe)) throw new Error(`解压后没有 ${uvExe}`);
  // 许可证正文随件 —— 与获取通道同一条纪律：缺一条就不算装好。
  for (const name of py.uv.licenseFiles ?? []) {
    const url = `https://raw.githubusercontent.com/astral-sh/uv/${py.uv.version}/${name}`;
    writeFileSync(join(uvHome, name), await getBytes(url, name));
  }
  console.log(`[seed-uv-cache] uv ${py.uv.version} 就位，sha256 与清单一致，许可证 ${(py.uv.licenseFiles ?? []).join(" / ")} 已随件`);
}

mkdirSync(cacheDir, { recursive: true });
mkdirSync(pythonDir, { recursive: true });
const env = {
  ...process.env,
  UV_CACHE_DIR: cacheDir,
  UV_PYTHON_INSTALL_DIR: pythonDir,
  UV_NO_PROGRESS: "1",
};

function uv(argv, { offline = false, extraEnv } = {}) {
  console.log(`[seed-uv-cache] uv ${argv.join(" ")}`);
  const res = spawnSync(uvExe, argv, { env: { ...env, ...extraEnv }, stdio: "inherit", windowsHide: true });
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
// **用运行时那条一模一样的命令去预热，只是不带 `--offline`。**
// 先前这里是 `uv tool install`，那是错的：它把 venv 装进 UV_TOOL_DIR（包外的
// 用户目录），缓存里并没有留下 uvx 解析得到的东西 —— 隔离复核当场戳穿：
// 「excel-mcp-server was not found in the cache」。缓存要被写成什么样，只有
// 真正读它的那条命令说了算，所以预热与运行必须是同一条命令。
for (const l of seeds) {
  const warmTools = mkdtempSync(join(tmpdir(), "ruyin-uv-warm-"));
  try {
    uv(["tool", "run", "--from", `${l.package}==${l.version}`, l.bin ?? l.package, "--help"], {
      extraEnv: { UV_TOOL_DIR: warmTools },
    });
  } finally {
    rmSync(warmTools, { recursive: true, force: true });
  }
}

// 2.5 裁掉随包用不上的部分。**裁完必须再过一次下面的离线复核** —— 裁剪的风险
//     全在「以为用不上」，而唯一能反驳它的是断网真起一次。
{
  const before = dirSize(uvHome);
  const drop = [
    // uv 的 GUI 变体：我们只从守护进程里以子进程方式起它，永远不用这个。
    join(uvHome, process.platform === "win32" ? "uvw.exe" : "uvw"),
    // `sdists-v9` 只在从源码构建时有东西；随包的全是 wheel，所以它是空的。
    // **`simple-v24` 不能裁** —— 试过：裁掉之后 `uv tool run --offline` 直接失败。
    // 它是 PyPI 的索引元数据，而 uvx 每次都要**重新解析**一遍 `包==版本` 到具体
    // 的依赖集（uvx 起的是临时环境，不是装好的那一个）。这一条是隔离复核抓出来的：
    // 在没隔离之前它「通过」了，靠的是构建机上 %APPDATA%\uv\tools 里的残留。
    join(cacheDir, "sdists-v9"),
  ];
  for (const dir of fs.readdirSync(pythonDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const root = join(pythonDir, dir.name);
    // Tk / IDLE / 标准库自测：MCP 服务器不画窗口，也不跑 CPython 自己的测试。
    drop.push(join(root, "tcl"), join(root, "Lib", "tkinter"), join(root, "Lib", "idlelib"), join(root, "Lib", "test"));
  }
  for (const p of drop) rmSync(p, { recursive: true, force: true });
  const after = dirSize(uvHome);
  console.log(`[seed-uv-cache] 裁掉 ${((before - after) / 1048576).toFixed(1)} MB（GUI 变体 / 索引元数据 / Tk / IDLE / 自测），剩 ${(after / 1048576).toFixed(1)} MB`);
}

// 3. **离线复核**：这一步才是 `launch.offline.cacheSeeded: true` 的凭据。
//    只把 wheel 放进缓存不算数 —— 断网时真起得来才算，而两者不是同一回事
//    （缺一个传递依赖、缺一个解释器，都要到 --offline 这一跑才现形）。
{
  // **复核要在一个空的 tool 目录里做。** `uv tool install` 把 venv 装到了
  // `%APPDATA%\uv\tools`（包外，本机实测 93 MB）—— 如果复核时还能看见它，
  // 那这一步证明的是「这台构建机上能起」，不是「随包这棵树自己够」。差别正是
  // 客户机器上起不起得来。
  const probeTools = mkdtempSync(join(tmpdir(), "ruyin-uv-toolprobe-"));
  try {
    for (const l of seeds) {
      uv(["tool", "run", "--offline", "--from", `${l.package}==${l.version}`, l.bin ?? l.package, "--help"], {
        offline: true,
        extraEnv: { UV_TOOL_DIR: probeTools },
      });
    }
  } finally {
    rmSync(probeTools, { recursive: true, force: true });
  }
}

console.log(
  `[seed-uv-cache] OK - uv ${py.uv.version} + CPython ${py.cpython.version} + ${seeds.length} 个包的 wheel 已就位（${uvHome}），` +
    `且每一个都在 --offline 下真起过一次。`,
);
