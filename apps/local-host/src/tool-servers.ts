/**
 * 预置的 MCP 服务器（ADR-018 §2.2「工具」；TD-042 的回收）—— 能启动的那一半。
 *
 * 构建时 `scripts/release/pull-tools.mjs` 按清单把 node 发行形态的服务器 vendored 进
 * <resources>/tools/<id>/，连同 index.json（启动规格 + 入口 + 许可证）。这里做三件事：
 *
 *   1. 读索引：有哪些服务器、哪些带启动规格、哪些只是登记；
 *   2. 记状态：用户启用了哪些、给了哪些环境变量（<dataDir>/tools/state.json）；
 *   3. 出启动计划：runtime = node 用 Ruyin 自带的 Node 起 vendored 入口（Electron 下靠
 *      ELECTRON_RUN_AS_NODE）；runtime = uvx 用本机的 uv 起 PyPI 包（不随包）。起不了
 *      的说清为什么 —— 没 vendored、没 uv、缺环境变量、缺外部程序。
 *
 * 真正起进程、握手、列工具、接 Tool Gate 的是 ConnectorRegistry：预置服务器就是
 * 一个来源为 `bundled` 的 MCP 连接器（ADR-005 通路二），项目授权与别的连接器一样。
 * 密钥不进本机：需要密钥的那一档经 Runos 注册，这里没有它们的启动规格。
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export interface LaunchSpec {
  runtime: "node" | "uvx";
  package: string;
  version: string;
  /** node：包内入口相对路径；uvx：可执行名（缺省 = 包名）。 */
  bin?: string;
  args?: string[];
  /** 启动前必须给的环境变量（例如 SEARXNG_URL）；值由用户在启用时给，不是密钥。 */
  requiresEnv?: string[];
  /** 还要本机有的外部程序（例如 pandoc）。 */
  requiresBin?: string;
  note?: string;
}

export interface BundledServer {
  id: string;
  repo?: string;
  license?: string;
  tier?: string;
  needsKey?: boolean;
  note?: string;
  launch: LaunchSpec | null;
  launchNote?: string;
  vendored?: { dir: string; package: string; entry: string; bytes?: number; licenseFile?: string | null };
  vendorError?: string;
}

export interface ToolsIndex {
  generatedAt?: string;
  servers: BundledServer[];
}

export type LaunchPlan =
  | { ok: true; command: string; args: string[]; env: Record<string, string> }
  | { ok: false; reason: string };

interface State {
  enabled: string[];
  env: Record<string, Record<string, string>>;
}

export interface BundledToolServersOptions {
  /** <resources>/tools；不存在就是没有预置工具层。 */
  toolsDir?: string | undefined;
  dataDir: string;
  /** 起 node 入口用的可执行文件；缺省 process.execPath（Electron 下是 Ruyin.exe）。 */
  execPath?: string;
  /** 本机有没有 uv；缺省真的问一次 `uvx --version`。注入是为了测试。 */
  hasUvx?: () => boolean;
  /** 本机有没有某个外部程序；缺省 `<bin> --version`。 */
  hasBin?: (bin: string) => boolean;
  log?: (line: string) => void;
}

function probeBin(bin: string, args: string[] = ["--version"]): boolean {
  try {
    const res = spawnSync(bin, args, { encoding: "utf8", windowsHide: true, timeout: 10_000 });
    return res.status === 0;
  } catch {
    return false;
  }
}

export class BundledToolServers {
  private readonly stateFile: string;
  private index?: ToolsIndex;
  private uvxKnown?: boolean;

  constructor(private readonly options: BundledToolServersOptions) {
    this.stateFile = join(options.dataDir, "tools", "state.json");
  }

  get toolsDir(): string | undefined {
    const dir = this.options.toolsDir;
    return dir && existsSync(join(dir, "index.json")) ? dir : undefined;
  }

  /** 索引里的全部服务器（含只登记的）。没有预置层就是空。 */
  list(): BundledServer[] {
    return this.readIndex().servers;
  }

  /** 带启动规格的那些：能启动，或至少能说清为什么现在起不了。 */
  launchable(): BundledServer[] {
    return this.list().filter((s) => !!s.launch);
  }

  get(id: string): BundledServer | undefined {
    return this.list().find((s) => s.id === id);
  }

  isEnabled(id: string): boolean {
    return this.readState().enabled.includes(id);
  }

  enabledIds(): string[] {
    const known = new Set(this.launchable().map((s) => s.id));
    return this.readState().enabled.filter((id) => known.has(id));
  }

  setEnabled(id: string, enabled: boolean): void {
    const state = this.readState();
    state.enabled = state.enabled.filter((x) => x !== id);
    if (enabled) state.enabled.push(id);
    this.writeState(state);
  }

  envFor(id: string): Record<string, string> {
    return { ...(this.readState().env[id] ?? {}) };
  }

  /** 用户给的环境变量（例如 SEARXNG_URL）。**不是密钥的地方** —— 密钥归 Runos 保险库。 */
  setEnv(id: string, env: Record<string, string>): void {
    const state = this.readState();
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(env)) {
      if (/^[A-Z][A-Z0-9_]*$/.test(k) && typeof v === "string") clean[k] = v;
    }
    state.env[id] = clean;
    this.writeState(state);
  }

  /** 这台机器上现在怎么起它 —— 或者为什么起不了。 */
  plan(id: string): LaunchPlan {
    const server = this.get(id);
    if (!server) return { ok: false, reason: `"${id}" 不在预置清单里` };
    const launch = server.launch;
    if (!launch) return { ok: false, reason: server.launchNote ?? "没有启动规格" };
    const userEnv = this.envFor(id);
    for (const key of launch.requiresEnv ?? []) {
      if (!userEnv[key]) return { ok: false, reason: `需要先配置环境变量 ${key}` };
    }
    if (launch.requiresBin && !(this.options.hasBin ?? probeBin)(launch.requiresBin)) {
      return { ok: false, reason: `需要本机有 ${launch.requiresBin}` };
    }
    if (launch.runtime === "node") {
      const dir = this.toolsDir;
      if (!dir || !server.vendored) {
        return { ok: false, reason: server.vendorError ? `构建时未装进包：${server.vendorError}` : "未随包 vendored（构建时没拉取）" };
      }
      const entry = resolve(dir, server.vendored.dir, server.vendored.entry);
      if (!existsSync(entry)) return { ok: false, reason: `入口不存在：${entry}` };
      return {
        ok: true,
        command: this.options.execPath ?? process.execPath,
        args: [entry, ...(launch.args ?? [])],
        // Electron 的可执行文件带这个变量就是一个纯 Node；真 Node 下它没有作用。
        env: { ELECTRON_RUN_AS_NODE: "1", ...userEnv },
      };
    }
    if (launch.runtime === "uvx") {
      if (this.uvxKnown === undefined) this.uvxKnown = (this.options.hasUvx ?? (() => probeBin("uvx")))();
      if (!this.uvxKnown) {
        return { ok: false, reason: "需要本机有 uv（https://docs.astral.sh/uv/），uvx 不在 PATH 里" };
      }
      return {
        ok: true,
        command: "uvx",
        args: ["--from", `${launch.package}==${launch.version}`, launch.bin ?? launch.package, ...(launch.args ?? [])],
        env: userEnv,
      };
    }
    return { ok: false, reason: `不认识的 runtime "${String((launch as { runtime: string }).runtime)}"` };
  }

  /** 让下次读索引重新读（构建脚本重跑之后）。 */
  refresh(): void {
    this.index = undefined;
    this.uvxKnown = undefined;
  }

  private readIndex(): ToolsIndex {
    if (this.index) return this.index;
    const dir = this.toolsDir;
    if (!dir) return (this.index = { servers: [] });
    try {
      const parsed = JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as Partial<ToolsIndex>;
      this.index = { ...parsed, servers: Array.isArray(parsed.servers) ? parsed.servers.filter((s) => s && typeof s.id === "string") : [] };
    } catch (cause) {
      this.options.log?.(`[ruyin] tools: index unreadable: ${cause instanceof Error ? cause.message : String(cause)}`);
      this.index = { servers: [] };
    }
    return this.index;
  }

  private readState(): State {
    try {
      const raw = JSON.parse(readFileSync(this.stateFile, "utf8")) as Partial<State>;
      return {
        enabled: Array.isArray(raw.enabled) ? raw.enabled.map(String) : [],
        env: raw.env && typeof raw.env === "object" ? (raw.env as State["env"]) : {},
      };
    } catch {
      return { enabled: [], env: {} };
    }
  }

  private writeState(state: State): void {
    mkdirSync(join(this.options.dataDir, "tools"), { recursive: true });
    writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
  }
}
