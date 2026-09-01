#!/usr/bin/env node
/**
 * 更新策略守卫（TD-021，owner 定于 2026-09-01）。
 *
 * 三条策略不是实现细节，是 owner 的决定：
 *
 *   1. 有任务在跑就不装
 *   2. 是否更新、何时安装，都归用户 —— 运行时绝不自行下载、自行挑时机
 *   3. 渠道不允许降级
 *
 * 每一条在代码里都只是一行。**一行很容易在别的改动里被顺手改掉，而改掉之后
 * 什么都不会报错** —— 自动下载了、退出时静默装了、降级了，用户只会觉得
 * 「它自己动了」，而没有任何一处会说是谁决定的。
 *
 * 第三条尤其要显式：electron-updater 的 `channel` setter 会把 `allowDowngrade`
 * 自动翻成 true（库文档原话）。而 channel 正是 beta/stable 切换要用的东西 ——
 * 也就是说，未来谁加渠道切换，这条策略会在没人察觉的情况下自己反过来。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const shell = readFileSync(join(repoRoot, "apps/shell/src/main.ts"), "utf8");
const updates = readFileSync(
  join(repoRoot, "apps/local-host/src/updates.ts"),
  "utf8",
);

const problems = [];

/** 必须**显式**写成这样的赋值。吃默认值不算 —— 默认值会变，也会被别处翻掉。 */
const MUST_SET = [
  ["autoUpdater.autoDownload = false", "策略 2：绝不自行下载"],
  ["autoUpdater.autoInstallOnAppQuit = false", "策略 2：退出时静默安装不是用户选的时机"],
  ["autoUpdater.allowDowngrade = false", "策略 3：渠道不允许降级"],
];
for (const [needle, why] of MUST_SET) {
  if (!shell.includes(needle)) {
    problems.push(`壳里找不到 \`${needle}\` —— ${why}`);
  }
}

// 策略 1 的闸门在守护进程（只有它知道有没有任务在跑），壳在重启前再问一次。
if (!/installGate/.test(updates)) {
  problems.push("updates.ts 里没有 installGate —— 策略 1 的闸门不见了");
}
if (!/\/updates\/intent/.test(shell)) {
  problems.push(
    "壳没有在安装前问 /updates/intent —— 只在按钮上禁用是挡误触，不是挡竞态：" +
      "用户点下去到下载完成之间隔着上百 MB，任务完全可能已经起来了",
  );
}

// downloadUpdate 之前必须先 checkForUpdates：库拿的是上一次检查留下的
// updateInfo，没检查过就直接 reject「Please check update first」。
const download = shell.indexOf("autoUpdater.downloadUpdate(");
const check = shell.indexOf("autoUpdater.checkForUpdates(");
if (download >= 0 && (check < 0 || check > download)) {
  problems.push(
    "壳在 checkForUpdates 之前就调 downloadUpdate —— 库会直接拒绝" +
      "（Please check update first），整条安装路径在第一步就断，而用户看到的" +
      "只是一句「更新下载失败」",
  );
}

if (problems.length > 0) {
  console.error("[update-policy] 不合规：");
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    "  这三条是 owner 的决定（TD-021），不是实现细节。要改先改决定。",
  );
  process.exit(1);
}

console.log("[update-policy] OK - 三条更新策略都在代码里显式写着。");
