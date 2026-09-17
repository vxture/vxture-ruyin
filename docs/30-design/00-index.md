# 30-design 索引

架构设计的权威是 RY 文档集（`../00-meta/00-index.md`）。本目录只留**代码与 CI 直接依赖的工程规范**；正文交叉引用用历史编号，对照表见同一份地图。

| 文件 | 历史编号 | 内容 | 与 RY 的关系 |
|---|---|---|---|
| `30-contract-schema.md` | 03-A | 契约字段规范、校验规则（§15 稀疏编号）、Bid 示例、产品包与分发 | 工程权威；`contract.test.ts` 直接读它。概念层归 RY-100 §02、RY-203 |
| `40-context-architecture.md` | 04 | 上下文来源 / 连接器 / 索引 / 最小化选择 / 推理传输审计 | §4–§7 被 `connector-*.ts`、`fts.ts`、`context-budget.ts`、`harness.ts` 引用；§8 同步有意不做（ADR-026 §5）；§9 身份已指向 RY-102 §03 / RY-103 / RY-100 §03 |
| `50-harness.md` | 05 | 任务执行内核：状态机 / 工具门控 / Checkpoint / 验证 / 恢复 / 审计链 | RY-101 §05 引用其 §5；目标态状态集（`waiting_quota` / `paused`，journal-first）见 RY-100 §05，落地在 RY-103 阶段 4 |
| `70-repo-organization.md` | 08 | 本仓组织方式、tag→渠道发布模式、三条构件流 | `CLAUDE.md` / `release.yml` 直接依赖 |
| `decisions/` | — | ADR 寄存器（append-only） | 与 RY 冲突处以追加补记指向 RY，不改历史（见其 `00-index.md` 末节） |

2026-09-17 退役（原文在 git 历史）：`10-workspace-runtime.md`（02）→ RY-100 / RY-101；`20-runtime-contract.md`（03）→ RY-100 §02 / RY-203；`60-technical-architecture.md`（06）→ RY-101 / RY-301 / RY-102（其中 T1–T13 选型论证与 §5.1 Electron vs Tauri 只在 git 历史里）；`inputs/`（owner 原稿留档）→ 吸纳对账已完成，不再保留副本。
