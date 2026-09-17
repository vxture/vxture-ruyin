# docs/ 地图（vxture-ruyin）

> 本仓遵循 org docs taxonomy（platform `070-docs-taxonomy.md`）。
> 元规则：编号 = 正式（永久）；无编号 = 临时（定位即待删）。护栏：`pnpm lint:docs-numbering`。

## 权威顺序（owner 2026-09-17）

产品定义、架构与接口设计的**权威是 Claude artifact 上的 RY 文档集**，不是本目录。
本目录只保留三类东西：代码与 CI 直接依赖的工程规范、append-only 的寄存器（ADR / TD）、
往来函件与发布骨架。仓内文档与 RY 文档不一致时，改仓内的（`CLAUDE.md`「Design authority」）。

| RY | 文档 | 管什么 |
|---|---|---|
| RY-001 | 产品现状 | 已建成 / 未建成 / 有意不做；§07 开发任务登记（原 `70-workplan` 的职责） |
| RY-100 | 顶层架构 | 产品定义、控制面 ⟷ 运行时、三种主体、三个授权权威、内核、能力路由、数据边界、Runtime Registry、一致性、决策 A1–A17 与不变量 I1–I5 |
| RY-101 | 系统架构 | 与平台的关系、四个进程一个内核、能力通路、Tool Gate 硬底线、内核取舍、符合性偏离、必需检查 |
| RY-102 | 接口文档 | 本地 API 全部端点、封套与拒绝词表、事件流、工作区边界、守卫 |
| RY-103 | 平台对接 | 现状机制、与 RY-100 的差距、迁移路线（阶段 0–6）、过渡期规则、旧决策去向 |
| RY-201 | 能力登记册 | 技能四层、MCP 服务器、档位、按需获取、工具名同名接入 |
| RY-202 | 权益同步 | 档位、权益三样、同步现状与目标、到期与离线两层、会话现状与目标 |
| RY-203 | 产品供给 | 两级供给、契约拉取、产品包、哪些产品能到桌面、分发面现状 |
| RY-204 | 能力清单同步 | Runos 能力清单的取 / 核 / 落 / 记 / 比 |
| RY-301 | 数据结构 | 数据目录、每项目一库、审计哈希链、日志与恢复、索引、状态文件、密钥、搬家、导出 |
| RY-401 | 界面与导航 | 窗口 chrome、视图路由、「在等我」、标题栏、设置八分区、设计系统 |
| RY-501 | 定位与商业设计 | 定位、同层关系、差异面、业务形态、商业模型、零订阅与退订、分工、风险 |

## 分段

| 段 | 内容 |
|---|---|
| `00-meta` | 本地图 |
| `10-standards` | 薄索引，指向 platform org 标准（不复制正文） |
| `20-specs` | 指针：产品定义归 RY-100 / RY-501 |
| `30-design` | 代码直接依赖的工程规范（契约 schema、Harness 内核、上下文机制、仓库组织）+ `decisions/`（ADR，append-only） |
| `40-implementation` | 产品接入指南、预置清单、构建生成的工具名对照表 |
| `50-deployment` | 发布与 bootstrap（`rebuild/main-ruleset.json`） |
| `60-operations` | 技术债登记（`10-tech-debt.md`，TD-NNN） |
| `70-workplan` | 指针：任务登记归 RY-001 §07 |
| `80-liaison` | 与上游线来往函件（发出即定稿的记录） |
| `90-memory` | 长期记忆 / agent 备忘 |

## 历史编号对照（01…08、03-A）

ADR 与旧正文里的交叉引用仍用历史编号。2026-09-17 起，其中五份已退役（内容并入 RY 文档，原文在 git 历史）：

| 历史编号 | 原文件 | 现状 |
|---|---|---|
| 01 产品战略 | `20-specs/10-product-strategy.md` | **退役** → RY-100 §01、RY-501 |
| 02 Workspace Runtime | `30-design/10-workspace-runtime.md` | **退役** → RY-100 §02 / §05、RY-101 §02 |
| 03 Runtime Contract | `30-design/20-runtime-contract.md` | **退役** → RY-100 §02（Runtime Contract 五个动词）、RY-203；落地规范仍是 03-A |
| 03-A Contract Schema 与分发 | `30-design/30-contract-schema.md` | 在用（R 规则权威，`contract.test.ts` 直接读它） |
| 04 Context 架构 | `30-design/40-context-architecture.md` | 在用（§4–§7 机制被代码引用；§8 有意不做、§9 已指向 RY） |
| 05 Harness 执行内核 | `30-design/50-harness.md` | 在用（目标态状态集见 RY-100 §05） |
| 06 技术架构 | `30-design/60-technical-architecture.md` | **退役** → RY-101（进程 / 内核 / 端口 / 硬底线）、RY-301（存储 / 密钥）、RY-102（本地 API） |
| 07 产品接入指南 | `40-implementation/10-product-integration-guide.md` | 在用（§5.4 已按 ADR-026 与 RY-100 修订） |
| 08 仓库组织与发布模式 | `30-design/70-repo-organization.md` | 在用 |
