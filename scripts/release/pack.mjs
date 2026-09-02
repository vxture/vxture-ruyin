#!/usr/bin/env node
/**
 * Installer pack orchestration (workplan W4; design 30-design/70 section 7.2):
 *
 *   pnpm -r build
 *     -> pnpm deploy --legacy the daemon (self-contained node_modules incl.
 *        native modules and workspace packages) into apps/shell/out/daemon
 *     -> scripts/native/sqlite-electron-binding.mjs: electron-ABI prebuilt of
 *        better-sqlite3-multiple-ciphers into that tree (TD-010)
 *     -> electron-builder (nsis, or --dir for an unpacked smoke build)
 *     -> launch the packaged app with --smoke: it must actually start
 *
 * Usage: node scripts/release/pack.mjs [--dir]
 *   --dir  build the unpacked win-unpacked/ tree only (fast) instead of the
 *          NSIS installer. The packaged smoke check runs either way.
 *
 * GFW note: local runs may need ELECTRON_MIRROR and
 * ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
 */

import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const shellDir = join(repoRoot, "apps", "shell");
const daemonOut = join(shellDir, "out", "daemon");
const dirOnly = process.argv.includes("--dir");

function run(cmd, args, cwd) {
  console.log(`[pack] ${cmd} ${args.join(" ")}`);
  const res = spawnSync(cmd, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32", // .cmd shims on Windows
  });
  if (res.status !== 0) {
    console.error(`[pack] FAILED: ${cmd} ${args.join(" ")}`);
    process.exit(res.status ?? 1);
  }
}

// Ensure a full dev install first (a previous run's deploy step may have
// left the workspace production-pruned).
run("pnpm", ["install", "--prefer-offline"], repoRoot);
run("pnpm", ["--recursive", "build"], repoRoot);

rmSync(daemonOut, { recursive: true, force: true });
run(
  "pnpm",
  [
    "--filter",
    "@vxture/ruyin-local-host",
    "deploy",
    "--prod",
    "--legacy",
    // Hoisted, so the deployed tree contains no symlinks. pnpm's default
    // isolated layout puts every real package under .pnpm/ and links to it;
    // electron-builder copies extraResources by dereferencing, so each linked
    // package lands as a plain directory OUTSIDE its .pnpm home - and its
    // siblings, which is where its own dependencies lived, do not come with
    // it. The app then starts and dies on "Cannot find package 'ajv'".
    // A tree with no links copies the same either way.
    "--config.node-linker=hoisted",
    daemonOut,
  ],
  repoRoot,
);

// `pnpm deploy --prod` production-installs the WHOLE workspace as a side
// effect, stripping devDependencies (including electron-builder). Restore
// them before packaging.
run("pnpm", ["install", "--prefer-offline"], repoRoot);

// TD-010: the daemon runs inside Electron's bundled Node (utilityProcess),
// whose ABI differs from the host Node that `pnpm deploy` fetched the
// better-sqlite3-multiple-ciphers prebuilt for. Fetch the electron-ABI
// prebuilt (for the electron version installed under apps/shell - the same
// one electron-builder packages) into the deployed tree, next to the host
// binding; storage.ts selects it at runtime. Runs after the restore so the
// electron package is resolvable again.
run(
  "node",
  [
    join(repoRoot, "scripts", "native", "sqlite-electron-binding.mjs"),
    "--module-dir",
    daemonOut,
  ],
  repoRoot,
);

run(
  "pnpm",
  ["exec", "electron-builder", "--win", ...(dirOnly ? ["--dir"] : [])],
  shellDir,
);

// Prove the thing we just built actually starts.
//
// Everything above this line can succeed while producing an app that dies on
// launch: the deployed dependency tree, the native binding ABI and the
// resource layout are all only exercised by running it. This exact check is
// what a missing transitive dependency looks like from the outside - the
// installer builds, installs, and the window never appears.
//
// The unpacked tree is produced by both modes, so this runs either way.
const packagedExe = join(shellDir, "release", "win-unpacked", "Ruyin.exe");
console.log(`[pack] smoke: ${packagedExe} --smoke`);
const smoke = spawnSync(packagedExe, ["--smoke"], {
  cwd: shellDir,
  encoding: "utf8",
});
const smokeOut = `${smoke.stdout ?? ""}${smoke.stderr ?? ""}`;
process.stdout.write(smokeOut);

// 起不来和不许起，是两件事。
//
// spawn 本身失败（Windows 上 errno UNKNOWN）说明这个 exe 连被执行的机会都没
// 拿到，是被某条策略挡在门外，而不是应用自己崩了。把它报成「应用起不来」会把
// 人送去查依赖树和原生绑定，那里什么问题都没有。
//
// **但别把原因写死成「未签名所以被拦」** —— 那是 TD-025 原本的判断，2026-09-02
// 实测推翻了：本机 Smart App Control 开着强制，打出来的 exe 确认未签名，照样
// 正常启动。SAC 拦的是**带 Mark-of-the-Web（下载来源标记）**的文件，本地构建
// 产物没有这个标记。所以这里只说「被策略挡住了」，并把该看的东西列出来，不替
// 用户断定是哪一条 —— 一句听起来笃定的错诊断，比不诊断更费时间。
if (smoke.error) {
  const blocked = smoke.error.code === "UNKNOWN";
  console.error(
    blocked
      ? "[pack] FAILED: 这个 exe 没能被执行（spawn errno UNKNOWN）—— 它是被某条\n" +
          "       策略挡在门外的，不是应用崩了。打包产物本身因此没被验证过。\n" +
          "       该查：① 文件有没有 Mark-of-the-Web（`Get-Item <exe> -Stream\n" +
          "       Zone.Identifier`）—— Smart App Control 拦的是带下载标记的文件，\n" +
          "       本地构建产物通常没有；② 杀毒/EDR 的隔离记录；③ 企业 WDAC 策略。\n" +
          "       打包形态由 CI 的 packaged-smoke 兜底验证。"
      : `[pack] FAILED: could not launch the packaged app: ${smoke.error.message}`,
  );
  process.exit(1);
}
if (!smokeOut.includes("[shell-smoke] OK")) {
  console.error(
    "[pack] FAILED: the packaged app did not start. It builds but does not run;" +
      " see the output above.",
  );
  process.exit(1);
}

// 打包形态下主密钥必须由 DPAPI 保护。
//
// KeyManager 在 DPAPI 不可用时会退到明文文件 —— 开发机上这是对的（那台机器
// 可能不是 Windows），但**装到用户机器上的那一份不该有这条退路**：
// `@primno/dpapi` 是原生模块，它在部署树里解析不到的样子和「这台机器没有
// DPAPI」一模一样，而后果是每一个新安装都拿到一把明文主密钥。
//
// 启动时那行日志一直都在打，只是从来没有人断言过它。跑起来了不等于跑对了。
if (process.platform === "win32") {
  const protection = /\[ruyin\] master key protection: (\w+)/.exec(smokeOut);
  if (protection?.[1] !== "dpapi") {
    console.error(
      `[pack] FAILED: 打包后的主密钥保护是 ${protection?.[1] ?? "(没报)"}，不是 dpapi。\n` +
        "       多半是 @primno/dpapi 在部署树里解析不到 —— 那看起来就像「这台\n" +
        "       机器没有 DPAPI」，而每一个新安装都会拿到一把明文主密钥。",
    );
    process.exit(1);
  }
}

// 图标真的贴上去了没有。
//
// **配了图标不等于贴上了。** electron-builder 是在「编辑可执行文件」那一步写入
// 图标的，而 `signAndEditExecutable: false` 关掉的正是那一步 —— 于是 `icon:`
// 配得好好的、构建全绿、装出来还是 Electron 的原子标，中间一句提示都没有。
// 这个仓库栽在这上面过一次，是把图标从 exe 里抠出来看才发现的。
//
// 判据：图标里的某一档 PNG 原样出现在 exe 的资源里。rcedit 对 PNG 编码的档位
// 是照搬字节的，所以逐帧找一遍，有一帧对上就说明这一步真的跑了。
if (process.platform === "win32") {
  const icoPath = join(shellDir, "icons", "icon.ico");
  const ico = readFileSync(icoPath);
  const exe = readFileSync(packagedExe);
  const frames = [];
  for (let i = 0; i < ico.readUInt16LE(4); i++) {
    const o = 6 + i * 16;
    frames.push({
      size: ico[o] || 256,
      data: ico.subarray(ico.readUInt32LE(o + 12), ico.readUInt32LE(o + 12) + ico.readUInt32LE(o + 8)),
    });
  }
  const found = frames.filter((f) => exe.includes(f.data)).map((f) => f.size);
  if (found.length === 0) {
    console.error(
      "[pack] FAILED: 打包出的 exe 里找不到我们的图标 —— 它多半还挂着 Electron\n" +
        "       的默认原子标。检查 electron-builder.yml 的 `signAndEditExecutable`\n" +
        "       是不是又被关掉了：图标是在那一步写进去的，关着它 `icon:` 完全空转。\n" +
        `       图标源：${icoPath}`,
    );
    process.exit(1);
  }
  console.log(`[pack] icon: ${found.length}/${frames.length} 档在 exe 里对上（${found.join(", ")}px）`);
}

console.log(`[pack] done -> ${join(shellDir, "release")}`);
