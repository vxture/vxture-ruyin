# Harness 走向：三个决策点的分析 + DeepSeek Harness 两周探针计划

- 日期：2026-09-05
- 上游：`../30-design/decisions/ADR-019-harness-strategy.md`（提议 1–3 已接受；
  §4 三个决策点由本文给出分析，等 owner 定）
- 事实来源：`deepseek-ai/deepseek-harness` 仓（master，2026-09-04）、npm registry、
  本仓源码。每一条能核的都核了；核不到的写「未核」。

## 0. 一句话结论

- **决策点 1（约束 D，与云运行时同构）**：内核今天确实宿主无关（`runtime-core/src`
  零 `node:` 导入，实测），但云运行时不存在（ADR-008 line 20）。dsh 路线的代价不是
  「失去同构」而是「云端也得嵌 dsh」—— 它在服务器上本来就能 headless 跑。建议：
  **D 改为条件约束**：探针通过则云端同样嵌 dsh；不通过则 D 照旧。
- **决策点 2（探针范围）**：必须**进程内嵌**（Cordis 组合），不能走它的 SDK 子进程 ——
  它的 SDK 协议明写「服务端→客户端请求是死能力」，工具 `ask` 推不到客户端，我们的
  Checkpoint 走不通。一人两周，判据 C1–C7。
- **决策点 3（「受挫」指什么）**：仓内证据指向广度（§3）；但有一处**结构性张力**
  比广度更要紧，探针必须给它一个答案：dsh 自己组装系统提示，而 ADR-011 说运行时
  只给事实不给措辞（§2.3）。

## 1. dsh 的可嵌入性（核实）

| 项 | 事实 |
|---|---|
| 发布 | npm 已发：`@deepseek-ai/dsh` 0.1.2-rc.1（2026-09-04）、`dsh-llm` / `dsh-tools` / `dsh-skill` / `dsh-mcp-client` / `dsh-sandbox` 0.0.1-rc.1（09-03）、`@deepseek-ai/cordis` 4.0.2。根仓 0.1.3-alpha.1 |
| Node | `engines.node: ^22.19.0 \|\| >=24.0.0`。我们：开发 Node 24.20，壳 Electron 42（内置 Node 24，ABI 137）—— **兼容** |
| 规模 | `packages/*/*` 下 262 个 package.json；pnpm 11 工作区；`native/landlock-run`（Linux）。**安装包体积影响未测**（现安装包 114 MB） |
| 嵌入方式 | ① 进程内：按 `cordis.yml` 组合插件（`bundle/base` + 自选行）；② 子进程：`dsh --profile sdk` 起 JSON-RPC stdio 服务，`@deepseek-ai/dsh-sdk-client` 驱动；③ `sdk-minimal`：两工具最小编码代理 |
| ② 的致命限制 | `packages/sdk/protocol` README「Known limitations」：**Server→client requests are a dead capability** —— 工具执行前的 `ask` 无法作为请求推给客户端。我们的 Checkpoint（tool ask / context_confirm / verification_review）在 ② 下没有通路 |
| 结论 | **探针只能走 ①**。② 留给「把 dsh 当外部代理调用」的场景，不是内核 |

## 2. 三条接缝，逐条核实

### 2.1 模型提供方（约束 A：能力面中转、零秘密）

- `ctx.llm` 是提供方中立的流式服务：适配器**注册路由**（`ctx.llm.stream({ provider, model, … })`），
  每个流以且仅以一个 `finish` 块结束；失败带稳定错误码。
- 现成适配器：`llm-deepseek`（官方直连）、`llm-pi-ai`（多提供方目录 + **手工声明的网关**：
  `baseURL` + `apiKeyEnv`，`apiKeyEnv` 是经凭据服务解析的引用，不是明文）。
- **我们要写自己的适配器 `llm-ruyin`**：把 dsh 的 `Message[]`（`text` / `reasoning` /
  `image` / `file` / `tool-call` / `tool-result` 六种块）映射到我们的
  `TurnRequest{objective, constraints, context[], messages[], tools[]}`，把能力面的
  `tool_calls | content | verdict` 映射回 `StreamChunk`。凭据：无 —— 能力面按用户会话
  （C1 登录态）鉴权，客户端零秘密照旧。
- 可行性：**高**。适配器是 dsh 明确开放的扩展点；映射是纯数据转换。

### 2.2 工具闸门（约束 B）

- `tools/pre-execute`：可重排的 allow / deny / ask 闸；`ctx.tools.guard()`：**单调拒绝**
  （后面的监听器撤不回）；`tools/post-execute` 可替换结果或阻断；`tools/result` 观察
  不可变的归一化结果。
- 我们的三层合成（硬底线 ∧ 用户策略 ∧ 契约默认）= 一个 `pre-execute` 监听器 +
  硬底线走 `guard()`。`x-ruyin-ref` 路径校验在同一处做 —— dsh 已把参数按 schema
  校验并冻结为无损 JSON，我们只看路径类字段。
- 可行性：**高**，而且形状比我们现在的更严（参数冻结、执行身份不可变、`exec.signal`
  协作取消）。

### 2.3 措辞边界（约束 E，ADR-011）—— **这是探针要回答的真正问题**

dsh 的循环**自己组装系统提示**：工具 schema 自动进提示、技能目录作为系统提醒注入、
PTC 模式生成 SDK 说明。ADR-011 定的是「运行时传结构化事实，产品负责措辞」——
我们的能力面收到的是 `objective / constraints / context[]` 字段，不是一段提示词。

三条出路，探针里各试一次、写明代价：

| 出路 | 做法 | 代价 |
|---|---|---|
| a. 适配器把 dsh 的提示再拆回字段 | `llm-ruyin` 只把 dsh 的 `messages` 当 `messages[]` 传，`objective / constraints / context[]` 仍从契约与上下文集另取 | dsh 组装的系统提示要么丢弃（它的工具 schema、技能目录就得由能力面自己重建）要么原样塞进 `messages[0]` —— 后者违反 ADR-011 |
| b. 修订 ADR-011 | 承认「本地运行时组装提示」，把它限定为**框架性文本**（工具 schema、技能目录、SDK 说明），业务措辞仍归产品 | 文档层面的边界要重画；两个运行时上的一致性由 dsh 保证而不是由字段保证 |
| c. 不用 dsh 的循环，只用它的插件面 | 我们的 `Harness` 仍是循环主体，只把 dsh 的 `tools` / `skills` / `sandbox` / `jobs` 当服务挂进来 | 拿不到它的会话回放、压缩、子代理（这些绑在它的循环上）；广度只补一半 |

**没有这个答案，C1–C7 过了也不算过。**

## 3. 「受挫」的候选解释（仓内证据）

| 候选 | 证据 | 判断 |
|---|---|---|
| 广度：每个能力都得自己写 | 沙箱 TD-005、连接器工具进闸门 TD-034、MCP HTTP TD-035、技能层 ADR-018、无作业 / 子代理 / 压缩 | 最可能 |
| 深度：内核有 bug 或过不了 | C1–C7 全过、62 用例过、修订轮与恢复已实现（工作计划 L49 曾长期误标未做） | 不成立 |
| 节奏：一个人补广度太慢 | 本周 #151–#160 十个 PR 全在数据目录一件事上 | 与广度同一件事 |
| 别的（某个具体卡点） | 未见 | **请 owner 点名** |

## 4. 沙箱：dsh 也不是「OS 级沙箱」

- Windows 后端 `sandbox-windows-acl`：**受限令牌，只限写**（写只许在工作区与私有临时
  目录），`read-only` / `workspace-write` 两档；README 明说「子进程还需要被限读时另选
  机制」。Linux 用 bwrap / Landlock，macOS 用 Seatbelt。
- `SAFETY.md`：实验性、**未经安全审计**、「沙箱与审批不保证隔离」。
- 对 TD-005 的含义：dsh 提供的是一级台阶（限写），不是 TD-005 要的墙。技能 `scripts/`
  是否能跑，**不因为换了 dsh 就自动变成能跑**；要单独定「限写台阶够不够」。

## 5. 约束 D 的真实成本

| 项 | 事实 |
|---|---|
| 内核今天是否同构 | 是：`packages/runtime-core/src/*.ts` 零 `node:` 导入（实测）；宿主经 ports 注入（local-host 实现 7 处） |
| 云运行时 | 不存在（ADR-008 line 20「尚未存在」） |
| 换 dsh 后 | 内核 = dsh 组合 + 我们的插件；Node 绑定（子进程、fs、Cordis）。云端要么嵌 dsh headless（它本就在服务器上跑，`bundle/headless` 与 `web-app` 都是服务器形态），要么另写 |
| 成本结论 | 不是「失去同构」，是「**云端选型被提前锁定为 dsh**」。这是一个今天可以明确做、以后也可以推翻的决定 —— 因为云端还没有代码 |

## 6. 探针计划（一人，两周，时间盒）

> **已批准（owner 2026-09-05）**：约束 D 改为条件约束（ADR-019 §4-1），探针时间盒
> **2026-09-06 → 2026-09-19**。进度记录在 §8，报告写在本文件末尾，不另开文档。

**分支 / worktree**：`spike/dsh-engine`，不进 main；产出是报告 + 可运行的分支。

**第一周：接缝**

1. 守护进程里按 `cordis.yml` 进程内组合 `bundle/base` 的最小子集（llm、tools、
   session、skill、mcp-client），不装 web。
2. `llm-ruyin` 适配器：dsh 块 ↔ 我们的回合协议；对着 `capability-client.ts` 的现有
   契约跑通一次真实能力面（mock 也可）。
3. Tool Gate 作 `tools/pre-execute` + `guard`；现有四个工具用 `defineTool` 注册；
   `x-ruyin-ref` 路径校验照旧。
4. 审计作 `tools/result` + 会话监听；哈希链连续性用现有 `audit.ts` 验。

**第二周：语义与判据**

5. 契约任务 → preset；`context_confirm` / `verification_review` 两种 Checkpoint 走
   dsh 的批准；验证修订轮的 `revision` 数据如何进 dsh 的消息 —— §2.3 三条出路各试
   一次，记代价。
6. `HarnessDeps` 门面：让 `conformance.ts` 不改一行地对着 dsh 版 Harness 跑
   **C1–C7**。
7. 度量：安装包体积增量、冷启动到 `/health` 的秒数、常驻内存、Windows 限写沙箱
   对 `read_file` / `write_document` 的实际效果。

**通过判据**（全部满足才算过）：

- C1–C7 全过；
- §2.3 有一条出路被证明可行且写明代价；
- 体积 / 启动 / 内存增量在可接受范围（现值：114 MB、约 5 s、待测）—— 阈值由 owner
  看到数字后定，不预设。

**通过之后**：ADR-002 / ADR-008 修订；D 改为「云端嵌 dsh headless」；ADR-011 按
§2.3 选定的出路修订；广度按插件逐项接入（沙箱台阶、作业、子代理、压缩、回放）。

**不通过**：报告归档到 `docs/90-memory/`；内核走 ADR-019 §3.1；状态机底座另评
LangGraph.js。

## 7. 探针之外、现在就能借的（不等探针）

- Tool Gate 的**参数冻结与执行身份不可变**（dsh 的 `exec.token` / 无损 JSON 快照）：
  我们的闸门可以照这个收紧，不依赖 dsh。
- `tools/post-execute` 的「替换呈现内容但保留程序值」：导出与保密策略正好需要。
- 技能目录热刷新、技能专属行（ADR-018 §2.8 已记）。

## 8. 进度记录（时间盒 2026-09-06 → 2026-09-19）

| 日期 | 步骤 | 结果 |
|---|---|---|
| 2026-09-05 | 立项：分支 `spike/dsh-engine`；核实 dsh 的包与版本、进程内组合的入口 | （见下一条） |
