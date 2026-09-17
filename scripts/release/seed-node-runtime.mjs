#!/usr/bin/env node
/**
 * 构建时把一份真 node.exe 随包进 <resources>/node（owner 2026-09-16）。
 *
 * 为什么要有它：清单里 node 形态的服务器过去借 Ruyin.exe 自己 +
 * ELECTRON_RUN_AS_NODE=1 跑——这是能跑，但在 Windows 上会弹出一个空白 cmd
 * 窗口：Electron 的已知限制，`spawn()` 那边已经开着 windowsHide 也压不住这一
 * 种子进程重执行的模式。随包一份真正的 node.exe，直接拿它当 command，就没有
 * 这层重执行，窗口也就不会冒出来。
 *
 * 运行时那一侧的契约在 `apps/local-host/src/tool-servers.ts` 的 nodeExe()：
 * 找不到随包的就退回旧路子（开发态没跑过这一步时的安全网），两边要一起改。
 *
 * 只随两个文件：node.exe 本体、LICENSE 正文。压缩包里的 npm / corepack /
 * CHANGELOG 等都不需要——我们只拿它当纯 JS 运行时用，不用它管包。
 *
 * 用法：node scripts/release/seed-node-runtime.mjs [--out <resources 目录>]
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const manifest = JSON.parse(readFileSync(join(repoRoot, "resources", "skill-manifest.json"), "utf8"));
const args = process.argv.slice(2);
const resourcesDir = args.includes("--out") ? resolve(args[args.indexOf("--out") + 1]) : join(repoRoot, "resources");
const nodeHome = join(resourcesDir, "node");
const rt = manifest.nodeRuntime;

if (process.platform !== "win32") {
  console.log("[seed-node-runtime] 非 Windows 构建机——node 形态的窗口问题只在 Windows 上存在，跳过");
  process.exit(0);
}

if (!rt?.version) {
  console.error("[seed-node-runtime] 清单里没有 nodeRuntime——这一版不带随包 node.exe");
  process.exit(1);
}

const nodeExe = join(nodeHome, "node.exe");
if (existsSync(nodeExe)) {
  console.log(`[seed-node-runtime] ${nodeExe} 已在，跳过取回`);
  process.exit(0);
}

/**
 * 取字节，网络抖动要重试：一次 ECONNRESET 让整条发布链失败，换来的不是安全，是重跑
 * 一遍 CI —— 而钉死的哈希在下面把关，重试多少次都改变不了「取到的必须是那一份」。
 * 退到 curl 也不是因为 curl 更可信，是 Node 的 fetch 在某些网络上到 GitHub 的 release
 * 主机直接超时，而同一地址 curl 通（2026-09-06 本机实测）。
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
      console.warn(`[seed-node-runtime] 取 ${what} 失败，重试：${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
  const tmp = join(nodeHome, ".fetch.part");
  mkdirSync(nodeHome, { recursive: true });
  const curl = spawnSync("curl", ["-fsSL", "--retry", "3", "-o", tmp, url], { stdio: "inherit", windowsHide: true });
  if (curl.status === 0 && existsSync(tmp)) {
    const bytes = readFileSync(tmp);
    rmSync(tmp, { force: true });
    console.log(`[seed-node-runtime] ${what}：Node 的 fetch 不通，curl 取到了`);
    return bytes;
  }
  rmSync(tmp, { force: true });
  throw new Error(`取 ${what} 失败（fetch 与 curl 都不行）：${last instanceof Error ? last.message : String(last)}`);
}

const { sha256, size, upstream } = rt;
if (!/^https:\/\//.test(upstream ?? "")) throw new Error("nodeRuntime.upstream 必须是 https");
if (!/^[0-9a-f]{64}$/.test(sha256 ?? "")) throw new Error("nodeRuntime.sha256 没有钉死");

mkdirSync(nodeHome, { recursive: true });
console.log(`[seed-node-runtime] 取 node.js ${rt.version}：${upstream}`);
const bytes = await getBytes(upstream, "node.js");
if (typeof size === "number" && bytes.length !== size) {
  throw new Error(`node.js 体积 ${bytes.length} 与清单的 ${size} 不符——字节丢弃`);
}
const got = createHash("sha256").update(bytes).digest("hex");
if (got !== sha256) throw new Error(`node.js sha256 ${got} 与清单的 ${sha256} 不符——字节丢弃`);

const zip = join(nodeHome, "node-download.zip");
writeFileSync(zip, bytes);

// 解压到 nodeHome 自己底下（与 zip 同一个盘），不借道系统临时目录——那边多半是
// 另一个盘（本机 C: vs 仓库所在的 D:），之后把文件搬进 nodeHome 时
// fs.renameSync 跨盘会直接报 EXDEV。
const dirName = `node-v${rt.version}-win-x64`;
const extractedRoot = join(nodeHome, dirName);
try {
  rmSync(extractedRoot, { recursive: true, force: true });
  // Windows 10 起自带 bsdtar，认 zip；失败再退到 PowerShell。构建脚本零依赖。
  const untar = spawnSync("tar", ["-xf", zip, "-C", nodeHome], { stdio: "inherit", windowsHide: true });
  if (untar.status !== 0 || !existsSync(extractedRoot)) {
    const ps = spawnSync(
      "powershell",
      ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${nodeHome}' -Force`],
      { stdio: "inherit", windowsHide: true },
    );
    if (ps.status !== 0) throw new Error("解压 node.js 失败（tar 与 Expand-Archive 都不行）");
  }
  const extractedExe = join(extractedRoot, "node.exe");
  if (!existsSync(extractedExe)) throw new Error(`解压后没有 ${extractedExe}`);
  // 只随这两个文件——npm / corepack / CHANGELOG 等一律不进包（见文件头注释）。
  renameSync(extractedExe, nodeExe);
  for (const name of rt.licenseFiles ?? ["LICENSE"]) {
    const extractedFile = join(extractedRoot, name);
    if (!existsSync(extractedFile)) throw new Error(`解压后没有 ${extractedFile}`);
    renameSync(extractedFile, join(nodeHome, name));
  }
} finally {
  rmSync(extractedRoot, { recursive: true, force: true });
  rmSync(zip, { force: true });
}

if (!existsSync(nodeExe)) throw new Error(`解压后没有 ${nodeExe}`);
console.log(`[seed-node-runtime] node.js ${rt.version} 就位（${nodeExe}），sha256 与清单一致，许可证 ${(rt.licenseFiles ?? ["LICENSE"]).join(" / ")} 已随件`);
