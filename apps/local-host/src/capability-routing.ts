/**
 * 能力路由（ADR-025）—— 智能体只认 Runos 协议，走本机还是走云端由这里决定。
 *
 * @package @vxture/ruyin-local-host
 *
 * ── 三层判定，顺序不能换 ──
 *   1. 能力本身的硬约束：要第三方密钥的只能云端（密钥在 Runos 保险库，客户端零秘密）；
 *      内网连接器只能本机；本机没装的只能云端。**配置改不了这一层。**
 *   2. 配置：能力 > 工作区 > 租户 > 默认，越具体越优先。**默认只许本机**（owner 2026-09-15）。
 *   3. 可用性：云端通路**未开放时视为不可用**（{@link CLOUD_ROUTE_OPEN}）；离线时同样不可用。
 *
 * ── 不许悄悄出域 ──
 * `local_only` 下本机做不了就是 `unavailable`，绝不改道云端：改道意味着数据离开本机而
 * 用户不知道。只有配置明写 `prefer_*` 才可能走云端，而且结果里带着原因。
 *
 * 这一层只做判定、不做调用：纯函数，脱离网络与宿主可测。
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** 三档（ADR-025 §2.2）。字符串枚举，不用布尔 —— 三态本来就装不进布尔。 */
export type RouteMode = "local_only" | "prefer_local" | "prefer_cloud";
export const ROUTE_MODES: readonly RouteMode[] = ["local_only", "prefer_local", "prefer_cloud"];

export const ROUTE_MODE_LABEL: Record<RouteMode, string> = {
  local_only: "只许本机",
  prefer_local: "优先本机",
  prefer_cloud: "优先云端",
};

/**
 * 面向用户的名字与它必须带着的那句说明（ADR-025 §2.4）。叫 Runos 好理解，但本机跑的
 * 不是云端 Runos 服务 —— 名字出现的地方，说明必须一起出现。
 */
export const LOCAL_PLANE_NAME = "Runos";
export const LOCAL_PLANE_NOTE = "兼容 Runos 协议的本地能力面";

/**
 * 云端通路开没开放。**P4 之前恒为 false**（ADR-025 §3）：平台还没有会话中转的调用接口，
 * 本机也还没实现那条路。它是一个常量而不是配置 —— 开放是一次发版，不是一个开关。
 */
export const CLOUD_ROUTE_OPEN = false;

export interface RoutingPolicy {
  default: RouteMode;
  tenants: Record<string, RouteMode>;
  workspaces: Record<string, RouteMode>;
  capabilities: Record<string, RouteMode>;
}

export const DEFAULT_ROUTING_POLICY: RoutingPolicy = Object.freeze({
  default: "local_only",
  tenants: Object.freeze({}),
  workspaces: Object.freeze({}),
  capabilities: Object.freeze({}),
}) as RoutingPolicy;

/** 策略文件的位置：`<dataDir>/capabilities/routing.json`。只有策略，没有秘密。 */
export function routingPolicyPath(dataDir: string): string {
  return join(dataDir, "capabilities", "routing.json");
}

function isMode(v: unknown): v is RouteMode {
  return typeof v === "string" && (ROUTE_MODES as readonly string[]).includes(v);
}

/**
 * 解析策略。**不抛**：认不出的条目丢掉并记一条原因，其余照用 —— 一个写错的工作区
 * 条目不该让整份策略作废，更不该让守护进程起不来。缺的键按默认补齐。
 */
export function parseRoutingPolicy(raw: unknown): { policy: RoutingPolicy; errors: string[] } {
  const errors: string[] = [];
  const policy: RoutingPolicy = { default: "local_only", tenants: {}, workspaces: {}, capabilities: {} };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    errors.push("策略不是一个对象，按默认（只许本机）");
    return { policy, errors };
  }
  const r = raw as Record<string, unknown>;
  if (r["default"] !== undefined) {
    if (isMode(r["default"])) policy.default = r["default"];
    else errors.push(`default 不是认得的档位：${JSON.stringify(r["default"])}，按只许本机`);
  }
  for (const key of ["tenants", "workspaces", "capabilities"] as const) {
    const table = r[key];
    if (table === undefined) continue;
    if (!table || typeof table !== "object" || Array.isArray(table)) {
      errors.push(`${key} 不是一个对象，忽略`);
      continue;
    }
    for (const [id, mode] of Object.entries(table as Record<string, unknown>)) {
      if (id.length > 0 && isMode(mode)) policy[key][id] = mode;
      else errors.push(`${key}.${id} 不是认得的档位：${JSON.stringify(mode)}，忽略`);
    }
  }
  return { policy, errors };
}

/**
 * 读本机策略文件。没有文件就是默认，不是错误；读坏了按默认并说明。
 * 平台下发（ADR-025 P3）接上之后，平台的覆盖这一份。
 */
export function loadRoutingPolicy(dataDir: string): {
  policy: RoutingPolicy;
  source: "default" | "file";
  errors: string[];
} {
  const path = routingPolicyPath(dataDir);
  if (!existsSync(path)) return { policy: DEFAULT_ROUTING_POLICY, source: "default", errors: [] };
  try {
    const { policy, errors } = parseRoutingPolicy(JSON.parse(readFileSync(path, "utf8")));
    return { policy, source: "file", errors };
  } catch (cause) {
    return {
      policy: DEFAULT_ROUTING_POLICY,
      source: "default",
      errors: [`策略文件读不出来（${cause instanceof Error ? cause.message : String(cause)}），按默认（只许本机）`],
    };
  }
}

export interface RouteContext {
  tenantId?: string;
  workspaceId?: string;
  capabilityId?: string;
}

export type ModeSource = "capability" | "workspace" | "tenant" | "default";

/** 按「能力 > 工作区 > 租户 > 默认」取出这次调用适用的档位。 */
export function modeFor(policy: RoutingPolicy, ctx: RouteContext): { mode: RouteMode; source: ModeSource } {
  if (ctx.capabilityId && policy.capabilities[ctx.capabilityId]) {
    return { mode: policy.capabilities[ctx.capabilityId]!, source: "capability" };
  }
  if (ctx.workspaceId && policy.workspaces[ctx.workspaceId]) {
    return { mode: policy.workspaces[ctx.workspaceId]!, source: "workspace" };
  }
  if (ctx.tenantId && policy.tenants[ctx.tenantId]) {
    return { mode: policy.tenants[ctx.tenantId]!, source: "tenant" };
  }
  return { mode: policy.default, source: "default" };
}

/** 一项能力此刻的事实。由调用方从登记册与网络状态里填，这里不去查。 */
export interface CapabilityFacts {
  /** 本机登记册里有它、而且起得来。 */
  localAvailable: boolean;
  /** 要第三方密钥（`runos-registered` / `needsKey`）—— 本机永远做不了。 */
  requiresCredential?: boolean;
  /** 内网 / 私有系统连接器 —— 云端永远到不了。 */
  intranetOnly?: boolean;
  /** 网络是否在线；缺省视为在线。 */
  online?: boolean;
  /** 云端通路是否开放；缺省取 {@link CLOUD_ROUTE_OPEN}。只给测试与 P4 用。 */
  cloudOpen?: boolean;
}

export interface RouteDecision {
  mode: RouteMode;
  modeSource: ModeSource;
  route: "local" | "cloud" | "unavailable";
  /** 给界面与审计的一句话。**每个结果都有原因**，包括走通了的。 */
  reason: string;
}

/** ADR-025 §2.3：硬约束 → 配置 → 可用性。 */
export function decideRoute(
  policy: RoutingPolicy,
  ctx: RouteContext,
  facts: CapabilityFacts,
): RouteDecision {
  const { mode, source } = modeFor(policy, ctx);
  const canLocal = facts.localAvailable && facts.requiresCredential !== true;
  const cloudOpen = facts.cloudOpen ?? CLOUD_ROUTE_OPEN;
  const online = facts.online ?? true;
  const canCloud = facts.intranetOnly !== true && cloudOpen && online;

  const whyNotLocal = facts.requiresCredential
    ? "这项能力要第三方密钥，密钥只在云端 Runos 保险库，本机做不了"
    : "本机没有这项能力，或它此刻起不来";
  const whyNotCloud = facts.intranetOnly
    ? "这是内网能力，云端到不了"
    : !cloudOpen
      ? "云端 Runos 通路尚未开放"
      : "当前离线，到不了云端";
  const decision = (route: RouteDecision["route"], reason: string): RouteDecision => ({
    mode,
    modeSource: source,
    route,
    reason,
  });

  if (mode === "local_only") {
    return canLocal
      ? decision("local", `按「只许本机」在${LOCAL_PLANE_NOTE}执行`)
      : decision("unavailable", `${whyNotLocal}；当前配置只许本机，不改走云端`);
  }
  if (mode === "prefer_local") {
    if (canLocal) return decision("local", `按「优先本机」在${LOCAL_PLANE_NOTE}执行`);
    if (canCloud) return decision("cloud", `${whyNotLocal}；按「优先本机」的配置改走云端 Runos`);
    return decision("unavailable", `${whyNotLocal}；${whyNotCloud}`);
  }
  if (canCloud) return decision("cloud", "按「优先云端」经云端 Runos 执行");
  if (canLocal) return decision("local", `${whyNotCloud}，按「优先云端」的配置退到${LOCAL_PLANE_NOTE}执行`);
  return decision("unavailable", `${whyNotCloud}；${whyNotLocal}`);
}
