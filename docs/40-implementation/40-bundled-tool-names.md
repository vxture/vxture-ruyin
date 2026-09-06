# 预置 MCP 服务器的工具名对照表

> **本文件由构建生成**（`pnpm tools:pull` 顺带重写，或单独 `pnpm tools:names`；源头是
> `resources/tools/index.json`）。别手改 —— 手改的那一版会在下一次构建被覆盖。
>
> **CI 在哪儿盯着它**：`packaged-smoke` 里 pack 刚跑过 pull-tools，随后一句
> `git diff --exit-code` —— 「重写完还有 diff」就等于「有人改了工具，却没把重生成的
> 文档一起提交」。static-checks 那边盯不了：`resources/tools/` 整目录是 .gitignore 的
> 构建产物，那个 job 里没有 index.json 可比。本地随时可以 `pnpm lint:tool-names` 自查。
>
> 名单是**上一次构建真起了一次服务器、`tools/list` 报回来的**。运行时的
> `tools/list` 永远是权威 —— 上游换个版本就可能多一个少一个，而这份表是那一刻的
> 快照。**这里不写日期**：日期只在 `resources/tools/index.json` 的 `generatedAt`
> 里（那一份是 gitignore 的构建产物）。写进正文，这份文档就会在生成的第二天起，
> 对每一次与工具名无关的提交都判「过期」。

契约里 `provider: connector` 的工具**靠同名接上**（TD-034，owner 2026-09-03 定：
映射来源是契约声明）。所以产品要用预置服务器的某个工具，就得在契约的 `tools[]` 里
写下面这一列里的名字，一个字不差；`category` 与 `risk` 仍由契约自己定（R15：连接器
工具只能是 `query` 或 `external_send`）。

| 服务器（连接器 id） | 档位 | 工具数 | 工具名（契约里照这个写） |
|---|---|---|---|
| `aas-ee.open-websearch` | default | 6 | `fetchCsdnArticle`、`fetchGithubReadme`、`fetchJuejinArticle`、`fetchLinuxDoArticle`、`fetchWebContent`、`search` |

## ⚠️ 标了的那几个：能跑任意代码

这一版没有探到这类工具名。

## 探不到的那些

起不来就探不到，那时这里写的是**一句原因**，不是空数组 —— 空数组读起来是
「它什么都不暴露」，而那是另一回事。目录覆盖率先告警不硬失败：硬失败等于
「构建机上起不来的服务器永远不许随包」，那是一条值得单独决定的约束。
