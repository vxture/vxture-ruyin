#!/usr/bin/env node
/**
 * 毕业前置：**正式版只能从测试版毕业**（owner 2026-09-18：「不能引起 stable 不稳定就发了」）。
 *
 * 人工审批门已经在了（`production` Environment 的必审人，`publish` job 整个挂在
 * 它下面，v tag 一来 GitHub 在跑任何一步之前就停住）。但**批了只证明有人点过头**，
 * 不证明那一版在测试渠道上真的跑过。这道守卫补的是后面那半句。
 *
 * 判据取自**线上那份 feed**，不是仓里的什么声明：发 `v1.2.0` 之前，测试渠道当前
 * 必须就是 `1.2.0-beta.N`。它同时挡住三件事：
 *
 *   - 从没发过 beta 就直接发正式版；
 *   - beta 上跑的是别的版本线（beta 还停在 1.1.0-beta.3，却要发 1.2.0）；
 *   - 版本号打错一位（要发 1.2.0，而 beta 上是 1.3.0-beta.1）。
 *
 * **不是密码锁，是一次提问。** 真有必须绕过的时候（比如一个不经 beta 的紧急修复），
 * 把仓库变量 `ALLOW_UNPROVEN_STABLE` 设成 `1` —— 那是一个**有人做过的决定**，而且
 * 日志里会把它喊出来。默认没有这个变量，绕过就不会悄悄发生。
 *
 * 用法：node scripts/guardrails/check-graduation.mjs --tag v1.2.0 --beta-feed <url>
 */

import { argv, env, exit } from "node:process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** feed 里那行 `version: x.y.z`。取不到就是这份 feed 不是我们认识的形状。 */
export function versionInFeed(text) {
  return /^version:\s*(\S+)\s*$/m.exec(String(text ?? ""))?.[1];
}

/**
 * 能不能发这个正式版。纯函数：把「线上 beta 是哪一版」当输入，好让它能被测 ——
 * 一道要联网才能验的守卫，多半没人会去验它。
 */
export function graduationProblem({ tag, betaVersion, allowUnproven }) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag ?? "")) return undefined; // 不是正式版 tag，与这条无关
  const want = tag.slice(1);
  if (allowUnproven) return undefined;
  if (!betaVersion) {
    return (
      `要发 ${tag}，但读不到测试渠道当前的版本 —— 无法证明这一版在 beta 上跑过。\n` +
      `    正式版只能从测试版毕业（owner 2026-09-18）。先发一个 ${want}-beta.N 跑一跑；\n` +
      `    真要绕过，把仓库变量 ALLOW_UNPROVEN_STABLE 设成 1（那是一个有人做过的决定）。`
    );
  }
  if (!betaVersion.startsWith(`${want}-`)) {
    return (
      `要发 ${tag}，而测试渠道上当前是 ${betaVersion} —— 对不上。\n` +
      `    正式版只能从同一条版本线的测试版毕业：发 ${tag} 之前，beta 应当是 ${want}-beta.N。\n` +
      `    要么先把 ${want}-beta.N 发到 beta，要么这个 tag 的版本号打错了。`
    );
  }
  return undefined;
}

/**
 * CLI 那一半包在 main() 里：**import 这个模块不许顺带跑一次检查**（更不许把测试
 * 进程 exit 掉 —— 2026-09-18 写完第一版时就是这样，七条用例只跑了一条）。
 */
async function main() {
  const arg = (name) => {
    const at = argv.indexOf(name);
    return at >= 0 ? argv[at + 1] : undefined;
  };

  const tag = arg("--tag");
  if (!/^v\d+\.\d+\.\d+$/.test(tag ?? "")) {
    console.log(`[graduation] ${tag ?? "(没给 tag)"} 不是正式版 tag —— 这一条与它无关。`);
    return 0;
  }

  const allowUnproven = env["ALLOW_UNPROVEN_STABLE"] === "1";
  let betaVersion;
  if (!allowUnproven) {
    const feed = arg("--beta-feed");
    try {
      const res = await fetch(feed, { redirect: "manual" });
      if (res.ok) betaVersion = versionInFeed(await res.text());
      else console.error(`[graduation] 取 ${feed} 回 HTTP ${res.status}`);
    } catch (cause) {
      console.error(`[graduation] 取 ${feed} 失败：${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  const problem = graduationProblem({ tag, betaVersion, allowUnproven });
  if (problem) {
    console.error(`[graduation] 不放行：\n  - ${problem}`);
    return 1;
  }
  console.log(
    allowUnproven
      ? `[graduation] **已绕过**（ALLOW_UNPROVEN_STABLE=1）：${tag} 没有经过测试渠道的验证就要发正式版。`
      : `[graduation] OK - ${tag} 毕业自测试渠道当前的 ${betaVersion}。`,
  );
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  exit(await main());
}
