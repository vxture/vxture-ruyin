#!/usr/bin/env node
/**
 * 把 packages/ 发到 GitHub Packages（W5）。
 *
 * 三件刻意的事：
 *
 * **1. 顺序固定，依赖在前。** `runtime-core` 与 `cli` 都依赖
 * `contract-schema`（workspace:*，pnpm 发布时重写成实际版本）。先发依赖，否则
 * 发出去的包会指向一个**注册表上还不存在的版本**——消费方装的时候才会发现。
 *
 * **2. 已存在的版本跳过，但要说出来。** npm 的版本不可变，重发同一版本必然失败。
 * 跳过是对的；**静默跳过不是**——「流水线全绿、其实什么都没发」是这里最坏的结局。
 * 所以逐个报告，并且**一个都没发成就整体失败**：推了个 tag 却什么也没发生，是
 * 出错了，不是成功。
 *
 * **3. dist-tag 按版本号定，不靠人记。** 行业惯例：`latest` 是 `npm install 包名`
 * 不带版本时装到的那个，只能指向正式版；预发布版用 semver 后缀
 * （`1.2.0-beta.1` / `-rc.1` / `-alpha.1`）并以同名 dist-tag 发布，`^1.2.0` 这类范围
 * 默认不会匹配到它。npm 的默认行为是每次 publish 都把 latest 移到新发的版本上 ——
 * 发预发布版忘了带 --tag，全世界的 npm install 就都装到预发布版。这里从版本号推
 * tag，没有第二个要记的地方。
 *
 * **4. 不做 dry-run 之外的补救。** 发布不可撤销，所以拦截只能发生在发布之前
 * （工作流里的构建与测试）；发到一半失败就如实退出，让人看着现场处理，不要
 * 自作主张回滚——npm 上没有回滚这回事。
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/** 依赖在前。改动这个顺序前先想清楚谁依赖谁。 */
const ORDER = ["contract-schema", "document", "runtime-core", "cli"];

function pkg(dir) {
  return JSON.parse(
    readFileSync(join(repoRoot, "packages", dir, "package.json"), "utf8"),
  );
}

/**
 * 版本号 → dist-tag。`0.1.0` → latest；`1.2.0-beta.1` → beta；`-rc.N` → rc；
 * `-alpha.N` → alpha。别的后缀不认：那是拼错了，不是新渠道。
 */
export function distTagFor(version) {
  const m = /^\d+\.\d+\.\d+(?:-(alpha|beta|rc)\.\d+)?$/.exec(version);
  if (!m) throw new Error(`version "${version}" is not X.Y.Z or X.Y.Z-(alpha|beta|rc).N`);
  return m[1] ?? "latest";
}

function publishedVersions(name) {
  try {
    const out = execFileSync(
      "npm",
      ["view", name, "versions", "--json", "--registry", "https://npm.pkg.github.com"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const parsed = JSON.parse(out);
    return new Set(Array.isArray(parsed) ? parsed : [parsed]);
  } catch {
    // 包还没发过第一版：注册表上没有它，不是错误。
    return new Set();
  }
}

const published = [];
const skipped = [];

for (const dir of ORDER) {
  const { name, version } = pkg(dir);
  if (publishedVersions(name).has(version)) {
    skipped.push(`${name}@${version}`);
    console.log(`[publish] skip ${name}@${version} - already on the registry`);
    continue;
  }
  const tag = distTagFor(version);
  console.log(`[publish] ${name}@${version} -> dist-tag ${tag}`);
  execFileSync("pnpm", ["--filter", name, "publish", "--no-git-checks", "--tag", tag], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  published.push(`${name}@${version}`);
}

console.log("");
console.log(`[publish] published: ${published.join(", ") || "(none)"}`);
console.log(`[publish] skipped:   ${skipped.join(", ") || "(none)"}`);

if (published.length === 0) {
  console.error(
    "[publish] FAILED: nothing was published. Every package version already " +
      "exists on the registry - bump the versions you meant to release, or " +
      "this tag did nothing. A green run that shipped nothing is the failure " +
      "this check exists to prevent.",
  );
  process.exit(1);
}
