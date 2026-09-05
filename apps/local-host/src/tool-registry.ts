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
import type { BundledIndex } from "./skill-registry.js";

export type ToolKind = "builtin" | "connector" | "mcp-server";
export type ToolStatus = "available" | "unavailable" | "registered" | "runos";

export interface ToolView {
  id: string;
  kind: ToolKind;
  /** builtin: "runtime" / "skills"；connector: 连接器 id；mcp-server: 清单来源 id。 */
  source: string;
  status: ToolStatus;
  detail?: string;
  license?: string;
  tier?: string;
  /** mcp-server / connector：它暴露（或清单说它有）的工具名。 */
  tools?: string[];
}

/** 内建四个 —— 与 tool-executor.ts 的 IMPLEMENTED 同一份名单，缺一个就是漂移。 */
export const BUILTIN_TOOL_IDS = ["read_file", "write_document", "search_knowledge", "export_result"] as const;

interface ManifestServer {
  id: string;
  repo?: string;
  license?: string;
  tier?: string;
  needsKey?: boolean;
  launch?: unknown;
  note?: string;
}

export interface ToolRegistrySources {
  /** 运行时支持这个内建工具吗（search_knowledge 缺检索时不支持）。 */
  supportsBuiltin: (id: string) => boolean;
  /** 技能登记册在不在（不在 = 两个技能工具也不在）。 */
  hasSkills: () => boolean;
  connectors?: () => Promise<Array<{ id: string; state: string; health: { ok: boolean; detail?: string }; tools: string[] }>>;
  bundledIndex?: () => BundledIndex | undefined;
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
        ...(ok ? {} : { detail: id === "search_knowledge" ? "这套装配没有检索索引" : "运行时未实现" }),
      });
    }
    const skills = this.sources.hasSkills();
    for (const t of SKILL_TOOLS) {
      out.push({
        id: t.id,
        kind: "builtin",
        source: "skills",
        status: skills ? "available" : "unavailable",
        ...(skills ? {} : { detail: "没有技能登记册" }),
      });
    }
    for (const c of (await this.sources.connectors?.()) ?? []) {
      const running = c.state === "active" && c.health.ok;
      out.push({
        id: c.id,
        kind: "connector",
        source: c.id,
        status: running ? "available" : "unavailable",
        ...(running ? {} : { detail: c.state === "stashed" ? "已暂存，未启用" : (c.health.detail ?? "未运行") }),
        tools: c.tools,
      });
    }
    const servers = (this.sources.bundledIndex?.()?.servers ?? []) as ManifestServer[];
    for (const s of servers) {
      if (typeof s?.id !== "string") continue;
      const viaRunos = s.tier === "runos-registered" || s.needsKey === true;
      const view: ToolView = {
        id: s.id,
        kind: "mcp-server",
        source: s.id,
        status: viaRunos ? "runos" : "registered",
        detail: viaRunos
          ? "经 Runos 注册，密钥在 Runos 保险库，本机不装（ADR-020 §6-2）"
          : "已登记；本机启动规格未定，尚不能启动（TD-042）",
      };
      if (s.license) view.license = s.license;
      if (s.tier) view.tier = s.tier;
      out.push(view);
    }
    return out;
  }
}
