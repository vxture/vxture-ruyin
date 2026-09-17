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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  denyWrites,
  describeIdentity,
  describeTreeWrites,
  diffTree,
  judgeReadOnlySmoke,
  parseUiSelfCheck,
  snapshotTree,
} from "./pack-smoke.mjs";

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

// 只读演练的锁先在一个空目录上自证一次（TD-062 第 2 条）。
//
// 真正的演练要在 8 分钟的安装 / 构建 / 打包之后才跑到；锁在这台 runner 上根本锁不住的
// 话（#244 在 CI 上红了三轮才看清是这件事），8 分钟后才知道太贵。空目录放在 release/
// 旁边，与解包树同一个卷 —— ACL 的行为是卷的事，换到 %TEMP%（C:）验了不算。Windows 上
// 锁不住就红，并把每种写法、锁着时的 ACL、身份与特权一起打出来；POSIX 上以 root 跑如实
// 说 SKIPPED（真演练那一步也会跳过）。
{
  const scratch = join(shellDir, "release", `.ro-selftest-${process.pid}`);
  mkdirSync(join(scratch, "sub"), { recursive: true });
  let lock;
  try {
    lock = denyWrites(scratch, [scratch, join(scratch, "sub")]);
    lock.restore();
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  console.log(`[pack] 只读演练自证:\n${lock.log}`);
  if (!lock.effective) {
    if (process.platform === "win32") {
      console.error(`[pack] FAILED: 只读演练的锁在这台机器上锁不住 —— 真演练没法做。\n${describeIdentity(join(shellDir, "release"))}`);
      process.exit(1);
    }
    console.log(`[pack] 只读演练自证 SKIPPED: ${lock.how} 挡不住当前身份（多半是 root）`);
  } else {
    console.log(`[pack] 只读演练自证: ${lock.how} 锁得住、恢复得回`);
  }
}

// Ensure a full dev install first (a previous run's deploy step may have
// left the workspace production-pruned).
run("pnpm", ["install", "--prefer-offline"], repoRoot);
run("pnpm", ["--recursive", "build"], repoRoot);

// 随包第三方组件的许可声明全文（TD-058）：守护进程与界面的生产依赖、外加 Electron。
// **放在 deploy 之前**：下面的 `pnpm deploy --prod` 会把整个工作区的开发依赖剥掉，
// Electron 就在其中 —— 那之后再扫，这一条就静静地少了。清单本身有 CI 守着
// （lint:third-party），这里只写全文，由 electron-builder 装进 resources/。
mkdirSync(join(shellDir, "out"), { recursive: true });
run(
  "node",
  [join(repoRoot, "scripts", "release", "third-party.mjs"), "--full", join(shellDir, "out", "THIRD-PARTY-NOTICES.txt")],
  repoRoot,
);

// 预置技能层（ADR-018 §2.3）：按 resources/skill-manifest.json 拉到 resources/skills，
// electron-builder 再把它连同 index.json 与许可证一起装进 resources/skills。
// 拉不到就失败 —— 装不进包的预置层不该静默变成「零条」。开发机上想跳过
// （没网、只验壳）：RUYIN_SKIP_SKILL_PULL=1，下面的冒烟断言随之放松。
const skillPull = process.env["RUYIN_SKIP_SKILL_PULL"] !== "1";
if (skillPull) {
  run("node", [join(repoRoot, "scripts", "release", "pull-skills.mjs")], repoRoot);
  // 预置的 MCP 服务器（node 形态 vendored 进 resources/tools；TD-042）。
  run("node", [join(repoRoot, "scripts", "release", "pull-tools.mjs")], repoRoot);
  // **Python 半边不在这里了**（2026-09-18，TD-042 ②）：uv + CPython + 预取缓存
  // 那 219 MB 从安装包里整个拿掉，改成用户点一次才落到本机（owner 2026-09-17 定性
  // 「安装包小一些，租户按照需求，安装必要环境」）。装它的那段代码搬进了守护进程的
  // apps/local-host/src/python-runtime.ts，seed-uv-cache.mjs 随之退出构建。
  // 随包真 node.exe：node 形态的服务器借它起，避免 ELECTRON_RUN_AS_NODE 重执行
  // 在 Windows 上弹出空白 cmd 窗口。它自己核 node.exe 的 sha256。
  run("node", [join(repoRoot, "scripts", "release", "seed-node-runtime.mjs")], repoRoot);
} else {
  console.log("[pack] skill/tool pull SKIPPED (RUYIN_SKIP_SKILL_PULL=1) - the bundled layers are whatever resources/skills and resources/tools hold");
}

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
    // The workspace patches app-builder-lib (#19, TD-068), a build-time
    // dependency the daemon's production tree does not contain. pnpm treats a
    // patch it cannot apply as an error (ERR_PNPM_UNUSED_PATCH), so without
    // this the deploy fails. Relaxed here only: the regular install stays
    // strict, and the template check before electron-builder below is what
    // proves the patch is actually in the installer.
    "--config.allow-unused-patches=true",
    daemonOut,
  ],
  repoRoot,
);

// ---------------------------------------------------------------------------
// 构建印：这个包到底签没签名。
//
// 界面底部那条「未签名」提醒是**判断式**的（关于页），要的是「签了自动消失」。
// 写死一个 false 的话它永远不会消失 —— 那条路从此没人走得到。所以这里按**决定
// 要不要签的那同一个条件**写：electron-builder 在没有证书时只编辑、不签
// （electron-builder.yml 里那段注释写着这件事），而证书来自 CSC_* 环境变量或
// win.certificateFile / certificateSubjectName。
//
// **加了新的签名机制就要回来改这里**，否则包签了而界面还在喊未签名。
// 下面这几个来源不自测（TD-053：pack 明确不补，由 packaged-smoke 端到端走）；
// 冒烟输出的判读另有自测（pack-smoke.test.mjs）。
// ---------------------------------------------------------------------------
const builderYml = readFileSync(join(shellDir, "electron-builder.yml"), "utf8");
const certInYml = /^\s*(certificateFile|certificateSubjectName|certificateSha1):/m.test(builderYml);
const certInEnv = Boolean(
  process.env["CSC_LINK"] ||
    process.env["WIN_CSC_LINK"] ||
    process.env["CSC_NAME"] ||
    process.env["CSC_KEY_PASSWORD"],
);
const codeSigning = certInYml || certInEnv ? "signed" : "unsigned";
// **落在 `dist/` 里，不是 daemon 根上**：守护进程按**自己那个文件所在的目录**去
// 找（`dirname(import.meta.url)`），而打包后的入口是 `resources/daemon/dist/main.js`。
// 第一版写在根上，差一层目录，装机态永远读成 unpackaged —— 下面那条断言就是为了
// 这种错而加的。
writeFileSync(join(daemonOut, "dist", "build-info.json"), JSON.stringify({ codeSigning }, null, 2));
console.log(`[pack] build-info: codeSigning=${codeSigning}`);

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

// 安装向导「下一步」即崩溃的补丁（#19，TD-068）必须真的在 electron-builder 这一次
// 要用的那份模板里。
//
// 原模板 multiUser.nsh 从 SHGetKnownFolderPath 的短缓冲区里固定读 16384 字节，
// System.dll 在 +0x1581 访问违例 —— 只在「本机没有按用户安装记录」时触发，也就是
// **每一个新用户的第一次安装**。CI 的冒烟走静默安装、runner 又每次都是新机器，
// 却一直绿：静默安装不经过向导的离页回调。所以补丁悄悄丢了（升级 electron-builder、
// 换了包管理器的补丁机制）不会有任何一项检查变红，只会在用户手里崩。这里在出包之前
// 读一眼 electron-builder 实际解析到的那份模板，没打上就不出包。
{
  const builderMain = createRequire(join(shellDir, "package.json")).resolve("electron-builder");
  const ablMain = createRequire(builderMain).resolve("app-builder-lib");
  const multiUserNsh = join(dirname(ablMain), "..", "templates", "nsis", "multiUser.nsh");
  const template = readFileSync(multiUserNsh, "utf8");
  // 查的是**那条调用语句**，不是那个片段：补丁自己的注释里就引着原来的写法。
  const overread = template.includes("System::Call '*$2(&w${NSIS_MAX_STRLEN}");
  if (overread || !template.includes("ruyin patch (vxture-ruyin #19)")) {
    console.error(
      `[pack] FAILED: electron-builder 用的 multiUser.nsh 没有打上 #19 的补丁：${multiUserNsh}\n` +
        "       不打补丁出的安装器，新用户第一次点「下一步」就崩（System.dll 0xc0000005）。\n" +
        "       看 pnpm-workspace.yaml 的 patchedDependencies 与 patches/ 下的补丁是否还对得上当前版本（TD-068）。",
    );
    process.exit(1);
  }
  console.log("[pack] installer template: #19 known-folder patch present");
}

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
// 冒烟前的 resources/ 快照：冒烟不许往安装目录里写（断言在下面，TD-062）。
const resourcesDir = join(shellDir, "release", "win-unpacked", "resources");
const resourcesBefore = snapshotTree(resourcesDir);
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

// 冒烟不许往安装目录里写（TD-062）。
//
// uvx 形态曾把 uv 的缓存指向随包的 resources/uv/cache，一次冒烟往里写一万多个文件 ——
// 在可写的 CI 工作区里一切正常，装到 Program Files（nsis 允许用户改安装目录）之后
// 非提权进程写不进去，首次用 Python 形态的服务器就在 --offline 下失败，没有回退。
// 「装到只读位置起不起得来」这件事 CI 的可写工作区永远看不到，所以换个问法：冒烟
// 前后 resources/ 一个字节都不该变。变了，就是有东西该落在数据目录却落在了包里。
{
  const writes = describeTreeWrites(diffTree(resourcesBefore, snapshotTree(resourcesDir)));
  if (writes) {
    console.error(writes);
    process.exit(1);
  }
  console.log(`[pack] 安装目录核对: 冒烟前后 resources/ 未变（${resourcesBefore.size} 个条目）`);
}

// 构建印真的到了打包产物里，而且守护进程**找得到**它。
//
// 这一条防的是一个已经犯过的错：印落在 `daemon/` 根上，而打包后的入口是
// `daemon/dist/main.js`，守护进程按自己的目录去找，差一层，读成 `unpackaged`。
// 后果是关于页底部那条「未签名」提醒**在真安装包里一次都不出现** —— 而
// 「没有提醒」和「已签名」在屏幕上长得一模一样，谁也不会发现。
//
// 断言的是**跑起来的守护进程报了什么**，不是「文件在不在」：文件在而路径对不上
// 时，前者红、后者绿 —— 而那正是当时的情形。
{
  const m = /\[ruyin\] code signing: (\w+)/.exec(smokeOut);
  if (!m) {
    console.error(
      '[pack] FAILED: 守护进程没有报签名状态（缺 "[ruyin] code signing: X" 这一行）',
    );
    process.exit(1);
  }
  if (m[1] !== codeSigning) {
    console.error(
      `[pack] FAILED: 构建印没到位 —— pack 写的是 ${codeSigning}，打包后的守护进程读到的是 ${m[1]}。\n` +
        `       多半是 build-info.json 的落点与守护进程的查找目录对不上\n` +
        `       （入口在 resources/daemon/dist/main.js，印就得在同一层）。`,
    );
    process.exit(1);
  }
  console.log(`[pack] build-info 落位核对: 守护进程读到 codeSigning=${m[1]}`);
}

// 第三方许可声明真的在包里（TD-058）。
//
// extraResources 配了不等于装进去了 —— 源文件不在时 electron-builder 一声不吭地跳过。
// Electron 自带的两份（LICENSE.electron.txt、LICENSES.chromium.html）由 electron-builder
// 放在 exe 旁边；关于页那句「在安装目录下」说的就是它们，这里一并核。
{
  const unpacked = join(shellDir, "release", "win-unpacked");
  const required = [
    [join(unpacked, "resources", "THIRD-PARTY-NOTICES.txt"), "第三方组件许可声明"],
    [join(unpacked, "LICENSES.chromium.html"), undefined],
    [join(unpacked, "LICENSE.electron.txt"), undefined],
  ];
  for (const [file, mustContain] of required) {
    if (!existsSync(file) || statSync(file).size === 0) {
      console.error(`[pack] FAILED: 许可声明不在包里：${file}`);
      process.exit(1);
    }
    if (mustContain && !readFileSync(file, "utf8").includes(mustContain)) {
      console.error(`[pack] FAILED: ${file} 不是 third-party.mjs 写的那份（缺「${mustContain}」）`);
      process.exit(1);
    }
  }
  console.log("[pack] 许可声明落位核对: THIRD-PARTY-NOTICES.txt、LICENSES.chromium.html、LICENSE.electron.txt 都在");
}

// 预置技能层真的在包里。
//
// extraResources 配了不等于装进去了：目录不存在时 electron-builder 一声不吭地跳过；
// 壳没把 RUYIN_SKILLS_DIR 传过去时守护进程会退回仓内路径 —— 装出来的机器上那条路
// 径不存在，于是「预置 270 条」在用户那里是 0 条，而启动日志一直都在打这一行。
{
  const skills = /\[ruyin\] skills: bundled (\d+)/.exec(smokeOut);
  const bundled = skills ? Number(skills[1]) : -1;
  if (bundled < 0) {
    console.error("[pack] FAILED: 守护进程没有报预置技能层（缺 \"[ruyin] skills: bundled N\" 这一行）");
    process.exit(1);
  }
  if (skillPull && bundled === 0) {
    console.error(
      "[pack] FAILED: 打包后的预置技能层是 0 条。拉取跑过了（resources/skills 有东西），\n" +
        "       所以是没装进包（electron-builder.yml 的 extraResources）或壳没传\n" +
        "       RUYIN_SKILLS_DIR（apps/shell/src/main.ts）。",
    );
    process.exit(1);
  }
  console.log(`[pack] bundled skills in the packaged app: ${bundled}`);
}

// 预置的 MCP 服务器真的起得来：守护进程在冒烟时真起一个 vendored 的 node 服务器
// （Electron 当 Node 用）、握手、列工具。拉过就必须起得来；没拉过如实说。
{
  const line = /\[ruyin\] tools self-check: (ok \(([^,]+), (\d+) tool\(s\)\)|no vendored node server to try)/.exec(smokeOut);
  if (!line) {
    console.error("[pack] FAILED: 守护进程没有报预置工具自检（缺 \"[ruyin] tools self-check\" 这一行）");
    process.exit(1);
  }
  if (skillPull && !line[1].startsWith("ok")) {
    console.error("[pack] FAILED: 拉取跑过了，包里却没有一个能试的 vendored 服务器 —— 看 electron-builder.yml 的 resources/tools 与壳的 RUYIN_TOOLS_DIR");
    process.exit(1);
  }
  console.log(`[pack] bundled tool server self-check: ${line[1]}`);
}

// uvx 自检**这一轮必须是「还没装」**（2026-09-18，TD-042 ②）。
//
// 判据翻了个面：以前它必须 `ok`（Python 半边随包，起不来就是包坏了），现在包里
// 一个字节都没有它，所以刚装完的机器上它**只能**是 not installed —— 要是它报了
// `ok`，那说明有什么东西又把 uv 塞回了安装包，或者冒烟捡到了这台构建机上别处的
// uv。两种都是要当场知道的事，而不出错时它们什么都不会说。
{
  const line = /\[ruyin\] uvx self-check: ([^\r\n]*)/.exec(smokeOut);
  if (!line) {
    console.error("[pack] FAILED: 守护进程没有报 uvx 自检（缺 \"[ruyin] uvx self-check\" 这一行）");
    process.exit(1);
  }
  if (!line[1].startsWith("python runtime not installed")) {
    console.error(
      `[pack] FAILED: 刚装完的机器上 uvx 自检不该是「${line[1]}」—— Python 半边不随安装包（TD-042 ②），` +
        "这一行只能是 python runtime not installed。报了别的，就是 uv 又进包了，或者捡到了本机别处的 uv。",
    );
    process.exit(1);
  }
  console.log(`[pack] uvx self-check: ${line[1]}（Python 半边不随包，这正是预期）`);
}

// 安装包里**不许再有 uv**（同上）。上面那条查的是行为，这条查的是字节：
// 一次误提交的 extraResources 会让安装包又胖 219 MB，而冒烟照样全绿。
{
  const stray = join(resourcesDir, "uv");
  if (existsSync(stray)) {
    console.error(
      `[pack] FAILED: 安装目录里出现了 ${stray} —— Python 半边不随安装包（TD-042 ②，owner 2026-09-17 定性）。` +
        "看 electron-builder.yml 的 extraResources。",
    );
    process.exit(1);
  }
}

// 工作台界面真的被守护进程端出来了（TD-061）—— 装进包不等于端得出来。
//
// 壳的 --smoke 在 openWindow() 之前就退出（apps/shell/src/main.ts），窗口要加载的那个
// `/` 在冒烟里从没被请求过；../ui-workspace/dist 不在时 electron-builder 一声不吭地
// 跳过（同上面预置技能层那条）；RUYIN_UI_DIR 指向不存在的目录时守护进程照样起来、
// /health 照样 200，只有 `/` 是 404。所以守护进程在冒烟里自己请求一次 `/`，把页面引用
// 的每个文件都取一遍（apps/local-host/src/ui-self-check.ts），端不出来就退出 1 ——
// 那种情形上面 [shell-smoke] OK 那一关已经拦下；这里断言它报了 ok。**不按 skillPull
// 放宽**：pack 每次都 `pnpm -r build`，界面必然构建过，「没有可端的界面」在这里不成立。
{
  const ui = parseUiSelfCheck(smokeOut);
  if (!ui.ok) {
    console.error(ui.message);
    process.exit(1);
  }
  console.log(`[pack] 工作台界面落位核对: ${ui.detail}`);
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

// 装到只读位置真的起得来（TD-062 的第 2 条；#242 只做了上面快照那一半）。
//
// 「resources/ 未变」证明的是冒烟**没往包里写**，证明不了**包写不了时也起得来**：探一下
// 可写再分岔的代码（uv 自己就这么干）、只在首次种子时才碰包的路径，快照一概看不见。
// 所以再冒一次，条件照 Program Files 那台机器摆：整棵解包树对当前用户拒绝写入（Windows
// 上目录的只读位挡不住建文件，走 ACL；POSIX 走 chmod），数据目录换成一个空的临时目录、
// 指针文件指到一个不存在的位置，让种子不得不从只读的包里重种。判据：壳照样 OK、uvx 自检
// 照样 ok、种子那一行落在临时目录之下（pack-smoke.mjs 的 judgeReadOnlySmoke，配自测）。
//
// 先探一次「拒绝真的生效了吗」：拒绝没生效的演练是在演戏。Windows 上生效不了就红；
// POSIX 上以 root 跑到这里（本仓的 Linux 等价演练）如实说 SKIPPED。做完无论成败都把
// ACL 恢复回来，恢复不了 denyWrites 会抛、并把手动命令放进报错 —— 这棵树接下来还要给
// upload-artifact 和开发者自己用。
{
  const unpacked = join(shellDir, "release", "win-unpacked");
  const lock = denyWrites(unpacked, [unpacked, resourcesDir]);
  if (lock.log) console.log(`[pack] 只读演练锁定: ${lock.log.split(/\r?\n/).join(" | ")}`);
  if (!lock.effective) {
    lock.restore();
    if (process.platform === "win32") {
      console.error(
        `[pack] FAILED: 只读演练没生效 —— ${lock.how} 之后当前身份照样能往 ${unpacked} 里写，这一轮验不了 TD-062。\n` +
          describeIdentity(unpacked),
      );
      process.exit(1);
    }
    console.log(`[pack] 只读演练 SKIPPED: ${lock.how} 挡不住当前身份（多半是 root）；这一条由 CI 的 packaged-smoke 在 Windows 上验。`);
  } else {
    const roDataDir = mkdtempSync(join(tmpdir(), "ruyin-ro-smoke-"));
    console.log(`[pack] 只读演练: ${lock.how} ${unpacked}；空数据目录 ${roDataDir}`);
    let ro;
    try {
      ro = spawnSync(packagedExe, ["--smoke"], {
        cwd: shellDir,
        encoding: "utf8",
        env: {
          ...process.env,
          RUYIN_DATA_DIR: roDataDir,
          RUYIN_LOCATION_FILE: join(roDataDir, "location.json"),
        },
      });
    } finally {
      lock.restore();
    }
    const roOut = `${ro.stdout ?? ""}${ro.stderr ?? ""}`;
    process.stdout.write(roOut);
    // 这一轮种出来的缓存两百兆，用完即弃。删不掉（Windows 上偶有句柄未释放）只提醒：
    // 演练本身已经做完，临时目录留在 %TEMP% 里不该把绿的结果变红。
    try {
      rmSync(roDataDir, { recursive: true, force: true });
    } catch (e) {
      console.warn(`[pack] 只读演练的临时数据目录没删干净（${e instanceof Error ? e.message : String(e)}）：${roDataDir}`);
    }
    if (ro.error) {
      console.error(`[pack] FAILED: 只读演练里应用没能被执行：${ro.error.message}`);
      process.exit(1);
    }
    const verdict = judgeReadOnlySmoke({ smokeOut: roOut, dataDir: roDataDir });
    if (!verdict.ok) {
      console.error(verdict.message);
      process.exit(1);
    }
    // 这一轮也不许往包里写。ACL 只在「写会被拒」这件事上作证；Node 那半边（壳与守护进程）
    // 有没有往包里写，不靠 ACL 猜，仍由快照来判 —— 两条证据各说各的。
    const roWrites = describeTreeWrites(diffTree(resourcesBefore, snapshotTree(resourcesDir)));
    if (roWrites) {
      console.error(roWrites.replace("冒烟往安装目录", "只读演练那一轮往安装目录"));
      process.exit(1);
    }
    console.log(`[pack] 只读演练核对: ${verdict.detail}；resources/ 仍未变`);
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
