# 40-implementation 索引

| 文件 | 内容 |
|---|---|
| `10-product-integration-guide.md` | 业务产品接入指南（历史编号 07）：契约编写/SDK/调试/发布 |
| `20-tools-skills-catalog-v1.md` | 技能与工具预置清单 v1（ADR-018 §2.3 的第一批候选；每条核实过存在 / 许可证 / 归档状态；含明确不进包的清单） |
| `30-harness-dsh-spike.md` | Harness 走向的决策分析 + DeepSeek Harness 两周探针计划（ADR-019 §4 三个决策点：嵌入方式、提供方接缝、闸门钩子、沙箱、约束 D 的真实成本，全部核实过） |
| `40-bundled-tool-names.md` | 预置 MCP 服务器的工具名对照表（TD-034）：构建时真起过一次、`tools/list` 报出来的名字，由 `pull-tools.mjs --docs-only` 生成，`lint:tool-names` 守着它不漂 |
| `50-capability-surface-contract.md` | **能力面接入说明**（给业务产品线）：`/products/{id}/capabilities/{cap}/turn` 的请求/回复形状、鉴权、循环与超时上限、状态码语义、最小实现清单与自验方法。这条线的客户端一侧已实现并测过，缺的是对面那个端点 |
