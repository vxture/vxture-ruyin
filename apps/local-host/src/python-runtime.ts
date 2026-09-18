/**
 * Python 半边（ADR-018 §7.2；TD-042 ②）—— **不随安装包，用户点一次才落到本机**。
 *
 * owner 2026-09-17 的定性是「安装包小一些，租户按照需求，安装必要环境」。此前
 * uv + uv 托管的 CPython + 预热好的 wheel 缓存一共 219 MB 真的躺在安装包里
 * （`resources/uv` → electron-builder 的 extraResources），而绝大多数租户一次
 * Python 形态的服务器都不会起。所以这一层整体搬到获取通道之后：
 *
 *   1. `uv` 是一条**普通的组件**（clean `python.uv`，走 component-store.ts 那条路：
 *      https + 闭合白名单 + 不跟跳 + 长度 + sha256 + 解压护栏）。
 *   2. 拿到 uv 之后，**用它**装 CPython、预热 `pythonRuntime.seed` 里那几个包的
 *      wheel，全部落在数据目录 —— 这就是本文件。
 *
 * ## 我们自己担保什么、委托给谁
 *
 * 我们自己钉 sha256 的只有 uv 那 16,989,876 字节。CPython 与 wheel 是 **uv 按上游
 * 校验和自核**的 —— 这是**委托，不是省略**，写在这里、写在清单里、也显示在界面上。
 * 要把这两样也纳入我们自己的钉死名单，那是 TD-042 ③（离线侧载包）的事；在那之前
 * 气隙机器上这条路走不通，而**这句话必须说出口**，不能让一台断网的机器自己去发现。
 *
 * ## 为什么预热与离线复核要一起做
 *
 * 只把 wheel 放进缓存不算数：缺一个传递依赖、缺一个解释器，都要到 `--offline`
 * 真起那一跑才现形。所以 provision 的最后一步是**在一个空的 UV_TOOL_DIR 里
 * `--offline` 真起一次** —— 复核要是能看见上一轮留下的 venv，它证明的是「这台机器
 * 上此刻能起」，而不是「这棵树自己够」。这两条都是原先的构建脚本
 * （`scripts/release/seed-uv-cache.mjs`，本轮删除，见 git 历史）在构建机上踩出来的，
 * 原样搬到了本机。
 *
 * ## 下载只发生在用户点下那一次
 *
 * 启动时、刷新时、任务要工具时一律不下载（§7.2 的硬规则，`check-update-policy.mjs`
 * 钉住）。所以 `status()` 只读盘、只比对，永远不起进程；`provision()` 只有一条
 * 调用路径 —— `POST /python-runtime/provision`，即用户在能力平台点下的那一次。
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** 清单（`resources/tools/index.json` 的 pythonRuntime 段）说的那几件事。 */
export interface PythonRuntimeConfig {
  /** uv 从哪条组件来。 */
  component: string;
  cpython: { version: string };
  /** 获取那一次要预热哪几个服务器的 wheel（服务器 id）。 */
  seed?: string[];
}

/** 要预热 / 复核的一个包：与运行时起它用的是同一组 `包==版本` 和入口名。 */
export interface PythonSeed {
  package: string;
  version: string;
  bin?: string;
}

export type PythonRuntimeState =
  /** 清单里没有 Python 半边，或 uv 那条组件还没获取。 */
  | "not-acquired"
  /** uv 在了，CPython 与 wheel 还没装。 */
  | "not-provisioned"
  /** 装过，但这一版安装包要的包 / 版本变了 —— 要重装一次。 */
  | "stale"
  | "provisioning"
  | "ready"
  /** 上一次装到一半没成，`code` 说是哪一步。 */
  | "failed";

/** 正在做哪一步（界面按码出词，守护进程不出中文）。 */
export type PythonStepCode = "acquire-uv" | "install-python" | "warm-cache" | "verify-offline";

/** 没成是因为什么。**各说各的**：折叠成一句「装不上」，用户分不清该重试还是该换机器。 */
export type PythonFailureCode =
  | "no-config"
  | "uv-missing"
  | "acquire-failed"
  | "install-python-failed"
  | "warm-failed"
  | "verify-failed"
  | "cancelled";

export interface PythonRuntimeStatus {
  state: PythonRuntimeState;
  /** uv 那条组件的 id（界面拿它去 `/components` 找体积与「获取」按钮）。 */
  component: string | null;
  uvVersion: string | null;
  pythonVersion: string | null;
  /** 已经预热好的 `包==版本`。 */
  packages: string[];
  /** 这一版清单要的 `包==版本`。与上面不一致就是 stale。 */
  wanted: string[];
  provisionedAt?: string;
  /**
   * uv 那条组件此刻的样子（体积 / 许可证 / 来源 / 下载进度）。**点之前就要看得见
   * 要下多少** —— 这一块是这条载荷在界面上唯一的落点：uvx 形态的服务器行不再自己
   * 显示载荷，一次安装只在一个地方有按钮。
   */
  payload?: ComponentPayloadStatus;
  stepCode?: PythonStepCode;
  code?: PythonFailureCode;
  /**
   * 诊断用的原文（uv 自己那句）。**界面一个字不渲染** —— 与 updates.ts 的
   * `reason` 同一条纪律：面向用户的话由界面按 `code` 出。
   */
  reason?: string;
}

/**
 * uv 那条组件此刻的样子。字段名与 `ComponentStatus` 一致（结构上就是它的一个子集）——
 * 界面要在**点之前**看得见要下多少、许可证是什么、字节从哪台主机来。
 */
export interface ComponentPayloadStatus {
  id: string;
  state: string;
  version: string;
  downloadBytes: number;
  diskBytes: number;
  license: string;
  origin: string;
  receivedBytes?: number;
  totalBytes?: number;
  reason?: string;
}

/** 只用到 ComponentStore 的这两件事；注入是为了测试，也断了与获取通道的双向依赖。 */
export interface ComponentLookup {
  pathOf(id: string): string | undefined;
  status(id: string): ComponentPayloadStatus | undefined;
}

export type RunResult = { status: number | null; output: string };

export interface PythonRuntimeOptions {
  dataDir: string;
  components: ComponentLookup;
  config: () => PythonRuntimeConfig | undefined;
  /** 要预热的那几个包（从预置清单的 launch 规格来）。 */
  seeds: () => PythonSeed[];
  /** 起一个子进程。缺省真的 spawn；注入是为了测试。 */
  run?: (cmd: string, args: string[], env: Record<string, string>, signal: AbortSignal) => Promise<RunResult>;
  onChanged?: () => void;
  now?: () => string;
  log?: (line: string) => void;
}

/** 落在 `<dataDir>/tools/python-runtime.json` 的回执。 */
interface Receipt {
  uvVersion: string;
  pythonVersion: string;
  /** 预热并**在 --offline 下真起过一次**的那几个 `包==版本`。 */
  packages: string[];
  provisionedAt: string;
}

const RECEIPT = "python-runtime.json";

/** uv 的输出可能很长；只留够诊断的一段。 */
const MAX_OUTPUT = 4000;

function spawnOnce(
  cmd: string,
  args: string[],
  env: Record<string, string>,
  signal: AbortSignal,
): Promise<RunResult> {
  return new Promise((done) => {
    // **不能用 spawnSync**：装 CPython 要几十秒，预热要几分钟，而守护进程是单线程的
    // —— 同步等于这段时间里界面一个请求都得不到回答，看起来就是「卡死了」。
    const child = spawn(cmd, args, { env: { ...process.env, ...env }, windowsHide: true });
    let output = "";
    const take = (b: Buffer) => {
      if (output.length < MAX_OUTPUT) output += b.toString("utf8");
    };
    child.stdout?.on("data", take);
    child.stderr?.on("data", take);
    const kill = () => child.kill();
    signal.addEventListener("abort", kill, { once: true });
    child.on("error", (e) => {
      signal.removeEventListener("abort", kill);
      done({ status: null, output: `${output}${String(e)}` });
    });
    child.on("close", (status) => {
      signal.removeEventListener("abort", kill);
      done({ status, output: output.slice(0, MAX_OUTPUT) });
    });
  });
}

export class PythonRuntime {
  private inFlight: { step: PythonStepCode; controller: AbortController } | undefined;
  private failure: { code: PythonFailureCode; reason: string } | undefined;

  constructor(private readonly options: PythonRuntimeOptions) {}

  private get toolsDir(): string {
    return join(this.options.dataDir, "tools");
  }

  /** uv 落在获取通道那棵树里（`install.into: "uv"`）。没获取就是 undefined。 */
  uvHome(): string | undefined {
    const config = this.options.config();
    if (!config) return undefined;
    const tree = this.options.components.pathOf(config.component);
    if (!tree) return undefined;
    const home = join(tree, "uv");
    return existsSync(this.uvExeIn(home)) ? home : undefined;
  }

  private uvExeIn(home: string): string {
    return join(home, process.platform === "win32" ? "uv.exe" : "uv");
  }

  /** 起 uvx 形态的服务器用的那个可执行文件。没获取就是 undefined。 */
  uvExe(): string | undefined {
    const home = this.uvHome();
    return home ? this.uvExeIn(home) : undefined;
  }

  /** uv 托管的 CPython 装在哪。 */
  pythonDir(): string {
    return join(this.toolsDir, "uv-python");
  }

  /**
   * uv 的缓存。**在数据目录里，不在安装目录里** —— uvx 每次都往缓存里写（临时环境、
   * 按解释器路径重算的解析结果、锁文件），而 nsis 允许用户把应用装到 Program Files
   * 这类非提权不可写的位置（TD-062 就是这么撞上的）。
   */
  cacheDir(): string {
    return join(this.toolsDir, "uv-cache");
  }

  /** uvx 起的临时环境的落脚点。钉在数据目录下：行为可预期，卸载也带得走。 */
  toolDir(): string {
    return join(this.toolsDir, "uv-tools");
  }

  /**
   * 装好的那个解释器（环境检查要用）。uv 把 CPython 装成 <python 目录>/<版本标签>/，
   * 所以这里要真去找一层 —— 找不到就是还没装。
   */
  interpreter(): string | undefined {
    const root = this.pythonDir();
    if (!existsSync(root)) return undefined;
    for (const name of readdirSync(root)) {
      const exe = join(root, name, process.platform === "win32" ? "python.exe" : "bin/python3");
      if (existsSync(exe)) return exe;
    }
    return undefined;
  }

  /** 这一版清单要预热的那几个 `包==版本`。 */
  private wanted(): string[] {
    return this.options.seeds().map((s) => `${s.package}==${s.version}`);
  }

  private receipt(): Receipt | undefined {
    try {
      const parsed = JSON.parse(readFileSync(join(this.toolsDir, RECEIPT), "utf8")) as Receipt;
      return Array.isArray(parsed?.packages) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  /** 装好了没有。**只读盘，不起进程、不发请求** —— 启动路径与列表页都会调它。 */
  status(): PythonRuntimeStatus {
    const config = this.options.config();
    const wanted = config ? this.wanted() : [];
    const base: PythonRuntimeStatus = {
      state: "not-acquired",
      component: config?.component ?? null,
      uvVersion: null,
      pythonVersion: null,
      packages: [],
      wanted,
    };
    if (!config) return base;
    const payload = this.options.components.status(config.component);
    if (payload) base.payload = payload;
    if (this.inFlight) return { ...base, state: "provisioning", stepCode: this.inFlight.step };
    const uvVersion = payload?.version ?? null;
    if (!this.uvHome()) {
      return this.failure ? { ...base, state: "failed", ...this.failure } : base;
    }
    const receipt = this.receipt();
    const ready =
      receipt !== undefined &&
      existsSync(this.pythonDir()) &&
      receipt.packages.length === wanted.length &&
      wanted.every((p) => receipt.packages.includes(p));
    const known: PythonRuntimeStatus = {
      ...base,
      uvVersion,
      pythonVersion: receipt?.pythonVersion ?? null,
      packages: receipt?.packages ?? [],
      ...(receipt?.provisionedAt ? { provisionedAt: receipt.provisionedAt } : {}),
    };
    if (ready) return { ...known, state: "ready" };
    if (this.failure) return { ...known, state: "failed", ...this.failure };
    // 装过、但清单换了一版（包或版本变了）：**这不是「没装过」**。用户记得自己装过，
    // 一句「未安装」会让他以为产品把它弄丢了。
    return { ...known, state: receipt ? "stale" : "not-provisioned" };
  }

  isReady(): boolean {
    return this.status().state === "ready";
  }

  /** 取消一次进行中的安装。没在跑就 false（不是错误）。 */
  cancel(): boolean {
    if (!this.inFlight) return false;
    this.inFlight.controller.abort();
    return true;
  }

  /**
   * 装 Python 半边。**只有一条调用路径**：用户在能力平台点下的那一次
   * （`POST /python-runtime/provision`）。
   *
   * `acquire` 由路由那一层给 —— 取 uv 的字节走的是获取通道，而
   * `check-update-policy.mjs` 不许守护进程的启动路径里出现 `acquire(`。
   */
  async provision(opts: { acquire?: () => Promise<unknown> } = {}): Promise<PythonRuntimeStatus> {
    if (this.inFlight) return this.status();
    const config = this.options.config();
    if (!config) {
      this.failure = { code: "no-config", reason: "这一版安装包的清单里没有 Python 半边" };
      return this.status();
    }
    const controller = new AbortController();
    this.inFlight = { step: "acquire-uv", controller };
    this.failure = undefined;
    this.changed();
    try {
      await this.steps(config, controller.signal, opts.acquire);
    } finally {
      // **先清掉在跑的标记，再算状态** —— 不然这一次调用的答案永远是「正在装」，
      // 而它其实已经装完（或者已经没成）了。
      this.inFlight = undefined;
      this.changed();
    }
    return this.status();
  }

  private async steps(
    config: PythonRuntimeConfig,
    signal: AbortSignal,
    acquire: (() => Promise<unknown>) | undefined,
  ): Promise<void> {
    // 1. uv 的字节。已经获取过就跳过 —— 同一条获取通道，不在这里另开一条。
    if (!this.uvHome() && acquire) {
      try {
        await acquire();
      } catch (e) {
        return void this.fail("acquire-failed", e instanceof Error ? e.message : String(e));
      }
    }
    const uvExe = this.uvExe();
    if (!uvExe) return void this.fail("uv-missing", `获取之后仍然没有 ${config.component}`);
    if (signal.aborted) return void this.fail("cancelled", "用户取消");

    const cache = this.cacheDir();
    const python = this.pythonDir();
    mkdirSync(cache, { recursive: true });
    mkdirSync(python, { recursive: true });
    const env = { UV_CACHE_DIR: cache, UV_PYTHON_INSTALL_DIR: python, UV_NO_PROGRESS: "1" };
    const run = this.options.run ?? spawnOnce;

    // 2. CPython。运行时 `UV_PYTHON_DOWNLOADS=never`，所以它必须在这一步就位。
    this.step("install-python");
    const minor = config.cpython.version.split(".").slice(0, 2).join(".");
    const got = await run(uvExe, ["python", "install", minor], env, signal);
    if (signal.aborted) return void this.fail("cancelled", "用户取消");
    if (got.status !== 0) return void this.fail("install-python-failed", got.output);

    // 3. 预热。**用运行时那条一模一样的命令，只是不带 `--offline`** —— 缓存要被写成
    //    什么样，只有真正读它的那条命令说了算。（先前构建脚本这里用 `uv tool install`，
    //    那是错的：venv 装进 UV_TOOL_DIR，缓存里并没有 uvx 解析得到的东西，隔离复核
    //    当场戳穿：「excel-mcp-server was not found in the cache」。）
    const seeds = this.options.seeds();
    for (const phase of ["warm-cache", "verify-offline"] as const) {
      this.step(phase);
      const offline = phase === "verify-offline";
      for (const seed of seeds) {
        // **每一次都用一个空的 UV_TOOL_DIR。** 复核要是能看见上一轮留下的 venv，
        // 它证明的是「这台机器上此刻能起」，不是「这棵树自己够」—— 而差别正是
        // 客户机器上起不起得来。
        const probe = mkdtempSync(join(tmpdir(), "ruyin-uv-"));
        try {
          const args = [
            "tool",
            "run",
            ...(offline ? ["--offline"] : []),
            "--from",
            `${seed.package}==${seed.version}`,
            seed.bin ?? seed.package,
            "--help",
          ];
          const res = await run(uvExe, args, { ...env, UV_TOOL_DIR: probe }, signal);
          if (signal.aborted) return void this.fail("cancelled", "用户取消");
          if (res.status !== 0) {
            return void this.fail(offline ? "verify-failed" : "warm-failed", `${seed.package}: ${res.output}`);
          }
        } finally {
          rmSync(probe, { recursive: true, force: true });
        }
      }
    }

    const receipt: Receipt = {
      uvVersion: this.options.components.status(config.component)?.version ?? "",
      pythonVersion: config.cpython.version,
      packages: this.wanted(),
      provisionedAt: (this.options.now ?? (() => new Date().toISOString()))(),
    };
    mkdirSync(this.toolsDir, { recursive: true });
    writeFileSync(join(this.toolsDir, RECEIPT), JSON.stringify(receipt, null, 2));
    this.options.log?.(
      `[ruyin] python: ready - uv ${receipt.uvVersion} + CPython ${receipt.pythonVersion}` +
        `, ${receipt.packages.length} package(s) warmed and started once with --offline`,
    );
    return;
  }

  /** 把装好的那一份删掉（uv 那条组件由获取通道自己的「移除」管）。 */
  remove(): boolean {
    const receiptFile = join(this.toolsDir, RECEIPT);
    if (!existsSync(receiptFile)) return false;
    rmSync(receiptFile, { force: true });
    rmSync(this.pythonDir(), { recursive: true, force: true });
    rmSync(this.cacheDir(), { recursive: true, force: true });
    rmSync(this.toolDir(), { recursive: true, force: true });
    this.failure = undefined;
    this.changed();
    return true;
  }

  private step(step: PythonStepCode): void {
    if (this.inFlight) this.inFlight.step = step;
    this.changed();
  }

  private fail(code: PythonFailureCode, reason: string): void {
    this.failure = { code, reason: reason.trim().slice(0, MAX_OUTPUT) };
    this.options.log?.(`[ruyin] python: ${code} - ${this.failure.reason.split("\n")[0] ?? ""}`);
  }

  private changed(): void {
    this.options.onChanged?.();
  }
}
