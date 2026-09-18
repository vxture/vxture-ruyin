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
import type { PythonRuntimeConfig, PythonSeed } from "./python-runtime.js";

/**
 * 起 uvx 形态要的那几条路径。**只声明用到的四件事**，不 import PythonRuntime 本身 ——
 * 那一头要问获取通道（ComponentStore），这一头也要，两个类互相 import 就成了环。
 */
export interface PythonHalf {
  uvExe(): string | undefined;
  pythonDir(): string;
  cacheDir(): string;
  toolDir(): string;
  isReady(): boolean;
}

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
   * **我方固定的环境变量** —— 与 `requiresEnv`（用户填的）是两件事：那一条是「这台
   * 机器上还缺什么」，这一条是「这个服务器必须怎么跑」。
   *
   * 它存在的理由是实测出来的（2026-09-18，真机装完之后）：`aas-ee.open-websearch`
   * 默认会在 **`0.0.0.0:3000`** 上开一个 HTTP 服务器 —— 不是回环，是这台电脑的每一个
   * 网络接口。Windows 于是弹「是否允许 Node.js JavaScript Runtime 通信」，而那个弹窗
   * 只是症状：真正的问题是同一个局域网里的任何人都能访问它，**而这是随包默认启用的
   * 工具，没有任何人被问过**。上游的开关是 `MODE=stdio`。
   *
   * 用户给的值优先级更高（`plan()` 里 userEnv 后并），因为要配的那几条（SEARXNG_URL
   * 之类）本来就该由用户说了算；但没人会去配 `MODE`，它属于「这个服务器怎么跑」。
   */
  env?: Record<string, string>;
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
  /** 清单里 Python 半边的描述（uv 那条组件、CPython 版本、要预热谁），pull-tools 照抄进来。 */
  pythonRuntime?: PythonRuntimeConfig;
}

export type LaunchPlan =
  | {
      ok: true;
      command: string;
      args: string[];
      env: Record<string, string>;
      /**
       * spawn 之前要做的准备（uvx 形态：首次把随包缓存种到数据目录）。计划本身是纯的 ——
       * 列表页也会算计划，不能一算就复制两百兆；真要起进程的人调这个。没有就不用等。
       */
      prepare?: () => Promise<void>;
    }
  | {
      ok: false;
      reason: string;
      /**
       * 起不了是因为差一件可获取的载荷 —— 界面按这个给「获取」按钮。
       * **不带地址**：地址只能来自守护进程刚从清单读出的那一份
       * （check-update-policy.mjs 钉住「设置页不许出现写死的组件 URL」）。
       */
      needsComponent?: string;
      /**
       * 起不了是因为 Python 半边还没装（uv 有了但 CPython / wheel 没有，或者两者都没有）。
       * 与 `needsComponent` 分开：那一条是「下载一份字节」，这一条是「用刚拿到的 uv
       * 在本机装出一个环境」，界面上是两个不同的按钮。
       */
      needsPython?: boolean;
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
  /**
   * 已获取并装好的 Python 半边（`python-runtime.ts`）。缺省 = 这套装配没有它，
   * uvx 形态一律如实报「还没装 Python 运行环境」。
   */
  python?: PythonHalf;
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

  /**
   * Python 半边在构造之后才接上（它要问获取通道，而获取通道这一头也要问它 ——
   * 构造期互指的两个对象，只能有一个先存在）。main.ts 造完就接。
   */
  setPython(python: PythonHalf): void {
    this.options.python = python;
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

  /** 清单里 Python 半边那一段。没有就是这一版不带 Python 形态。 */
  pythonConfig(): PythonRuntimeConfig | undefined {
    const py = this.readIndex().pythonRuntime;
    return py && typeof py.component === "string" ? py : undefined;
  }

  /**
   * 获取那一次要预热哪几个包。**版本从清单的 launch 里取** —— 钉死的那一个，不是
   * 最新的；预热与运行时起它用的必须是同一组 `包==版本`，否则预热的是另一份东西。
   */
  pythonSeeds(): PythonSeed[] {
    const ids = this.pythonConfig()?.seed ?? [];
    return this.list()
      .filter((s) => ids.includes(s.id) && s.launch?.runtime === "uvx")
      .map((s) => ({
        package: s.launch!.package,
        version: s.launch!.version,
        ...(s.launch!.bin ? { bin: s.launch!.bin } : {}),
      }));
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
      // 随包真 node.exe 就用它（owner 2026-09-16）：借 Ruyin.exe 自己 +
      // ELECTRON_RUN_AS_NODE 跑纯 Node 是能用，但在 Windows 上会弹一个空白
      // cmd 窗口——Electron 的已知限制，与 spawn 的 windowsHide 无关，`spawn()`
      // 那边已经开着它了也没用。开发态没有随包这一份（没跑过打包），退回旧路子。
      const nodeExe = this.nodeExe();
      // 清单里那段固定环境变量先放，用户填的后放（后者赢）—— 见 LaunchSpec.env。
      const fixed = launch.env ?? {};
      if (nodeExe) {
        return {
          ok: true,
          command: nodeExe,
          args: [entry, ...(launch.args ?? []), ...extra.args],
          env: { ...fixed, ...userEnv },
        };
      }
      return {
        ok: true,
        command: this.options.execPath ?? process.execPath,
        args: [entry, ...(launch.args ?? []), ...extra.args],
        // Electron 的可执行文件带这个变量就是一个纯 Node；真 Node 下它没有作用。
        env: { ELECTRON_RUN_AS_NODE: "1", ...fixed, ...userEnv },
      };
    }
    if (launch.runtime === "uvx") return this.uvxPlan(launch, userEnv);
    return { ok: false, reason: `不认识的 runtime "${String((launch as { runtime: string }).runtime)}"` };
  }

  /**
   * uvx 的启动契约（ADR-018 §7.2）。三件事一起定死，少一件装好了缓存也照样联网：
   *
   *   - 用**已获取的那个 uv.exe 的绝对路径**，不用 PATH 上的 uvx（`probeBin("uvx")`
   *     只看 PATH，找不到获取通道装下的那一个）；
   *   - `--offline`，**不留联网回退** —— 有回退，首次运行就可能悄悄偏离钉死的版本，
   *     而它成功的时候什么都不会说。冷缓存 + `--offline` 的失败是干净的
   *     （"Packages were unavailable because the network was disabled"），可诊断；
   *   - `UV_PYTHON_INSTALL_DIR` 指向装好的 CPython，`UV_PYTHON_DOWNLOADS=never`；
   *     `UV_CACHE_DIR` 指向数据目录下那份缓存 —— 预热就发生在那里。
   *
   * **2026-09-18：uv 与 CPython 不再随安装包**（TD-042 ②，owner 2026-09-17 的定性）。
   * 于是这里少了一整支「从只读的包里把缓存种到数据目录」的代码（TD-062 那条缝）：
   * 缓存从一开始就写在数据目录，没有第二份，也就没有两份之间的漂移。
   */
  private uvxPlan(launch: LaunchSpec, userEnv: Record<string, string>): LaunchPlan {
    const python = this.options.python;
    const uvExe = python?.uvExe();
    // 装好的没有就退回 PATH 上的 uv：那是开发机（以及自己装过 uv 的租户）的情形，
    // **不是**联网回退 —— `--offline` 与钉死的 `包==版本` 两条都还在，缓存冷了照样
    // 干净地失败。
    if (!uvExe) {
      if (this.uvxKnown === undefined) this.uvxKnown = (this.options.hasUvx ?? (() => probeBin("uvx")))();
      if (!this.uvxKnown) {
        return {
          ok: false,
          reason: "还没装 Python 运行环境（uv 与 CPython 不随安装包），PATH 上也没有 uv",
          needsPython: true,
        };
      }
    }
    // uv 在、但 CPython 与 wheel 还没装好：**这与「没有 uv」不是同一句话**，
    // 用户在界面上要点的也不是同一个按钮。
    if (uvExe && python && !python.isReady()) {
      return { ok: false, reason: "Python 运行环境还没装完（CPython 或 wheel 缺）", needsPython: true };
    }
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
        ...(python ? { UV_CACHE_DIR: python.cacheDir(), UV_PYTHON_INSTALL_DIR: python.pythonDir() } : {}),
        // 不写进用户的漫游配置（`%APPDATA%\uv\tools`）。uvx 起的是临时环境，
        // 这个目录只是它的落脚点；钉在数据目录下，行为可预期、卸载也带得走。
        UV_TOOL_DIR: python?.toolDir() ?? join(this.options.dataDir, "tools", "uv-tools"),
        // 缺什么就失败，绝不自己去下一个 Python 解释器。
        UV_PYTHON_DOWNLOADS: "never",
        UV_NO_PROGRESS: "1",
        ...(launch.env ?? {}),
        ...userEnv,
      },
    };
  }

  /**
   * 随包的真 node.exe 在哪（`<resources>/node`，与 `uv` 兄弟）。没有就是这一版
   * 没装进来（开发态：没跑过 `pack.mjs`）——那时退回借 Ruyin.exe 自己跑的旧路子。
   */
  private nodeExe(): string | undefined {
    const dir = this.options.toolsDir;
    if (!dir || process.platform !== "win32") return undefined;
    const exe = join(dirname(resolve(dir)), "node", "node.exe");
    return existsSync(exe) ? exe : undefined;
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
