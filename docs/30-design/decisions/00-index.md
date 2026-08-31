# ADR 寄存器（append-only）

命名 `ADR-NNN-slug.md`，编号只增不改不删。

| ID | 标题 | 状态 | 日期 |
|---|---|---|---|
| [ADR-001](ADR-001-capability-resolution-path.md) | 能力调用通路：Ruyin 不直连 Atlas | 已接受 | 2026-08-31 |
| [ADR-002](ADR-002-execution-loop-ownership.md) | 执行循环归 Harness，云端只出无状态推理 | 已接受 | 2026-08-31 |
| [ADR-003](ADR-003-offline-entitlement-grace.md) | 权益的受控持久化与离线宽限 | 已接受 | 2026-08-31 |
| [ADR-004](ADR-004-capability-supply-boundary.md) | 能力供给边界：模型与 skill／连接器不由 Ruyin 提供 | **部分被 ADR-006 取代**（模型归 Atlas 的部分仍有效） | 2026-08-31 |
| [ADR-005](ADR-005-local-connector-path.md) | 本地资源连接器：第二条通路 | 已接受（分发通路依 ADR-006 简化） | 2026-08-31 |
| [ADR-006](ADR-006-skills-on-harness.md) | skill 层归 Ruyin 建在 Harness 上；权益门控只到产品级 | 已接受 | 2026-08-31 |

后续候选（定稿时立 ADR）：Electron vs Tauri（60 §5.1）、
每 Workspace 一库（60 §7.1）、推理传输 ≠ 数据存储（10 §15.2）。
