/**
 * 用户对工具的策略（TD-050）—— Tool Gate 三层里唯一一层此前永远是空的。
 *
 * ## 这一层为什么必须真的存在
 *
 * `decideTool()` 合成三样：**硬底线 ∧ 用户策略 ∧ 契约默认**。另外两层都有真实
 * 来源 —— 硬底线写死在内核，契约默认来自契约；只有中间这层此前恒为 `undefined`
 * （harness 里那行注释就写着「还没有存储」）。于是「用户可以收紧、也可以在底线
 * 之外放宽」这句承诺一次都兑现不了：界面上看到的每一条工具权限，全部来自契约
 * 默认，用户改不了、改了也不留。
 *
 * 三层合成的代码一直在那儿，一致性套件也测过它 —— **一个从没被走过的路径，坏了
 * 和好了长得一模一样**。
 *
 * ## 它跟着项目走，不是全局开关
 *
 * 与授权目录同层（存在同一个项目库里）。理由是具体的：授权本来就是以项目为边界
 * 的（ADR-005 第 4 条），而「在这个项目里我允许它写文件」与「在所有项目里都允许」
 * 是两件差得很远的事。一个全局开关会让用户在一个低风险项目里做的放宽，悄悄跟到
 * 他下一个碰真实客户资料的项目里去。
 *
 * ## 硬底线不可被它放松
 *
 * 这不是这里判的，是 `decideTool()` 的 `stricter()` 合并保证的 —— 但**写下策略
 * 的这一侧也要拦一道**：让一条「external_send: allow」落进库里，等于在记录上留
 * 一句永远不会生效的话。用户会以为他关掉了那道确认，而每次仍然会被问 —— 那比
 * 拒绝他更糟，因为他不知道自己没改成。
 *
 * 所以这里**当场拒绝并说明白**：不是悄悄存下来再在读的时候忽略。
 */

import type { PermissionValue, Tool } from "@vxture/ruyin-contract-schema";

/** 工具 id → 用户设定。没有条目 = 用户没表态，走契约默认。 */
export type ToolPolicy = Record<string, PermissionValue>;

const VALUES: readonly PermissionValue[] = ["allow", "ask", "deny"];

export class ToolPolicyError extends Error {
  /**
   * 三种拒绝，**在 API 上不是同一件事**，所以这里就分开而不是留给上层猜措辞：
   *
   * - `floor`        底线之下的放宽 → 403 POLICY_DENIED。这是一次**策略拒绝**：
   *                  请求本身没毛病，是规则不让。用户要看到「能改到哪儿为止」。
   * - `unknown_tool` 这个产品的契约里没有这个工具 → 400。请求写错了。
   * - `bad_value`    不是 allow / ask / deny → 400。同上。
   *
   * 全都报成 POLICY_DENIED 的话，一个拼错工具名的请求会告诉用户「策略不允许」，
   * 而他会去找一个并不存在的策略。
   */
  constructor(
    message: string,
    readonly kind: "floor" | "unknown_tool" | "bad_value" = "floor",
  ) {
    super(message);
  }
}

/** allow < ask < deny，与 tool-gate 同一把尺子。 */
const STRICTNESS: Record<PermissionValue, number> = { allow: 0, ask: 1, deny: 2 };

/**
 * 存下来的 JSON 读回成策略表。
 *
 * **认不出来的一律丢掉，而不是留着**：一条值为 `"maybe"` 的记录，读的时候会被
 * `decideTool` 当成一个合法的 PermissionValue 传下去。宁可当作用户没表态（回落
 * 到契约默认，也就是更保守的那条路），也不要把一个来路不明的值送进闸门。
 */
export function parseToolPolicy(json: string | undefined): ToolPolicy {
  if (!json) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return {};
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: ToolPolicy = {};
  for (const [tool, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string" && (VALUES as readonly string[]).includes(value)) {
      out[tool] = value as PermissionValue;
    }
  }
  return out;
}

/**
 * 硬底线：这些类别的工具，用户策略只能收紧，不能放宽。
 *
 * 与 `tool-gate.ts` 的 `HARD_FLOOR` **是同一张表**，所以从那边导入而不是抄一份
 * —— 抄一份的话，哪天底线加了一类，这边不会跟着加，而症状是「用户成功地放宽了
 * 一个不该被放宽的东西」，没有任何一处会响。
 */
import { HARD_FLOOR } from "./tool-gate.js";
export { HARD_FLOOR };

/**
 * 写一条策略之前先问：这条写得下去吗。
 *
 * 返回 `undefined` = 可以；返回一句话 = 不行，而那句话是要给用户看的。
 */
export function policyRefusal(
  tool: Tool,
  value: PermissionValue,
): { message: string; kind: "floor" | "bad_value" } | undefined {
  if (!(VALUES as readonly string[]).includes(value)) {
    return {
      message: `"${value}" 不是一个权限值（只能是 allow / ask / deny）`,
      kind: "bad_value",
    };
  }
  const floor = HARD_FLOOR[tool.category];
  if (floor && STRICTNESS[value] < STRICTNESS[floor]) {
    return {
      message:
        `工具 "${tool.id}" 属于 ${tool.category}，它的底线是「${floor}」，不能放宽到` +
        `「${value}」—— 数据发出去收不回来，所以每次都要有人点头。可以收紧到 deny。`,
      kind: "floor",
    };
  }
  return undefined;
}

/**
 * 改一条策略，返回新表。
 *
 * `undefined` 表示**清掉这一条**（回到契约默认）—— 与「设成契约默认当前的那个
 * 值」不是一回事：契约会升级，而一条钉死的记录不会跟着变。用户说的是「这条我不
 * 管了」，不是「我要求它永远是 ask」。
 */
export function withPolicy(
  policy: ToolPolicy,
  toolId: string,
  value: PermissionValue | undefined,
): ToolPolicy {
  const next = { ...policy };
  if (value === undefined) delete next[toolId];
  else next[toolId] = value;
  return next;
}
