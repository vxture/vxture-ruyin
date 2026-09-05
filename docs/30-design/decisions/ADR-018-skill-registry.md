# ADR-018 技能与工具：全部从外部获取、拉到本机可运行、随发布预置；格式对齐开放生态

- 状态：**已接受（v2.2，owner 2026-09-05）**。分区名定为「**能力平台**」（§2.7）。
  v1 被 owner 否掉两处：不该自己造技能，数量应至少上百。v2 按 owner 七条意见重写；
  v2.1 记入已定的三条（§6）；v2.2 按 ADR-020 修正三处：技能来源加「产品分发」层、
  第三方密钥归 Runos 保险库、脚本的 Runos Executor 出路只登记。
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

没做、记着：契约里 bid 样例还没声明 `skills`（预置层在包里验过之后再加，否则开发机
没拉过预置层，任务一启动就被按名拒绝）；任务详情里技能调用的专属行（§2.8 第 4 条）；
用户层目录监视（现在是按需重扫，2 秒缓存）。
