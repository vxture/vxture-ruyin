#!/usr/bin/env node
/**
 * 更新策略守卫（TD-021，owner 定于 2026-09-02）。
 *
 * **MVP 阶段不做自动更新。** 这不是"还没做到"——曾经整套接过 electron-updater，
 * 后来整段拆掉了。原因是 owner 定了不采购签名证书（TD-001 转 standing），而
 * electron-updater 在 Windows 上默认校验更新包签名：要么关掉那道校验，等于让更新
 * 通道接受任何来自 feed 的包；要么不做自动安装。选了后者。
 *
 * 所以这道守卫的方向和上一版**是反的**。上一版钉的是"自动更新必须按这三条策略
 * 走"；这一版钉的是**"它不许悄悄回来"**，外加检查那一半必须继续诚实。
 *
 * 为什么值得钉：`autoUpdater.autoDownload = true` 是一行的事，而它一旦回来，
 * 用户会在没有任何人做过决定的情况下开始自动下载安装包。**这类东西不出错的时候
 * 什么都不会说**——没有报错、没有告警，只是它自己动了。
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const shellDir = join(repoRoot, "apps", "shell", "src");
const shell = readdirSync(shellDir)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .map((f) => readFileSync(join(shellDir, f), "utf8"))
  .join("\n");
const updates = readFileSync(
  join(repoRoot, "apps", "local-host", "src", "updates.ts"),
  "utf8",
);
const settings = readFileSync(
  join(repoRoot, "apps", "ui-workspace", "src", "settings.tsx"),
  "utf8",
);

const problems = [];

// ---- 一、自动更新不许回来 -------------------------------------------------
//
// 整段拆掉是一个决定，不是一次清理。改回来要先改决定。
for (const [needle, why] of [
  ["electron-updater", "壳里重新引入了 electron-updater"],
  ["autoUpdater", "壳里重新出现了 autoUpdater"],
]) {
  if (shell.includes(needle)) {
    problems.push(
      `${why} —— MVP 阶段不做自动更新（owner 定 2026-09-02）。\n` +
        `    它默认会校验更新包签名，而本仓不签名（TD-001 转 standing）：要么关掉那道\n` +
        `    校验、让更新通道接受任何来自 feed 的包，要么不自动安装。选的是后者。`,
    );
  }
}

// ---- 二、检查那一半必须继续诚实 -------------------------------------------
//
// 这个功能的上一版**不发请求就断言「当前已是最新」并附时间戳**。没查过就说最新，
// 比不提供这个按钮糟得多：它把一个未知说成了一个保证。
if (!/"unreachable"/.test(updates)) {
  problems.push(
    "updates.ts 里没有 `unreachable` 状态 —— 查不到必须是一个独立状态。\n" +
      "    把它折叠进「已是最新」，就是把「没问到」说成「问过了，没有新版本」。",
  );
}
if (!/unreachable/.test(settings) && !/没查到/.test(settings)) {
  problems.push(
    "设置页没有呈现「没查到」这一路 —— 状态存在但界面不显示，等于没有这个状态。",
  );
}

// ---- 三、下载地址必须来自 feed，且必须写明渠道 -----------------------------
//
// 地址若另存一份，迟早和检查用的那份 feed 不一致：用户检查的是 stable，下到的
// 是 beta，而两边各自都"对"。从同一份 feed 拼出来则不可能不一致。
if (!/parsed\.path/.test(updates)) {
  problems.push(
    "updates.ts 不再从 feed 的 `path` 拼下载地址 —— 地址一旦另存一份，就会和\n" +
      "    检查用的那份 feed 漂开：检查 stable、下到 beta，而两边各自都「对」。",
  );
}
if (/https?:\/\/[^\s"'`]*\.exe/.test(settings)) {
  problems.push(
    "设置页里出现了写死的安装包地址 —— 它必须来自守护进程刚校验过的那份 feed。\n" +
      "    猜出来的地址点下去是 404，而用户会以为是产品坏了。",
  );
}
if (!/result\.channel/.test(settings)) {
  problems.push(
    "设置页没有显示渠道 —— **不写明渠道的下载链接是有害的**：用户可能正装上一个\n" +
      "    beta 包而不自知，而他以为自己在用 stable。",
  );
}

// ---- 四、获取通道：只有用户点了才下载（ADR-018 §7.2，TD-042）-------------
//
// 方向和上面那三条是同一条：**这类东西不出错的时候什么都不会说**。一次悄悄发生
// 的 114 MB 下载没有报错、没有告警，只是它自己动了。所以扩这一份而不是另起一份
// 守卫 —— 「自动下载不许悄悄回来」这个决定留在一处。
//
// 反面教材是实测到的：executeautomation 的 dist/toolHandler.js 在启动失败时
// spawn `npx playwright install` —— 一次**模型工具调用**引发 311 MB 无人值守下载。
const componentStore = join(repoRoot, "apps", "local-host", "src", "component-store.ts");
if (existsSync(componentStore)) {
  const store = readFileSync(componentStore, "utf8");
  const NEVER_ACQUIRE = [
    ["apps/local-host/src/main.ts", "启动路径", "应用一起来就开始下载，用户没有做过任何决定"],
    ["apps/local-host/src/tool-executor.ts", "工具执行路径", "模型的一次工具调用引发无人值守下载"],
    ["packages/runtime-core/src/harness.ts", "任务循环", "任务跑到一半自己去下 114 MB"],
  ];
  for (const [file, where, why] of NEVER_ACQUIRE) {
    const full = join(repoRoot, file);
    if (!existsSync(full)) continue;
    const text = readFileSync(full, "utf8");
    // 声明依赖（`components: componentStore`）不算，调用（`.acquire(`）才算。
    if (/\.acquire(FromDir)?\s*\(/.test(text)) {
      problems.push(
        `${file} 里调用了 acquire —— ${where}不许下载任何东西。\n` +
          `    ${why}；契约要的工具落在未获取的载荷后面时，startTask 在开跑前按名拒绝。`,
      );
    }
  }
  // 白名单是**发请求之前**查的一份闭合名单。fetch 缺省的 `redirect: "follow"` 允许
  // 跳 20 次，每一跳都可以落到白名单外的任意主机 —— 那道检查于是只挡住了第一跳，
  // 而它看起来还在。同一类沉默失效：光比 origin 不看协议，一条 http 的 pin 能从
  // 写成 http 的白名单项那里过去，字节走明文，回执上照写 https。
  // 查的是**那次调用**，不是注释里提到这个词：一份把 `redirect: "manual"` 写在
  // 注释里、调用里没有的代码，读起来完全合规。
  if (!/doFetch\((?:[^;]*?)redirect:\s*"manual"/s.test(store)) {
    problems.push(
      'component-store.ts 的下载没有 `redirect: "manual"` —— 缺省的 follow 允许跳 20 次，\n' +
        "    每一跳都可以是白名单外的主机：那份闭合白名单于是只挡住了第一跳。",
    );
  }
  if (!/if\s*\([^)]*protocol\s*!==\s*"https:"/.test(store)) {
    problems.push(
      'component-store.ts 没有检查 `url.protocol !== "https:"` —— `new URL("http://…").origin`\n' +
        "    会匹配上一条写成 http 的白名单项，字节走明文，而回执上写的是 https。",
    );
  }
  // 失败要各说各的，且每一种都要在界面上被渲染 —— 状态存在但界面不显示，等于
  // 没有这个状态（与上面「没查到」那一条同形）。`gone` 与 `unreachable` 分开是同一
  // 条纪律的下一层：把「上游删了这个构建」说成「网络到不了」，用户会一直重试一件
  // 永远不会成的事。
  for (const state of ["unreachable", "gone", "payload-missing", "mismatch", "no-space", "license-missing", "refused-origin", "cancelled"]) {
    if (!store.includes(`"${state}"`)) {
      problems.push(`component-store.ts 里没有 ${state} 这一种失败 —— 折叠进「未获取」，用户就分不清网络到不了与字节被换了`);
    } else if (!settings.includes(state)) {
      problems.push(`设置页没有呈现 ${state} 这一路 —— 状态存在但界面不显示，等于没有这个状态`);
    }
  }
  // 地址只能来自守护进程刚从清单读出的那一份（现有那条 .exe 规则的推广）。
  if (/https?:\/\/[^\s"'`]*\.(zip|tar\.gz|7z)/.test(settings)) {
    problems.push(
      "设置页里出现了写死的组件下载地址 —— 它必须来自守护进程刚从随包清单读出的那一份。\n" +
        "    另存一份就会和清单里那条钉死的 sha256 漂开，而漂开的那一次校验必然失败。",
    );
  }
  // 点之前必须看得见要下多少。
  if (!/downloadBytes/.test(settings)) {
    problems.push(
      "设置页没有显示组件的体积 —— **点之前必须看见要下多少**。\n" +
        "    一个不写明体积的下载按钮，在按流量计费的网络上是有害的。",
    );
  }
}

if (problems.length > 0) {
  console.error("[update-policy] 不合规：");
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    "  这些是 owner 的决定（TD-021），不是实现细节。要改先改决定。",
  );
  process.exit(1);
}

console.log(
  "[update-policy] OK - 不做自动更新；检查诚实（unreachable 独立）；" +
    "下载地址出自 feed 且写明渠道。",
);
