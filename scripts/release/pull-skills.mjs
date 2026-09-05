#!/usr/bin/env node
/**
 * 构建时按预置清单拉取技能（ADR-018 §2.3）。
 *
 *   resources/skill-manifest.json  →  resources/skills/<来源 id>/<技能名>/…  +  resources/skills/index.json
 *
 * 每个来源仓按钉死的 commit 稀疏检出（只取 include 里的路径），找出其中每个带
 * SKILL.md 的目录，校验前言（agentskills.io：name kebab ≤64、description 非空
 * ≤1024、目录名 = name），合格的整目录复制过来；许可证文件跟着走（逐技能的
 * LICENSE 优先，否则仓库级的落在来源目录下）。不合格的**警告并跳过**，写进索引
 * 的 skipped 里 —— 不让一份坏技能拖垮整个预置层，也不让它悄悄消失。
 *
 * 经 Runos 注册那一档（runos-registered）不拉：密钥在 Runos 保险库，本机不装。
 * MCP 服务器定义原样抄进 index.json（servers），供工具登记册展示；它们的本机
 * 启动规格还没定（TD-042）。
 *
 * 用法：node scripts/release/pull-skills.mjs [--only <来源 id>] [--force] [--out <目录>]
 *   --only  只拉一个来源（开发时快速试）
 *   --force 已有的也重拉（默认：来源目录已存在且 commit 相同就跳过）
 *
 * 要 git（稀疏检出 + 按 SHA 取）。网络不通就失败退出 —— 装不进包的预置层不该
 * 静默变成「零条」。
 */

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const manifestPath = join(repoRoot, "resources", "skill-manifest.json");
const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;
const force = args.includes("--force");
const outDir = args.includes("--out") ? resolve(args[args.indexOf("--out") + 1]) : join(repoRoot, "resources", "skills");

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

function git(cwd, ...argv) {
  const res = spawnSync("git", argv, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (res.status !== 0) {
    throw new Error(`git ${argv.join(" ")} failed (${res.status}): ${(res.stderr || res.stdout).trim().slice(0, 400)}`);
  }
  return res.stdout;
}

/**
 * 稀疏检出到临时目录：init + 只取那个 commit + 只展开 include 的路径。GitHub 允许
 * 按完整 SHA 取（uploadpack.allowReachableSHA1InWant），所以不必拉整个分支历史。
 */
function checkout(source, work) {
  mkdirSync(work, { recursive: true });
  git(work, "init", "-q");
  git(work, "remote", "add", "origin", source.repo);
  git(work, "config", "core.longpaths", "true");
  const patterns = (source.include ?? ["**"]).map(includeToSparse);
  if (!patterns.includes("/*")) {
    git(work, "sparse-checkout", "init", "--no-cone");
    // 仓库级许可证文件跟着来：许可证是硬门槛，包里每个来源都要带它的那一份。
    git(work, "sparse-checkout", "set", "--no-cone", ...patterns, "/LICENSE*", "/LICENCE*", "/COPYING*");
  }
  git(work, "fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", source.commit);
  git(work, "checkout", "-q", "FETCH_HEAD");
}

/** include 是清单里的目录 glob（`skills/**`、`plugin/skills/xberg`、`**`）→ sparse 模式。 */
function includeToSparse(glob) {
  if (glob === "**" || glob === "**/*") return "/*";
  const dir = glob.replace(/\/\*\*$/, "").replace(/\/\*$/, "");
  return `/${dir}/`;
}

/** include 之内、带 SKILL.md 的目录（不再往下找：技能目录不嵌套）。 */
function findSkillDirs(work, includes) {
  const roots = (includes ?? ["**"]).map((g) => (g === "**" || g === "**/*" ? work : join(work, g.replace(/\/\*\*$/, "").replace(/\/\*$/, ""))));
  const out = new Set();
  const walk = (dir, depth) => {
    if (!existsSync(dir)) return;
    if (existsSync(join(dir, "SKILL.md"))) {
      out.add(dir);
      return;
    }
    if (depth === 0) return;
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      if (!d.isDirectory() || d.name === ".git" || d.name === "node_modules") continue;
      walk(join(dir, d.name), depth - 1);
    }
  };
  for (const r of roots) walk(r, 6);
  return [...out].sort();
}

function frontMatter(text) {
  const t = text.replace(/^﻿/, "").replaceAll("\r\n", "\n");
  if (!t.startsWith("---\n")) return { ok: false, reason: "no front matter" };
  const end = t.indexOf("\n---", 4);
  if (end < 0) return { ok: false, reason: "front matter not closed" };
  const block = t.slice(4, end);
  // 只需要 name 与 description 两个标量；不引入 YAML 库（构建脚本零依赖）。
  const pick = (key) => {
    const m = new RegExp(`^${key}:[ \\t]*(.*)$`, "m").exec(block);
    if (!m) return undefined;
    let v = m[1].trim();
    if (v === ">" || v === "|" || v === ">-" || v === "|-") {
      // 折叠 / 字面块：取后续缩进行
      const lines = block.slice(m.index + m[0].length).split("\n");
      const body = [];
      for (const line of lines) {
        if (line.trim() === "") continue;
        if (!/^\s/.test(line)) break;
        body.push(line.trim());
      }
      v = body.join(" ");
    }
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    return v;
  };
  const name = pick("name");
  const description = pick("description");
  if (!name || !NAME_RE.test(name) || name.length > 64) return { ok: false, reason: `bad name ${JSON.stringify(name)}` };
  if (!description) return { ok: false, reason: "no description" };
  if (description.length > 1024) return { ok: false, reason: "description > 1024" };
  return { ok: true, name, description };
}

/**
 * 只复制规范定义的技能内容：SKILL.md、许可证，以及 scripts/ references/ assets/
 * 三个子目录（agentskills.io）。技能就是整个仓时（include `**`），仓里的测试、
 * 截图、CI 配置都不是技能 —— 照单全收会把两个单技能仓变成 28 MB 的安装包体积。
 */
const SKILL_DIRS = new Set(["scripts", "references", "assets"]);
/**
 * 单个文件的上限。一个技能仓的 assets/ 里放着 14 MB 的演示照片和一段 mp3 ——
 * 那是作者的展示品，不是技能。超过的不进包，索引里记 dropped，用户看得见。
 */
const MAX_FILE_BYTES = 1024 * 1024;
const dropped = [];
const JUNK_DIRS = new Set([".git", "node_modules", "__pycache__", ".venv", "venv", ".pytest_cache"]);
function isSkillContent(root, p) {
  const rel = relative(root, p);
  if (!rel) return true; // 根目录本身
  const parts = rel.split(sep);
  if (parts.some((x) => JUNK_DIRS.has(x))) return false;
  let allowed;
  if (parts.length === 1) {
    const name = parts[0];
    allowed = name === "SKILL.md" || /^(LICENSE|LICENCE|COPYING|NOTICE)(\.|$)/i.test(name) || SKILL_DIRS.has(name);
  } else {
    allowed = SKILL_DIRS.has(parts[0]);
  }
  if (!allowed) return false;
  const st = statSync(p);
  if (st.isFile() && st.size > MAX_FILE_BYTES && parts[parts.length - 1] !== "SKILL.md") {
    dropped.push({ path: rel.split(sep).join("/"), bytes: st.size });
    return false;
  }
  return true;
}

/** 仓库 URL 的最后一段（去掉 .git）：单技能仓的「目录名」。 */
function repoName(url) {
  return url.replace(/\/+$/, "").replace(/\.git$/, "").split("/").pop() ?? "";
}

function findLicense(dir) {
  const hit = readdirSync(dir).find((f) => /^(LICENSE|LICENCE|COPYING)(\.|$)/i.test(f));
  return hit ? join(dir, hit) : undefined;
}

function dirSize(dir) {
  let n = 0;
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    n += d.isDirectory() ? dirSize(p) : statSync(p).size;
  }
  return n;
}

const sources = manifest.skills.filter((s) => s.kind === "skill-source" && s.tier !== "runos-registered" && (!only || s.id === only));
if (only && sources.length === 0) {
  console.error(`[pull-skills] no such source: ${only}`);
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
const indexFile = join(outDir, "index.json");
const previous = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, "utf8")) : { sources: [], skills: [], skipped: [] };

const index = {
  generatedAt: new Date().toISOString(),
  manifestVersion: manifest.version,
  sources: [],
  skills: [],
  skipped: [],
  servers: manifest.servers ?? [],
};

if (only) {
  for (const s of previous.sources ?? []) if (s.id !== only) index.sources.push(s);
  for (const s of previous.skills ?? []) if (s.source !== only) index.skills.push(s);
  for (const s of previous.skipped ?? []) if (s.source !== only) index.skipped.push(s);
}

let failures = 0;
for (const source of sources) {
  const target = join(outDir, source.id);
  const prior = previous.sources?.find((s) => s.id === source.id);
  const stale = !prior || prior.commit !== source.commit || !existsSync(target);
  if (!force && !stale) {
    console.log(`[pull-skills] ${source.id}: up to date (${source.commit.slice(0, 7)})`);
    index.sources.push(prior);
    for (const s of previous.skills.filter((x) => x.source === source.id)) index.skills.push(s);
    for (const s of (previous.skipped ?? []).filter((x) => x.source === source.id)) index.skipped.push(s);
    continue;
  }
  const work = mkdtempSync(join(tmpdir(), "ruyin-skill-pull-"));
  try {
    process.stdout.write(`[pull-skills] ${source.id}: fetching ${source.repo} @ ${source.commit.slice(0, 7)} … `);
    checkout(source, work);
    const dirs = findSkillDirs(work, source.include);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    const repoLicense = findLicense(work);
    if (repoLicense) cpSync(repoLicense, join(target, "LICENSE"));
    let taken = 0;
    for (const dir of dirs) {
      const fm = frontMatter(readFileSync(join(dir, "SKILL.md"), "utf8"));
      const rel = relative(work, dir).split(sep).join("/");
      if (!fm.ok) {
        index.skipped.push({ source: source.id, path: rel, reason: fm.reason });
        continue;
      }
      // 规范要求目录名 = name。技能就是整个仓时，「目录」是仓本身，名字取仓名。
      // 不合的跳过 —— 收进来再改名等于替作者改了它的身份。
      const dirName = dir === work ? repoName(source.repo) : basename(dir);
      // 目录名 ≠ name 的照收（按前言 name 落目录，登记册也按它认 —— dsh 同样如此），
      // 但在索引里记一条 warning：这是来源仓对规范的偏离，不该悄悄被抹平。
      const warning = dirName !== fm.name ? `directory "${dirName}" != name "${fm.name}"` : undefined;
      const dest = join(target, fm.name);
      if (existsSync(dest)) {
        index.skipped.push({ source: source.id, path: rel, reason: `duplicate name "${fm.name}" within source` });
        continue;
      }
      dropped.length = 0;
      cpSync(dir, dest, { recursive: true, filter: (p) => isSkillContent(dir, p) });
      const droppedHere = dropped.map((d) => ({ ...d }));
      const own = findLicense(dir);
      const hasScripts = existsSync(join(dir, "scripts"));
      index.skills.push({
        source: source.id,
        name: fm.name,
        description: fm.description,
        dir: `${source.id}/${fm.name}`,
        tier: source.tier,
        license: source.license,
        licenseFile: own ? `${source.id}/${fm.name}/${basename(own)}` : repoLicense ? `${source.id}/LICENSE` : null,
        hasScripts,
        bytes: dirSize(dest),
        ...(warning ? { warning } : {}),
        ...(droppedHere.length ? { dropped: droppedHere } : {}),
      });
      taken++;
    }
    index.sources.push({ id: source.id, repo: source.repo, commit: source.commit, license: source.license, tier: source.tier, skills: taken });
    console.log(`${taken} skill(s)${dirs.length - taken ? `, ${dirs.length - taken} skipped` : ""}`);
    if (taken === 0) {
      console.error(`[pull-skills]   WARNING: ${source.id} yielded no skills - include patterns: ${JSON.stringify(source.include)}`);
    }
  } catch (cause) {
    failures++;
    console.log("FAILED");
    console.error(`[pull-skills]   ${cause instanceof Error ? cause.message : String(cause)}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// 清单里已经不在的来源目录，删掉：预置层是清单的投影。
for (const d of readdirSync(outDir, { withFileTypes: true })) {
  if (d.isDirectory() && !manifest.skills.some((s) => s.id === d.name)) {
    rmSync(join(outDir, d.name), { recursive: true, force: true });
    console.log(`[pull-skills] removed ${d.name} (no longer in the manifest)`);
  }
}

writeFileSync(indexFile, JSON.stringify(index, null, 2));
const total = index.skills.length;
const withScripts = index.skills.filter((s) => s.hasScripts).length;
console.log(
  `[pull-skills] ${total} skills from ${index.sources.length} sources -> ${outDir} (${withScripts} with scripts/, not run locally: TD-005; ${index.skipped.length} skipped)`,
);
for (const s of index.skipped) console.log(`[pull-skills]   skipped ${s.source}:${s.path}: ${s.reason}`);
for (const s of index.skills.filter((x) => x.warning)) console.log(`[pull-skills]   warning ${s.source}/${s.name}: ${s.warning}`);
for (const s of index.skills.filter((x) => x.dropped)) {
  console.log(`[pull-skills]   dropped ${s.dropped.length} file(s) > ${MAX_FILE_BYTES / 1024 / 1024} MB from ${s.source}/${s.name}: ${s.dropped.map((d) => d.path).join(", ")}`);
}
if (failures) {
  console.error(`[pull-skills] ${failures} source(s) failed`);
  process.exit(1);
}
if (total === 0) {
  console.error("[pull-skills] no skills were pulled - the bundled layer would be empty");
  process.exit(1);
}
