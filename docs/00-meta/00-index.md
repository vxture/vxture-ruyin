# docs/ 地图（vxture-ruyin）

> 本仓遵循 org docs taxonomy（platform `070-docs-taxonomy.md`）。
> 元规则：编号 = 正式（永久）；无编号 = 临时（定位即待删）。护栏：`pnpm lint:docs-numbering`。

## 分段

| 段 | 内容 |
|---|---|
| `00-meta` | 本地图、术语 |
| `10-standards` | 薄索引，指向 platform org 标准（不复制正文） |
| `20-specs` | 产品定义（产品战略） |
| `30-design` | 架构设计文档族 + `decisions/`（ADR，append-only）+ `inputs/`（owner 原稿留档，非权威） |
| `40-implementation` | 实施面（产品接入指南等） |
| `50-deployment` | 发布与 bootstrap（`rebuild/main-ruleset.json`） |
| `60-operations` | 技术债登记（`10-tech-debt.md`，TD-NNN） |
| `70-workplan` | 工作计划（`10-workplan.md`，W 批次） |
| `80-liaison` | 与平台线来往函件 |
| `90-memory` | 长期记忆 / agent 备忘 |

## 设计文档族与历史编号对照

设计文档正文中的交叉引用使用历史编号（01…08、03-A）。对照表：

| 历史编号 | 现文件 |
|---|---|
| 01 产品战略 | `20-specs/10-product-strategy.md` |
| 02 Workspace Runtime | `30-design/10-workspace-runtime.md` |
| 03 Runtime Contract | `30-design/20-runtime-contract.md` |
| 03-A Contract Schema 与分发 | `30-design/30-contract-schema.md` |
| 04 Context 架构 | `30-design/40-context-architecture.md` |
| 05 Harness 执行内核 | `30-design/50-harness.md` |
| 06 技术架构 | `30-design/60-technical-architecture.md` |
| 07 产品接入指南 | `40-implementation/10-product-integration-guide.md` |
| 08 仓库组织与发布模式 | `30-design/70-repo-organization.md` |

阅读顺序即历史编号顺序：01 → 02 → 03 → 03-A → 04 → 05 → 06 → 07 → 08。
