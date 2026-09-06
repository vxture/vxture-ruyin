/**
 * 预置工具名对照表的**渲染**（TD-034 / TD-042 的那一半）。
 *
 * 抽出来是为了能被测：`pull-tools.mjs` 是一个顶层就会去装包、探服务器的脚本，
 * 导入它就等于跑它。而这里要证明的那件事，只有从函数这一侧才证得了 ——
 *
 * ## 生成物必须是**确定的**：同一份 index.json，什么时候跑都要一字不差
 *
 * CI 那条检查是「pack 刚跑过 pull-tools，随后 `git diff --exit-code`」。上一版在
 * 正文里写了一句「本次构建（2026-09-06）」，而 `resources/tools/` 整个是 gitignore
 * 的构建产物 —— 每一次构建都会重新生成 index.json，`generatedAt` 于是就是**当天**。
 * 结果：提交当天绿，第二天起，任何一次与工具名毫无关系的提交都会因为那一行日期
 * 变红。一个每天都会红一次的必需检查，等于教所有人忽略它。
 *
 * 所以日期只留在 `index.json`（gitignore 的那一份）里，正文里不写。要知道这份表是
 * 什么时候探的，看那一份，或看这次构建的日志。
 */

/** 一份小 deny 列表：名字长这样的工具能跑任意代码。**照登，但标出来。** */
export const RESTRICTED = /(run_code|eval|execute_script)/i;

export function renderToolNameTable(source) {
  const rows = [];
  for (const s of source.servers ?? []) {
    if (!s.launch) continue;
    const names = s.tools?.length
      ? s.tools.map((n) => (RESTRICTED.test(n) ? `\`${n}\` ⚠️` : `\`${n}\``)).join("、")
      : `_未探到：${s.toolsUnprobed ?? "原因未记"}_`;
    rows.push(`| \`${s.id}\` | ${s.tier ?? ""} | ${s.tools?.length ?? "—"} | ${names} |`);
  }
  return [
    "| 服务器（连接器 id） | 档位 | 工具数 | 工具名（契约里照这个写） |",
    "|---|---|---|---|",
    ...rows,
  ].join("\n");
}

export function renderToolNameDoc(source) {
  const restricted = (source.servers ?? []).flatMap((s) => (s.tools ?? []).filter((n) => RESTRICTED.test(n)));
  return `# 预置 MCP 服务器的工具名对照表

> **本文件由构建生成**（\`pnpm tools:pull\` 顺带重写，或单独 \`pnpm tools:names\`；源头是
> \`resources/tools/index.json\`）。别手改 —— 手改的那一版会在下一次构建被覆盖。
>
> **CI 在哪儿盯着它**：\`packaged-smoke\` 里 pack 刚跑过 pull-tools，随后一句
> \`git diff --exit-code\` —— 「重写完还有 diff」就等于「有人改了工具，却没把重生成的
> 文档一起提交」。static-checks 那边盯不了：\`resources/tools/\` 整目录是 .gitignore 的
> 构建产物，那个 job 里没有 index.json 可比。本地随时可以 \`pnpm lint:tool-names\` 自查。
>
> 名单是**上一次构建真起了一次服务器、\`tools/list\` 报回来的**。运行时的
> \`tools/list\` 永远是权威 —— 上游换个版本就可能多一个少一个，而这份表是那一刻的
> 快照。**这里不写日期**：日期只在 \`resources/tools/index.json\` 的 \`generatedAt\`
> 里（那一份是 gitignore 的构建产物）。写进正文，这份文档就会在生成的第二天起，
> 对每一次与工具名无关的提交都判「过期」。

契约里 \`provider: connector\` 的工具**靠同名接上**（TD-034，owner 2026-09-03 定：
映射来源是契约声明）。所以产品要用预置服务器的某个工具，就得在契约的 \`tools[]\` 里
写下面这一列里的名字，一个字不差；\`category\` 与 \`risk\` 仍由契约自己定（R15：连接器
工具只能是 \`query\` 或 \`external_send\`）。

${renderToolNameTable(source)}

## ⚠️ 标了的那几个：能跑任意代码

${
  restricted.length
    ? `这一版探到 ${restricted.length} 个：${restricted.map((n) => `\`${n}\``).join("、")}。

**照登，不藏。** 对照表的职责是记录事实 —— 藏起来只会让下一个人以为自己看漏了。

挡住它们的是 \`packages/contract-schema/src/schema.ts\` 里 \`category\` 的**闭合枚举**
（只允许 local_read / local_write / query / generate / export / external_send）加上
\`additionalProperties: false\`，**不是任何一条 R 规则** —— 全仓核过，R 系列里没有一条
提到 \`execute_script\`（TD-005 行 2026-09-02 的机制更正）。不写清楚，契约作者会去找
一条不存在的规则，并可能以为护栏丢了。

跟进项（**本次不占用 R 编号** —— 那要改 30-contract-schema §15 的权威表）：加一条
R 规则，拒绝 \`provider: connector\` 且工具名命中这份 deny 列表的声明。`
    : "这一版没有探到这类工具名。"
}

## 探不到的那些

起不来就探不到，那时这里写的是**一句原因**，不是空数组 —— 空数组读起来是
「它什么都不暴露」，而那是另一回事。目录覆盖率先告警不硬失败：硬失败等于
「构建机上起不来的服务器永远不许随包」，那是一条值得单独决定的约束。
`;
}
