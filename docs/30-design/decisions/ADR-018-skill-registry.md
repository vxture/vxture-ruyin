# ADR-018 技能与工具：全部从外部获取、拉到本机可运行、随发布预置；格式对齐开放生态

- 状态：**已接受（v2.2，owner 2026-09-05）**。分区名定为「**能力平台**」（§2.7）。
  v1 被 owner 否掉两处：不该自己造技能，数量应至少上百。v2 按 owner 七条意见重写；
  v2.1 记入已定的三条（§6）；v2.2 按 ADR-020 修正三处：技能来源加「产品分发」层、
  第三方密钥归 Runos 保险库、脚本的 Runos Executor 出路只登记。
  **v2.3（2026-09-09）**：许可证判定改为逐技能两读，撤下 `xberg-io/xberg`（§7.3）。
  **v2.4（2026-09-09）**：预置台账权威归 Runos，本仓的同步是**构建时物化**，运行时
  永不依赖 Runos 可达（§7.4）。
- 日期：2026-09-05
- 相关：ADR-006（skill 归 Ruyin，建在 Harness 上）、ADR-002（循环归 Harness）、
  ADR-005（本地连接器 = MCP）、ADR-009（能力面中转）、ADR-011（框架边界）、
  **ADR-020（两个能力提供平台：Runos 分发与承载，Ruyin 执行）**、
  30-contract-schema §10 / §11、TD-005（无沙箱不进 `execute_script`）、TD-034、
  TD-035；候选清单 `../../40-implementation/20-tools-skills-catalog-v1.md`

## 0. 先回答 owner 的一个问题：我们是不是建在 harness 上

**是「harness 形态」，但内核是自己写的，不建在任何外部 harness 框架之上。**

- 50-harness.md 定义的 Harness 是本仓自己的任务执行内核：状态机、Tool Gate、
  Checkpoint、验证、恢复、审计链；实现在 `packages/runtime-core/src/harness.ts`，
  一致性清单 C1–C7 在 `conformance.ts`。
- DeepSeek Harness（`deepseek-ai/deepseek-harness`，MIT，Node，Cordis 插件体系，
  developer preview）是**另一个** harness：它的循环自己调模型、自己持提供方凭据。
  我们的循环在本地、推理在产品能力面后面（ADR-002 / ADR-009），客户端零秘密 ——
  这一点结构上不同。
- 所以本 ADR 的口径是 **参照它的「接入方式、格式与管理界面」，不把内核换成它**：
  格式对齐了，它那个生态里的东西就能直接拉过来用；内核不换，是因为 developer
  preview 会破坏性变更，而且换内核换不来任何产品能力。

## 1. 现状

| 层 | 设计里说的（ADR-006） | 实现里有的 |
|---|---|---|
| 预制 | 文件读写、检索、解析、抽取、转换、导出 | `tool-executor.ts` 一个写死的四元素集合 |
| 拓展 | MCP 对齐的连接器 | 连接器已落地（stdio；HTTP 见 TD-035；工具面未接 Tool Gate 见 TD-034） |

没有登记册、没有清单端点、没有界面。契约多声明一个 `provider: runtime` 的工具，
任务在启动前就被拒 —— 而用户看不到本机到底有什么。

## 2. 决策（提议）

### 2.1 归集：一个分区，两种条目

| 条目 | 是什么 | 怎么跑 | 来源 |
|---|---|---|---|
| **工具** tool | 可执行的能力：有输入 schema、有 `execute` | 本地进程或子进程；每次调用过 Tool Gate | **MCP 服务器**（stdio：`command` + `args`；Streamable HTTP：`url`） |
| **技能** skill | 一份**指令包**：`SKILL.md` + 可选 `scripts/` `references/` `assets/` | 目录只送名字与描述给模型；模型决定用时，运行时把全文作为工具结果交回 | **Agent Skills 开放规范**的技能目录（git / zip / 本地目录） |

这是 DeepSeek Harness、Claude Code、Codex、OpenCode、Kimi 已经趋同的划分：
**工具是代码，技能是指令**；两者各有登记册，但对用户是一张清单。

- 设置里新增分区「**能力平台**」（§2.7），一张清单：名称、种类（工具 / 技能）、来源、
  版本、状态。
- 「连接器」保留，职责**收窄为管理外部来源**（添加 / 测试 / 授权一个 MCP 服务器或
  内网系统）；它贡献出来的工具出现在那张清单里，而不是各页各管一份。数据库不动。
  **（owner 2026-09-05 已定）**

### 2.2 全部从外部获取，不自己造

**Ruyin 不再实现任何技能，也不再新写内建工具**（现有四个保留，作为地板）。

| 种类 | 从哪拉 | 拉到哪 | 怎么可运行 |
|---|---|---|---|
| 技能 | ① git 仓库 / zip / 本地目录（规范见 agentskills.io：`SKILL.md` 前言 `name`、`description` 必填；`license`、`compatibility`、`metadata`、`allowed-tools` 可选；目录名须等于 `name`）；② **Runos 分发**：产品能力面把 Runos 目录里分发给本产品的 Skill 转交过来（`GET /skills` + `GET /skills/:name`，带 `content_digest`，见接入指南 §5.4） | `<dataDir>/skills/<source>/<name>/`；Runos 来源记为 `runos:<capability_id>@<version>` | 全文按需加载（§2.4）；`scripts/` **本地暂不执行**（§2.6） |
| 工具 | MCP 服务器定义（与 DeepSeek Harness `dsh-mcp-client` 同形：`{transport:'stdio', serverName, command, args, env, cwd}` 或 `{transport:'streamable-http', url, headers}`） | `<dataDir>/tools/<serverName>.json` | 本地拉起子进程 / 连 HTTP；工具名加命名空间 `mcp__<serverName>__<name>`，与 dsh 一致 |

生态规模足够支撑「上百个」：Agent Skills 是开放规范（Anthropic 发布，
agentskills/agentskills 维护），官方仓 anthropics/skills、社区索引
VoltAgent/awesome-agent-skills（1000+）、目录站已到数十万条；MCP 服务器目录同样以
百计。**数量来自生态，不来自我们的开发工时。**

### 2.3 随发布预置：清单跟着安装包走，首启离线可用

- 仓内维护一份 **预置清单** `resources/skill-manifest.json`：每条 = 来源（git URL +
  钉死的 commit / zip 校验和）+ 纳入哪些技能 + 哪些 MCP 服务器定义 + 三档之一
  （默认启用 / 装而不启用 / 需密钥）。
- **构建时按清单拉取**，用 agentskills 的 `skills-ref validate` 校验前言，打进安装包
  `resources/skills/` 与 `resources/tools/`：客户的域环境可能连不上 GitHub / npm，
  首启必须离线可用。
- 来源分**四层**（ADR-020 §6-1）：**预置**（随安装包）→ **产品分发**（Runos 经产品
  能力面转交，按 `content_digest` 缓存、离线可用）→ **用户**（自己加的）→ **项目**。
  同名时**近者优先**（dsh 的分层规则：project > custom > user > bundled，近层整体
  覆盖远层）。首次启动把预置复制到 `<dataDir>`；应用更新时刷新预置层；产品分发层
  在能力面可达时刷新。
- **第一批候选**：`../../40-implementation/20-tools-skills-catalog-v1.md`。每一条都
  核实过存在、许可证、是否归档；技能约 270 条、MCP 服务器 34 个，按三档分。

**许可证是硬门槛，不是备注。** 查下来最重要的一条：Anthropic 官方的 docx / pdf /
pptx / xlsx 四个技能是**专有许可、明文禁止分发与复制**，打进安装包就是分发 ——
不能用。文档类改走 SenseNova（MIT）、OfficeCLI（Apache-2.0）、openai/skills 的
Apache 条目，以及 MCP 侧的 markitdown / docling / excel-mcp-server / mcp-pandoc。

### 2.4 怎么接进我们的回合协议（参照 dsh 的进阶披露）

dsh 的做法：目录只含 `name` + `description`（约 100 token / 条），作为一条用户
角色的系统提醒注入；模型调 `skill({ name })` 工具拿全文，`resourceBase` 按需取脚本
与参考文件；`disable-model-invocation` / `user-invocable` 两个开关。

映射到我们（ADR-002 循环在本地，ADR-011 运行时只给事实）：

| dsh | Ruyin |
|---|---|
| 系统提醒里的技能目录 | `TurnRequest.skills: SkillOffer[]`（`name` + `description`），**新增字段**，是数据不是措辞 —— 提供方决定怎么用 **（owner 已定）** |
| `skill({name})` 工具 | 运行时实现的 `use_skill` 工具（内建，`category: local_read`）：返回 `SKILL.md` 全文 + 资源清单 |
| `resourceBase` | `read_skill_resource` 工具：只读 `references/` `assets/`；路径限定在技能目录内 |
| 工具注册 + `tools/pre-execute` allow/deny/ask | 现有 Tool Gate：硬底线 ∧ 用户策略 ∧ 契约默认 —— **一模一样的形状**，不用改 |
| MCP 工具 `mcp__<server>__<tool>` | 同名规则；连接器工具接上 Tool Gate（这就是 TD-034 的回收） |

回合协议是本仓与产品能力面之间的约定（30-design/20），不是平台联络项 —— 加一个
字段不需要等平台。

### 2.5 只有产品能调用（owner 第 5 条）

技能与工具是运行环境提供的**基础设施**，用户在设置里看得见、管得着，但**不直接
用**；调用它们的只有产品，且产品必须在契约里声明：

```yaml
tasks:
  - id: generate_proposal
    tools: [read_file, search_knowledge, mcp__excel__write_sheet]   # ⊆ 本机工具清单
    skills: [sn-da-excel-workflow, officecli-word-form]              # 新增：⊆ 本机技能清单
```

- 契约新增 `tasks[].skills`（R8 同样约束：必须在清单里）**（owner 已定）**；每回合
  只把**这个任务声明的**技能送进 `TurnRequest.skills` —— 这也是「上百个」不会把每
  回合撑爆的原因：清单在本机有几百条，一次任务只带它声明的几条。
- 没声明的技能，模型看不见；没声明的工具，闸门直接拒。

### 2.6 不变的、和一条必须说清的限制

- **不门控、不计量、不计费**（ADR-006）；**客户端零秘密**；**Tool Gate 不变**。
- **技能里的 `scripts/` 本地暂不执行。** 那是任意代码，TD-005 说得很清楚：没有 OS
  级沙箱之前不进 `execute_script` 类。文档类技能的价值有一半在脚本（python-docx /
  openpyxl / LibreOffice 渲染核对），第一版拿不到这一半；**真正落盘的是 MCP 工具**。
  技能先当「怎么做」的知识，工具当「手」。脚本在清单里标「需要沙箱」而不是悄悄跳过。
  第二条出路已登记未启用（ADR-020 §6-3，TD-005）：不带业务数据的脚本可声明依赖
  **Runos Executor** 在云端沙箱里跑。
- `allowed-tools` 前言字段（规范标为实验性）：读进来、显示出来，**不当作放行依据**
  —— 放行只听 Tool Gate。
- **需要外部 API 密钥的能力**（Tavily / Exa / Brave / Firecrawl…）：**不进本机**。它们
  经 **Runos 注册**，密钥放 Runos 的凭证保险库、由 Runos 在出站调用时注入
  （ADR-020 §6-2）；产品经能力面调用。本地连接器只管内网 / 私有系统（ADR-005 的本意）。

### 2.7 分区叫什么 —— 定为「能力平台」（owner 2026-09-05）

行业现状（2026-09 查证）：

| 产品 | 设置里的名字 | 备注 |
|---|---|---|
| Claude.ai | **Capabilities**（功能） | 组织设置里的开关：联网搜索等 |
| Cursor | **Tools & MCP** | 逐服务器、逐工具开关 |
| JetBrains DataGrip 2026.2 | **AI Agent Skills, MCP Tools** | 两个词并列 |
| DeepSeek Harness | `skills` 与 `tools` 两个登记册；`extensions` 指动态插件 | 设置页按插件命名空间分卡 |
| OpenAI Codex | 没有面板：`~/.codex/skills/` 目录即清单 | — |

「能力集」贴近 Claude 的 Capabilities，但**在我们自己的词表里会撞车**：契约 §10 的
`capabilities` 已经是「AI 能力需求」（模型能力，经能力面解析，ADR-009）。一个词
在同一套系统里指两件事，契约作者和用户都会被绊倒。

**定名「能力平台」**（owner 2026-09-05）。与契约 §10 的 `capabilities`（模型能力）
不是同一个词：那是「产品要的 AI 能力」，这是「本机装着的能力」的**平台**（技能 +
工具 + 来源）。界面文案、`GET /skills` `GET /tools` 的分区标题、设置侧栏一律用
「能力平台」；代码标识符仍用 `skills` / `tools`，不引入第三个词。
未取的备选：「技能与工具」（我的建议，行业通用但不够上位）、「工具技能」（v2 原名）、
「扩展」（dsh 指动态插件）、「能力集」（撞车）。

### 2.8 参照 dsh 的可视化管理面（owner 补充）

看过它的实现之后，可借鉴的是三件事，而不是「一个安装器」：

| dsh 的做法 | 我们的对应 |
|---|---|
| **插件面板是全局的**（`ui-cordis`）：一个侧栏座位带计数徽标，打开是每个定义的一行 —— 运行中 / 等待批准，行上有运行、停止、移除；**模型请求运行时要人批准，批准入口在任何会话里都够得着**，多标签页先答者胜 | 「技能与工具」清单的每一行：状态 + 启用 / 停用；模型请求启用一个未启用的工具时，走我们的 Checkpoint 队列（50-harness §6），不另起一套批准 |
| **设置页按命名空间分卡**（`settings.plugin.item`）：插件注册命名空间 + schema，用户在一份文档里改值，改动实时生效；`role('secret')` 的字段值不回显 | 需密钥的 MCP 服务器定义 = 一张卡：非密钥字段可编辑，密钥经连接器来源管理进 OS 凭据库，卡上只显示「已配置」 |
| **技能目录热刷新**（`skill-catalog-hot-refresh`）：监视技能根目录，增删即入目录；坏文件「警告并跳过」，不让一份坏技能拖垮整个目录 | 用户层技能目录同样监视；预置层随更新刷新。**坏技能只影响自己** |
| 对话里 `skill` 调用有专属行（`web-skill-tool-row`）：折叠只显示技能名，展开是送给模型的原文 | 任务详情里的工具调用列表同样区分「用了哪个技能」与普通工具调用，展开能看到交给模型的原文 —— 审计要说得清 |

一处纠正：它仓里的 `web-install-manifest` 是浏览器 PWA 清单（安装为桌面应用），
**不是技能安装器** —— 它的技能「安装」就是把目录放进技能根，由热刷新接管。我们的
「拉取到本机」也按这个模型做：拉取 = 把技能目录落进用户层根目录；不需要安装向导。

## 3. 后果

- 契约 schema 改一处：`tasks[].skills`。R 系列加一条：技能名必须在本机清单里。
- 回合协议改一处：`TurnRequest.skills`。产品能力面不认这个字段时忽略即可。
- 守护进程：技能登记册（分层：预置 / 用户 / 项目，近者优先，目录监视）、工具登记册
  （内建 + MCP）、`GET /skills` `GET /tools`、`use_skill` / `read_skill_resource`
  两个内建工具、MCP 工具接 Tool Gate（回收 TD-034）。
- 构建链：`skill-manifest.json` → 构建时拉取 + `skills-ref validate` → `resources/`；
  packaged-smoke 要核对预置层真的在包里、且每条的许可证文件随包同行。
- 界面：新分区（清单 + 来源 + 状态 + 启用开关 + 刷新预置）；「连接器」收窄为来源
  管理；任务详情里技能调用有专属行。
- 写死的 `IMPLEMENTED` 集合被登记册取代。
- 产品能力面多两个端点（`GET /skills`、`GET /skills/:name`），写进接入指南 §5.4；
  bid 的云端能力面是第一个实现者（它也是 Runos 的第一个消费者，ADR-020 §6-4）。

## 4. 备选方案

| 方案 | 为什么不取 |
|---|---|
| 把内核换成 DeepSeek Harness | developer preview 会破坏性变更；它的循环自持凭据调模型，与零秘密客户端 + 能力面中转（ADR-009）结构相反；换内核换不来产品能力 |
| 自己实现技能（v1 的方案） | owner 否：重复造轮子，且永远到不了上百个 |
| 技能商店让用户挑 | 与「发布后已预置」相反；预置层已经带着一批，用户层再加是补充 |
| 全部技能进每回合 | 几百条 × 100 token 会撑爆每一回合；按任务契约限定才可行 |
| 现在就跑 `scripts/` | 没有沙箱（TD-005）；先把指令类用起来 |
| 用 Anthropic 官方 docx / xlsx / pptx / pdf 技能 | 专有许可，禁止分发 |

## 5. 已定的三档与两个默认（实现时照此，变更另立记录）

- 三档按 `40-implementation/20-tools-skills-catalog-v1.md` §4：默认启用 / 装而不启用 /
  经 Runos 注册。
- docx / pptx 离线生成缺口：mcp-pandoc 先上，fork 归档的 Word / PowerPoint MCP 补齐。
- 脚本：本地不跑（TD-005）；不带业务数据的走 Runos Executor（登记未启用）。

## 6. 已定（owner，2026-09-05）

1. 「连接器」收窄为来源管理 —— 同意。
2. 契约 `tasks[].skills` 与回合协议 `TurnRequest.skills` 两个字段 —— 同意。
3. 第一批预置由本仓按业务口径（文档读取 / 编辑 / 浏览器操作 / 文档解析分析 / 在线
   搜索 / 表格生成 / docx 模板）梳理，目标 100+ —— 清单已出（§2.3）。
4. 分区名「能力平台」（2026-09-05）。

## 7. 实施记录（2026-09-05，技能半边落地）

落了什么（PR「能力平台：技能登记册」）：

| 层 | 落地 | 在哪 |
|---|---|---|
| 契约 | `tasks[].skills`（L1 pattern：kebab ≤64）+ **R16**（任务内唯一、须有 capability）| `packages/contract-schema`；30-contract-schema §12 / §15 |
| 回合协议 | `TurnRequest.skills: SkillOffer[]`（name + description），只在任务声明了技能时带 | `packages/runtime-core/src/ports.ts` |
| 内核 | `SkillsPort`（resolve / read / readResource）；`use_skill` `read_skill_resource` 两个内建工具随 `tasks[].skills` 而来、过同一道 Tool Gate、在内核里执行；启动前缺的技能按名拒绝（同不可运行的工具）；审计 `tool.executed` 带 `skill` | `packages/runtime-core/src/skills.ts`、`harness.ts` |
| 守护进程 | 四层登记册（预置 / 产品分发 / 用户 / 项目，近者优先；同层重名先扫到的生效；启用状态 `<dataDir>/skills/state.json`；坏 SKILL.md 警告并跳过）；产品分发层按能力面 `GET /skills` `GET /skills/:name` 刷新、按摘要缓存、离线照用；`GET /skills` `GET /skills/:name` `POST /skills/:name/enable|disable` `POST /skills/refresh` `GET /tools` | `apps/local-host/src/skill-registry.ts`、`skill-distribution.ts`、`tool-registry.ts`、`server.ts` |
| 构建链 | `pnpm skills:pull`：按清单钉死的 commit 稀疏检出、校验前言、连同许可证落 `resources/skills/` + `index.json`；`pack.mjs` 先拉再打包，冒烟断言包里的预置层非空 | `scripts/release/pull-skills.mjs`、`pack.mjs`、`electron-builder.yml` |
| 界面 | 设置分区「能力平台」：技能清单（层 / 来源 / 许可证 / 档位 / 含脚本 / 启用 / 被覆盖，按层筛选，刷新）+ 工具清单（内建 / 连接器 / MCP 服务器，状态如实）；「连接器」文案收窄为来源管理 | `apps/ui-workspace/src/settings.tsx` |

与 §2 原文的三处出入，记下不改判：

1. **预置层就地读取、不复制进 `<dataDir>`**（§2.3 写的是「首次启动把预置复制到
   `<dataDir>`；应用更新时刷新预置层」）。就地读，更新装完它自然就是新的，少一份会
   过期的副本；用户的启用 / 停用单独落 `state.json`，不动预置文件也记得住。
2. **目录名 ≠ 前言 `name` 的技能照收**，索引里记 `warning`（规范要求两者相等；
   Agent-Reach 等仓不合）。登记册按前言 `name` 认 —— dsh 同样如此；跳过它等于把一条
   默认档的技能悄悄丢掉。前言本身不合格（名字 / 描述）的仍然跳过。
3. **工具那一半只到「登记」**：清单里 27 条 MCP 服务器的 `launch` 规格还是空的，本机
   起不来；工具登记册把它们列为「已登记」而不是「可用」。收口在 **TD-042**（与 TD-034
   一起：起得来之后接 Tool Gate）。

样例契约（`products/bidproposal`）已声明技能（`pdf`、`officecli-docx`、
`officecli-word-form`，都在预置层 default 档；2026-09-09 前第一条是 `xberg`，随该
来源撤下换成 `openai/skills` 的 `pdf` —— 见 §7.3 与清单的 `refused` 段）：安装包
里预置层随包而来；开发机要先 `pnpm skills:pull`，否则任务启动前按名拒绝 —— 测试装配与观察台用 `MemorySkills` /
桩目录应答。没做、记着：任务详情里技能调用的专属行（§2.8 第 4 条）；用户层目录监视
（现在是按需重扫，2 秒缓存）。

### 7.1 工具半边（2026-09-05 晚，owner：「按照能启动的模式推进」）

| 层 | 落地 |
|---|---|
| 清单 | `servers[].launch`：本机启动规格，2026-09-05 逐条在 registry.npmjs.org / pypi.org 核过包名、版本、bin。两种 runtime：**node**（构建时 vendored 随包，用 Ruyin 自带的 Node 起）、**uvx**（Python 包，要本机有 uv，不随包）。没有规格的写 `launchNote` 说为什么；经 Runos 注册 / 需密钥的不许有规格。守卫 `lint:skill-manifest` 查形状 |
| 构建 | `pnpm tools:pull`（`scripts/release/pull-tools.mjs`）：`npm install --ignore-scripts` 到 `resources/tools/<id>/`，只留 win32-x64 的预编译二进制，去掉 .d.ts / map / 文档 / 测试；`index.json` 记入口与许可证。3 个 node 服务器 vendored 共 49.8 MB（playwright-mcp 15、mcp-searxng 11、open-websearch 24）；另外 3 个 node 形态的（executeautomation / negokaz / one-search）vendored 后各 100 MB 上下，**不随包**，记在 launchNote 里等第二批按需下载 |
| 守护进程 | `tool-servers.ts`：读索引、记启用状态与用户给的环境变量（`<dataDir>/tools/state.json`）、出启动计划（缺 uv / 缺 pandoc / 缺 SEARXNG_URL / 未 vendored 各说各的）。**预置服务器就是来源为 `bundled` 的 MCP 连接器**：`ConnectorRegistry` 多一层，起进程、握手、tools/list、`exposes / providersOf / callTool` 与用户装的连接器同一条路，项目授权（ConnectorGrant）同样适用；不能卸载只能停用。路由：`POST /connectors/:id/activate` `deactivate` `env`，`DELETE` 对预置的回 `CONNECTOR_BUNDLED` |
| 冒烟 | `RUYIN_SMOKE=1` 时真起第一个 vendored 的 node 服务器（握手 + tools/list + 停），`pack.mjs` 断言那一行。本机开发态实测：playwright-mcp 起来 24 个工具，open-websearch 经 API 启动 6 个工具再停下 |
| 界面 | 能力平台的「工具」清单：有启动规格的行带「启动 / 停止」，起不了的原因就在行里；「连接器」页预置的标「预置」，只能停用 |

**还没做**（TD-042 保留为 open）：uvx 形态要用户自己装 uv；playwright 的浏览器不随包（首次要
`playwright install chromium`）；契约 `provider: connector` 的工具靠同名接上，预置服务器的
工具名（`browser_navigate`、`search`…）要产品契约照着声明，还没有一份「预置工具名对照表」
（TD-034 的那一半）；三个重的按需下载的通道。

### 7.2 获取通道与档位纠正（2026-09-06）

判据只有两条，而它们同时成立：**目标客户里有气隙 / 域受限企业**（预置层存在的全部
理由，§2.3），而**安装包已经 129 MB**。唯一的解是：能装进包、且没有网络时真有用的
装进包；装不进的走一条经校验的通道，**而那条通道必须有一种不需要网络的运输方式**。

#### 先纠正三处已经为假的事实

1. **「默认启用 10 条」是假的。** 清单里 `tier: "default"` 有 10 条，而在一台干净的、
   断网的机器上真能起来的是 **3 条**（三个 vendored 的 node 服务器）：5 条 uvx 形态要
   本机自己装 uv，2 条（`zcaceres.fetch-mcp`、`modelcontextprotocol.servers`）连启动
   规格都没有。**这不是降级，是把一个已经为真的事实写进清单** —— 而 Runos 台账
   （vxture-runos#14）从同一份清单读。现在由 `lint:skill-manifest` 的第 1 条钉住：
   **档位与「装没装进包」是同一件事**。
2. **`negokaz.excel-mcp-server` 的「100 MB」不是真重量，是剪枝器漏判。** 它的平台目录
   叫 `dist/excel-mcp-server_windows_amd64_v1`，与 `pull-tools.mjs` 的规则四处不匹配
   （父目录门是 `^(build|prebuilds|bin)$`、目录名带包名前缀、带 `_v1` 后缀、词表里没有
   `windows` / `amd64`）。**没有去放宽那个正则** —— 它会继续漏掉下一个 GoReleaser /
   napi 形状；改成清单里人评审过的 `vendored.keepOnly` 白名单，加一条构建期体积断言
   （剪枝后 > 40 MB 即失败，除非显式 `sizeAcknowledged`）。实测剪到 **13.3 MB**，于是
   它随包了 —— 这是**唯一一条不要 Python、不要网络的离线 xlsx 通路**。
   同理纠正两个尺寸：`executeautomation` 134 MB → **56.6 MB**，`one-search` 95 MB →
   **65.3 MB**（原数是剪枝前的）。留着错数，下一个人会照它重新推出错的结论。
3. **playwright-mcp 的 launchNote 说反了。** 原文「首次用前 `npx playwright install
   chromium`（~150 MB）」：实测它默认 channel 就是本机已装的 Chrome，`--browser msedge`
   同样可用，而 Win11 一定有 Edge —— **离线浏览器自动化是零字节就已到手的能力**；而那条
   命令的真实代价是 311 MB 下载 / 704 MB 磁盘。梯子写在 `tool-servers.ts` 里
   （chrome → msedge → 用户给的 `BROWSER_EXECUTABLE_PATH` → 已获取的 headless shell），
   **不指望 playwright 自己**：它的 `findChromiumChannelBestEffort` 两个调用点都在
   codegen / dashboard，不在 MCP 那条代码路径上。

#### 第四档与 `components[]`

`tiers` 加 **`acquire-on-demand`**（随包不带、要点一次获取）。**这不是推翻 §6 第 3 条
已定的三档** —— 三档都还在，只是多了一档说明「随包不带」，故按 §7 / §7.1 的体例作为
实施记录追加，不另立 ADR。若 owner 认为加档就是改判，那该另立一条，这一条不替 owner 定。

组件（载荷）在清单里**单列**而不是挂在服务器上：一份载荷可以解锁多个服务器，挂上去会让
同一次下载在几行里各报一次，用户没法知道那是一次下载。`redistribution: "download-only"`
是硬标记 —— 这类不许进安装包、不许镜像到我们自己的主机，**把「许可证是硬门槛」（§2.3）
写成了一行机器能查的字段**。

#### 两种运输，同一段校验

```
POST /components/:id/acquire                      → HTTPS，从清单里那个 URL 取
POST /components/:id/acquire { from: "E:\…" }    → 本地文件 / 目录（U 盘、内网共享）
POST /components/acquire-from-dir { dir }         → 整个离线目录按 <id>-<version>.zip 配对
```

第二条是这份设计对气隙机器的真正回答：那台机器点不动下载按钮，但管理员可以把离线包里的
zip 指给它，**校验和还是随安装包同行的那一条**。

#### 信任论证：没有新开例外，四条现成的纪律各自延长一段

| 对着谁 | 这条通道怎么接上去 |
|---|---|
| `registry-client.ts` 的四道校验 | **一条不减，加第五道**：origin（从「索引自己的 origin」放宽成清单里的**闭合白名单** —— pandoc 与 Chrome for Testing 我们没有再分发权，镜像本身就是再分发）、size 上限、字节数相等、sha256 相等，再加**「许可证文件解压后必须存在」**（缺一条即回滚整棵暂存树）。唯一的实现改动是**流式**：那份把整个 body 收进内存的写法，对 120 MB 的下载 / 234 MB 的单文件是错的形状 |
| 「闭合白名单」这句话本身 | 一份**发请求之前**查的白名单，只有在**没人跟重定向**的时候才是闭合的：`fetch` 缺省的 `redirect: "follow"` 允许跳 20 次，每一跳都可以落到名单外的任意主机 —— 那道检查看起来还在，实际只挡住了第一跳。所以 `redirect: "manual"`，**3xx 一律拒**（清单里那几条是直链，一次都不需要跳；要换地址就改那条有人评审过的 pin）。同一处还查协议：`new URL("http://…").origin` 会和一条写成 http 的白名单项对上，于是字节走明文而回执上照写 `https` —— 运行时要求 `url.protocol === "https:"`，`lint:skill-manifest` 在清单那一层同样拒 http 的 `source.url` 与 http 的 `allowedOrigins` 项 |
| 「校验过一次」不等于「现在还是那样」 | 落地之后有人会动那棵树：杀毒软件隔离掉 `headless_shell.exe`、用户清盘删了半棵。所以**用时也看一眼**：回执里 `verify` 记下入口 / marker / 许可证正文，`acquiredTree()` 每次判定都查它们还在不在，缺一个就是 `payload-missing`（不是「已获取」）。**不重算整包 sha256** —— 那是 120 MB 的一次磁盘读，而这个判定在每次列出 / 每次 `plan()` / 每次起服务器时都要跑一遍。**判定只有这一处**：`pathOf` 与 `status` 各判各的，就一定有一天说不到一块去（上一版正是如此：回执截断时界面说「失败」，而启动路径照样把那棵树交给 playwright） |
| TD-012（没有签名根） | **不需要新例外，也不需要 `RUYIN_ALLOW_UNSIGNED_*` 那类开关。** 与产品包那条路声称的是同一件事，区别只在**摘要从哪来**：那条路的 sha256 来自一份经 TLS 取回的 index.json（TD-037 明说清单本身可能被换）；这条路的 sha256 **写在仓里、随安装包同行、评审时有人看过、不经网络**。上游换了字节就校验不过，失败模式是「用不了」而不是「被换掉」。残余照实说：安装包本身未签名（TD-001 standing），所以信任地板与 ruyin 其余部分**同高，不更高**，回执里 `signed: false` 照写 |
| TD-036 / ADR-005（不接受任意来源） | 这条通道**不接受任意来源**：只接受仓里那份清单按 sha256 钉死的那几串字节，来源限于闭合白名单，解压走 `pkg.ts` 那套护栏（护栏函数**导出复用，不复制** —— 复制出来的两份会各自漂移） |
| TD-021 的更新策略护栏 | **扩 `check-update-policy.mjs` 而不是新起一份**（「自动下载不许悄悄回来」这个决定留在一处）。机器可查的那几条：`main.ts` / `tool-executor.ts` / `harness.ts` 里不许调 `acquire`；每一种失败状态都要在 `settings.tsx` 里被渲染；设置页不许出现写死的组件 URL；按钮附近必须显示体积字段；下载必须写着 `redirect: "manual"` 且必须查 `url.protocol` —— 后两条钉的是**沉默失效**：跟着跳和不查协议，都不会报任何错，只是那道白名单不再挡什么 |

#### 「等会儿再试」是一个断言，不是一句客套

失败折叠一次，用户就分不清；**可重试与否折叠一次，用户会一直重试一件永远不会成的事。**
404 / 410 说明上游把这个构建删了（Chrome for Testing 明确会删旧版本）—— 那是**永久**的，
该说的是「清单里那条 pin 没了」。所以状态与错误码都分开：

| 发生了什么 | state | HTTP | code | `retryable` |
|---|---|---|---|---|
| 网络错误 / 5xx / 408 / 429 | `unreachable` | 503 | `COMPONENT_UNREACHABLE` | true |
| 404 / 410（上游删了这个构建） | `gone` | 410 | `COMPONENT_SOURCE_GONE` | **false** |
| 长度 / sha256 不符，或盘上那棵树按另一条摘要装的 | `mismatch` | 409 | `COMPONENT_BYTES_MISMATCH` | false |
| 协议 / origin / 重定向被拒 | `refused-origin` | 400 | `COMPONENT_SOURCE_REFUSED` | false |

（通则 X-1：`retryable` 必填 —— 缺了它，调用方拿到的每一个错误都得靠猜。）

`payload-missing`（回执在、载荷被杀毒隔离或清盘删了）**不在这张表里**：它是 `status`
报的状态，不是 `acquire` 的失败 —— 载荷不在了的时候 `acquire` 会当作「没获取过」重新
取一遍（自愈），永远抛不出这个状态。**表里只放真抛得出来的**：加一个永不触发的码，
消费方会照着写一条永不触发的分支（`check-api-shape.mjs` 的原话）。

#### 绝不下载的三种时机

启动时；刷新清单时；**以及任务需要某个工具时**。最后一条最要紧：契约要的工具若落在未获取
的载荷后面，`startTask` 在开跑前按名拒绝（与缺技能、缺工具同一条既有路径，§7）。
**模型的一次工具调用永远不能触发下载。** 反面教材是实测到的：`executeautomation` 的
`dist/toolHandler.js` 在启动失败时 spawn `npx playwright install` —— 一次模型工具调用引发
311 MB 无人值守下载。这也是那个包被剔出清单的头一条理由（**是行为问题，不是体积问题**）。

#### v1 不做断点续传

失败或中断就删暂存、把原因说清楚、用户再点一次。**不是疏漏**：续传会引入「续上来的那段
前缀从没被校验过」的信任问题，而最大的一件也就 120 MB，重来比多一套信任面便宜。这一句同时
写在 `component-store.ts` 的头注释里，否则下一个人会当成疏漏补上。

#### 落了什么

| 层 | 落地 |
|---|---|
| 清单 | 第四档 `acquire-on-demand`；`allowedOrigins`、`pythonRuntime`、`components[]` 三个顶层字段；`launch.requiresComponent` / `offline.cacheSeeded` / `browserLadder`；`vendored.keepOnly` / `sizeAcknowledged`。`lint:skill-manifest` 加 9 条字段规则（不联网、不判断），并有自己的反向验证测试（`pnpm test:guardrails`） |
| 守护进程 | `component-store.ts`：两种运输、**只走 https 且不跟重定向**、流式下载 + 边写边算摘要、`pkg.ts` 护栏复用的**流式解压**（上限按组件的 `unpackedBytes` 给 + 硬天花板）、许可证核对、`.ruyin-component.json` 回执（含 `verify`，用时按它查载荷还在不在）+ 同盘 rename 原子落地、`NOTICES.md` 汇总、**「装好了没有」收在 `acquiredTree()` 一处**（`pathOf` / `isAcquired` / `status` / `NOTICES` 全走它）、失败各说各的（11 种非成功态，逐一有自己的措辞与拒绝码）（永久与可重试分开）、取消。路由 `GET /components`、`POST /components/:id/acquire|cancel`、`POST /components/acquire-from-dir`、`DELETE /components/:id`，失败按种类映射到各自的 HTTP 状态与错误码；事件总线加 `component`（只说什么变了、不带数值，节流约每秒一次） |
| 启动计划 | `tool-servers.ts`：解析顺序补全（随包 → 已获取 → **「未获取：需下载 N MB」**，与「这一版没有 vendored」「没有随包的 uv」三件事分开说）；uvx 离线启动契约（随包 uv.exe 绝对路径 + `--offline` + `UV_CACHE_DIR` / `UV_PYTHON_INSTALL_DIR` / `UV_PYTHON_DOWNLOADS=never`，**不留联网回退**）；浏览器梯子 |
| 界面 | `ToolView.status` 从 4 个扩到 6 个（加 `needs-acquisition` / `acquiring`），加 `component`（体积 / 许可证 / 来源主机 / 进度）与 `toolsUnprobed`。**体积、许可证、来源主机都在按钮左边** —— 点之前就看得见。按钮旁给「从本地文件导入」。照 TD-037 的先例：**能列不能装的时候把话写在界面上，不要把按钮藏掉** |
| 连接器进程 | 每个 MCP 服务器都拿到一个自己的工作目录（`<系统临时目录>/ruyin-connector-work/<id>`）。不给 cwd 就是继承守护进程的 cwd —— playwright-mcp 一起来就往那儿写 `.playwright-mcp/` 快照，实测在仓库根留下过四个未跟踪文件；而装好的机器上那个目录可能是 Program Files。**刻意不放数据目录下**：Windows 上进程的 cwd 会锁住目录连同上级，而数据目录是可以搬家的 |
| 对照表 | `pull-tools.mjs` 起每个 vendored 完的 node 服务器、`initialize` + `tools/list`、停掉；工具名记进 `resources/tools/index.json`，生成 `40-implementation/40-bundled-tool-names.md` 与接入指南 §5.4.1 那一段，`pnpm lint:tool-names` 比对（过期就红 —— **生成物里不写构建日期**：写了，这份文档就会从提交的第二天起对每一次无关提交判过期，而一个每天红一次的必需检查等于教人忽略它；渲染单列在 `tool-name-doc.mjs` 里，就是为了能被测）。探测本身在一个临时工作目录里跑。本机实测 **41 个工具名**（playwright-mcp 24、mcp-searxng 4、open-websearch 6、negokaz 7）。⚠️ 标了两个能跑任意代码的（`browser_run_code_unsafe`、`browser_evaluate`）：**照登，不藏** —— 藏起来只会让下一个人以为自己看漏了；文档同一处写明挡住它们的是 schema 里 `category` 的闭合枚举，**不是任何一条 R 规则**（TD-005 的机制更正） |
| 定期核对 | `pnpm components:verify` 只读地把每条 pin 的字节流回来算一次摘要（不落盘、不解压、同一份白名单、同样不跟跳）。**由 `.github/workflows/components-verify.yml` 每周一 03:17 UTC 跑**，另有手动触发。为什么非有不可：Chrome for Testing 不发布任何校验和，清单里那一条是唯一的钉子，而上游会删旧构建。照实记两条：GitHub 的 `schedule` 只在 main 上触发；失败的样子是 Actions 里一条红的定时任务加一封 GitHub 的邮件，**没有人会被呼叫** |

#### 没做、以及为什么（照实记，TD-042 保留为 open）

- **`components[]` 里现在只有一条**（`browser.chromium-headless-shell`，sha256 实测取回并
  验过）。设计里另外三条（markitdown 的 wheel 包、pandoc、open-websearch 的 node 包）**没有
  写进清单**：它们的 sha256 要么得由 CI 造包时算出（前两者中的 wheel/node 包），要么得先取
  一次上游记下来（pandoc 不发布任何校验和文件）。**写占位符会把 `lint:skill-manifest` 变成
  摆设**，所以宁可让这三条留在 `installed-disabled` 并在 `launchNote` 里说清缺什么。
  于是 `open-websearch` 也**没有**挪出安装包（挪走它是唯一一处不损失离线诚实度的减重，但
  没有可获取的替代之前挪走等于让它消失）。
- **Python 半边没有真的进安装包。** 启动契约（`uvxPlan`）与预取脚本（`seed-uv-cache.mjs`）
  都写了，但 uv / CPython / 预取好的 wheel 缓存这一次没有加进 `electron-builder.yml`，也没有
  在 CI 里跑过。所以 `haris-musa.excel-mcp-server` 记为 `installed-disabled` 而不是 `default`
  —— 档位与「装没装进包」是同一件事，这一条自己也要守。转正顺序：跑通预取 → 进
  electron-builder → `packaged-smoke` 真起一次 uvx 形态 → 才改 tier。
- **`packaged-smoke` 没有加「每个 default 档的 `plan()` 都 ok」这条断言**，也没有覆盖 uvx
  形态 —— 前者要在打包产物里跑，本轮没有打过包。
- **离线侧载包**（`Ruyin-Offline-Tools-<version>.zip`）与 `build-components.mjs` 没做：
  它要先有 `redistributable` 的组件，而现在一条都没有。`acquire-from-dir` 那一半已经在了。
- **执行后的默认档是 4 条**（playwright-mcp、mcp-searxng、open-websearch、negokaz），全部是
  vendored 的 node 服务器。**条数从名义 10 掉到 4：这 4 条都随包、不下载任何字节，其中 3 条开箱即起，
  第 4 条（mcp-searxng）随包但要先配 `SEARXNG_URL`（它指向企业自托管实例，那个地址
  只有用户知道）。「随包」与「开箱即起」是两个数，合成一个就是「预置 10 个」那个错
  的小一号版本 —— 守卫与界面现在都分开报。**

#### 六条策略：owner 已定（2026-09-06）

判断阶段把这六条列为「owner 的策略题」，各自实现了一个可逆的默认值。**owner 同意全部
六条推荐**，因此它们不再是默认值，是决定：

| # | 决定 | 理由 / 代价 |
|---|---|---|
| 1 | **随包 uv 引导件**（`uv.exe` + `uvx.exe` + uv 托管的 CPython，约 37 MiB 压缩） | 它是**使能件**：机器上没有 uv，连侧载来的 wheel 都跑不了，uvx 形态在气隙机器上永远是死的。不要就从 `electron-builder.yml` 的 `files` 里摘掉 |
| 2 | **markitdown 不进安装包**，走离线侧载 / 按需获取 | 它是气隙机器上唯一的 PDF/pptx/docx → Markdown 通路，但要 113 MiB，其中约 76 MB 是死重（speech_recognition 要 ffmpeg 而我们不带、onnxruntime 经 magika 进来）。方向可逆：以后要进包改一行构建配置；发出去一个 240 MB 的安装包再想瘦回来做不到 |
| 3 | **Ruyin 不主动下浏览器** | 与 updates.ts 的先例同形（owner 2026-09-02：检查更新但不下载）。而且实测 playwright-mcp 用本机已装的 Chrome / Edge 就能跑，**离线浏览器自动化是零字节就已到手的能力**；headless shell 那条只是梯子的最后一级 |
| 4 | **pandoc 只允许按需下载**（`redistribution: "download-only"`），永不进安装包、永不镜像到我们自己的主机，许可证正文与 source offer 随组件落盘 | 它是 GPL-2.0-or-later，而本仓有意以 all-rights-reserved 分发、不带 LICENSE 文件。按需下载把「放进闭源安装包算不算分发」这个问题绕开，但没免除随件带许可证的义务 |
| 5 | **docling 降为 `installed-disabled`**、`launch: null`、原因照实写 | 它钉死的 3.2.0 默认装的是一个**远端 docling-serve 的客户端**，本地一页都不转 —— 与「数据不出域」是反的。能本地转的形态 1.014 GiB（torch 481 MB、cv2 113 MB，闭包里还有要编译工具链的 sdist）。代价：默认档少一条 |
| 6 | **第四档 `acquire-on-demand` 作为实施记录追加**，不另立 ADR | §6 第 3 条的三档没有被推翻，只是多了一档说明「随包不带、要点一次」。§7 / §7.1 已有这个体例 |

### 7.3 许可证判定改为逐技能两读；撤下 xberg（2026-09-09）

清单原先只读**仓库级** `LICENSE`（`licenseSource` 一水儿写着「仓库级 LICENSE
（GitHub API license.spdx_id）」）。那一读不管辖技能自己的声明，于是有了这条：

**`xberg-io/xberg` 在钉死的 `d98f848` 上，仓库级 LICENSE 是 MIT，而
`plugin/skills/xberg/SKILL.md` 的前言写 `license: Elastic-2.0`** —— source-available，
不是宽松许可。同一批字节两个说法，管辖的是限制性的那个。它此前是 `tier: default`，
**已经打进安装包并默认启用**。Runos 侧独立判出同一结论（vxture/vxture-ruyin#201 §d）。

反过来的例子同样存在：`anthropics/skills` 仓库级是 Apache-2.0，而 `docx` / `pdf` /
`pptx` / `xlsx` 四条自带的 `LICENSE.txt` 是「All rights reserved」的专有条款 ——
清单 v1 已正确排除这四条，但**只读仓库级本来会把它们收进来**，排除对是靠人评审，
不是靠规则。

#### 现在读三处，任意两处冲突就失败关闭

判定抽在 `scripts/release/skill-license.mjs`（纯函数，可单测），`pull-skills` 在
**落盘之前**调用它：判完再拷，坏字节一次都没进过 `resources/`。三读是：清单那一级
的声明、技能前言里的 `license:`、技能自己带的许可证文件正文。白名单制 —— 宽松许可
之外一律拒，copyleft 与 source-available 都在拒的一侧。

两条刻意的保守取舍，都是被真数据逼出来的：

- **前言里认不出是 SPDX 的值不当作声明。** `anthropics/skills` 的 11 条写的是
  `license: Complete terms in LICENSE.txt` —— 一句散文，是指向文件的指针，不是第二
  个说法。当成声明比对会把 11 条合规技能全部误杀。
- **正文认不出来的不判定。** 只认少数几种确定的形态（MIT 与 ISC 的正文开头几乎
  一样，就不猜），认不出的记一条 note 交给人看，不拿它去否定别处的说法。

对已拉下的 233 条真字节跑了一遍：**232 条通过、11 条带 note（正是上面那 11 条散文
前言）、被拦的只有 xberg**。零误杀。

#### 失败关闭是整个 run 失败，不是跳过一条

`pull-skills` 原有的口径是「不合格警告并跳过，不让一份坏技能拖垮整个预置层」——
那对前言格式是对的。许可证不一样：**前言坏是质量问题，许可证冲突是分发权问题。**
跳过一条继续构建，等于给了人一个不看它的机会。所以许可证冲突既不落盘、也让整个
run 非零退出；要让构建重新变绿，唯一的路是在清单里把这条来源撤下或改正。

#### 撤下不等于删掉

xberg 从 `skills[]` 移到清单新增的 `refused` 段，连原因、钉死的 commit 与核实日期
一起留着。理由很实在：「不在清单里」和「查过了、不能收」在字节上长得一模一样 ——
没有这一段，下一个人会把这条 9.3k 星的技能重新加一遍。`lint:skill-manifest` 钉住
`refused` 里的 id 不许同时出现在 `skills` / `servers` 里。

连带改动：样例契约 `products/bidproposal` 的 `analyze_tender` 原声明 `xberg`，换成
`openai/skills` 的 `pdf`（同为预置层 default 档，Apache-2.0，逐技能 `LICENSE.txt`
核过）。

#### 顺带修掉的一处

`check-skill-manifest.mjs` 的错误汇报此前夹在组件段与 `pythonRuntime` 段之间，于是
**随包 uv 的每一条校验都是死信** —— 检查在跑，`errors.push` 也在跑，只是没人读它。
汇报移到全部规则之后。证据是它一移过去，守卫自测里那份「干净的清单」立刻不干净了：
baseline 的 `pythonRuntime.uv` 从来没写全过 sha256 / size / licenseFiles，而它一直
「通过」。补了一条用例钉住这个顺序。

### 7.4 预置层的来源换到 Runos，但取字节的时机是构建时（owner 2026-09-09）

Runos 侧已定（其 ADR-019）：**预置供给台账归 Runos 拥有**——`deploy/preset/sources.json`
人工策展、`ledger.json` 由它生成、经普通管理面 API 注册进环境，288 条真实 Agent
Skills。原先的方向（Runos 按本仓 `resources/skill-manifest.json` 构建）作废，联络单
vxture/vxture-ruyin#201。

**本仓接受这个方向。** 台账放在某一个消费方手里，其它消费方就只能各自复制一份 ——
这条理由成立，而且与 ADR-020 §1.1「Runos 是能力的台账与网关，Ruyin 是能力的执行
环境」是同一句话的两半。

#### 口径三句，写死

1. **Runos 是预置台账的权威**：收哪些来源、钉哪个 commit、逐条许可证怎么判，以它为准。
2. **本仓的同步是构建时物化**：CI 取字节 → `resources/skills` → `extraResources` 打进
   安装包。装出来的安装包形态一个字不变。
3. **运行时永不依赖 Runos 可达。** 四层来源里没有任何一层是「用的时候才去网上取」：
   预置层随包在本地；产品分发层按 `content_digest` 落盘，能力面拉不到时本地那份照用
   （`skill-distribution.ts` 的 `unreachable`）；用户层与项目层本来就在本地。

#### 第 3 句为什么必须单独写一句

**「在线维护台账」和「在线获取技能」是两件事。** 混起来会同时踩两个坑，而且两个坑
都不是新的：

- **气隙 / 域受限客户用不了。** 那是预置层存在的全部理由（§2.3），不是一个可以让位
  的次要目标。
- **客户端结构上够不到 Runos。** 零密钥 public client，不直连，中间隔着产品自己的
  云端服务（ADR-001 / ADR-009 / ADR-020 §5）。

ADR-020 §7 的备选表里「把本机登记册整个换成 Runos 目录的镜像」被否掉，理由写的就是
「离线必须可用」。本节不是推翻它，是给出它的精确版：**换的是取字节的地方，不是取
字节的时机。**

#### 这条不与「不直连」冲突 —— CI 不是客户端

构建时在 CI 里持有 Runos 的 S2S 凭证，不违反客户端零秘密。那条规则约束的是**发出去
的客户端**（CLAUDE.md：shipped client contains ZERO secrets）。同理，ADR-001 / 009
的「不直连」说的是运行时的桌面进程，不是构建流水线。

代价照实记两条：**本仓的构建从「只依赖 GitHub」变成「还依赖 Runos 生产环境可用」**；
**需要 Runos 给本仓 CI 一个 S2S 身份** —— 后者是 Runos 侧动作，不是本仓能自决的。

#### 换源之前要先解决的两个缺口

不是反对，是次序问题 —— 这两条不解决就换，等于静默换掉一批预置内容：

1. **`scripts/` 缺口。** Runos 的 `fetch` 明确不带 `scripts`（#201 §c：Skill 声明
   scripts 就必须声明对 Executor 的 required 依赖，且打包形态等 plugin ingest），台账
   里记了 `upstreamScripts` 计数，288 条中 64 条有。而本仓现在从上游直接拉的是整个
   技能目录：`pull-skills` 的最近一次全量是 **232 条里 56 条带 `scripts/` 随包**。本地
   暂不执行（TD-005），但沙箱落地后要跑的就是它们。换源会让这 56 条的「手」从安装包
   里消失，而这不是缓存能补的 —— Runos 那边就没有。
2. **条数差没查清。** 本仓 **232 条 / 22 源**（撤下 xberg 后，§7.3）对 Runos **288 条 /
   22 源**。差从哪来（`include` 路径范围？逐仓纳入口径？）没查清就同步，会把一批内容
   悄悄换掉而没人看见。对账口径按 Runos 的提醒：**台账数减去被运维方撤下的**，不要
   断言两者相等（其可发现面实测是 287）。

#### 时点

Runos 的三个 PR（其 #15 / #16 / #17，加上补枚举与 `filter` 的 #18）**尚未合入、尚未
seed 进生产**，生产台账当前仍是 2 条。在那之前，本仓的 `resources/skill-manifest.json`
仍是预置层的唯一事实；同步的实现方式待上述两个缺口有答复后再定，本节只定口径。
