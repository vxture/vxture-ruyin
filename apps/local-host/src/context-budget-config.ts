/**
 * 上下文预算的**宿主侧**取值（TD-044）。
 *
 * 内核只接受一个数字（`RuntimePorts.contextBudgetBytes`），它自己不读环境变量 ——
 * 内核宿主无关（ADR-008）。于是「从哪儿取这个数」是本进程的事，就落在这里。
 *
 * 写法与 `maxConcurrentFromEnv` 一致，理由也一样：**一个拍脑袋的默认值至少要能
 * 被改**。非法值一律回落到内核缺省而不是 0 —— 0 在内核里表示「不限」，一个手滑
 * 写错的环境变量不该悄悄把预算这道闸整个拆掉。要不限，得明写 `unlimited`。
 */

/** 明写这个值表示不限预算；内核侧 <= 0 即不限。 */
const UNLIMITED = 0;

export interface ContextBudgetConfig {
  /** 传给内核的字节数；`undefined` = 用内核缺省。 */
  bytes: number | undefined;
  /** 给启动日志用的一句话 —— 用户改了这个旋钮，得能在日志里看见它生效了。 */
  note: string;
}

export function contextBudgetFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ContextBudgetConfig {
  const raw = env["RUYIN_CONTEXT_BUDGET_KB"]?.trim();
  if (!raw) return { bytes: undefined, note: "上下文预算：内核缺省" };
  if (raw.toLowerCase() === "unlimited") {
    return { bytes: UNLIMITED, note: "上下文预算：不限（RUYIN_CONTEXT_BUDGET_KB=unlimited）" };
  }
  const kb = Number(raw);
  if (!Number.isInteger(kb) || kb <= 0) {
    return {
      bytes: undefined,
      note: `上下文预算：RUYIN_CONTEXT_BUDGET_KB="${raw}" 不是正整数，按内核缺省处理`,
    };
  }
  return { bytes: kb * 1024, note: `上下文预算：约 ${kb} KB（近似 token）` };
}
