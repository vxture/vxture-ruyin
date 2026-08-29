# design inputs — owner 原始输入稿（留档）

> 本目录存放 owner（stonesmoker）手写的产品 / 设计输入原稿。**它们不是权威文档**——
> 权威在 `../../20-specs/10-product-strategy.md`（产品战略，v0.3）与
> `../60-technical-architecture.md`（技术架构，06）；本目录只作吸纳溯源与对账依据。
>
> 约定沿用 platform `070-docs-taxonomy.md` §2（`30-design/inputs/` = owner 原稿留档，
> 键控子目录，永久性 staging）与 platform `30-design/inputs/00-index.md` 的吸纳留档对账硬规：
> **吸纳输入稿前，原稿先 commit 入本目录留档，并留下吸纳对账清单；对账完成前不得删除原稿。**

## 清单与吸纳对账

| 原稿 | 原文件名（入仓前，仓库根目录） | 日期 | 吸纳去向 | 对账状态 |
|---|---|---|---|---|
| `10-product-strategy-v0.1.md` | `如影智能工作平台_产品战略与顶层设计_v0.1.md` | 2026-07-21 | 产品战略母文档 v0.1 初始草案 → `20-specs/10-product-strategy.md`（v0.3）。v0.1 → v0.3 主要演进：**产品定义**由"Vxture 的 AI 原生业务工作平台"收敛为"Vxture SaaS 产品的本地智能工作环境"；**§1.2 产品使命**（用户 / 业务 / Vxture 三视角）在 v0.3 不再单列；**§5 逻辑分层**由六层（L1 行业业务 / L2 业务智能 / L3 AI Runtime / L4 Context & Data / L5 Vxture 智能基础设施 / L6 Local-Cloud 运行环境）重整为五层（L1 Business Product / L2 Work Environment / L3 Local Context / L4 AI Capability / L5 Sync & Data Control）；**§7 Local / Cloud 模型**由"第一阶段 + 三类基本数据模式 + 长期对等模型"重写为 Cloud / Local Workspace 双实现 + "同步不是默认行为" + 四种同步模式；**§9** 由"已确定 / 当前建议 / 待讨论"改为"当前共识 + 五个待研究问题"；§10 指导原则、§11 下一步设计重点沿用。 | ✅ 已吸纳（章节级对账，2026-08-30） |
| `10-product-strategy-v0.1.docx` | `如影智能工作平台_产品战略与顶层设计_v0.1.docx` | 2026-07-21 | 同上 v0.1 的 Word 版（"初始战略草案"，内容同 `.md`，仅载体不同）。二进制留档，不再更新。 | ✅ 同上 |
| `20-product-blueprint-1.0-tech-architecture.html` | `Ruyin_如影_产品蓝图_1.0_技术架构版.html` | 2026-07-21 | 单页技术架构蓝图 1.0 → `../60-technical-architecture.md`（06）。四层栈（Vxture Cloud / Ruyin Local Runtime / Security Policy Layer / Local Workspace）→ 06 §4 总体架构 + §6 共享内核 + §9 安全架构汇总；**"Desktop Shell = Tauri"** → 06 T4 裁定 **Electron**（§5.1 专项论证，有意弃置 Tauri）；"Local Web"（localhost 访问）→ 06 §4.1 保留为可选浏览器入口，不再是独立运行模式；"Enterprise Runtime"（企业内网部署）→ 06 §10 离线 MSI + 内网分发、§11 信创路线，不再是独立运行时形态；**Agent 权限模型**（Skill Capability → Policy Engine → Runtime Permission）→ `../50-harness.md` §5 工具门控 + `../30-contract-schema.md` 校验规则（TD-005：禁 `execute_script` 类工具）；核心原则（数据属于用户、Runtime 与 UI 解耦、Agent 是受治理的进程、能力通过 Package 扩展）→ 06 §2 实现目标与 `../10-workspace-runtime.md`。 | ✅ 已吸纳（要点级对账，2026-08-30） |

## 处理纪律

- 本目录不进编号体系（键控子目录，键 = owner 原稿留档）；`.md` 原稿仍按 `NN-slug.md` 命名，
  以通过 `lint:docs-numbering`（本仓护栏不检查子目录，仅检查 `.md` 文件名）。非 `.md` 产物按
  070 §0 元规则不受编号约束，此处同样取 `NN-slug` 前缀以保持并列顺序。
- 原稿只增不改：修订产品定义 / 架构请改权威文档并升版本号，不要回写原稿。
- 新原稿入仓即在上表登记；吸纳完成时补对账状态与差异摘要。
