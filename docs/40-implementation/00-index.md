# 40-implementation 索引

| 文件 | 内容 |
|---|---|
| `10-product-integration-guide.md` | 业务产品接入指南（历史编号 07）：契约编写 / SDK / 调试 / 发布。§5.4 已按 ADR-026 与 RY-100 修订：产品不自建能力面，模型回合由运行时经网关发起。§5.4.1 标记之间的表由构建生成，CI 盯着 |
| `20-tools-skills-catalog-v1.md` | 技能与工具预置清单 v1（ADR-018 §2.3 的第一批候选；每条核实过存在 / 许可证 / 归档状态；含明确不进包的清单）。机器读的一份是 `resources/skill-manifest.json`，`lint:skill-manifest` 守着；登记册现状见 RY-201 |
| `40-bundled-tool-names.md` | 预置 MCP 服务器的工具名对照表（TD-034）：构建时真起过一次、`tools/list` 报出来的名字，由 `pull-tools.mjs --docs-only` 生成，`lint:tool-names` 守着它不漂 |

2026-09-17 退役（原文在 git 历史）：`30-harness-dsh-spike.md`（探针 2026-09-06 结案，结论与证据在 ADR-019 §4-4、RY-101 §06；分支 `spike/dsh-engine` 仍是证据）；`50-capability-surface-contract.md`（`/capabilities/{id}/turn` 这条线随 ADR-009 一起作废，ADR-026 §2 第 1 条）。
