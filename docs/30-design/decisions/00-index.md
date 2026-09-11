# ADR 寄存器（append-only）

命名 `ADR-NNN-slug.md`，编号只增不改不删。

| ID | 标题 | 状态 | 日期 |
|---|---|---|---|
| [ADR-001](ADR-001-capability-resolution-path.md) | 能力调用通路：Ruyin 不直连 Atlas | 已接受 | 2026-08-31 |
| [ADR-002](ADR-002-execution-loop-ownership.md) | 执行循环归 Harness，云端只出无状态推理 | 已接受 | 2026-08-31 |
| [ADR-003](ADR-003-offline-entitlement-grace.md) | 权益的受控持久化与离线宽限 | 已接受 | 2026-08-31 |
| [ADR-004](ADR-004-capability-supply-boundary.md) | 能力供给边界：模型与 skill／连接器不由 Ruyin 提供 | **部分被 ADR-006 取代**（模型归 Atlas 的部分仍有效） | 2026-08-31 |
| [ADR-005](ADR-005-local-connector-path.md) | 本地资源连接器：第二条通路 | 已接受（分发通路依 ADR-006 简化） | 2026-08-31 |
| [ADR-006](ADR-006-skills-on-harness.md) | skill 层归 Ruyin 建在 Harness 上；权益门控只到产品级 | 已接受（分层理由由 ADR-008 修订） | 2026-08-31 |
| [ADR-007](ADR-007-object-hierarchy.md) | 对象层级：workspace 让给平台定义，本地容器是项目 | 已接受 | 2026-08-31 |
| [ADR-008](ADR-008-runtime-layering.md) | 一个内核两个宿主；Runos 是能力供给层，不是对位运行时 | 已接受 | 2026-08-31 |
| [ADR-009](ADR-009-capability-relay.md) | 能力通路定案：经业务产品的云端服务中转 | 已接受 | 2026-08-31 |
| [ADR-010](ADR-010-verification-boundary.md) | 验证的工作界面：检查归产品，编排归 Runtime | 已接受 | 2026-08-31 |
| [ADR-011](ADR-011-framework-boundary.md) | 框架边界：Runtime 给事实，产品给措辞与判定 | 已接受 | 2026-08-31 |
| [ADR-012](ADR-012-two-tier-product-supply.md) | 两级产品供给：契约拉取为主，产品包为辅 | 已接受 | 2026-08-31 |
| [ADR-013](ADR-013-artifact-materialization.md) | 成果落盘：结构化内容由 Runtime 渲染，字节回传为辅 | 已接受 | 2026-08-31 |
| [ADR-014](ADR-014-untrusted-content-provenance.md) | 上下文是资料，不是指令：出处随内容传递 | 已接受 | 2026-08-31 |
| [ADR-015](ADR-015-projects-belong-to-a-workspace.md) | 项目必须归属工作区，无归属不是一种受支持的状态 | 已接受 | 2026-08-31 |
| [ADR-016](ADR-016-document-wire-format.md) | 结构化文档：上线格式是 Markdown，内部表示是 mdast，来源按路径给 | 已接受 | 2026-09-01 |
| [ADR-017](ADR-017-pdf-rendering-lives-in-the-shell.md) | PDF 由壳里的 Chromium 渲染，字节回到守护进程落盘 | 已接受 | 2026-09-01 |
| [ADR-018](ADR-018-skill-registry.md) | 技能与工具：外部获取 + Runos 产品分发四层来源、拉到本机可运行、随发布预置；格式对齐 Agent Skills 与 MCP；候选清单见 40-implementation/20。**v2.3**：许可证逐技能两读、撤下 xberg（§7.3）；**v2.4**：预置台账权威归 Runos，同步是构建时物化、运行时不依赖其可达（§7.4） | 已接受（v2.4） | 2026-09-05（v2.4 2026-09-09） |
| [ADR-019](ADR-019-harness-strategy.md) | Harness 走向：**内核保留，不换成 DeepSeek Harness**（探针 2026-09-06 结案：判据 C7 硬底线不可绕在 dsh 里不成立）；广度按 ADR-018 从接缝引入；约束 D 回到原样 | 已接受 | 2026-09-05 |
| [ADR-020](ADR-020-two-capability-planes.md) | 两个能力提供平台：Runos（云端商业能力面，分发与承载）与 Ruyin（本地执行环境）—— 机制对照、接线与对 ADR-018 的修正；§6.1 追加：预置台账权威归 Runos，取字节的时机是构建时 | 已接受 | 2026-09-05（§6.1 2026-09-09） |

| [ADR-021](ADR-021-registration-boundary-with-platform.md) | Ruyin 是环境不是产品：对平台的登记只到 OIDC client 这一层；产品码／订阅项都不要，RP 五端点不适用。由此推出会话与设备管理归 accounts（TD-057 的归属） | 已接受 | 2026-09-10 |

| [ADR-022](ADR-022-product-surface-trust-boundary.md) | 产品接入面：沙箱 iframe 是必须的边界但不够 —— **契约裁剪归守护进程、凭据按 (项目, 产品) 限定**，SDK 只给便利与类型、不做判断；已修订 60-technical §8.2 那条「桥在渲染进程裁剪 + 携带会话 token」 | 已接受 | 2026-09-10 |

| [ADR-023](ADR-023-product-ui-supply.md) | 产品界面从哪来：契约**钉 sha256 不钉地址**，界面包从产品能力面按摘要取回、校验、按摘要落盘；装载跟项目快照走；界面可选、坏了等于没有界面；契约升 `0.2`、新增 R17 | 已接受 | 2026-09-11 |

后续候选（定稿时立 ADR）：Electron vs Tauri（60 §5.1）、
每 Workspace 一库（60 §7.1）、推理传输 ≠ 数据存储（10 §15.2）。
