#!/usr/bin/env node
/**
 * 安装包版本号守卫（RY-001 §07 任务 49；owner 2026-09-18 定）。
 *
 * 钉两件事。
 *
 * ## 一、版本号写在三处，三处必须一致
 *
 * `apps/shell/package.json`（安装包文件名与 CI 的 tag 比对用它）、
 * `apps/local-host/package.json`、以及 `apps/local-host/src/main.ts` 里那个
 * **手写的 `const VERSION`**（守护进程报给界面、检查更新时拿它跟 feed 比）。
 *
 * 三处漂开的后果是安静的：安装包叫 0.2.0，而守护进程自报 0.1.0 —— 于是**每一次
 * 检查更新都说「有新版本」**，用户点了下载，装上，还是「有新版本」。没有任何一处
 * 报错，因为每一处单看都自洽。
 *
 * ## 二、beta 与 stable 的版本号形状（owner 2026-09-18）
 *
 * 测试版带 `-beta.N` 后缀，毕业为正式版时去掉：`1.2.0-beta.1` → `1.2.0-beta.2`
 * → `1.2.0`。**这不是风格问题**：更新检查按 semver 比，而 `1.2.0-beta.3 < 1.2.0`
 * —— 有后缀，测试版用户在正式版出来时会被正确地提示升级；没有后缀，两条渠道的
 * 同一个版本号对应两份不同的字节，客户端分不出谁新谁旧。
 *
 * 允许的形状与包那条守卫（check-package-versions.mjs）保持一致：`X.Y.Z` 或
 * `X.Y.Z-(alpha|beta).N`（owner 2026-09-03：三种足够，不要 rc）。
 *
 * `--tag <tag>` 给发布流水线用：`beta-*` 的 tag 要求版本号**带**预发布后缀，
 * `vX.Y.Z` 要求**不带**且与 tag 相等。没有这一条，那个约定就只活在文档里。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { argv, exit } from "node:process";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const SHAPE = /^\d+\.\d+\.\d+(-(alpha|beta)\.\d+)?$/;

/** main.ts 里那一行 `const VERSION = "x.y.z";`。读不到就是它被改成了别的写法。 */
export function versionInMain(source) {
  return /const VERSION\s*=\s*"([^"]+)"/.exec(source)?.[1];
}

export function problemsFor({ shell, daemon, main, tag }) {
  const problems = [];
  for (const [where, v] of [
    ["apps/shell/package.json", shell],
    ["apps/local-host/package.json", daemon],
    ["apps/local-host/src/main.ts 的 const VERSION", main],
  ]) {
    if (!v) {
      problems.push(`${where}: 读不出版本号`);
    } else if (!SHAPE.test(v)) {
      problems.push(`${where}: 版本号 ${v} 不是 X.Y.Z 或 X.Y.Z-(alpha|beta).N`);
    }
  }
  if (shell && daemon && main && !(shell === daemon && daemon === main)) {
    problems.push(
      `三处版本号不一致：安装包 ${shell} · 守护进程包 ${daemon} · main.ts ${main}。\n` +
        "    安静的后果是「每次检查更新都说有新版本」—— 装上还是有，因为自报的版本永远追不上 feed。",
    );
  }
  if (tag) {
    const pre = shell?.includes("-") ?? false;
    if (tag.startsWith("beta-") && !pre) {
      problems.push(
        `tag ${tag} 是测试版，而版本号 ${shell} 没有预发布后缀。\n` +
          "    测试版必须是 X.Y.Z-beta.N：没有后缀，两条渠道的同一个版本号会对应两份不同的字节，\n" +
          "    而客户端按 semver 比，分不出谁新谁旧（owner 2026-09-18）。",
      );
    }
    if (/^v\d+\.\d+\.\d+$/.test(tag)) {
      if (pre) {
        problems.push(`tag ${tag} 是正式版，而版本号 ${shell} 还带着预发布后缀 —— 毕业就要去掉它。`);
      }
      if (shell && tag.slice(1) !== shell) {
        problems.push(`tag ${tag} 与版本号 ${shell} 不相等。`);
      }
    }
  }
  return problems;
}

const tagAt = argv.indexOf("--tag");
const tag = tagAt >= 0 ? argv[tagAt + 1] : undefined;
const read = (p) => JSON.parse(readFileSync(join(repoRoot, p), "utf8")).version;
const shell = read("apps/shell/package.json");
const daemon = read("apps/local-host/package.json");
const main = versionInMain(readFileSync(join(repoRoot, "apps/local-host/src/main.ts"), "utf8"));

const problems = problemsFor({ shell, daemon, main, ...(tag ? { tag } : {}) });
if (problems.length) {
  console.error(`[app-version] ${problems.length} 处不合规：\n  - ${problems.join("\n  - ")}`);
  exit(1);
}
console.log(`[app-version] OK - 三处版本号一致：${shell}${tag ? `，且与 tag ${tag} 相符` : ""}。`);
