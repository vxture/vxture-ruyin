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
 *
 * 另外两条，任何时候都查（owner 2026-09-03 定：按行业最简单的那套）：
 *   - **步调一致**：四个包同一个版本号，tag 就是那个版本号（`packages-v0.2.0`），
 *     不用记谁是哪一版。版本号只允许 `X.Y.Z` 或 `X.Y.Z-(alpha|beta|rc).N`。
 *   - **`--tag packages-vX.Y.Z`**（发布工作流传入）：tag 号必须等于包版本号 ——
 *     推 `packages-v0.2.0` 而包里还是 0.1.0，会以 0.2.0 的名义发出一份没人升过的包。
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

const VERSION_SHAPE = /^\d+\.\d+\.\d+(?:-(alpha|beta|rc)\.\d+)?$/;

const argv = process.argv.slice(2);
const tagFlag = argv.indexOf("--tag");
const releaseTag = tagFlag >= 0 ? argv[tagFlag + 1] : undefined;
if (tagFlag >= 0 && !releaseTag) {
  console.error("[versions] --tag needs a tag name");
  process.exit(2);
}
const baselineFlag = argv.indexOf("--baseline");
let baseline = baselineFlag >= 0 ? argv[baselineFlag + 1] : undefined;
if (baselineFlag >= 0 && !baseline) {
  console.error("[versions] --baseline needs a ref");
  process.exit(2);
}

// -- Always: one version across the publishable packages, in the allowed shape,
// and (when publishing) equal to the tag. These need no baseline.
{
  const pkgs = readdirSync(pkgRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => JSON.parse(readFileSync(join(pkgRoot, e.name, "package.json"), "utf8")))
    .filter((j) => !j.private);
  const early = [];
  for (const j of pkgs) {
    if (!VERSION_SHAPE.test(j.version)) {
      early.push(`${j.name}: version "${j.version}" is not X.Y.Z or X.Y.Z-(alpha|beta|rc).N`);
    }
  }
  const versions = new Set(pkgs.map((j) => j.version));
  if (versions.size > 1) {
    early.push("packages are not in lockstep: " + pkgs.map((j) => j.name + "@" + j.version).join(", ") + " - one version for all four, the tag is that version");
  }
  if (releaseTag) {
    const m = /^packages-v(.+)$/.exec(releaseTag);
    if (!m) early.push(`tag "${releaseTag}" is not packages-vX.Y.Z`);
    else if (versions.size === 1 && !versions.has(m[1])) {
      early.push(`tag ${releaseTag} says ${m[1]} but the packages say ${[...versions][0]} - bump the packages or tag the version that is in the tree`);
    }
  }
  if (early.length > 0) {
    console.error("[versions]:");
    for (const p of early) console.error(`  - ${p}`);
    process.exit(1);
  }
  if (releaseTag) console.log(`[versions] tag ${releaseTag} matches the packages' version`);
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
