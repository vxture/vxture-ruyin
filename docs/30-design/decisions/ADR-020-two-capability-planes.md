# ADR-020 两个能力提供平台：Runos 分发与承载，Ruyin 执行；接线走产品云端

- 状态：**已接受**（owner 2026-09-05：§6 四条全部同意；第 4 条定为 **bid 产品的云端
  能力面是 Runos 的第一个消费者**）。原问：「检查 Runos 代码与文档，分析两个能力提供
  平台和机制」
- 日期：2026-09-05
- 事实来源：`D:\MyWebSite\vxturestudio\vxture-runos`（master `3e247c2`，
  设计语料 `docs/30-design/1xx–2xx`、ADR-001~018、`service/src/gateway`）；
  artifacts《Runos 接口文档》《Runos 系统架构》（2026-08-18）、《产品接入范本》、
  《Ruyin 能力登记册》；本仓 ADR-001 / 004 / 006 / 008 / 009 / 018。
  **每条机制都对过代码或设计正文；没核到的写「未核」。**
- 相关：ADR-008（Runos 是能力供给层，不是对位运行时）、ADR-009（能力面中转）、
  ADR-018（技能与工具从外部获取）、ADR-019（Harness 走向）

## 0. 一句话

**Runos 是「能力的台账与网关」，Ruyin 是「能力的执行环境」；两者不是对位、也不
直连，中间隔着业务产品自己的云端服务。** Runos 自己把这一点写进了设计：Skill
「只分发不执行，执行发生在 agent 的运行时」（Runos ADR-006 / ADR-009），而 agent
的运行时就是 Ruyin。ADR-008 一年前判的分层是对的；本 ADR 把机制层面的对照补齐，
并修正 ADR-018 里一句写过头的话。

## 1. 两个平台各是什么（核实）

| | **Runos**（L1 商业能力面） | **Ruyin**（L2 本地工作环境） |
|---|---|---|
| 自陈 | 「业务场景 agent 除模型推理之外所需的一切」：**聚合**（一本台账）、**开放**（裁决后放行）、**承载**（鉴权、凭证注入、配额、沙箱、全链路审计） | 「本地运行环境」：契约驱动的任务执行内核（Harness）、本地文件与项目库、Tool Gate、人在回路、审计链 |
| 形态 | 一个 NestJS 服务，API-only，无浏览器面（Runos ADR-001）；`worker-02:3120`，Postgres 18 | Electron 壳 + Node 守护进程 + 同构内核 `runtime-core`，装在用户机器上 |
| 原语 | **Connector**（MCP 服务器面）、**Skill**（Agent Skills 规范）、**Executor**（Runos 自建沙箱，`runos.code-sandbox`）、**Asset**（休眠） | 契约 `tools[]`（`provider: runtime \| connector`）、本地连接器（MCP stdio）、内建工具四个；技能层在 ADR-018 里立项 |
| 谁能调 | **只有产品**：S2S RS256，`aud="runos"`、`scope="tool:runos"`、`act.sub`=产品码必填，`mode=obo\|service`；授权主体唯一是 `product`（Runos ADR-008 / ADR-010） | 只有产品（契约）能声明要什么；用户在设置里看得见、管得着，不直接用 |
| 已建 | M1 + M2 全部：注册、网关四工具、Skill 分发、凭证保险库、闭包编译、配额、审计三流、346 条测试语料。Executor 代码验完、**生产未接线**；Asset 休眠；**尚无第一个消费者**（Runos ADR-014） | 内核过 C1–C7；工具四个；连接器 stdio；技能 / 工具登记册未建（ADR-018 提议中） |

### 1.1 它们对「同一件事」的分工，Runos 自己说清了

Runos ADR-006（执行可观测性不对称）：

> Executor 在 Runos 里执行（完全可观测）；Connector 在供给方执行（网关只观测往返）；
> **Skill 在 agent 运行时里执行** —— Skill 的调用是分发事件，不是执行度量。

Runos ADR-008（两层授权）：

> 第一层「能不能用这个能力」归 Runos 网关；**第二层「这次调用能不能碰这份数据」归
> 调用方 agent，按它自己的权限模型裁决** —— Runos 执行第二层，不裁决它。

对照到我们：第二层正是 Tool Gate + 目录授权 + `x-ruyin-ref` 路径校验（50-harness §5）。
**两个平台的边界在设计上已经互相承认**，只是两边文档各写一半。

## 2. 机制对照

| 机制 | Runos | Ruyin | 关系 |
|---|---|---|---|
| **目录 / 登记** | 一本台账：`capability_id = {provider}.{name}`、semver 版本、`stable/latest` 别名、端点实例；注册时机械校验 30+ 子码，端点注册时活体比对 `tools/list`（TD-019） | 契约里的 `tools[]`（需求侧）；本机登记册（供给侧，ADR-018 提议） | Runos 是**供给侧台账**，我们的登记册是**本机可运行的子集** |
| **发现 / 解析** | `runos_discover`（只返 stable + direct 授权，无 schema）→ `runos_resolve`（完整契约，direct ∪ derived） | `GET /skills` / `GET /tools`（提议）；契约与登记册按 id 对上 | 两边都是「先目录后 schema」的两段式，**词表可直接对齐**（`capability_id`、`operation`、`inputSchema`） |
| **调用 / 承载** | `runos_invoke`：四元合取（supplied ∧ entitled ∧ quota ∧ policy）→ 凭证注入（按契约声明的 `carrier/name/scheme`）→ MCP `tools/call` 到供给端点 → 恰好一条 `capability.call` 审计 | Tool Gate（硬底线 ∧ 用户策略 ∧ 契约默认）→ 本地执行 → 审计哈希链 | **同一个形状，两层各管一层**：Runos 管「能不能用」，Ruyin 管「能不能碰这份数据」 |
| **技能** | **分发**：`fetch` 返回 `SKILL.md` 全文 + `resource` 块（`skill://` uri），`content_digest` 供缓存；`scripts` 要求声明对 Executor 的 `required` 依赖；派生授权闭包（授一个 Skill = 授其 required 依赖） | **执行**：目录只送 `name+description`，模型调 `use_skill` 取全文（ADR-018 §2.4） | Runos 是**来源**之一，Ruyin 是**执行处** —— 与 dsh 的「provider / consumer」分层同形 |
| **沙箱** | Executor：一次性容器，`--network none`、只读 rootfs、nobody、cap-drop ALL、512 MB / 1 cpu / 60 s，并发 2 无队列；**生产未接线** | 无（TD-005）；dsh 的 Windows 后端只限写（ADR-019 §4） | **Runos 才有真沙箱**。Skill 的 `scripts/` 在 Runos 侧的答案是「声明依赖 Executor，脚本在 Runos 沙箱里跑」—— 这对我们 TD-005 是一条现成的出路（§4.3） |
| **凭证** | 保险库 AES-256-GCM 信封加密，调用路径实时解密不缓存；`account-scoped` 已建，`per-caller` 阻塞于平台 token exchange | 客户端零秘密；用户会话 token 在 OS 凭据库 | 互补：**第三方 API 密钥归 Runos 保险库，永远不下发到客户端** —— ADR-018 里「需密钥的条目」有了正确的家 |
| **审计** | 三条流（calls / mgmt-events / outcomes），append-only，`task_id` 是聚合键，`end_user_id = sha256(sub)` 假名化 | 本地哈希链，`taskId` 同为聚合键（通则 X-2） | **同一个 `task_id` 贯穿两边**：一次任务的云端调用与本地执行可以对账 |
| **配额** | 软执行、30 s 分片回写、`critical` 同步原子；`quota_exceeded` 是拒绝码之一 | 不门控、不计量（ADR-006 / 记忆约束）；`QUOTA_EXCEEDED` 被动呈现 | 一致：**配额在 Runos，Ruyin 只如实转达** |

## 3. 接线：Ruyin 怎么够到 Runos（不是直连）

Runos 的消费面只认 S2S 令牌（`act.sub`=产品码，要 `client_secret` 换票），而 Ruyin
是零秘密 public client —— 与 Atlas 同一个结构性障碍（ADR-001）。ADR-009 已选的解
同样适用：

```text
Ruyin 守护进程 ──回合协议──→ 产品云端能力面 ──S2S(OBO, act.sub=产品码)──→ Runos /v1/mcp
      本地执行 ←── tool_calls ──┘         └─ 同一侧持 confidential 凭据 ──→ Atlas /v1/chat
```

《产品接入范本》（vxtpl，生产运行）证实这条路是产品侧的标准形状：`app/chat/skill-runner.ts`
跑 discover → resolve → invoke → report_outcome；`app/lib/s2s-token.ts` 用**服务端会话里的
用户 access token** 做 OBO 换票 —— 「token 永不下发浏览器的第二个理由：它是换票的原料」。
桌面客户端与浏览器在这一点上地位相同。

**因此 Runos 的能力对 Ruyin 来说是「经产品能力面转来的」，有三种到达方式：**

| 到达方式 | 谁触发 | 在 Ruyin 里长什么样 |
|---|---|---|
| a. **产品云端调用 Runos 后把结果作为 `content` 回来** | 能力面 | 对 Ruyin 不可见，就是一次推理回合 |
| b. **能力面把 Runos Connector 的操作作为 `tool_calls` 交给本地执行** | 不成立 | Connector 在供给方执行，本地没有它的端点 —— 不会出现 |
| c. **能力面把 Runos 分发的 Skill 转交给 Ruyin** | 能力面 / 或 Ruyin 主动经能力面拉取 | 一个技能目录条目（来源 = `runos:<capability_id>@<version>`，带 `content_digest`），进本机技能登记册的**产品层** |

c 是本 ADR 要立的新东西：**技能登记册多一个来源层「产品分发」**，位于「预置」与
「用户」之间；内容与摘要来自 Runos，经产品能力面转交，本机按 digest 缓存。这需要
回合协议或能力面多一个端点（`GET /skills` 代理），属于产品接入指南的增补。

## 4. 对既有 ADR 的修正

### 4.1 ADR-018 §2.2「全部从外部获取」—— 补一个来源

ADR-018 把技能来源写成「git / zip / 本地目录」，没有 Runos。**Runos 的 Skill 目录
正是为「平台自己的 agent 拉取」而立的**（Runos ADR-009：「留着不用，平台自己的
agent 就拉不到聚合面存在的意义所在」）。修正：来源分四层 —— **预置**（随安装包）、
**产品分发**（Runos 经能力面）、**用户**（自己加的）、**项目**；近者优先不变。

### 4.2 ADR-018 §2.6「需密钥的条目走连接器来源管理」—— 改

第三方 API 密钥的正确归宿是 **Runos 的凭证保险库**（`credential_requirements` +
账户级注入），Ruyin 本地永远不持有。本地连接器只管**内网 / 私有系统**（ADR-005
的本意）。ADR-018 §2.6 那句改为：需外部密钥的能力经 Runos 注册与注入，本机不收。

### 4.3 TD-005 有了第二条路

「技能里的 `scripts/` 暂不执行」的替代不只有「引入 OS 级沙箱」：**Runos Executor**
是现成的隔离运行时（脚本随 Skill 声明 `required` 依赖 Executor，在 Runos 沙箱里跑）。
代价：脚本要执行的数据得离开本机 —— 与「数据不出域」冲突，**只适用于不带业务数据
的脚本**（格式转换模板、校验器）。写进 TD-005 的选项表，不在这里定。

### 4.4 ADR-008 的「遗留张力」可以关

ADR-008 留下「能力目录放 Runos 更干净，前提是先解决 Ruyin 怎么够到 Runos」。答案：
**经产品能力面**（ADR-009 的解本就覆盖），Ruyin 永远不直连。张力关闭，代价是每个
产品的能力面要多转一层技能目录（§3 c）。

## 5. 不变的

- Ruyin 不直连 Runos、不直连 Atlas（ADR-001 / ADR-009）。
- 客户端零秘密。
- 权益门控只到产品级；配额归 Runos / SaaS，Ruyin 不门控不计量（ADR-006）。
- Tool Gate 是第二层授权的执行点，Runos 不越过它裁决对象级访问（Runos ADR-008）。
- 回合协议由本仓与产品能力面约定（30-design/20）；对 Runos 无义务、无依赖。

## 6. 已定（owner，2026-09-05）

| # | 决定 | 落到哪 |
|---|---|---|
| 1 | 技能来源加「**产品分发**」层（Runos 经产品能力面转交，按 `content_digest` 缓存；层序：预置 → 产品分发 → 用户 → 项目，近者优先） | ADR-018 v2.2 §2.2 / §2.3；产品接入指南 §5.4 |
| 2 | 第三方 API 密钥归 **Runos 凭证保险库**（账户级注入），本机不做这类连接器；本地连接器只管内网 / 私有系统 | ADR-018 v2.2 §2.6；预置清单 §4「需密钥」档改为「经 Runos 注册」 |
| 3 | `scripts/` 的 Runos Executor 出路**只登记不启用**（仅适用于不带业务数据的脚本） | TD-005 选项表 |
| 4 | **bid 产品的云端能力面是 Runos 的第一个消费者**（Runos ADR-014 的「baseline-only」条件随之失效） | 产品接入指南 §5.4；对 Runos 的告知走 GitHub Issue（`liaison` 标签，开在 vxture-runos 上）—— 待 owner 点头再开 |

## 7. 备选方案

| 方案 | 为什么不取 |
|---|---|
| Ruyin 直连 Runos（申请一个 public client 例外） | 平台明令禁止 public client 走 token-exchange（ADR-001）；Runos 授权主体只有产品，桌面客户端不是主体 |
| 把本机技能 / 工具登记册整个换成 Runos 目录的镜像 | Runos 是分发面不是执行面；本机还有预置、用户、项目三层来源，且离线必须可用 |
| 让 Runos 执行 Skill | Runos 自己否决过（其 ADR-006 方案 B：会让 Runos 跑模型循环，破坏薄代理与模型无关两条主张） |
