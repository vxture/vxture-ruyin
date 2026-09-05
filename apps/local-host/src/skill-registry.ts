/**
 * 技能登记册（ADR-018 §2.3）—— 四层目录，近者优先。
 *
 *   预置 bundled      随安装包来的（构建时按 resources/skill-manifest.json 拉取，
 *                     packaged: <resources>/skills；开发: 仓内 resources/skills）
 *   产品分发 distributed  产品能力面经 Runos 转交的（<dataDir>/skills/distributed/<产品>/）
 *   用户 user          用户自己放进来的（<dataDir>/skills/user/）
 *   项目 project       只对这个项目生效的（<dataDir>/projects/<id>/skills/）
 *
 * 同名时近者优先，近层整体盖住远层（dsh 的分层规则）。**预置层就地读取、不复制
 * 进数据目录**：复制一份等于多一份会过期的副本，而应用更新时「刷新预置层」就
 * 变成一次同步 —— 就地读，更新装完它自然就是新的。启用 / 停用状态单独落在
 * <dataDir>/skills/state.json 里，所以不动预置文件也能记住用户的选择。
 *
 * 格式是 Agent Skills 开放规范（agentskills.io）：SKILL.md 前言 name /
 * description 必填，license / compatibility / metadata / allowed-tools 可选。
 * 一份坏的 SKILL.md **警告并跳过**，不让它拖垮整个目录（ADR-018 §2.8）。
 *
 * `allowed-tools` 读进来、显示出来，**不当作放行依据** —— 放行只听 Tool Gate
 * （§2.6）。`scripts/` 本地不跑也不读（TD-005）。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  checkResourcePath,
  type SkillDocument,
  type SkillLayer,
  type SkillResource,
  type SkillSummary,
  type SkillsPort,
} from "@vxture/ruyin-core";

/** Agent Skills 名字：小写字母、数字、单个连字符，≤64。目录名须等于它。 */
export const SKILL_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const LAYER_ORDER: readonly SkillLayer[] = ["bundled", "distributed", "user", "project"];

/** 一次读回来的资源上限：references 是给模型读的说明，不是数据集。 */
const MAX_RESOURCE_BYTES = 256 * 1024;
/** 最多列多少个资源文件：清单进对话，太长等于把整个目录塞进回合。 */
const MAX_RESOURCES = 200;
/** 当作文本读回去的扩展名；其余按「不可读」如实回答，不解码成乱码。 */
const TEXT_EXTENSIONS = new Set([
  ".md", ".markdown", ".txt", ".yaml", ".yml", ".json", ".csv", ".xml", ".html", ".htm",
  ".svg", ".tex", ".rst", ".toml", ".ini",
]);
/** 扫描缓存：用户层目录随时会变，但同一次请求里几百个目录不该扫两遍。 */
const DEFAULT_TTL_MS = 2_000;

export interface SkillFrontMatter {
  name: string;
  description: string;
  license?: string;
  version?: string;
  allowedTools?: string[];
  compatibility?: string;
}

export type ParsedSkill =
  | { ok: true; meta: SkillFrontMatter; content: string }
  | { ok: false; reason: string };

/**
 * 解析 SKILL.md 的前言。返回的 `content` 是原文（含前言）：模型读的是作者
 * 写的那一份，不是我们转述的。
 */
export function parseSkillMd(raw: string): ParsedSkill {
  const text = raw.replace(/^﻿/, "").replaceAll("\r\n", "\n");
  if (!text.startsWith("---\n")) return { ok: false, reason: "SKILL.md must start with a --- front matter block" };
  const end = text.indexOf("\n---", 4);
  if (end < 0) return { ok: false, reason: "front matter is not closed" };
  let fm: unknown;
  try {
    fm = parseYaml(text.slice(4, end));
  } catch (cause) {
    return { ok: false, reason: `front matter is not YAML: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
  if (!fm || typeof fm !== "object") return { ok: false, reason: "front matter must be a mapping" };
  const m = fm as Record<string, unknown>;
  const name = m["name"];
  if (typeof name !== "string" || !SKILL_NAME_RE.test(name) || name.length > 64) {
    return { ok: false, reason: `name must be kebab-case and at most 64 characters (got ${JSON.stringify(name)})` };
  }
  const description = m["description"];
  if (typeof description !== "string" || !description.trim()) {
    return { ok: false, reason: "description is required" };
  }
  if (description.length > 1024) return { ok: false, reason: "description must be at most 1024 characters" };
  const meta: SkillFrontMatter = { name, description: description.trim() };
  if (typeof m["license"] === "string") meta.license = m["license"];
  if (typeof m["compatibility"] === "string") meta.compatibility = m["compatibility"];
  const allowed = m["allowed-tools"];
  if (typeof allowed === "string") meta.allowedTools = allowed.split(/\s+/).filter(Boolean);
  else if (Array.isArray(allowed)) meta.allowedTools = allowed.map(String);
  const metadata = m["metadata"];
  const version =
    (metadata && typeof metadata === "object" && (metadata as Record<string, unknown>)["version"]) ??
    m["version"];
  if (typeof version === "string" || typeof version === "number") meta.version = String(version);
  return { ok: true, meta, content: text };
}

/** 界面与 GET /skills 看到的一条。 */
export interface SkillView {
  name: string;
  description: string;
  layer: SkillLayer;
  /** 预置：清单来源 id；产品分发：产品 id；用户 / 项目：目录名。 */
  source: string;
  version?: string;
  license?: string;
  /** 预置三档之一（default / installed-disabled / runos-registered）；别的层没有。 */
  tier?: string;
  enabled: boolean;
  /** 被更近的一层（或同层更靠前的一条）同名技能盖住：那一条生效，这一条不生效。 */
  shadowedBy?: SkillLayer;
  /** 带 scripts/ 目录：本地不跑（TD-005），标出来而不是悄悄跳过。 */
  hasScripts: boolean;
  /** 前言里的 allowed-tools，只展示，不作放行依据。 */
  allowedTools?: string[];
  dir: string;
}

export interface SkillLayerInfo {
  layer: SkillLayer;
  dir?: string;
  present: boolean;
  count: number;
}

export interface SkillListing {
  items: SkillView[];
  layers: SkillLayerInfo[];
  scannedAt: string;
}

interface Entry {
  name: string;
  description: string;
  layer: SkillLayer;
  source: string;
  version?: string;
  license?: string;
  tier?: string;
  hasScripts: boolean;
  allowedTools?: string[];
  dir: string;
}

/** 构建脚本写在预置根下的索引（scripts/release/pull-skills.mjs）。 */
export interface BundledIndex {
  generatedAt?: string;
  sources?: Array<{ id: string; repo?: string; commit?: string; license?: string; tier?: string }>;
  skills?: Array<{ source: string; name: string; dir: string; tier?: string; license?: string; hasScripts?: boolean }>;
  servers?: unknown[];
}

interface State {
  enabled: string[];
  disabled: string[];
}

export interface SkillRegistryOptions {
  /** 预置层根目录；不存在就是没有预置层（开发机没拉过）。 */
  bundledDir?: string | undefined;
  dataDir: string;
  projectSkillsDir?: (projectId: string) => string;
  log?: (line: string) => void;
  ttlMs?: number;
}

function stateKey(e: { layer: SkillLayer; source: string; name: string }): string {
  return `${e.layer}:${e.source}:${e.name}`;
}

export class SkillRegistry implements SkillsPort {
  private readonly stateFile: string;
  private readonly distributedRoot: string;
  private readonly userRoot: string;
  private readonly ttl: number;
  private machine?: { at: number; entries: Entry[] };
  private readonly projects = new Map<string, { at: number; entries: Entry[] }>();
  private readonly log: (line: string) => void;

  constructor(private readonly options: SkillRegistryOptions) {
    this.stateFile = join(options.dataDir, "skills", "state.json");
    this.distributedRoot = join(options.dataDir, "skills", "distributed");
    this.userRoot = join(options.dataDir, "skills", "user");
    this.ttl = options.ttlMs ?? DEFAULT_TTL_MS;
    this.log = options.log ?? (() => {});
  }

  get bundledDir(): string | undefined {
    return this.options.bundledDir && existsSync(this.options.bundledDir) ? this.options.bundledDir : undefined;
  }
  get distributedDir(): string {
    return this.distributedRoot;
  }
  get userDir(): string {
    return this.userRoot;
  }
  projectDir(projectId: string): string {
    return this.options.projectSkillsDir?.(projectId) ?? join(this.options.dataDir, "projects", projectId, "skills");
  }

  /** 预置索引（含 MCP 服务器定义），没有预置层时为空。 */
  bundledIndex(): BundledIndex | undefined {
    const dir = this.bundledDir;
    if (!dir) return undefined;
    const file = join(dir, "index.json");
    if (!existsSync(file)) return undefined;
    try {
      return JSON.parse(readFileSync(file, "utf8")) as BundledIndex;
    } catch (cause) {
      this.log(`[ruyin] skills: bundled index unreadable: ${cause instanceof Error ? cause.message : String(cause)}`);
      return undefined;
    }
  }

  /** 让下一次读取重新扫描（用户加了目录、分发层刷新过）。 */
  refresh(): void {
    this.machine = undefined;
    this.projects.clear();
  }

  // ── SkillsPort ───────────────────────────────────────────────────────────

  async resolve(name: string, projectId: string): Promise<SkillSummary | undefined> {
    const e = this.effective(projectId).get(name);
    return e ? summaryOf(e) : undefined;
  }

  async read(name: string, projectId: string): Promise<SkillDocument | undefined> {
    const e = this.effective(projectId).get(name);
    if (!e) return undefined;
    let content: string;
    try {
      content = readFileSync(join(e.dir, "SKILL.md"), "utf8").replace(/^﻿/, "");
    } catch {
      return undefined;
    }
    return { ...summaryOf(e), content, resources: listResources(e.dir) };
  }

  async readResource(name: string, path: string, projectId: string): Promise<SkillResource> {
    const e = this.effective(projectId).get(name);
    if (!e) return { kind: "unavailable", reason: `skill "${name}" is not available` };
    // 内核查过一次；这里再查一次 —— 只在一层存在的防线，在有人加第二个调用方时就不存在了。
    const checked = checkResourcePath(path);
    if (!checked.ok) return { kind: "unavailable", reason: checked.reason };
    const root = resolve(e.dir);
    const file = resolve(root, checked.path);
    if (!file.startsWith(root + sep)) return { kind: "unavailable", reason: `path "${path}" leaves the skill directory` };
    let size: number;
    try {
      const st = statSync(file);
      if (!st.isFile()) return { kind: "unavailable", reason: `"${path}" is not a file` };
      size = st.size;
    } catch {
      return { kind: "unavailable", reason: `no such resource "${path}" in skill "${name}"` };
    }
    if (!TEXT_EXTENSIONS.has(extname(file).toLowerCase())) {
      return { kind: "unavailable", reason: `"${path}" is not a text resource (${extname(file) || "no extension"})` };
    }
    const bytes = readFileSync(file);
    const truncated = size > MAX_RESOURCE_BYTES;
    const text = (truncated ? bytes.subarray(0, MAX_RESOURCE_BYTES) : bytes).toString("utf8");
    return truncated ? { kind: "text", text, truncated: true } : { kind: "text", text };
  }

  // ── 界面 / API ───────────────────────────────────────────────────────────

  list(projectId?: string): SkillListing {
    const entries = this.entries(projectId);
    const state = this.readState();
    const chosen = this.choose(entries, state);
    const items: SkillView[] = entries.map((e) => {
      const enabled = this.isEnabled(e, state);
      const winner = chosen.get(e.name);
      const view: SkillView = {
        name: e.name,
        description: e.description,
        layer: e.layer,
        source: e.source,
        enabled,
        hasScripts: e.hasScripts,
        dir: e.dir,
      };
      if (e.version) view.version = e.version;
      if (e.license) view.license = e.license;
      if (e.tier) view.tier = e.tier;
      if (e.allowedTools) view.allowedTools = e.allowedTools;
      if (enabled && winner && winner !== e) view.shadowedBy = winner.layer;
      return view;
    });
    const layers: SkillLayerInfo[] = LAYER_ORDER.filter((l) => l !== "project" || projectId).map((layer) => {
      const dir =
        layer === "bundled"
          ? this.bundledDir
          : layer === "distributed"
            ? this.distributedRoot
            : layer === "user"
              ? this.userRoot
              : this.projectDir(projectId!);
      const info: SkillLayerInfo = {
        layer,
        present: dir !== undefined && existsSync(dir),
        count: entries.filter((e) => e.layer === layer).length,
      };
      if (dir) info.dir = dir;
      return info;
    });
    return { items, layers, scannedAt: new Date().toISOString() };
  }

  /** 启动日志用：每层几条。 */
  counts(): Record<SkillLayer, number> {
    const out: Record<SkillLayer, number> = { bundled: 0, distributed: 0, user: 0, project: 0 };
    for (const e of this.machineEntries()) out[e.layer]++;
    return out;
  }

  /**
   * 启用 / 停用一条。键是 (layer, source, name)：同一层里两个来源可能带同名技能
   * （两个仓都收了 playwright-skill），只按名字开关会一起动。
   */
  setEnabled(target: { layer: SkillLayer; source: string; name: string }, enabled: boolean): SkillView {
    const entries = this.entries();
    const e = entries.find((x) => x.layer === target.layer && x.source === target.source && x.name === target.name);
    if (!e) throw new SkillNotFoundError(`skill "${target.name}" (${target.layer}/${target.source}) is not installed`);
    const state = this.readState();
    const key = stateKey(e);
    state.enabled = state.enabled.filter((k) => k !== key);
    state.disabled = state.disabled.filter((k) => k !== key);
    // 只记与默认相反的选择：默认启用的记 disabled，默认停用的（装而不启用）记 enabled。
    if (enabled && !this.defaultEnabled(e)) state.enabled.push(key);
    if (!enabled && this.defaultEnabled(e)) state.disabled.push(key);
    mkdirSync(join(this.options.dataDir, "skills"), { recursive: true });
    writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
    const view = this.list().items.find((v) => v.layer === e.layer && v.source === e.source && v.name === e.name);
    if (!view) throw new Error("unreachable: entry vanished between write and list");
    return view;
  }

  // ── 扫描 ─────────────────────────────────────────────────────────────────

  private entries(projectId?: string): Entry[] {
    const machine = this.machineEntries();
    if (!projectId) return machine;
    const now = Date.now();
    let cached = this.projects.get(projectId);
    if (!cached || now - cached.at > this.ttl) {
      cached = { at: now, entries: this.scanRoot(this.projectDir(projectId), "project", 1, () => "project") };
      this.projects.set(projectId, cached);
    }
    return [...machine, ...cached.entries];
  }

  private machineEntries(): Entry[] {
    const now = Date.now();
    if (this.machine && now - this.machine.at <= this.ttl) return this.machine.entries;
    const entries = [
      ...this.scanBundled(),
      ...this.scanRoot(this.distributedRoot, "distributed", 2, (dir) => productOf(this.distributedRoot, dir)),
      ...this.scanRoot(this.userRoot, "user", 1, () => "user"),
    ];
    this.machine = { at: now, entries };
    return entries;
  }

  private scanBundled(): Entry[] {
    const root = this.bundledDir;
    if (!root) return [];
    const index = this.bundledIndex();
    if (!index?.skills) return this.scanRoot(root, "bundled", 2, (dir) => productOf(root, dir));
    const out: Entry[] = [];
    const tierOf = new Map((index.sources ?? []).map((s) => [s.id, s.tier]));
    const licenseOf = new Map((index.sources ?? []).map((s) => [s.id, s.license]));
    for (const item of index.skills) {
      const dir = resolve(root, item.dir);
      const entry = this.readEntry(dir, "bundled", item.source);
      if (!entry) continue;
      entry.tier = item.tier ?? tierOf.get(item.source) ?? "default";
      const license = item.license ?? licenseOf.get(item.source);
      if (license) entry.license = license;
      if (item.hasScripts !== undefined) entry.hasScripts = item.hasScripts;
      out.push(entry);
    }
    return out;
  }

  private scanRoot(root: string, layer: SkillLayer, depth: number, sourceOf: (dir: string) => string): Entry[] {
    if (!existsSync(root)) return [];
    const out: Entry[] = [];
    const walk = (dir: string, left: number) => {
      if (existsSync(join(dir, "SKILL.md"))) {
        const e = this.readEntry(dir, layer, sourceOf(dir));
        if (e) out.push(e);
        return;
      }
      if (left === 0) return;
      let names: string[];
      try {
        names = readdirSync(dir, { withFileTypes: true })
          .filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "node_modules")
          .map((d) => d.name)
          .sort();
      } catch {
        return;
      }
      for (const name of names) walk(join(dir, name), left - 1);
    };
    walk(root, depth);
    return out;
  }

  private readEntry(dir: string, layer: SkillLayer, source: string): Entry | undefined {
    let raw: string;
    try {
      raw = readFileSync(join(dir, "SKILL.md"), "utf8");
    } catch (cause) {
      this.log(`[ruyin] skills: skipped ${dir}: ${cause instanceof Error ? cause.message : String(cause)}`);
      return undefined;
    }
    const parsed = parseSkillMd(raw);
    if (!parsed.ok) {
      // 坏文件警告并跳过，不让一份坏技能拖垮整个目录（ADR-018 §2.8）。
      this.log(`[ruyin] skills: skipped ${dir}: ${parsed.reason}`);
      return undefined;
    }
    const entry: Entry = {
      name: parsed.meta.name,
      description: parsed.meta.description,
      layer,
      source,
      hasScripts: existsSync(join(dir, "scripts")),
      dir,
    };
    if (parsed.meta.version) entry.version = parsed.meta.version;
    if (parsed.meta.license) entry.license = parsed.meta.license;
    if (parsed.meta.allowedTools) entry.allowedTools = parsed.meta.allowedTools;
    return entry;
  }

  // ── 生效判定 ─────────────────────────────────────────────────────────────

  private effective(projectId: string): Map<string, Entry> {
    return this.choose(this.entries(projectId), this.readState());
  }

  /** 近者优先：按层从远到近扫，近层整体盖住远层；同层里先扫到的先算。 */
  private choose(entries: Entry[], state: State): Map<string, Entry> {
    const chosen = new Map<string, Entry>();
    for (const layer of LAYER_ORDER) {
      const here = new Set<string>();
      for (const e of entries) {
        if (e.layer !== layer || !this.isEnabled(e, state) || here.has(e.name)) continue;
        here.add(e.name);
        chosen.set(e.name, e);
      }
    }
    return chosen;
  }

  private defaultEnabled(e: Entry): boolean {
    return e.tier !== "installed-disabled";
  }

  private isEnabled(e: Entry, state: State): boolean {
    const key = stateKey(e);
    if (state.disabled.includes(key)) return false;
    if (state.enabled.includes(key)) return true;
    return this.defaultEnabled(e);
  }

  private readState(): State {
    try {
      const raw = JSON.parse(readFileSync(this.stateFile, "utf8")) as Partial<State>;
      return {
        enabled: Array.isArray(raw.enabled) ? raw.enabled.map(String) : [],
        disabled: Array.isArray(raw.disabled) ? raw.disabled.map(String) : [],
      };
    } catch {
      return { enabled: [], disabled: [] };
    }
  }
}

export class SkillNotFoundError extends Error {}

function summaryOf(e: Entry): SkillSummary {
  return {
    name: e.name,
    description: e.description,
    layer: e.layer,
    ...(e.version ? { version: e.version } : {}),
  };
}

/** `<root>/<product>/<name>` 的 product 段。 */
function productOf(root: string, dir: string): string {
  const rel = resolve(dir).slice(resolve(root).length + 1);
  return rel.split(sep)[0] ?? rel;
}

/** references/ 与 assets/ 下的文件，相对路径、正斜杠、排序、封顶。scripts/ 不列（TD-005）。 */
export function listResources(dir: string): string[] {
  const out: string[] = [];
  const walk = (base: string, rel: string) => {
    let items: import("node:fs").Dirent[];
    try {
      items = readdirSync(join(base, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of items.sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= MAX_RESOURCES) return;
      const r = `${rel}/${d.name}`;
      if (d.isDirectory()) walk(base, r);
      else if (d.isFile()) out.push(r);
    }
  };
  for (const top of ["references", "assets"]) {
    if (existsSync(join(dir, top))) walk(dir, top);
  }
  return out;
}
