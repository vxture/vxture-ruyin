/**
 * 工具登记册的只读视图（ADR-018 §2.1）—— 「能力平台」清单里「工具」那一半。
 *
 * 三处来源合成一张表，各说各的状态，不把「登记了」写成「能跑」：
 *
 *   builtin    运行时内建的四个（read_file / write_document / search_knowledge /
 *              export_result）加两个技能工具（use_skill / read_skill_resource）
 *   connector  已装连接器暴露的 MCP 工具（运行中才有名字；ADR-005 通路二）
 *   mcp-server 预置清单里的 MCP 服务器定义（随安装包来的 index.json）。**目前只是
 *              登记**：清单里每条的 launch 规格都还是空的，本机起不来，所以状态
 *              是 registered 而不是 available（TD-042）。需要密钥的那一档经 Runos
 *              注册、不进本机（ADR-020 §6-2），状态 runos。
 */

import { SKILL_TOOLS } from "@vxture/ruyin-core";
import type { ComponentState } from "./component-store.js";
import type { BundledServer } from "./tool-servers.js";

export type ToolKind = "builtin" | "connector" | "mcp-server";
/**
 * `needs-acquisition` / `acquiring` 是 2026-09-06 加的两种（ADR-018 §7.2）。
 * 在此之前，一条「起不来是因为缺一件要下载的载荷」的行**一个可点的东西都没有**：
 * 按钮由 `launchable` 门控，而这类服务器只设 `detail`、不设 `launchable`，于是只
 * 剩一个中性的「已登记」徽标。照 TD-037 定下的先例：**能列不能装的时候把话写在
 * 界面上，不要把按钮藏掉。**
 */
export type ToolStatus = "available" | "unavailable" | "needs-acquisition" | "acquiring" | "registered" | "runos";

/**
 * 一行工具旁边那半句话，**用码不用话**（2026-09-17）。
 *
 * 两个理由，各自都足够：
 *
 * ① **翻译。** 这半句原来是守护进程拼好的中文，界面照着渲染 —— 英文界面下
 *    它仍然是中文。界面按码说话，两门语言各说各的。
 * ② **措辞。** 更要紧的一条：原来这里会漏出预置清单的 `launchNote`，而那个
 *    字段装的是**我们自己的工程笔记** —— 带日期的降档决策、闭包体积、
 *    「死重」「归属未核实」，连 Markdown 星号都在里面。那是写给我们看的，
 *    任何语言下都不该摆到用户面前（owner 2026-09-17 的口径）。
 *
 * 真正对用户有用的那半句被混在同一个字段里（「需要本机有 pandoc」「需要先配
 * 环境变量 SEARXNG_URL」）—— 后者本来就是结构化的（`launch.requiresEnv`），
 * 所以它单独成一个码，带着变量名过去。
 */
export type ToolDetailCode =
  | "no-search-index"
  | "not-implemented"
  | "no-skill-registry"
  | "connector-stashed"
  | "connector-stopped"
  | "via-runos"
  | "no-launch-spec"
  | "running"
  | "launchable"
  | "not-enabled"
  | "needs-env"
  | "blocked";

export interface ToolView {
  id: string;
  kind: ToolKind;
  /** builtin: "runtime" / "skills"；connector: 连接器 id；mcp-server: 清单来源 id。 */
  source: string;
  status: ToolStatus;
  /** 界面据此说话。诊断细节不走这里 —— 见 `ToolDetailCode` 的说明。 */
  detailCode?: ToolDetailCode;
  /** 码要带的值（`running` 的运行时名、`needs-env` 的变量名）。**不含散文。** */
  detailVars?: Record<string, string>;
  license?: string;
  tier?: string;
  /**
   * mcp-server / connector：它暴露（或清单说它有）的工具名。
   * **停着的服务器也有** —— 名字来自构建时探过一次的目录（resources/tools/index.json），
   * 所以用户在下载之前就看得见这台机器将要多出哪些工具（TD-034 的那一半）。
   */
  tools?: string[];
  /** 目录里为什么没有工具名（起不来就探不到）。**绝不用空数组冒充「它什么都不暴露」。** */
  toolsUnprobed?: string;
  /** mcp-server：有本机启动规格（能启动 / 能停），还是只登记。 */
  launchable?: boolean;
  /**
   * 起它要先获取的那件载荷。体积、许可证、来源主机都在这里 —— 界面把它们放在
   * 按钮左边，**点之前就看得见要下多少**。地址不在这里：地址只在守护进程手上。
   */
  component?: {
    id: string;
    state: ComponentState;
    downloadBytes: number;
    diskBytes: number;
    license: string;
    origin: string;
    /** 正在取时的进度；别的状态没有。 */
    receivedBytes?: number;
    totalBytes?: number;
    /** 失败时那句话，按 ComponentState 分类，不折叠成「失败」。 */
    reason?: string;
  };
}

/** 内建四个 —— 与 tool-executor.ts 的 IMPLEMENTED 同一份名单，缺一个就是漂移。 */
export const BUILTIN_TOOL_IDS = ["read_file", "write_document", "search_knowledge", "export_result"] as const;

export interface ToolRegistrySources {
  /** 运行时支持这个内建工具吗（search_knowledge 缺检索时不支持）。 */
  supportsBuiltin: (id: string) => boolean;
  /** 技能登记册在不在（不在 = 两个技能工具也不在）。 */
  hasSkills: () => boolean;
  connectors?: () => Promise<
    Array<{ id: string; source: string; state: string; health: { ok: boolean; detail?: string }; tools: string[]; bundled?: { blocked?: string } }>
  >;
  /** 预置的 MCP 服务器定义（tools/index.json）；缺省 = 没有预置工具层。 */
  bundledServers?: () => BundledServer[];
  /** 这台机器上现在能不能起它 —— 起不了时说清是哪一种起不了。 */
  planFor?: (id: string) => { ok: boolean; reason?: string; needsComponent?: string };
  /** 获取通道的组件此刻的样子（体积 / 许可证 / 来源 / 进度）。 */
  componentStatus?: (id: string) => ToolView["component"] | undefined;
}

export class ToolRegistryView {
  constructor(private readonly sources: ToolRegistrySources) {}

  async list(): Promise<ToolView[]> {
    const out: ToolView[] = [];
    for (const id of BUILTIN_TOOL_IDS) {
      const ok = this.sources.supportsBuiltin(id);
      out.push({
        id,
        kind: "builtin",
        source: "runtime",
        status: ok ? "available" : "unavailable",
        ...(ok
          ? {}
          : {
              detailCode: (id === "search_knowledge"
                ? "no-search-index"
                : "not-implemented") as ToolDetailCode,
            }),
      });
    }
    const skills = this.sources.hasSkills();
    for (const t of SKILL_TOOLS) {
      out.push({
        id: t.id,
        kind: "builtin",
        source: "skills",
        status: skills ? "available" : "unavailable",
        ...(skills ? {} : { detailCode: "no-skill-registry" as ToolDetailCode }),
      });
    }
    const connectors = (await this.sources.connectors?.()) ?? [];
    for (const c of connectors) {
      if (c.source === "bundled") continue; // 预置服务器按 mcp-server 列，见下
      const running = c.state === "active" && c.health.ok;
      out.push({
        id: c.id,
        kind: "connector",
        source: c.id,
        status: running ? "available" : "unavailable",
        // 连接器没起来时，**健康检查那句原话不再往外递** —— 它是给排障的人看的
        // （见 api-message.ts 同一条分寸）。用户要知道的只有「没在跑」。
        ...(running
          ? {}
          : {
              detailCode: (c.state === "stashed"
                ? "connector-stashed"
                : "connector-stopped") as ToolDetailCode,
            }),
        tools: c.tools,
      });
    }
    const byId = new Map(connectors.filter((c) => c.source === "bundled").map((c) => [c.id, c]));
    for (const s of this.sources.bundledServers?.() ?? []) {
      const viaRunos = s.tier === "runos-registered" || s.needsKey === true;
      const view: ToolView = { id: s.id, kind: "mcp-server", source: s.id, status: "registered" };
      if (s.license) view.license = s.license;
      if (s.tier) view.tier = s.tier;
      // 目录来的工具名：**停着的、甚至还没获取的服务器也列出来**。
      // 在此之前 view.tools 只在 live 分支里赋值，于是停着的服务器一个名字都不显示 ——
      // 而契约作者要照着这些名字写 provider: connector 的工具声明（TD-034）。
      if (s.tools && s.tools.length > 0) view.tools = s.tools;
      else if (s.toolsUnprobed) view.toolsUnprobed = s.toolsUnprobed;
      const live = byId.get(s.id);
      if (viaRunos) {
        view.status = "runos";
        view.detailCode = "via-runos";
      } else if (!s.launch) {
        // **`launchNote` 到此为止。** 它是清单里我们自己的工程笔记（降档理由、
        // 闭包体积、归属存疑），不是说给用户听的话。用户在这一行要知道的只有
        // 一件事：这一台上它还起不来。
        view.detailCode = "no-launch-spec";
      } else if (live) {
        // 有启动规格：状态是它此刻真实的样子。
        view.launchable = true;
        const running = live.state === "active" && live.health.ok;
        view.status = running ? "available" : live.bundled?.blocked ? "unavailable" : "registered";
        if (running) {
          view.detailCode = "running";
          view.detailVars = { runtime: s.launch.runtime };
        } else if (live.bundled?.blocked) {
          // 起不来的具体原因里，**只有「差环境变量」是用户能动手的**，而它本来
          // 就是结构化的。其余（差外部程序、平台不支持…）一律说「没启用」——
          // 把守护进程的原话摆出去，用户读到的是一段他无从下手的诊断。
          const env = s.launch.requiresEnv ?? [];
          if (env.length > 0) {
            view.detailCode = "needs-env";
            view.detailVars = { names: env.join(", ") };
          } else {
            view.detailCode = "blocked";
          }
        } else {
          view.detailCode = "not-enabled";
        }
        // 运行中的以它自己报的为准：目录是构建时的一张快照，运行时的 tools/list 才是权威。
        if (live.tools.length > 0) view.tools = live.tools;
      } else {
        view.launchable = true;
        view.detailCode = "launchable";
        view.detailVars = { runtime: s.launch.runtime };
      }
      // 起不来是因为差一件可获取的载荷：这不是「不可用」，是「还没获取」——
      // 一个用户点一下就能改变的事实，所以给它自己的状态和自己的按钮。
      const plan = this.sources.planFor?.(s.id);
      if (plan && !plan.ok && plan.needsComponent && view.status !== "available") {
        const component = this.sources.componentStatus?.(plan.needsComponent);
        if (component) {
          view.component = component;
          view.status = component.state === "acquiring" ? "acquiring" : "needs-acquisition";
          // 载荷那一行自己会说清要下多少、许可证与来源（界面渲染 `component`），
          // 这里把上一支留下的码清掉：一个「还没获取」的行不是「可启动」的，
          // 两句并排会自相矛盾。
          delete view.detailCode;
          delete view.detailVars;
        }
      }
      out.push(view);
    }
    return out;
  }
}
