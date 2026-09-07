/**
 * 上下文预算裁剪（TD-044，设计出处 `30-design/40-context-architecture` §6.1）。
 *
 * 管线那一步写的是「**预算裁剪：token budget 内取最小充分集**」，而实现此前是
 * 「每类取前 3 条」—— 按**条数**裁，不是按预算。三条小备忘录与三条百页标书在
 * 成本上差一个量级，而对那一版实现来说它们一模一样。
 *
 * ## 单位是字节，而且这里说明白它是个近似
 *
 * 真正该管的是 token，而 token 数要由**分词器**给，分词器属于模型那一侧 ——
 * 本地运行时没有、也不该为了估算把某个模型的分词表抄一份进来（抄进来的那份会
 * 和真正在用的模型漂开，而漂开的估算读起来和准的一样）。
 *
 * 所以这里用**字节**：它是我们真实掌握的量（每个条目的 `bytes` 就是要发出去的
 * 那些字节），与 token 大致成比例，且**永远不会低估**。文档与代码都直说它是近似
 * —— 一个说自己是 token 预算、实则数字节的旋钮，比一个诚实的字节预算更危险。
 *
 * ## 裁的是条目，不截断某一条
 *
 * 这是判据里点名的一条：截断会让引用指向半句话。成果要能回溯到原文（这是本产品
 * 的立身之本之一），而一条被腰斩的资料，其引用指向的位置在原文里可能根本不存在
 * 那句话。**宁可少一条完整的，不要多半条残的。**
 *
 * ## 广度优先：先给每一类第一条，再给每一类第二条
 *
 * 不这么做的话，`input_types` 里排第一的那一类会把预算吃光 —— 后面的类型一条都
 * 拿不到，而任务声明它们正是因为它们都需要。轮转之后，预算不够时缺的是**某一类的
 * 第二条**，不是**某一类全没有**。
 *
 * ## 必需类型的第一条不受预算约束
 *
 * 契约里 `required: true` 的类型，它的最高排位那一条**一定进**，即使超预算。
 * 否则会出现一个用户无法处理的失败：任务因为「必需资料缺失」跑不起来，而资料明明
 * 在那儿，只是太大 —— 那不是他能改的东西。超了就如实记一笔（`overBudget`），
 * 让上面那一层去说，而不是在这里默默丢掉。
 *
 * 同理，**预算再小也不会把上下文清零**：一条候选都没选上时，兜底取全场排位最高
 * 的那一条。否则调用方那句「一份资料都没拿到 —— 去绑个目录」会指错方向：目录绑
 * 得好好的，是预算调小了，而错误里一个字都不会提预算。
 */

import type { ContextItemMeta } from "./ports.js";

/** 一个类型的候选，已按相关性排好序。 */
export interface RankedType {
  type: string;
  required: boolean;
  /** 相关性从高到低。 */
  ranked: ContextItemMeta[];
}

export interface BudgetOptions {
  /** 预算（字节）。<= 0 视为不限，与「没有配」同义。 */
  budgetBytes: number;
  /** 每类最多取几条 —— 预算之外的第二道闸，防一类刷屏。 */
  maxPerType: number;
}

export interface DroppedItem {
  item: ContextItemMeta;
  reason: "over-budget" | "per-type-cap";
}

export interface BudgetResult {
  selected: ContextItemMeta[];
  dropped: DroppedItem[];
  usedBytes: number;
  /** 必需类型里为了不让任务失败而**超预算放行**的那些条目。 */
  overBudget: ContextItemMeta[];
}

/**
 * 在预算内选出条目。
 *
 * 顺序：先把每个必需类型的第一条无条件放进去（它们决定任务能不能起），再按
 * 「排位轮转」补其余的，直到预算装不下下一条。
 */
export function selectWithinBudget(
  types: readonly RankedType[],
  options: BudgetOptions,
): BudgetResult {
  const { budgetBytes, maxPerType } = options;
  const unlimited = !(budgetBytes > 0);

  const selected: ContextItemMeta[] = [];
  const dropped: DroppedItem[] = [];
  const overBudget: ContextItemMeta[] = [];
  const taken = new Set<string>();
  let used = 0;

  const take = (item: ContextItemMeta): void => {
    taken.add(item.id);
    selected.push(item);
    used += Math.max(0, item.bytes);
  };

  // ① 必需类型的第一条：先占位，且不受预算约束。
  for (const t of types) {
    if (!t.required) continue;
    const first = t.ranked[0];
    if (!first) continue;
    take(first);
    if (!unlimited && used > budgetBytes) overBudget.push(first);
  }

  // ② 排位轮转：第 1 位走一圈，再第 2 位走一圈……
  const depth = Math.min(
    maxPerType,
    types.reduce((n, t) => Math.max(n, t.ranked.length), 0),
  );
  for (let rank = 0; rank < depth; rank++) {
    for (const t of types) {
      const item = t.ranked[rank];
      if (!item || taken.has(item.id)) continue;
      if (!unlimited && used + Math.max(0, item.bytes) > budgetBytes) {
        // **跳过它，继续看下一个** —— 不是就此收摊。一条排位靠前但特别大的资料
        // 若能挡住它后面的一切，那它挤掉的是别的类型，而不是它自己。
        dropped.push({ item, reason: "over-budget" });
        continue;
      }
      take(item);
    }
  }

  // ③ 兜底：预算再小也不清零。
  if (selected.length === 0) {
    const first = types.find((t) => t.ranked.length > 0)?.ranked[0];
    if (first) {
      take(first);
      overBudget.push(first);
      const at = dropped.findIndex((d) => d.item.id === first.id);
      if (at >= 0) dropped.splice(at, 1);
    }
  }

  // ④ 每类上限之外的，如实记一笔 —— 它们不是被预算挤掉的，别混成一件事。
  for (const t of types) {
    for (const item of t.ranked.slice(maxPerType)) {
      if (!taken.has(item.id)) dropped.push({ item, reason: "per-type-cap" });
    }
  }

  return { selected, dropped, usedBytes: used, overBudget };
}
