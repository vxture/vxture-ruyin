#!/usr/bin/env node
/**
 * 发布顺序守卫（W5）。
 *
 * `pnpm publish` 会把 `workspace:*` 重写成**具体版本**——实测 runtime-core 打出来
 * 的包里写的是 `"@vxture/ruyin-contract-schema": "0.1.0"`。所以顺序不是好习惯，
 * 是必需的：**依赖没先发，这个包在注册表上就指向一个不存在的版本**，而消费方要
 * 到 `npm install` 那一刻才会发现。
 *
 * 这个脚本按 packages/ 里真实的依赖关系拓扑排序，然后与
 * scripts/release/publish-packages.mjs 里写死的顺序比对。**加了新包却忘了排进
 * 顺序表**——那正是这道守卫要拦的事。
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const pkgRoot = join(repoRoot, "packages");

const dirs = readdirSync(pkgRoot, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

const byName = new Map();
for (const dir of dirs) {
  const j = JSON.parse(readFileSync(join(pkgRoot, dir, "package.json"), "utf8"));
  if (j.private) continue; // 不发布的包不参与顺序
  byName.set(j.name, { dir, deps: Object.keys(j.dependencies ?? {}) });
}

// 声明的发布顺序
const script = readFileSync(
  join(repoRoot, "scripts", "release", "publish-packages.mjs"),
  "utf8",
);
const m = script.match(/const ORDER = \[([^\]]*)\]/s);
if (!m) {
  console.error("[publish-order] 找不到 publish-packages.mjs 里的 ORDER");
  process.exit(1);
}
const declared = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);

const problems = [];

// 1. 覆盖：每个要发布的包都得在顺序表里
for (const [name, { dir }] of byName) {
  if (!declared.includes(dir)) {
    problems.push(`${name}（packages/${dir}）不在 ORDER 里 —— 它不会被发布`);
  }
}
for (const dir of declared) {
  if (![...byName.values()].some((v) => v.dir === dir)) {
    problems.push(`ORDER 里的 "${dir}" 不是一个要发布的包`);
  }
}

// 2. 顺序：依赖必须排在前面
const position = new Map(declared.map((d, i) => [d, i]));
for (const [name, { dir, deps }] of byName) {
  for (const dep of deps) {
    const target = byName.get(dep);
    if (!target) continue; // 外部依赖，与顺序无关
    if ((position.get(target.dir) ?? -1) > (position.get(dir) ?? -1)) {
      problems.push(
        `${name} 依赖 ${dep}，但 ${dep} 在 ORDER 里排在它后面 —— ` +
          `发出去的包会指向一个注册表上还不存在的版本`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error("[publish-order] 不合规：");
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(
  `[publish-order] OK - ${declared.length} 个包，依赖均排在依赖方之前。`,
);
