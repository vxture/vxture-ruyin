#!/usr/bin/env node
/**
 * 版本守卫（W5，owner 2026-09-03 定：手工版本 + 守卫，不上 changesets）。
 *
 * 口径：版本写在各包的 package.json，推 `packages-v*` tag 发布，已发的版本跳过。
 * 这套口径有一个安静的失败方式 —— **包的内容改了、版本号没动**：发布流水线看见
 * 「已发过 0.1.0」就跳过，消费方拿到的还是旧包，而流水线全绿。这道守卫就拦这一件。
 *
 * 基线 = 最近一次 `packages-v*` tag（那是上一次真正发出去的内容）。对每个要发布
 * 的包：基线以来 `packages/<dir>` 有改动（*.test.ts 除外 —— 测试不进消费方手里）
 * 而 package.json 的 version 与基线相同 → 报错；version 比基线还小 → 报错。
 *
 * 依赖方不强制跟着升：B 发过的那版钉着当时的 A，semver 上是成立的；B 自己没改就
 * 不用重发。守卫只对依赖方给一句提示。
 *
 * 还没有任何 `packages-v*` tag 时什么都没发过，也就没有「发过的内容」可比 —— 如实
 * 说明后通过，而不是拿一个假基线装作检查过。`--baseline <ref>` 可指定别的基线
 * （本地自查、或故意弄坏来验证守卫本身）。
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const pkgRoot = join(repoRoot, "packages");

function git(...args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

function compareVersions(a, b) {
  const pa = a.split(".").map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(".").map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

const argv = process.argv.slice(2);
const baselineFlag = argv.indexOf("--baseline");
let baseline = baselineFlag >= 0 ? argv[baselineFlag + 1] : undefined;
if (baselineFlag >= 0 && !baseline) {
  console.error("[versions] --baseline needs a ref");
  process.exit(2);
}

if (!baseline) {
  // Newest packages-v* tag by version sort; the tag itself is the baseline.
  const tags = git("tag", "--list", "packages-v*", "--sort=-v:refname")
    .split("\n")
    .filter(Boolean);
  if (tags.length === 0) {
    console.log(
      "[versions] no packages-v* tag yet - nothing has been published, so there is no published content to compare against. Passing, honestly.",
    );
    process.exit(0);
  }
  baseline = tags[0];
}

let baselineSha;
try {
  baselineSha = git("rev-parse", "--verify", `${baseline}^{commit}`);
} catch {
  console.error(`[versions] baseline ${baseline} is not a commit this checkout knows (shallow clone without tags?)`);
  process.exit(1);
}

const packages = readdirSync(pkgRoot, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => {
    const j = JSON.parse(readFileSync(join(pkgRoot, e.name, "package.json"), "utf8"));
    return { dir: e.name, name: j.name, version: j.version, private: !!j.private, deps: Object.keys(j.dependencies ?? {}) };
  })
  .filter((p) => !p.private);

function versionAt(ref, dir) {
  try {
    return JSON.parse(git("show", `${ref}:packages/${dir}/package.json`)).version;
  } catch {
    return undefined; // package did not exist at the baseline
  }
}

function changedSince(ref, dir) {
  const out = git("diff", "--name-only", ref, "HEAD", "--", `packages/${dir}`);
  return out
    .split("\n")
    .filter(Boolean)
    .filter((f) => !/\.test\.tsx?$/.test(f));
}

const problems = [];
const bumped = new Set();
const notes = [];

for (const p of packages) {
  const before = versionAt(baselineSha, p.dir);
  const changed = changedSince(baselineSha, p.dir);
  if (before === undefined) {
    notes.push(`${p.name}: new since ${baseline} (${p.version}) - first publish`);
    bumped.add(p.name);
    continue;
  }
  const cmp = compareVersions(p.version, before);
  if (cmp < 0) {
    problems.push(`${p.name}: version ${p.version} is lower than ${before} at ${baseline} - versions do not go backwards`);
    continue;
  }
  if (cmp > 0) {
    bumped.add(p.name);
    continue;
  }
  if (changed.length > 0) {
    problems.push(
      `${p.name}: ${changed.length} file(s) changed since ${baseline} but version is still ${p.version} - ` +
        `the publish pipeline skips already-published versions, so consumers would keep getting the old package. ` +
        `First: ${changed.slice(0, 3).join(", ")}${changed.length > 3 ? ", ..." : ""}`,
    );
  }
}

// Advisory only: a dependent that did not change keeps pinning the old upstream, which semver allows.
for (const p of packages) {
  const upstreamBumped = p.deps.filter((d) => bumped.has(d));
  if (upstreamBumped.length > 0 && !bumped.has(p.name)) {
    notes.push(`${p.name}: depends on ${upstreamBumped.join(", ")} which bumped; its published copy will keep pinning the older version until it is republished`);
  }
}

for (const n of notes) console.log(`[versions] note: ${n}`);
if (problems.length > 0) {
  console.error(`[versions] baseline ${baseline}:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`[versions] OK - ${packages.length} publishable package(s) checked against ${baseline}`);
