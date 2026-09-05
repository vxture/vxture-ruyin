# 技能与工具预置清单 v1（候选，待 owner 勾选）

- 日期：2026-09-05
- 用途：ADR-018（`../30-design/decisions/ADR-018-skill-registry.md`）第 2.3 条「随发布预置」的第一批候选。**每一条都在 GitHub 上核实过
  存在、许可证、是否归档**（`gh api repos/<owner>/<repo>`，2026-09-05）；没核实到
  的不进表，进不了安装包的单独列在 §5。
- 业务口径（owner）：文档读取、编辑、浏览器操作、文档解析分析、在线搜索，按日常办公
  梳理；文档编写含表格生成、docx 模板。
- 数量：技能 **≈ 270** 条（按 `SKILL.md` 计）、工具 **34** 个 MCP 服务器（暴露工具
  数以百计，Playwright 一家就 ~70 个）。目标 100+ 有余量，所以 §4 按「默认启用 /
  装而不启用 / 需密钥」分三档，不是全开。

## 0. 先说三条硬约束（都是查出来才知道的）

1. **Anthropic 官方的 docx / pdf / pptx / xlsx 四个技能不能用。** 它们的 LICENSE.txt
   是专有许可，明文禁止「保留副本、复制、派生、分发、转让给第三方」。打进安装包就是
   分发。同仓其它技能是 Apache-2.0，可以用（见 §1.4）。
2. **技能里的 `scripts/` 暂不执行**（TD-005，无 OS 级沙箱）。文档类技能的价值有一半
   在脚本（python-docx / openpyxl / LibreOffice 渲染核对），这一半第一版拿不到；
   **真正落盘的是 MCP 工具**（§2）。技能先当「怎么做」的知识，工具当「手」。
3. **需要外部 API 密钥的条目**（Tavily / Exa / Brave / Firecrawl / SerpApi 等），密钥
   归用户或企业配置，走连接器那条来源管理路 —— 客户端零秘密不变。清单里标「需密钥」。

## 1. 技能（Agent Skills 规范，`SKILL.md`）

### 1.1 中文办公主力：OpenSenseNova/SenseNova-Skills — MIT · 5.4k★ · 76 条

| 族 | 条目数 | 覆盖 |
|---|---|---|
| `sn-da-excel-workflow` | 44 | 读取 7（单表 / 多表 / 多文件 / 区间 / 大文件 / 结构化表头…）、清洗 6、分析 6（分组 / 对比 / KPI / 透视 / 时序 / 趋势）、可视化 6、统计 4、筛选 4、导出 4、着色 5、样式 1、条件格式 1 |
| `sn-ppt-*` | 5 | 标准 / 创意 / 工作台 / 诊断 / 入口 |
| `sn-search-*` | 9 | 学术 / 代码 / 财经 / 图片 / **市场（中文）** / **社媒（中文）** / 社媒（英文）/ 社媒 / 年报 |
| 研究与报告 | 6 | `sn-deep-research`、`sn-research-report`、`sn-report-format-discovery`、`sn-prepare-citations`、`sn-md-to-html-report`、`sn-infographic` |
| 其它 | 12 | 大文件分析、非表格数据分析、图片说明、图片系列、更新 |

**建议：默认启用。** 与我们的业务重合度最高，且是 MIT。

### 1.2 办公套件：iOfficeAI/OfficeCLI — Apache-2.0 · 29.9k★ · 12 条

`officecli`、`officecli-docx`、`officecli-xlsx`、`officecli-pptx`、`officecli-word-form`
（**表单 / 模板填写**）、`officecli-academic-paper`、`officecli-data-dashboard`、
`officecli-financial-model`、`officecli-pitch-deck`、`morph-ppt`、`morph-ppt-3d`。

这些技能驱动同仓的 OfficeCLI 可执行程序 —— 也就是说它们的「手」是那个 CLI。要用起来，
CLI 得作为**工具**接进来（MCP 包装或子进程，过 Tool Gate），否则只剩说明书。
**建议：技能默认启用；CLI 作为工具进第二批**（要先验证它在无沙箱下的执行边界）。

### 1.3 OpenAI：openai/skills — 逐技能 Apache-2.0（LICENSE.txt 已核）· 25.4k★

| 条目 | 用途 |
|---|---|
| `pdf` | 读 / 建 / 审 PDF，含版式核对（reportlab / pdfplumber / pypdf） |
| `playwright`、`playwright-interactive` | 浏览器自动化：导航、表单、抓取；持久会话 |
| `screenshot` | 截图 |
| `jupyter-notebook` | 数据分析笔记本 |
| `transcribe`、`speech` | 音频转写 / 语音 |
| `define-goal` | 任务目标澄清 |

**注意**：社区索引（officialskills.sh）列出的 `openai/doc`、`openai/slides` **在仓库里
不存在**（直接取文件 404，树未截断）—— 不收。

### 1.4 Anthropic：anthropics/skills — 只收 Apache-2.0 的 · 174k★

`webapp-testing`（Playwright 测本地 Web 应用）、`mcp-builder`、`skill-creator`、
`academy-guide`、`brand-guidelines`、`canvas-design`、`claude-api`、`discernment-nudge`、
`internal-comms`、`slack-gif-creator`、`theme-factory`、`web-artifacts-builder`、
`algorithmic-art` —— 13 条，许可证文件哈希一致（Apache-2.0）。

**不收**：`docx` `pdf` `pptx` `xlsx`（专有，§0.1）；`doc-coauthoring`（LICENSE 404，
无法核实）；`frontend-design`（另一份许可证，未核）。

### 1.5 研究与搜索技能

| 来源 | 许可证 | ★ | 条目 | 说明 |
|---|---|---|---|---|
| sandbaseai/sandbase-skills | Apache-2.0 | 122 | **99** | `research/*`（学术、**中文社媒**、抖音、文档解析 `document-parser`、内容翻译、竞品、公司、品牌监测、域名情报、CVE、汇率…）、`marketing/*`（会议纪要、PRD、对账、差异分析、市场规模…）、`multi-source-search`。**多数需密钥**（Exa / Apollo 等） |
| Panniantong/Agent-Reach | MIT | 78k | 1 | 17 个站点的多平台搜索 CLI，**含中文平台** |
| mvanhorn/last30days-skill | MIT | 61k | 1 | 跨 Reddit / X / YouTube / HN / 网页的话题研究 |
| Johell1NS/browser-search | MIT | 512 | 1 | SearXNG 搜索 + 浏览，**无需密钥**（自托管） |
| serpapi/skills | MIT | 7 | 2 | `serpapi-web-search`（130+ 引擎，需密钥） |
| sanjay3290/ai-skills | Apache-2.0 | 417 | 24 | `deep-research`、Google Docs / Drive / Sheets / Slides、Gmail、日历、NotebookLM、Outline… **多数需授权** |
| deusyu/translate-book | MIT | 1.5k | 1 | 翻译整本 PDF / DOCX / EPUB |
| yusufkaraaslan/Skill_Seekers | MIT | 14.9k | 1 | 把文档站 / 仓库 / PDF 转成技能（**造技能的技能**，对预置清单本身有用） |
| joeseesun/qiaomu-anything-to-notebooklm | MIT | 5.9k | 1 | 多源内容整理 |

### 1.6 文档生成与解析技能

| 来源 | 许可证 | ★ | 说明 |
|---|---|---|---|
| xberg-io/xberg（`plugin/skills/xberg`） | MIT | 9.3k | 101+ 格式抽文本 / 表格 / 元数据（Rust 核心） |
| Fokkyp/SoftwareCopyright-Skill | MIT | 5.2k | 读本地项目，**生成全套 .docx 申请材料** —— docx 模板生成的现成范例（中文） |
| the-shy123456/thesis-docx | MIT | 455 | 论文 docx |
| nexu-io/codex-slides | MIT | 869 | 幻灯片工作室 |

### 1.7 浏览器技能

lackeyjb/playwright-skill（MIT · 3.1k）、testdino-hq/playwright-skill（MIT · 359，
70+ 模式）、browser-act/skills（MIT · 5.6k，带反爬与人工接管）、
LambdaTest/agent-skills（MIT · 366：`playwright-skill` `puppeteer-skill` 等）。

### 1.8 微软：microsoft/skills — MIT · 3k★（可选）

`microsoft-docs`、`wiki-researcher`，以及 Azure 文档智能 / 文档翻译 / 认知搜索的
.NET / Java / Python / TS 各版 —— 绑 Azure，**第二批**。

### 1.9 工具类（不是业务技能，但预置流程要用）

agentskills/agentskills（Apache-2.0）里的 `skills-ref validate` —— **构建时校验每一
条技能的前言**，不合规范的不进包。obra/superpowers（MIT · 282k★）的
`writing-skills` / `writing-plans` —— 写技能用。

## 2. 工具（MCP 服务器）

### 2.1 浏览器操作

| 服务器 | 许可证 | ★ | 说明 |
|---|---|---|---|
| **microsoft/playwright-mcp** | Apache-2.0 | 36.8k | ~70 个 `browser_*` 工具：导航、点击、填表、快照、截图、PDF 保存、Cookie / 存储、录制、网络路由 |
| executeautomation/mcp-playwright | MIT | 5.6k | 同类，备选 |

不收：browserbase/mcp-server-browserbase（已归档）、官方 Puppeteer（已归档）。

### 2.2 文档读取 / 解析

| 服务器 | 许可证 | ★ | 说明 |
|---|---|---|---|
| **microsoft/markitdown**（`packages/markitdown-mcp`） | MIT | 178k | Office / PDF / 图片等 → Markdown，官方 MCP 包 |
| **docling-project/docling-mcp** | MIT | 732 | 版式感知的文档解析（IBM Docling） |
| opendatalab/MinerU-Document-Explorer | MIT | 631 | 文档索引与检索（MinerU，中文强） |
| KorigamiK/markitdown_mcp_server | MIT | 87 | markitdown 的另一包装 |

### 2.3 文档编辑 / 生成（docx · xlsx · pptx · 转换）

| 服务器 | 许可证 | ★ | 说明 |
|---|---|---|---|
| **haris-musa/excel-mcp-server** | MIT | 4.2k | 读写 xlsx：公式、格式、图表、透视 |
| negokaz/excel-mcp-server | MIT | 1k | 读写 xlsx，备选 |
| sbroenne/mcp-server-excel | MIT | 658 | 驱动**真实 Excel**（Windows），需装 Office |
| ykarapazar/word-mcp-live | MIT | 202 | 编辑**打开中的** Word 文档 |
| vivekVells/mcp-pandoc | MIT | 579 | pandoc 格式转换（md ↔ docx / pdf / html…） |
| yb2460/harness-anything | MIT | 1.7k | 控制 WPS / MS Office / Zotero 等的 hub |

**缺口**：docx / pptx 的**离线生成**没有一个未归档、许可证宽松的 MCP 服务器 ——
GongRzhe 的 Word / PowerPoint 两个（MIT，2.1k / 1.9k★）**已归档**。三条路：
① 从归档版 fork（MIT 允许）；② 用 mcp-pandoc 走 Markdown → docx；③ OfficeCLI 作工具。
**建议 ② 先上、① 补齐**（我们 `packages/document` 已能渲染 docx，和 ② 一致）。

### 2.4 在线搜索

| 服务器 | 许可证 | ★ | 密钥 | 说明 |
|---|---|---|---|---|
| nickclyde/duckduckgo-mcp-server | MIT | 1.5k | 否 | 无密钥即可用 |
| ihor-sokoliuk/mcp-searxng | MIT | 1.2k | 否 | 自托管 SearXNG，企业内可控 |
| Aas-ee/open-webSearch | Apache-2.0 | 1.8k | 否 | 多引擎 |
| anysearch-ai/anysearch-mcp-server | Apache-2.0 | 1.8k | 部分 | 统一实时搜索 |
| yokingma/one-search-mcp | MIT | 139 | 部分 | 搜索 + 抓取 + 抽取 |
| tavily-ai/tavily-mcp | MIT | 2.4k | 是 | 搜索 / 抽取 / 爬取 |
| exa-labs/exa-mcp-server | MIT | 5k | 是 | 语义搜索 |
| brave/brave-search-mcp-server | MIT | 1.4k | 是 | Brave 搜索 |
| firecrawl/firecrawl-mcp-server | MIT | 7.4k | 是 | 抓取 / 搜索 |
| leehanchung/bing-search-mcp | MIT | 79 | 是 | 必应 |
| Evilran/baidu-mcp-server | MIT | 28 | 是 | 百度（社区小仓，**弱**） |
| jina-ai/mcp | Apache-2.0 | 838 | 是 | 远程读取 / 搜索 |
| apify/actors-mcp-server | MIT | 6k | 是 | 各站抽取 |
| zcaceres/fetch-mcp | MIT | 821 | 否 | HTTP 抓取 |

不收：BochaAI/bocha-search-mcp（无许可证）、crawlbase/crawlbase-mcp（无许可证）。
**中文搜索的现成 MCP 都弱**（百度 28★、博查无许可证）；更稳的路是 SearXNG 自托管
+ Agent-Reach（§1.5）。

### 2.5 基础（官方参考实现 modelcontextprotocol/servers）

`filesystem`、`fetch`、`git`、`memory`、`sequentialthinking`、`time`、`everything`。
仓库级许可证字段为 NOASSERTION，**逐包核对后再进**。

## 3. 按业务口径对照

| 业务 | 技能（知道怎么做） | 工具（真的去做） |
|---|---|---|
| 文档读取 | SenseNova 读取族、xberg、openai/pdf | markitdown-mcp、docling-mcp、MinerU、filesystem |
| 文档解析分析 | SenseNova 分析 / 统计族、sandbase `document-parser`、`sn-da-large-file-analysis` | docling-mcp、excel-mcp-server（读） |
| 文档编辑 / 生成（含表格、docx 模板） | OfficeCLI docx / xlsx / word-form、SoftwareCopyright-Skill（模板范例）、SenseNova 导出 / 样式族 | excel-mcp-server、mcp-pandoc、word-mcp-live、（fork）Word-MCP |
| 浏览器操作 | openai/playwright*、lackeyjb、browser-act | **playwright-mcp** |
| 在线搜索 | `sn-search-*`（含中文市场 / 社媒）、Agent-Reach、last30days、browser-search | duckduckgo / searxng / open-webSearch（无密钥）；tavily / exa / brave（需密钥） |
| 研究报告 | `sn-deep-research`、`sn-research-report`、sandbase research/* | fetch、search 组合 |

## 4. 建议的三档

| 档 | 内容 | 数量（约） |
|---|---|---|
| **默认启用** | SenseNova 76、OfficeCLI 技能 12、openai 7、anthropics Apache 13、Agent-Reach、last30days、browser-search、xberg、translate-book、lackeyjb；工具：playwright-mcp、markitdown-mcp、docling-mcp、excel-mcp-server、mcp-pandoc、duckduckgo、searxng、open-webSearch、fetch、filesystem | 技能 ~115 · 工具 10 |
| **装而不启用** | sandbase 99（多需密钥）、sanjay 24、microsoft、LambdaTest、MinerU、negokaz、word-mcp-live、harness-anything、one-search、anysearch | 技能 ~150 · 工具 6 |
| **需密钥（连接器管理）** | tavily、exa、brave、firecrawl、bing、jina、apify、serpapi | 工具 8 |

## 5. 明确不进包的（及原因）

| 条目 | 原因 |
|---|---|
| anthropics/skills `docx` `pdf` `pptx` `xlsx` | 专有许可，禁止分发 |
| anthropics `doc-coauthoring` `frontend-design` | 许可证未核实到 |
| openai `doc` `slides` | 仓库里不存在 |
| tfriedel/claude-office-skills、PSPDFKit-labs/nutrient-agent-skill、Achuan-2/pandoc_docx_template、BochaAI/bocha-search-mcp、crawlbase/crawlbase-mcp | 无许可证 |
| GongRzhe Office-Word / Office-PowerPoint MCP、browserbase MCP、官方 Puppeteer / Brave | 已归档（Word / PPT 两个可 fork） |
| googleworkspace 的 `gws-*` | 索引指向的仓库 404，未定位 |
