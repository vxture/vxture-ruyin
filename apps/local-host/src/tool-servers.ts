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
import { dirname, join, resolve } from "node:path";

import type { ComponentStore } from "./component-store.js";

export interface LaunchSpec {
  runtime: "node" | "uvx";
  package: string;
  version: string;
  /** node：包内入口相对路径；uvx：可执行名（缺省 = 包名）。 */
  bin?: string;
  args?: string[];
  /** 启动前必须给的环境变量（例如 SEARXNG_URL）；值由用户在启用时给，不是密钥。 */
  requiresEnv?: string[];
  /**
   * 还要本机有的外部程序（例如 pandoc）。**PATH 探测**：本机自己装了就不必获取。
   * 与 requiresComponent 并存，探测优先。
   */
  requiresBin?: string;
  /**
   * 起它之前必须先获取的载荷（ADR-018 §7.2）。与 requiresBin 的分工：那一条是
   * 「本机有没有」，这一条是「获取界面拿来给按钮的那一条」。
   */
  requiresComponent?: string[];
  /** 这个包的 wheel 已在构建时预取进随包的 uv cache（pack.mjs 断言，不是手写的承诺）。 */
  offline?: { cacheSeeded?: boolean };
  /** 走浏览器梯子（chrome → msedge → 用户指定 → 已获取的 headless shell）。 */
  browserLadder?: boolean;
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
  /** 构建时真起过一次、`tools/list` 报出来的工具名（预置工具名对照表，TD-034）。 */
  tools?: string[];
  /** 探不到的原因。**绝不写成空数组** —— 空数组读起来是「它什么都不暴露」。 */
  toolsUnprobed?: string;
  /** 构建时服务器自报的 `{name, version}`。 */
  serverInfo?: { name?: string; version?: string };
  toolsProbedAt?: string;
}

export interface ToolsIndex {
  generatedAt?: string;
  servers: BundledServer[];
}

export type LaunchPlan =
  | { ok: true; command: string; args: string[]; env: Record<string, string> }
  | {
      ok: false;
      reason: string;
      /**
       * 起不了是因为差一件可获取的载荷 —— 界面按这个给「获取」按钮。
       * **不带地址**：地址只能来自守护进程刚从清单读出的那一份
       * （check-update-policy.mjs 钉住「设置页不许出现写死的组件 URL」）。
       */
      needsComponent?: string;
    };

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
  /** 获取通道（ADR-018 §7.2）。缺省 = 这套装配没有，需要载荷的一律如实报「未获取」。 */
  components?: ComponentStore;
  /**
   * 本机装着的浏览器（梯子的头两级）。缺省按 Windows 的固定安装位置找。
   * playwright 自己的 findChromiumChannelBestEffort **不在 MCP 那条代码路径上**
   * （两个调用点都在 codegen / dashboard），所以这条梯子必须我们写。
   */
  findBrowser?: (channel: "chrome" | "msedge") => boolean;
  log?: (line: string) => void;
}

/** Windows 上 Chrome / Edge 的固定安装位置。Win11 一定有 Edge。 */
const BROWSER_PATHS: Record<"chrome" | "msedge", string[]> = {
  chrome: [
    "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe",
    "%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe",
    "%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe",
  ],
  msedge: [
    "%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe",
    "%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe",
  ],
};

function browserInstalled(channel: "chrome" | "msedge"): boolean {
  return BROWSER_PATHS[channel].some((p) => {
    const expanded = p.replace(/%([^%]+)%/g, (_, name: string) => process.env[name] ?? "");
    return !expanded.includes("%") && expanded.length > 0 && existsSync(expanded);
  });
}

function mb(n: number): string {
  return `${(n / 1048576).toFixed(1)} MB`;
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
    // 必需的载荷：**「未获取」与「未随包」「需要 uv」是三件不同的事**，各说各的。
    // 上一版对这几条一律回「未随包 vendored（构建时没拉取）」—— 那句话对用户不成立，
    // 他没有构建过任何东西。
    for (const id of launch.requiresComponent ?? []) {
      if (!this.options.components?.isAcquired(id)) {
        const status = this.options.components?.status(id);
        const size = status ? `需下载 ${mb(status.downloadBytes)}（占盘 ${mb(status.diskBytes)}）` : "载荷不在本次构建的清单里";
        // 「从来没取过」和「取过、文件后来不见了」不是同一句话：后者用户会记得自己
        // 装过，一句「未获取」会让他以为是产品把它弄丢了之外还在骗他。
        const lead = status?.state === "payload-missing" ? "载荷不在了" : "未获取";
        const why = status && status.state !== "not-acquired" && status.reason ? `（${status.reason}）` : "";
        return {
          ok: false,
          reason: `${lead}：${size}${why} —— 在「能力平台」里点「获取」，或从本地文件导入`,
          needsComponent: id,
        };
      }
    }
    if (launch.runtime === "node") {
      const dir = this.toolsDir;
      if (!dir || !server.vendored) {
        return { ok: false, reason: server.vendorError ? `构建时未装进包：${server.vendorError}` : "这一版安装包里没有它（构建时没有 vendored）" };
      }
      const entry = resolve(dir, server.vendored.dir, server.vendored.entry);
      if (!existsSync(entry)) return { ok: false, reason: `入口不存在：${entry}` };
      const extra = launch.browserLadder ? this.browserArgs(userEnv) : { ok: true as const, args: [] };
      if (!extra.ok) return extra;
      return {
        ok: true,
        command: this.options.execPath ?? process.execPath,
        args: [entry, ...(launch.args ?? []), ...extra.args],
        // Electron 的可执行文件带这个变量就是一个纯 Node；真 Node 下它没有作用。
        env: { ELECTRON_RUN_AS_NODE: "1", ...userEnv },
      };
    }
    if (launch.runtime === "uvx") return this.uvxPlan(launch, userEnv);
    return { ok: false, reason: `不认识的 runtime "${String((launch as { runtime: string }).runtime)}"` };
  }

  /**
   * uvx 的启动契约（ADR-018 §7.2）。三件事一起定死，少一件随包了缓存也照样联网：
   *
   *   - 用**随包的 uv.exe 绝对路径**，不用 PATH 上的 uvx（`probeBin("uvx")` 只看
   *     PATH，找不到随包的那一个）；
   *   - `--offline`，**不留联网回退** —— 有回退，首次运行就可能悄悄偏离钉死的版本，
   *     而它成功的时候什么都不会说。冷缓存 + `--offline` 的失败是干净的
   *     （"Packages were unavailable because the network was disabled"），可诊断；
   *   - `UV_CACHE_DIR` / `UV_PYTHON_INSTALL_DIR` 指向随包的那两份，
   *     `UV_PYTHON_DOWNLOADS=never`。
   */
  private uvxPlan(launch: LaunchSpec, userEnv: Record<string, string>): LaunchPlan {
    const bundled = this.uvHome();
    const uvExe = bundled ? join(bundled, process.platform === "win32" ? "uv.exe" : "uv") : undefined;
    // 随包的没有就退回 PATH 上的 uv：那是开发机的情形，**不是**联网回退 ——
    // `--offline` 与钉死的 `包==版本` 两条都还在，缓存冷了照样干净地失败。
    if (!uvExe) {
      if (this.uvxKnown === undefined) this.uvxKnown = (this.options.hasUvx ?? (() => probeBin("uvx")))();
      if (!this.uvxKnown) {
        return {
          ok: false,
          reason:
            "这一版安装包里没有随包的 uv，PATH 上也没有 —— Python 形态的服务器起不来。" +
            "（随包 uv + CPython + 预取好的 wheel 缓存是 TD-042 未完的那一步）",
        };
      }
    }
    const cache = bundled ? join(bundled, "cache") : undefined;
    const python = bundled ? join(bundled, "python") : undefined;
    return {
      ok: true,
      command: uvExe ?? "uvx",
      args: [
        ...(uvExe ? ["tool", "run"] : []),
        "--offline",
        "--from",
        `${launch.package}==${launch.version}`,
        launch.bin ?? launch.package,
        ...(launch.args ?? []),
      ],
      env: {
        ...(cache ? { UV_CACHE_DIR: cache } : {}),
        ...(python ? { UV_PYTHON_INSTALL_DIR: python } : {}),
        // 不写进用户的漫游配置（`%APPDATA%\uv\tools`）。uvx 起的是临时环境，
        // 这个目录只是它的落脚点；钉在数据目录下，行为可预期、卸载也带得走。
        UV_TOOL_DIR: join(this.options.dataDir, "tools", "uv-tools"),
        // 缺什么就失败，绝不自己去下一个 Python 解释器。
        UV_PYTHON_DOWNLOADS: "never",
        UV_NO_PROGRESS: "1",
        ...userEnv,
      },
    };
  }

  /** 随包的 uv 在哪（`<resources>/uv`）。没有就是这一版没装进来。 */
  private uvHome(): string | undefined {
    const dir = this.options.toolsDir;
    if (!dir) return undefined;
    const home = join(dirname(resolve(dir)), "uv");
    return existsSync(join(home, process.platform === "win32" ? "uv.exe" : "uv")) ? home : undefined;
  }

  /**
   * 浏览器梯子：chrome → msedge → 用户指定的可执行路径 → 已获取的 headless shell。
   *
   * 实测 playwright-mcp 的默认 channel 就是本机已装的 Chrome，`--browser msedge`
   * 同样可用，而 Win11 一定有 Edge —— **离线浏览器自动化是零字节就已到手的能力**。
   * 所以这里的默认答案是「什么都不加」，而不是「去下 311 MB」。
   */
  private browserArgs(userEnv: Record<string, string>): { ok: true; args: string[] } | { ok: false; reason: string; needsComponent?: string } {
    const has = this.options.findBrowser ?? browserInstalled;
    if (has("chrome")) return { ok: true, args: [] };
    if (has("msedge")) return { ok: true, args: ["--browser", "msedge"] };
    const given = userEnv["BROWSER_EXECUTABLE_PATH"];
    if (given && existsSync(given)) return { ok: true, args: ["--executable-path", given] };
    for (const c of this.options.components?.list() ?? []) {
      if (c.kind !== "browser" || c.state !== "acquired") continue;
      const exe = this.options.components?.pathOf(c.id);
      const spec = this.options.components?.spec(c.id);
      if (exe && spec?.install.expect) return { ok: true, args: ["--executable-path", join(exe, spec.install.expect)] };
    }
    const shell = (this.options.components?.list() ?? []).find((c) => c.kind === "browser");
    return {
      ok: false,
      reason: shell
        ? `本机既没有 Chrome 也没有 Edge。给一个浏览器的路径（环境变量 BROWSER_EXECUTABLE_PATH），` +
          `或获取 ${shell.id}：需下载 ${mb(shell.downloadBytes)}（占盘 ${mb(shell.diskBytes)}，${shell.license}）`
        : "本机既没有 Chrome 也没有 Edge，也没有可获取的浏览器载荷。给一个浏览器的路径（环境变量 BROWSER_EXECUTABLE_PATH）",
      ...(shell ? { needsComponent: shell.id } : {}),
    };
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
