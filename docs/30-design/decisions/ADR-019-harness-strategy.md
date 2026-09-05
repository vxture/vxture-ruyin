# ADR-019 Harness 走向：内核保留、在接缝处引入生态；是否换成 DeepSeek Harness 由探针定

- 状态：**提议**（owner 2026-09-05：「我们的 harness 是受挫的，有没有官方或优秀
  开源可以借鉴或使用的」）
- 日期：2026-09-05
- 相关：50-harness.md、ADR-002（循环归 Harness，云端只出无状态推理）、ADR-008
  （运行时分层 / 同构内核）、ADR-009（能力面中转）、ADR-011（框架边界）、ADR-018
  （技能与工具从外部获取）、TD-005（无沙箱）、TD-034 / TD-035

## 0. 先把「受挫」量出来：内核不是不能用，是窄

| 指标 | 事实（2026-09-05 仓内实测） |
|---|---|
| 内核规模 | `runtime-core/src/harness.ts` 1,665 行；`tool-gate.ts` 222 行；`audit.ts` 173 行；`ports.ts` 606 行 |
| 50-harness 六项机制 | 状态机 ✔、Tool Gate ✔（独立文件）、Checkpoint ✔（approve / reject / modify，三种 kind）、验证与修订轮 ✔（`MAX_REVISIONS` 有界）、journal 恢复 ✔（`ResumePoint`：select / execute / finalize）、审计哈希链 ✔ |
| 一致性 | C1–C7 在内存 ports 上**全过**；runtime-core 62 用例通过 |
| 循环归属 | ADR-002 落地：回合协议 `TurnRequest{objective, constraints, context[], messages[], tools[], revision?}` → `tool_calls | content | verdict`，工具在本地过闸 |

所以「受挫」不是「跑不起来」。对着 DeepSeek Harness 那样的清单一比就看得见差在哪：
**它有而我们没有的，全是内核之外的东西** —— 沙箱（TD-005）、后台作业运行时、
子代理、上下文压缩 / 溢出、会话格式与回放、技能层（ADR-018 在补）、设置界面框架、
MCP 的 HTTP 传输（TD-035）、连接器工具进闸门（TD-034）。每一样都得我们自己写，
这才是受挫的来源：**广度**，不是**深度**。

## 1. 我们的硬约束（候选必须过的关）

| # | 约束 | 出处 |
|---|---|---|
| A | 循环在本地；推理经**产品能力面**、无状态；客户端**零秘密** —— 候选必须有「自定义模型提供方」的接缝，且不要求本地持凭据 | ADR-002 / ADR-009 |
| B | Tool Gate = 硬底线 ∧ 用户策略 ∧ 契约默认，参数按 `x-ruyin-ref` 查授权目录 —— 候选的工具执行前必须有 allow / deny / ask 钩子 | 50-harness §5 |
| C | Checkpoint 跨重启可恢复；journal 恢复；审计哈希链 | 50-harness §6 / §8 / §9 |
| D | 内核宿主无关，与未来云运行时**同构**（无 Node / Electron API） | ADR-008、CLAUDE.md |
| E | 契约驱动：任务、工具、验证由 `ruyin.product.yaml` 声明；运行时给事实不给措辞 | 30-contract、ADR-011 |
| F | Node / TypeScript；许可证允许随安装包分发 | 70-repo-organization |

## 2. 候选（全部 2026-09-05 用 `gh api` 与官方文档核实）

### 2.1 可嵌入的运行时 / 内核

| 候选 | 许可证 · ★ · 最近推送 | A 自定义模型接缝 | B 工具钩子 | C 持久化 / 人机回路 | D 同构 | 广度 | 判断 |
|---|---|---|---|---|---|---|---|
| **DeepSeek Harness**（dsh） | MIT · 212k · 09-04 | ✔ `ctx.llm` 提供方中立，适配器可注册（含「手工声明的网关」路由） | ✔ `tools/pre-execute` allow/deny/ask、`ctx.tools.guard()` 单调拒绝、`tools/post-execute`、`tools/result` | ✔ 持久会话日志、durable 步、后台作业、回放 | ✘ 宿主是 Node（子进程、fs） | **最广**：沙箱（含 e2b）、子代理、压缩、溢出、技能、MCP stdio + HTTP、设置卡、会话回放 | **developer preview，声明会破坏性变更**；用于 DeepSeek V4 官方评测。唯一能一次补齐广度的候选 |
| **OpenAI Agents SDK (JS)** | MIT · 3.8k · 09-05 | ✔ `Model` / `ModelProvider` 接口 | ✔ 工具级 `needsApproval` | ✔ `RunState.toString()` / `runner.run(agent, state)`、`state.approve()` / `reject()`、`result.interruptions` | ✔ 轻量、多运行时 | 窄：循环 + 交接 + 护栏 + MCP（stdio / SSE / Streamable HTTP）；无沙箱、无作业 | 官方、干净，但补不了广度 |
| **LangGraph.js** | MIT · 3.3k · 09-04 | ✔ 模型无关（图节点里你自己调） | ✘ 无工具闸门概念（要自己写节点） | ✔ `interrupt()` / `new Command({resume})`、checkpointer（Memory / SQLite / Postgres）、`thread_id`、时间回溯；**恢复时节点从头重跑**（节点内必须幂等） | ✔ | 窄：只是持久状态机引擎 | 与我们 §3 / §6 / §8 一一对应，可作为「状态机 + 恢复」的底座 |
| Vercel AI SDK | Apache-2.0 · 26.6k · 09-05 | ✔ 自定义 provider | ✔ 代码里有 `needsApproval` | ✘ 无持久执行引擎 | ✔ | 窄：模型调用 + 工具循环 | 是 SDK 不是 harness |
| Mastra | Apache-2.0（`ee/` 除外）· 27.7k · 09-05 | ✔（经 AI SDK provider） | 部分 | ✔ workflow suspend / resume | 部分 | 中：agents + workflows + memory + MCP + evals | 偏应用框架，闸门语义要自己补 |
| Google ADK-js | Apache-2.0 · 1.4k · 09-04 | ✔ | ？ | README 未见人机回路 | ✔ | 中 | 太新 |
| Microsoft Agent Framework | MIT · 13.3k | — | — | — | ✘ .NET / Python | — | 语言不对 |

### 2.2 不可嵌入（是应用，不是内核）—— 只借鉴，不引入

OpenClaw（MIT，389k★，个人助理应用，Node 守护进程 + 消息渠道）、Hermes Agent
（MIT，242k★，Python，自我改进循环、Curator 自动写技能）、Goose（Apache-2.0，
Rust）、Codex（Apache-2.0，Rust CLI）、OpenCode（MIT）。它们解决的是「一个人用的
代理」，我们解决的是「产品契约驱动、企业数据不出域的业务运行环境」——**能借的是
交互与技能生态，不是内核**。

Temporal / Restate 这类持久执行平台要一个服务端，桌面单机不合适。

## 3. 决策（提议）

### 3.1 现在：内核保留，广度从接缝处引入 —— 这就是 ADR-018 的路

内核通过一致性、循环归属正确、闸门与审计是自己的 —— 这些是**产品定位本身**
（数据不出域、契约驱动、人在回路），换谁都要重写这一层。缺的广度里，
**技能 / 工具 / MCP** 已由 ADR-018 从生态拉；沙箱、作业、子代理、压缩另议。

### 3.2 立即立项一个两周探针：dsh 能不能当我们的引擎

dsh 是唯一一次补齐广度的候选，也是唯一「preview」的候选 —— 值得用实验而不是
辩论来定。探针目标（时间盒两周，一人）：

1. 在守护进程里 headless 拉起 dsh，**自定义 `ctx.llm` 适配器指向产品能力面**
   （回合协议不变，客户端零秘密）。
2. 我们的 Tool Gate 作为 `tools/pre-execute` + `guard` 插件接进去，`x-ruyin-ref`
   路径校验照旧。
3. 我们的审计作为 `tools/result` / 会话监听器，哈希链不断。
4. 契约任务编成 dsh 的 preset；`context_confirm` / `verification_review` 两种
   Checkpoint 走它的批准机制。
5. **判据只有一条：C1–C7 一致性套件对着 dsh 版 Harness 全过。**

过了：ADR-002 / ADR-008 修订（内核不再与云端同构 —— 或云端也嵌 dsh headless，
它本就在服务器上跑），随后广度按插件拿。不过：留下报告，内核继续走 3.1，
状态机底座可再评估 LangGraph.js（它满足 D）。

### 3.3 不做的

- 不换成 OpenAI Agents SDK / Vercel AI SDK：它们是循环 SDK，补不了广度，却要重写
  我们已经有的部分。
- 不引入 OpenClaw / Hermes 作内核：它们是应用。

## 4. 待 owner 定

1. **约束 D（与云运行时同构）现在有多硬？** 这是 dsh 路线的唯一结构性代价。云运行时
   今天还不存在；如果同构是「将来再说」，dsh 探针的价值最大。
2. 批准 3.2 的两周探针（一人，时间盒，判据 C1–C7）。
3. 「受挫」如果指的不是广度而是别的（某个具体卡点），请点名 —— 上面的量化是我从
   仓库看到的，不一定是你感受到的。

## 5. 备选方案

| 方案 | 为什么不取 |
|---|---|
| 立刻整体换成 dsh | 它是 preview 且声明会破坏性变更；我们的闸门 / 审计 / 契约层无论如何要重写在它上面 —— 先用探针证明这层能挂上去 |
| 立刻换成 LangGraph.js | 只解决状态机与恢复（我们已有且通过一致性），不解决广度 |
| 什么都不换，全部自己写 | 广度上永远追不上生态 —— 这正是 owner 说的受挫 |
