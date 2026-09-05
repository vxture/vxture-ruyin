# ADR-018 工具技能：全部从外部获取、拉到本机可运行、随发布预置；格式对齐开放生态

- 状态：**提议（v2）**。v1（2026-09-05 上午）被 owner 否掉两处：不该自己造技能，
  数量应至少上百。本稿按 owner 七条意见重写，待定稿。
- 日期：2026-09-05
- 相关：ADR-006（skill 归 Ruyin，建在 Harness 上）、ADR-002（循环归 Harness）、
  ADR-005（本地连接器 = MCP）、ADR-009（能力面中转）、ADR-011（框架边界）、
  30-contract-schema §11、TD-005（无沙箱不进 `execute_script`）、TD-034、TD-035

## 0. 先回答 owner 的一个问题：我们是不是建在 harness 上

**是「harness 形态」，但内核是自己写的，不建在任何外部 harness 框架之上。**

- 50-harness.md 定义的 Harness 是本仓自己的任务执行内核：状态机、Tool Gate、
  Checkpoint、验证、恢复、审计链；实现在 `packages/runtime-core/src/harness.ts`，
  一致性清单 C1–C7 在 `conformance.ts`。
- DeepSeek Harness（`deepseek-ai/deepseek-harness`，MIT，Node，Cordis 插件体系，
  developer preview）是**另一个** harness：它的循环自己调模型、自己持提供方凭据。
  我们的循环在本地、推理在产品能力面后面（ADR-002 / ADR-009），客户端零秘密 ——
  这一点结构上不同。
- 所以本 ADR 的口径是 **参照它的「接入方式与格式」，不把内核换成它**：格式对齐了，
  它那个生态里的东西就能直接拉过来用；内核不换，是因为 developer preview 会破坏性
  变更，而且换内核换不来任何产品能力。

## 1. 现状

| 层 | 设计里说的（ADR-006） | 实现里有的 |
|---|---|---|
| 预制 | 文件读写、检索、解析、抽取、转换、导出 | `tool-executor.ts` 一个写死的四元素集合 |
| 拓展 | MCP 对齐的连接器 | 连接器已落地（stdio；HTTP 见 TD-035；工具面未接 Tool Gate 见 TD-034） |

没有登记册、没有清单端点、没有界面。契约多声明一个 `provider: runtime` 的工具，
任务在启动前就被拒 —— 而用户看不到本机到底有什么。

## 2. 决策（提议）

### 2.1 名称与归集：一个分区，叫「工具技能」，两种条目

| 条目 | 是什么 | 怎么跑 | 来源 |
|---|---|---|---|
| **工具** tool | 可执行的能力：有输入 schema、有 `execute` | 本地进程或子进程；每次调用过 Tool Gate | **MCP 服务器**（stdio：`command` + `args`；Streamable HTTP：`url`） |
| **技能** skill | 一份**指令包**：`SKILL.md` + 可选 `scripts/` `references/` `assets/` | 目录只送名字与描述给模型；模型决定用时，运行时把全文作为工具结果交回 | **Agent Skills 开放规范**的技能目录（git / zip / 本地目录） |

这是 DeepSeek Harness、Claude Code、Codex、OpenCode、Kimi 已经趋同的划分：
**工具是代码，技能是指令**；两者各有登记册，但对用户是一张清单。

- 设置里新增分区「**工具技能**」（顺序：通用设置 / 工具技能 / 连接器 / 数据库 /
  软件更新 / 关于）。一张清单：名称、种类（工具 / 技能）、来源、版本、状态。
- 「连接器」保留，但职责收窄为**管理外部来源**（添加 / 测试 / 授权一个 MCP
  服务器或内网系统）；它贡献出来的工具出现在「工具技能」清单里，而不是各页各管
  一份。数据库不动。

### 2.2 全部从外部获取，不自己造

**Ruyin 不再实现任何技能，也不再新写内建工具**（现有四个保留，作为地板）。

| 种类 | 从哪拉 | 拉到哪 | 怎么可运行 |
|---|---|---|---|
| 技能 | git 仓库 / zip / 本地目录；规范见 agentskills.io（`SKILL.md` 前言：`name`、`description` 必填；`license`、`compatibility`、`metadata`、`allowed-tools` 可选；目录名须等于 `name`） | `<dataDir>/skills/<source>/<name>/` | 全文按需加载（下面 2.4）；`scripts/` **暂不执行**（见 2.6） |
| 工具 | MCP 服务器定义（与 DeepSeek Harness `dsh-mcp-client` 同形：`{transport:'stdio', serverName, command, args, env, cwd}` 或 `{transport:'streamable-http', url, headers}`） | `<dataDir>/tools/<serverName>.json` | 本地拉起子进程 / 连 HTTP；工具名加命名空间 `mcp__<serverName>__<name>`，与 dsh 一致 |

生态规模足够支撑「上百个」：Agent Skills 是开放规范（Anthropic 发布，
agentskills/agentskills 维护），官方仓 anthropics/skills、社区索引
VoltAgent/awesome-agent-skills（1000+）、目录站已到数十万条；MCP 服务器目录
同样以百计。**数量来自生态，不来自我们的开发工时。**

### 2.3 随发布预置：清单跟着安装包走，首启离线可用

- 仓内维护一份 **预置清单** `products/…` 之外的 `resources/skill-manifest.json`：
  每条 = 来源（git URL + 钉死的 commit / zip 校验和）+ 纳入哪些技能 + 哪些 MCP
  服务器定义。
- **构建时按清单拉取**，打进安装包 `resources/skills/` 与 `resources/tools/`：
  客户的域环境可能连不上 GitHub / npm，首启必须离线可用。
- 首次启动把预置复制到 `<dataDir>`（用户层）；应用更新时刷新预置层。用户自己
  加的来源在用户层，与预置层分开 —— 同名时**近者优先**（dsh 的分层规则：
  project > custom > user > bundled，近层整体覆盖远层）。

这就是 owner 说的「开发和发布后已预置链接」：发布物里带着经过挑选、版本钉死的
一批；用户拿到的是已经能干活的机器，不是空壳加商店。

### 2.4 怎么接进我们的回合协议（参照 dsh 的进阶披露）

dsh 的做法：目录只含 `name` + `description`（约 100 token / 条），作为一条
用户角色的系统提醒注入；模型调 `skill({ name })` 工具拿全文，`resourceBase`
按需取脚本与参考文件；`disable-model-invocation` / `user-invocable` 两个开关。

映射到我们（ADR-002 循环在本地，ADR-011 运行时只给事实）：

| dsh | Ruyin |
|---|---|
| 系统提醒里的技能目录 | `TurnRequest.skills: SkillOffer[]`（`name` + `description`），**新增字段**，是数据不是措辞 —— 提供方决定怎么用 |
| `skill({name})` 工具 | 运行时实现的 `use_skill` 工具（内建，`category: local_read`）：返回 `SKILL.md` 全文 + 资源清单 |
| `resourceBase` | `read_skill_resource` 工具：只读 `references/` `assets/`；路径限定在技能目录内 |
| 工具注册 + `tools/pre-execute` allow/deny/ask | 现有 Tool Gate：硬底线 ∧ 用户策略 ∧ 契约默认 —— **一模一样的形状**，不用改 |
| MCP 工具 `mcp__<server>__<tool>` | 同名规则；连接器工具接上 Tool Gate（这就是 TD-034 的回收） |

回合协议是本仓与产品能力面之间的约定（30-design/20），不是平台联络项 —— 加一个
字段不需要等平台。

### 2.5 只有产品能调用（owner 第 5 条）

工具技能是运行环境提供的**基础设施**，用户在设置里看得见、管得着，但**不直接
用**；调用它们的只有产品，且产品必须在契约里声明：

```yaml
tasks:
  - id: generate_proposal
    tools: [read_file, search_knowledge, mcp__docx__fill_template]   # ⊆ 本机工具技能清单
    skills: [bid-writing-cn, tender-compliance-check]                 # 新增：⊆ 本机技能清单
```

- 契约新增 `tasks[].skills`（R8 同样约束：必须在清单里）；每回合只把**这个任务
  声明的**技能送进 `TurnRequest.skills` —— 这也是「上百个」不会把每回合撑爆的
  原因：清单在本机有几百条，一次任务只带它声明的几条。
- 没声明的技能，模型看不见；没声明的工具，闸门直接拒。

### 2.6 不变的、和一条必须说清的限制

- **不门控、不计量、不计费**（ADR-006）；**客户端零秘密**；**Tool Gate 不变**。
- **技能里的 `scripts/` 暂不执行。** 那是任意代码，TD-005 说得很清楚：没有 OS 级
  沙箱之前不进 `execute_script` 类。所以第一版技能 = 指令 + 参考 + 模板，脚本
  在清单里标「需要沙箱」而不是悄悄跳过。dsh 有 `packages/sandbox`（含 e2b）
  才敢跑脚本 —— 这是它比我们多的一块，也是我们下一步要不要引入的决定。
- `allowed-tools` 前言字段（规范标为实验性）：读进来、显示出来，**不当作放行
  依据** —— 放行只听 Tool Gate。

## 3. 后果

- 契约 schema 改一处：`tasks[].skills`。R 系列加一条：技能名必须在本机清单里。
- 回合协议改一处：`TurnRequest.skills`。产品能力面不认这个字段时忽略即可。
- 守护进程：技能登记册（分层：预置 / 用户 / 项目）、工具登记册（内建 + MCP）、
  `GET /skills` `GET /tools`、`use_skill` / `read_skill_resource` 两个内建工具、
  MCP 工具接 Tool Gate（回收 TD-034）。
- 构建链：`skill-manifest.json` → 构建时拉取 → `resources/`；packaged-smoke 要核
  对预置层真的在包里。
- 界面：「工具技能」分区（清单 + 来源 + 状态 + 刷新预置）；「连接器」收窄为来源管理。
- 写死的 `IMPLEMENTED` 集合被登记册取代。

## 4. 备选方案

| 方案 | 为什么不取 |
|---|---|
| 把内核换成 DeepSeek Harness | developer preview 会破坏性变更；它的循环自持凭据调模型，与零秘密客户端 + 能力面中转（ADR-009）结构相反；换内核换不来产品能力 |
| 自己实现技能（v1 的方案） | owner 否：重复造轮子，且永远到不了上百个 |
| 技能商店让用户挑 | 与「发布后已预置」相反；预置层已经带着一批，用户层再加是补充 |
| 全部技能进每回合 | 几百条 × 100 token 会撑爆每一回合；按任务契约限定才可行 |
| 现在就跑 `scripts/` | 没有沙箱（TD-005）；先把指令类用起来 |

## 5. 待 owner 定

1. **分区名与归集**：「工具技能」一张清单（工具 + 技能），「连接器」收窄为来源管理 —— 同意与否。
2. **预置清单第一版收哪些来源**：建议 anthropics/skills 里文档处理类（docx / xlsx / pdf / pptx）
   + 社区索引里文档与办公类，再加 1–2 个文档类 MCP 服务器；数量目标 100+。
   要不要我先列一份候选清单（名称 + 来源 + 许可证）供你勾。
3. **脚本执行**：第一版技能不跑 `scripts/`（无沙箱）—— 接受；还是把「引入 OS 级
   沙箱」提前立项。
4. **契约与回合协议各加一个字段**（`tasks[].skills`、`TurnRequest.skills`）—— 同意与否。
