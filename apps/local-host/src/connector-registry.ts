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
import { dirname, join } from "node:path";
import type { ConnectorHealth, ConnectorPort, ContextSource } from "@vxture/ruyin-core";
import { McpConnector, type ConnectorToolOutcome } from "./connector-mcp.js";
import type { ConnectorToolSource } from "./tool-executor.js";
import type { BundledToolServers } from "./tool-servers.js";

export const CONNECTORS_FILE = "connectors.json";

/** Ids follow the contract's id grammar plus dashes; never local-fs. */
const CONNECTOR_ID = /^[a-z][a-z0-9_-]{0,63}$/;

export interface InstalledConnector {
  id: string;
  transport: "stdio";
  command: string;
  args: string[];
  env?: Record<string, string>;
  /**
   * Which contract source kind this connector serves (lan / private) —— 或
   * `bundled`：随安装包预置的 MCP 服务器（ADR-018 §2.2，tool-servers.ts），
   * 不在 connectors.json 里，启用状态记在 <dataDir>/tools/state.json。
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

export interface ConnectorView extends InstalledConnector {
  health: ConnectorHealth;
  /** Tools the running server exposes (tools/list at start); empty when not running. */
  tools: string[];
  /** 预置服务器才有：怎么起、现在为什么起不了（没 uv / 缺环境变量 / 没随包）。 */
  bundled?: { runtime: string; blocked?: string; note?: string };
}

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

interface Manifest {
  items: InstalledConnector[];
}

export class ConnectorRegistry implements ConnectorToolSource {
  private readonly manifestPath: string;
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
    },
  ) {
    this.manifestPath = join(dataDir, CONNECTORS_FILE);
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
      const spec = this.bundledSpec(id);
      if (!spec) {
        const plan = this.options.bundled!.plan(id);
        this.options.log?.(`[ruyin] bundled tool server "${id}" not started: ${plan.ok ? "?" : plan.reason}`);
        continue;
      }
      try {
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
   * 试连一次：起进程 → 握手 → 读工具清单 → 关掉。**什么都不落盘**，也不进
   * `lookup` —— 添加页要在写下任何东西之前先告诉用户「这条命令通不通」。
   *
   * 拒装规则（未签名，TD-036）不管这里：测试不让任何第三方代码留在机器上，
   * 它起一下就结束。生产上仍然装不进去，界面照实说。
   */
  async probe(input: {
    id: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }): Promise<ConnectorProbe> {
    if (!input.command) return { ok: false, tools: [], detail: "命令不能为空" };
    const connector = new McpConnector(
      {
        id: input.id || "probe",
        command: input.command,
        args: Array.isArray(input.args) ? input.args.map(String) : [],
        ...(input.env ? { env: input.env } : {}),
      },
      this.options.timeoutMs !== undefined ? { timeoutMs: this.options.timeoutMs } : {},
    );
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
      // 测完一定要收摊：留下一个孤儿进程比测试失败糟得多。
      await connector.stop().catch(() => {});
    }
  }

  async install(input: {
    id: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
    source: string;
    /** `stashed` = 存下来但不启用（测试没通过时用户选择先留着）。 */
    state?: string;
  }): Promise<ConnectorView> {
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
    if (!input.command || typeof input.command !== "string") {
      throw new Error("connector command is required");
    }
    if (input.source !== "lan" && input.source !== "private") {
      throw new Error(`connector source must be lan or private, got "${input.source}"`);
    }
    const stashed = input.state === "stashed";
    const spec: InstalledConnector = {
      id: input.id,
      transport: "stdio",
      command: input.command,
      args: Array.isArray(input.args) ? input.args.map(String) : [],
      ...(input.env ? { env: input.env } : {}),
      source: input.source,
      installedAt: new Date().toISOString(),
      state: stashed ? "stashed" : "active",
    };
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

  private async bringUp(spec: InstalledConnector): Promise<void> {
    const { id, command, args, env } = spec;
    const connector = new McpConnector(
      { id, command, args, ...(env ? { env } : {}) },
      this.options.timeoutMs !== undefined ? { timeoutMs: this.options.timeoutMs } : {},
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
