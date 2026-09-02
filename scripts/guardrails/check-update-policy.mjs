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

import { readFileSync, readdirSync } from "node:fs";
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
