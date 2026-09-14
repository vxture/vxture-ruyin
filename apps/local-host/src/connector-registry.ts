/**
 * Host-side connector registry (ADR-005 seam ④ and ⑤, host half).
 *
 * The kernel only ever calls `get(id)` on the lookup it was handed. This
 * class owns that lookup: it loads the installed connectors from a manifest
 * in the data dir at startup, starts each one, and puts it in the same Map
 * the kernel reads - so installing a connector does not restart the daemon.
 *
 * Trust posture, from the ADR's four rules. "Source-restricted" and "signed"
 * (rules 1 and 3) are what the .ruyinpkg pipeline will provide once the
 * Registry root exists (TD-012); until then this registry does what the
 * package installer does: **production refuses to install**, and only an
 * explicit development switch allows it. An installed connector is an
 * arbitrary process run with the user's rights - that is precisely the thing
 * rule 1 says must not come from anywhere. "Explicit install" (rule 2) is the
 * POST; "project-scoped authorization" (rule 4) is ConnectorGrant, in the
 * kernel.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ConnectorHealth, ConnectorPort, ContextSource } from "@vxture/ruyin-core";
import { McpConnector, type ConnectorToolOutcome } from "./connector-mcp.js";
import type { ConnectorToolSource } from "./tool-executor.js";
import type { BundledToolServers } from "./tool-servers.js";
import {
  DEFAULT_RESOURCE_LIMITS,
  overLimitMessage,
  type ResourceLimits,
} from "./resource-limits.js";

export const CONNECTORS_FILE = "connectors.json";

/** Ids follow the contract's id grammar plus dashes; never local-fs. */
const CONNECTOR_ID = /^[a-z][a-z0-9_-]{0,63}$/;

/** 公共字段，两种传输各自的连接细节不同（stdio 的命令行 vs HTTP 的地址）。 */
interface InstalledConnectorBase {
  id: string;
  /**
   * Which contract source kind this connector serves (lan / private) —— 或
   * `bundled`：随安装包预置的 MCP 服务器（ADR-018 §2.2，tool-servers.ts），
   * 不在 connectors.json 里，启用状态记在 <dataDir>/tools/state.json。
   * 预置服务器只有 stdio 形态。
   */
  source: Extract<ContextSource, "lan" | "private"> | "bundled";
  installedAt: string;
  /**
   * 本机生效态（通则 B-3：一个 state 字符串，不用布尔取反）。
   *
   * `active`  跑起来了，任务能用它。
   * `stashed` **存下来了但没启用** —— 添加时连不上，用户选择先留着
   *           （owner 2026-09-04 第 12 条「可以不通过暂存」）。它不进
   *           `lookup`，所以任务拿不到它：一个连不上的连接器留在名单里是
   *           待办，不是能力。
   */
  state: "active" | "stashed";
}

export interface InstalledStdioConnector extends InstalledConnectorBase {
  transport: "stdio";
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/** Streamable HTTP（工作计划「通路二 E」）：没有子进程，连接细节是地址与请求头。 */
export interface InstalledHttpConnector extends InstalledConnectorBase {
  transport: "streamable_http";
  url: string;
  /** 目标服务要的鉴权头之类；不落 UI 之外的地方，也不进审计。 */
  headers?: Record<string, string>;
  source: Extract<ContextSource, "lan" | "private">;
}

export type InstalledConnector = InstalledStdioConnector | InstalledHttpConnector;

export type ConnectorView = InstalledConnector & {
  health: ConnectorHealth;
  /** Tools the running server exposes (tools/list at start); empty when not running. */
  tools: string[];
  /** 预置服务器才有：怎么起、现在为什么起不了（没 uv / 缺环境变量 / 没随包）。 */
  bundled?: { runtime: string; blocked?: string; note?: string };
};

export class ConnectorInstallRefusedError extends Error {}
/** 预置的服务器不能卸载 —— 它随安装包来，只能停用。 */
export class ConnectorBundledError extends Error {}

/** 暂存态的健康：不是「未运行」而是「没启用」—— 两件事在用户那里不一样。 */
function stashedHealth(): ConnectorHealth {
  return { ok: false, detail: "已暂存，未启用", checkedAt: new Date().toISOString() };
}

/** 一次连接测试的结果。**不落盘、不注册** —— 只是问一句能不能连上。 */
export interface ConnectorProbe {
  ok: boolean;
  /** 连上了的话，对方 tools/list 报了哪些工具。 */
  tools: string[];
  /** 没连上的原因，照原样转达。 */
  detail?: string;
}

/** `probe()` 的入参：两种传输各自的连接细节，由 `transport` 挑。缺省 = stdio（早于 E 批就有的调用方不必改）。 */
export type ConnectorProbeInput =
  | { id: string; transport?: "stdio"; command: string; args?: string[]; env?: Record<string, string> }
  | { id: string; transport: "streamable_http"; url: string; headers?: Record<string, string> };

/** `install()` 的入参，同一条 discriminant。 */
export type ConnectorInstallInput =
  | {
      id: string;
      transport?: "stdio";
      command: string;
      args?: string[];
      env?: Record<string, string>;
      source: string;
      /** `stashed` = 存下来但不启用（测试没通过时用户选择先留着）。 */
      state?: string;
    }
  | {
      id: string;
      transport: "streamable_http";
      url: string;
      headers?: Record<string, string>;
      source: string;
      state?: string;
    };

/** `undefined` = 地址没问题；否则是给用户看的原因。 */
function invalidHttpUrl(url: string): string | undefined {
  if (!url || typeof url !== "string") return "地址不能为空";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `地址不是合法的 URL："${url}"`;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `地址必须是 http 或 https，收到 "${parsed.protocol}"`;
  }
  return undefined;
}

interface Manifest {
  items: InstalledConnector[];
}

export class ConnectorRegistry implements ConnectorToolSource {
  private readonly manifestPath: string;
  private readonly workRoot: string;
  private readonly live = new Map<string, McpConnector>();
  private specs: InstalledConnector[] = [];

  constructor(
    dataDir: string,
    private readonly lookup: Map<string, ConnectorPort>,
    private readonly options: {
      /** Development only. Production leaves this false and refuses installs. */
      allowUnsigned: boolean;
      log?: (line: string) => void;
      timeoutMs?: number;
      /** 预置的 MCP 服务器（随包）；缺省 = 这套装配没有预置工具层。 */
      bundled?: BundledToolServers;
      /** 本机资源上限（TD-046）；缺省见 resource-limits.ts。 */
      limits?: ResourceLimits;
    },
  ) {
    this.manifestPath = join(dataDir, CONNECTORS_FILE);
    // **刻意不放数据目录下**，见 workDirFor 的注释。
    this.workRoot = join(tmpdir(), "ruyin-connector-work");
  }

  /**
   * 连接器进程的工作目录：`<系统临时目录>/ruyin-connector-work/<id>`。
   *
   * 为什么必须给一个：MCP 服务器会往 cwd 里写东西 —— playwright-mcp 每访问一页就在
   * `.playwright-mcp/` 下留一份 .yml 快照。不给就是**继承守护进程的 cwd**，而那是
   * 「应用是从哪个目录被启动的」：在 CI 里是仓库根（上一轮探测就在仓里留下了四个
   * 未跟踪文件），在装好的机器上可能是 Program Files —— 一个多半写不进去的地方。
   *
   * 为什么不是 `<dataDir>/connector-work`：**Windows 上一个进程的 cwd 会把那个目录
   * 连同它的所有上级锁住**（写这一条时是被测试当场证明的：子进程还活着时
   * `rmSync(dataDir)` 直接 EPERM）。数据目录是可以搬家的（设置 → 数据位置），
   * 而把它做成某个连接器进程的 cwd，等于让「有连接器在跑」变成「搬不了家」。
   * 这里写的都是可以随时丢的临时文件，临时目录才是它们该在的地方。
   */
  private workDirFor(id: string): string {
    const dir = join(this.workRoot, id.replace(/[^A-Za-z0-9._-]/g, "_"));
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  /** 预置服务器的连接器 spec：命令 / 参数 / 环境由启动计划给，不落 connectors.json。 */
  private bundledSpec(id: string): InstalledConnector | undefined {
    const plan = this.options.bundled?.plan(id);
    if (!plan?.ok) return undefined;
    return {
      id,
      transport: "stdio",
      command: plan.command,
      args: plan.args,
      env: plan.env,
      source: "bundled",
      installedAt: "",
      state: "active",
    };
  }

  private bundledView(id: string): ConnectorView {
    const bundled = this.options.bundled!;
    const server = bundled.get(id)!;
    const live = this.live.get(id);
    const plan = bundled.plan(id);
    const enabled = bundled.isEnabled(id);
    const checkedAt = new Date().toISOString();
    return {
      id,
      transport: "stdio",
      command: plan.ok ? plan.command : "",
      args: plan.ok ? plan.args : [],
      source: "bundled",
      installedAt: "",
      state: live ? "active" : "stashed",
      health: live
        ? { ok: true, checkedAt }
        : { ok: false, detail: !plan.ok ? plan.reason : enabled ? "未运行" : "未启用", checkedAt },
      tools: live?.tools() ?? [],
      bundled: {
        runtime: server.launch?.runtime ?? "",
        ...(!plan.ok ? { blocked: plan.reason } : {}),
        ...(server.launch?.note ? { note: server.launch.note } : {}),
      },
    };
  }

  /**
   * Load the manifest and start every **active** connector in it. Failures are
   * reported, not fatal. 暂存的一个都不起：用户添加时已经看到它连不上。
   */
  async load(): Promise<void> {
    this.specs = this.readManifest().items;
    for (const spec of this.specs) {
      if (spec.state === "stashed") continue;
      try {
        await this.bringUp(spec);
      } catch (cause) {
        // Still registered so the user sees it (with a failing health), and so
        // a binding through it fails with "unavailable" rather than "unknown".
        this.options.log?.(
          `[ruyin] connector "${spec.id}" failed to start: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
    }
    // 预置层：用户启用过的起来；起不了的（没 uv、缺环境变量）只记日志，界面里如实标。
    for (const id of this.options.bundled?.enabledIds() ?? []) {
      const plan = this.options.bundled!.plan(id);
      const spec = this.bundledSpec(id);
      if (!plan.ok || !spec) {
        this.options.log?.(`[ruyin] bundled tool server "${id}" not started: ${plan.ok ? "?" : plan.reason}`);
        continue;
      }
      try {
        // 起进程之前的准备（uvx 形态：首次把随包缓存种到数据目录）。
        await plan.prepare?.();
        await this.bringUp(spec);
      } catch (cause) {
        this.options.log?.(
          `[ruyin] bundled tool server "${id}" failed to start: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
    }
  }

  /** 预置服务器的 id（有启动规格的那些）。 */
  private bundledIds(): string[] {
    return this.options.bundled?.launchable().map((s) => s.id) ?? [];
  }

  isBundled(id: string): boolean {
    return this.bundledIds().includes(id);
  }

  async list(): Promise<ConnectorView[]> {
    const out: ConnectorView[] = [];
    for (const spec of this.specs) {
      out.push(
        spec.state === "stashed"
          ? this.viewOf(spec)
          : {
              ...spec,
              health: await this.healthOf(spec.id),
              tools: this.live.get(spec.id)?.tools() ?? [],
            },
      );
    }
    for (const id of this.bundledIds()) out.push(this.bundledView(id));
    return out;
  }

  // -- ConnectorToolSource (ADR-005 batch D) ------------------------------

  /** Does any running connector expose this tool - the machine-level question startTask asks. */
  exposes(tool: string): boolean {
    for (const connector of this.live.values()) {
      if (connector.tools().includes(tool)) return true;
    }
    return false;
  }

  /** Which of the *granted* connectors expose this tool - the project-level question execution asks. */
  providersOf(tool: string, granted: readonly string[]): string[] {
    return granted.filter((id) => this.live.get(id)?.tools().includes(tool) ?? false);
  }

  async callTool(
    connector: string,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<ConnectorToolOutcome> {
    const live = this.live.get(connector);
    if (!live) return { content: `connector "${connector}" is not running`, isError: true };
    return live.callTool(tool, args);
  }

  async healthOf(id: string): Promise<ConnectorHealth> {
    const connector = this.live.get(id);
    if (!connector) {
      return { ok: false, detail: "not running", checkedAt: new Date().toISOString() };
    }
    return connector.health();
  }

  /**
   * Install and start a connector. Refused in production until the signing
   * trust anchor exists - see the file header.
   */
  /**
   * 试连一次：起进程（或发一次握手请求）→ 握手 → 读工具清单 → 关掉。
   * **什么都不落盘**，也不进 `lookup` —— 添加页要在写下任何东西之前先告诉用户
   * 「这条命令/地址通不通」。
   *
   * 拒装规则（未签名，TD-036）不管这里：测试不让任何第三方代码留在机器上
   * （stdio 起一下就结束；HTTP 本来就不落地任何东西），生产上仍然装不进去，
   * 界面照实说。
   */
  async probe(input: ConnectorProbeInput): Promise<ConnectorProbe> {
    if (input.transport === "streamable_http") {
      const invalid = invalidHttpUrl(input.url);
      if (invalid) return { ok: false, tools: [], detail: invalid };
      const connector = new McpConnector(
        {
          id: input.id || "probe",
          transport: "streamable_http",
          url: input.url,
          ...(input.headers ? { headers: input.headers } : {}),
        },
        {
          ...(this.options.timeoutMs !== undefined ? { timeoutMs: this.options.timeoutMs } : {}),
          limits: this.options.limits ?? DEFAULT_RESOURCE_LIMITS,
        },
      );
      return this.probeConnector(connector);
    }
    if (!input.command) return { ok: false, tools: [], detail: "命令不能为空" };
    const connector = new McpConnector(
      {
        id: input.id || "probe",
        command: input.command,
        args: Array.isArray(input.args) ? input.args.map(String) : [],
        ...(input.env ? { env: input.env } : {}),
        // 试连也给工作目录：**这一条是打包冒烟真正走的那条路**（RUYIN_SMOKE=1 起
        // 一个 vendored 的 node 服务器），而 playwright-mcp 一起来就往 cwd 里写。
        cwd: this.workDirFor(input.id || "probe"),
      },
      {
        ...(this.options.timeoutMs !== undefined ? { timeoutMs: this.options.timeoutMs } : {}),
        limits: this.options.limits ?? DEFAULT_RESOURCE_LIMITS,
      },
    );
    return this.probeConnector(connector);
  }

  /** 试连的收尾：起、问健康、**一定**收摊 —— 留下一个孤儿进程比测试失败糟得多。 */
  private async probeConnector(connector: McpConnector): Promise<ConnectorProbe> {
    try {
      await connector.start();
      const health = await connector.health();
      return health.ok
        ? { ok: true, tools: connector.tools() }
        : { ok: false, tools: [], ...(health.detail ? { detail: health.detail } : {}) };
    } catch (cause) {
      return {
        ok: false,
        tools: [],
        detail: cause instanceof Error ? cause.message : String(cause),
      };
    } finally {
      await connector.stop().catch(() => {});
    }
  }

  async install(input: ConnectorInstallInput): Promise<ConnectorView> {
    if (!this.options.allowUnsigned) {
      throw new ConnectorInstallRefusedError(
        "connector installation is refused until connectors arrive signed (TD-012); " +
          "set RUYIN_ALLOW_UNSIGNED_CONNECTORS=1 for development only",
      );
    }
    if (!CONNECTOR_ID.test(input.id) || input.id === "local-fs") {
      throw new Error(`invalid connector id "${input.id}"`);
    }
    if (this.lookup.has(input.id)) {
      throw new Error(`connector "${input.id}" is already installed`);
    }
    if (input.source !== "lan" && input.source !== "private") {
      throw new Error(`connector source must be lan or private, got "${input.source}"`);
    }
    const stashed = input.state === "stashed";
    let spec: InstalledConnector;
    if (input.transport === "streamable_http") {
      const invalid = invalidHttpUrl(input.url);
      if (invalid) throw new Error(invalid);
      spec = {
        id: input.id,
        transport: "streamable_http",
        url: input.url,
        ...(input.headers ? { headers: input.headers } : {}),
        source: input.source,
        installedAt: new Date().toISOString(),
        state: stashed ? "stashed" : "active",
      };
    } else {
      if (!input.command || typeof input.command !== "string") {
        throw new Error("connector command is required");
      }
      spec = {
        id: input.id,
        transport: "stdio",
        command: input.command,
        args: Array.isArray(input.args) ? input.args.map(String) : [],
        ...(input.env ? { env: input.env } : {}),
        source: input.source,
        installedAt: new Date().toISOString(),
        state: stashed ? "stashed" : "active",
      };
    }
    // Start before persisting: a connector that cannot even initialize is
    // not installed, it is a typo the user should see now.
    //
    // 暂存的**不启动、不注册**：用户已经知道它连不上，硬起一次只会在这里
    // 再失败一遍，然后把一个用不了的名字塞进任务能拿到的清单里。
    if (!stashed) await this.bringUp(spec);
    this.specs.push(spec);
    this.writeManifest();
    return {
      ...spec,
      health: stashed ? stashedHealth() : await this.healthOf(spec.id),
      tools: this.live.get(spec.id)?.tools() ?? [],
    };
  }

  /**
   * 启用一个暂存的连接器：**重新试一次**，通了才转 active。
   * 通不过就保持暂存并把原因带回去 —— 换个状态不会让它连上。
   */
  async activate(id: string): Promise<ConnectorView> {
    if (this.isBundled(id)) return this.activateBundled(id);
    const spec = this.specs.find((s) => s.id === id);
    if (!spec) throw new Error(`connector "${id}" is not installed`);
    if (spec.state === "active") return this.viewOf(spec);
    // 起不来就**退回原样**。`bringUp` 是先注册后启动的（那样内核能报「不可用」
    // 而不是「不认识」），所以启动抛错时 live/lookup 里会留下一个半死的实例 ——
    // 对暂存的那个来说这是错的：它本来就不在名单里，启用失败后也不该在。
    const rollback = async (): Promise<void> => {
      const half = this.live.get(id);
      if (half) await half.stop().catch(() => {});
      this.live.delete(id);
      this.lookup.delete(id);
    };
    let detail: string | undefined;
    try {
      await this.bringUp(spec);
      const health = await this.healthOf(id);
      if (health.ok) {
        spec.state = "active";
        this.writeManifest();
        return this.viewOf(spec);
      }
      detail = health.detail;
    } catch (cause) {
      detail = cause instanceof Error ? cause.message : String(cause);
    }
    await rollback();
    throw new Error(`connector "${id}" still cannot start${detail ? ": " + detail : ""}`);
  }

  /**
   * 启用一个预置服务器：按启动计划起进程、握手、列工具；通了才记为启用。
   * 起不了的原因照原样带回（没 uv / 缺环境变量 / 入口不存在 / 进程退出）。
   */
  private async activateBundled(id: string): Promise<ConnectorView> {
    const bundled = this.options.bundled!;
    if (this.live.get(id)) return this.bundledView(id);
    const plan = bundled.plan(id);
    if (!plan.ok) throw new Error(`bundled tool server "${id}" cannot start: ${plan.reason}`);
    const spec = this.bundledSpec(id)!;
    try {
      await plan.prepare?.();
      await this.bringUp(spec);
      const health = await this.healthOf(id);
      if (health.ok) {
        bundled.setEnabled(id, true);
        return this.bundledView(id);
      }
      throw new Error(health.detail ?? "not healthy after start");
    } catch (cause) {
      const half = this.live.get(id);
      if (half) await half.stop().catch(() => {});
      this.live.delete(id);
      this.lookup.delete(id);
      throw new Error(`bundled tool server "${id}" still cannot start: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  /**
   * 停用：停进程、从内核的名单里拿掉。预置的记回 state.json；用户装的转「暂存」——
   * 配置留着，任务拿不到它（通则 B-3：动作是动词，状态是字符串）。
   */
  async deactivate(id: string): Promise<ConnectorView> {
    const live = this.live.get(id);
    if (live) await live.stop().catch(() => {});
    this.live.delete(id);
    this.lookup.delete(id);
    if (this.isBundled(id)) {
      this.options.bundled!.setEnabled(id, false);
      return this.bundledView(id);
    }
    const spec = this.specs.find((s) => s.id === id);
    if (!spec) throw new Error(`connector "${id}" is not installed`);
    spec.state = "stashed";
    this.writeManifest();
    return this.viewOf(spec);
  }

  /** 预置服务器要的环境变量（例如 SEARXNG_URL）。不是密钥的地方 —— 密钥归 Runos 保险库。 */
  setBundledEnv(id: string, env: Record<string, string>): ConnectorView {
    if (!this.isBundled(id)) throw new Error(`"${id}" is not a bundled tool server`);
    this.options.bundled!.setEnv(id, env);
    return this.bundledView(id);
  }

  private viewOf(spec: InstalledConnector): ConnectorView {
    return {
      ...spec,
      health:
        spec.state === "stashed"
          ? stashedHealth()
          : {
              ok: !!this.live.get(spec.id),
              ...(this.live.get(spec.id) ? {} : { detail: "未运行" }),
              checkedAt: new Date().toISOString(),
            },
      tools: this.live.get(spec.id)?.tools() ?? [],
    };
  }

  async remove(id: string): Promise<void> {
    if (this.isBundled(id)) {
      throw new ConnectorBundledError(`"${id}" 随安装包预置，不能卸载，只能停用`);
    }
    const idx = this.specs.findIndex((s) => s.id === id);
    if (idx < 0) throw new Error(`connector "${id}" is not installed`);
    const connector = this.live.get(id);
    if (connector) await connector.stop();
    this.live.delete(id);
    this.lookup.delete(id);
    this.specs.splice(idx, 1);
    this.writeManifest();
  }

  /** Stop every running connector (daemon shutdown). */
  async stopAll(): Promise<void> {
    for (const connector of this.live.values()) await connector.stop();
    this.live.clear();
  }

  /**
   * 现在有几个工具服务器子进程活着，以及它们是谁。
   *
   * 报**名字**而不只是数量：判据里那句「超限时说得出是谁超的」落在这里 ——
   * 「已达上限 6」对用户等于没说，他要知道是哪六个占着才能去停一个。
   */
  get runningServers(): string[] {
    return [...this.live.keys()];
  }

  private async bringUp(spec: InstalledConnector): Promise<void> {
    const { id } = spec;
    // 上限（TD-046）。每个 stdio 工具服务器都是一个完整的解释器进程；HTTP 连接器
    // 没有子进程，但一样占着这台机器上的一个活跃连接，同一张表统一数——已经在
    // 跑的那个再启用一次不算新占名额（activate 会走到这里，但它复用同一个 id）。
    const max = this.options.limits?.maxToolServers ?? DEFAULT_RESOURCE_LIMITS.maxToolServers;
    if (!this.live.has(id) && this.live.size >= max) {
      throw new Error(overLimitMessage("同时运行的工具服务器", max, this.runningServers));
    }
    const connector = new McpConnector(
      spec.transport === "streamable_http"
        ? { id, transport: "streamable_http", url: spec.url, ...(spec.headers ? { headers: spec.headers } : {}) }
        : { id, command: spec.command, args: spec.args, ...(spec.env ? { env: spec.env } : {}), cwd: this.workDirFor(id) },
      {
        ...(this.options.timeoutMs !== undefined ? { timeoutMs: this.options.timeoutMs } : {}),
        limits: this.options.limits ?? DEFAULT_RESOURCE_LIMITS,
      },
    );
    // Registered before start so a failed start still leaves a name the UI
    // and the kernel can report on ("unavailable", not "unknown connector").
    this.live.set(id, connector);
    this.lookup.set(id, connector);
    await connector.start();
  }

  private readManifest(): Manifest {
    if (!existsSync(this.manifestPath)) return { items: [] };
    try {
      const parsed = JSON.parse(readFileSync(this.manifestPath, "utf8")) as Partial<Manifest>;
      // `state` 是 2026-09-04 加的。**旧清单里没有它的一律算 active** —— 那些
      // 连接器本来就是装上就跑的；默认成暂存会让升级一次静静地停掉所有连接器。
      return {
        items: (Array.isArray(parsed.items) ? parsed.items : []).map((item) => ({
          ...item,
          state: item.state === "stashed" ? "stashed" : "active",
        })),
      };
    } catch (cause) {
      this.options.log?.(
        `[ruyin] ${CONNECTORS_FILE} unreadable, starting with no connectors: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
      return { items: [] };
    }
  }

  private writeManifest(): void {
    mkdirSync(dirname(this.manifestPath), { recursive: true });
    writeFileSync(this.manifestPath, JSON.stringify({ items: this.specs }, null, 2), "utf8");
  }
}
