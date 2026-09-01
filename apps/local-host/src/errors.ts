/**
 * 本地 API 的错误封套（《产品接入通则》X-1；TD-014 的 D1/D2）。
 *
 * ```
 * { code, message, retryable, field? }
 * ```
 *
 * `code` 为带模块前缀的 SCREAMING_SNAKE。**`retryable` 是必填的**，理由通则写得
 * 很具体：**缺了它，调用方碰到错误不知道要不要重试**——而它拿到的每一个错误都
 * 得靠猜。
 *
 * ## 四个拒绝码：照抄词表，但只用真会发生的
 *
 * 通则规定 `NOT_ENTITLED` / `POLICY_DENIED` / `APPROVAL_REQUIRED` /
 * `QUOTA_EXCEEDED`，且**不要自造、不要做映射表**。这里用前三个：
 *
 * - `NOT_ENTITLED` —— 平台订阅未覆盖该产品，引导去 console 订阅
 * - `POLICY_DENIED` —— 本机停用、路径不在授权范围内一类：本地策略说不行
 * - `APPROVAL_REQUIRED` —— 状态转换声明了 `confirm: human`。通则强调
 *   **「这是一条出路，不是一个错误」**，所以它不该被当成失败展示
 *
 * **`QUOTA_EXCEEDED` 不用**，且这不是遗漏：Ruyin 是本地运行环境，配额门控在
 * SaaS，本地没有任何会耗尽配额的动作点（ADR-006）。通则自己讲过为什么不能凑数
 * ——**「加一个永不抛出的码，消费方会写一条永不触发的分支」**，而那正是词表规则
 * 要防的缺陷。
 *
 * ## 「本机停用」与「未订阅」必须分开
 *
 * 两者曾共用一个自造码 `product_unavailable`。通则「十个坑」的第二条说的就是它：
 * **混了就永远显示错的行动入口**——本该引导首购的地方显示续费，或者反过来。
 */

export interface ApiErrorBody {
  code: string;
  message: string;
  retryable: boolean;
  field?: string;
}

export function apiError(
  code: string,
  message: string,
  opts: { retryable?: boolean; field?: string } = {},
): ApiErrorBody {
  return {
    code,
    message,
    // 保守缺省：说「可以重试」而其实不能，只会让调用方空转。
    retryable: opts.retryable ?? false,
    ...(opts.field ? { field: opts.field } : {}),
  };
}

/** 通则 X-1 的拒绝词表中，Ruyin 真会发出的三个。 */
export const REJECTION = {
  NOT_ENTITLED: "NOT_ENTITLED",
  POLICY_DENIED: "POLICY_DENIED",
  APPROVAL_REQUIRED: "APPROVAL_REQUIRED",
} as const;
