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
| `microsoft.playwright-mcp` | default | 24 | `browser_click`、`browser_close`、`browser_console_messages`、`browser_drag`、`browser_drop`、`browser_evaluate` ⚠️、`browser_file_upload`、`browser_fill_form`、`browser_find`、`browser_handle_dialog`、`browser_hover`、`browser_navigate`、`browser_navigate_back`、`browser_network_request`、`browser_network_requests`、`browser_press_key`、`browser_resize`、`browser_run_code_unsafe` ⚠️、`browser_select_option`、`browser_snapshot`、`browser_tabs`、`browser_take_screenshot`、`browser_type`、`browser_wait_for` |
| `haris-musa.excel-mcp-server` | installed-disabled | — | _未探到：本次构建没有 vendored 它（runtime = uvx）_ |
| `vivekvells.mcp-pandoc` | installed-disabled | — | _未探到：本次构建没有 vendored 它（runtime = uvx）_ |
| `ihor-sokoliuk.mcp-searxng` | default | 4 | `searxng_instance_info`、`searxng_search_suggestions`、`searxng_web_search`、`web_url_read` |
| `aas-ee.open-websearch` | default | 6 | `fetchCsdnArticle`、`fetchGithubReadme`、`fetchJuejinArticle`、`fetchLinuxDoArticle`、`fetchWebContent`、`search` |
| `negokaz.excel-mcp-server` | default | 7 | `excel_copy_sheet`、`excel_create_table`、`excel_describe_sheets`、`excel_format_range`、`excel_read_sheet`、`excel_screen_capture`、`excel_write_to_sheet` |

## ⚠️ 标了的那几个：能跑任意代码

这一版探到 2 个：`browser_evaluate`、`browser_run_code_unsafe`。

**照登，不藏。** 对照表的职责是记录事实 —— 藏起来只会让下一个人以为自己看漏了。

挡住它们的是 `packages/contract-schema/src/schema.ts` 里 `category` 的**闭合枚举**
（只允许 local_read / local_write / query / generate / export / external_send）加上
`additionalProperties: false`，**不是任何一条 R 规则** —— 全仓核过，R 系列里没有一条
提到 `execute_script`（TD-005 行 2026-09-02 的机制更正）。不写清楚，契约作者会去找
一条不存在的规则，并可能以为护栏丢了。

跟进项（**本次不占用 R 编号** —— 那要改 30-contract-schema §15 的权威表）：加一条
R 规则，拒绝 `provider: connector` 且工具名命中这份 deny 列表的声明。

## 探不到的那些

起不来就探不到，那时这里写的是**一句原因**，不是空数组 —— 空数组读起来是
「它什么都不暴露」，而那是另一回事。目录覆盖率先告警不硬失败：硬失败等于
「构建机上起不来的服务器永远不许随包」，那是一条值得单独决定的约束。
