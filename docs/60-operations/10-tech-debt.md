# 技术债登记（TD 寄存器，append-only）

> 依 org 偏离纪律：暂不可满足的标准条款 / 有意的过渡态，三步登记（实现处标注 + 本表记名 + 必要时报平台），
> 带回收条件；回收后状态改 closed，编号不复用。

| ID | 条目 | 原因 | 回收条件 | 状态 |
|---|---|---|---|---|
| TD-001 | Windows 代码签名证书未采购，release 签名步缺位 | 采购未启动（08 OQ-1）；未签名 = SmartScreen 拦阻 | 证书就位 → release.yml 启用签名步；stable 渠道公开发布前必须回收 | open |
| TD-002 | main ruleset 未 apply，直推 main 仍可行 | bootstrap 顺序要求先让五个 CI context 在 main 产生一次 | 已回收（2026-07-24）：fcca640 全绿后 apply，ruleset id 19652673 active，此后只走 PR | closed |
| TD-003 | CI build / test-coverage 为绿色占位（workspace 无包，recursive 空跑） | W1 治理批先行，Phase A 代码未落 | W2 落 contract-schema + runtime-core 单测后自动转实，验证 job 有真实工作量 | open |
| TD-004 | `lint:contract`（R1–R11 契约护栏）未接入 quality-gate | 校验器与 CLI 属 W2 产物 | 已回收（2026-07-24）：contract-lint job 接入 quality-gate needs，`ruyin lint products` 全量把关 | closed |
| TD-005 | 契约 schema 禁入 `execute_script` 类工具（设计约束，非缺陷） | 无 OS 级执行沙箱（30-design/60 §13；同类产品 Cowork/WorkBuddy 均以 VM/容器兜底） | 执行沙箱专项立项并落地后解禁；在此之前 R 规则层面拒绝该类工具 | standing |
| TD-006 | products/bid 与 Runtime 同仓（过渡态） | MVP 期同仓联调最快；契约/SDK 未稳定不宜拆 | 契约 + product-sdk 冻结后迁出为独立产品仓，走 03-A 分发通道 | open |
| TD-007 | 平台侧无"桌面分发型仓库 profile"标准，本仓剖面替换暂以 30-design/70 自述 | 模板家族只覆盖 Web 全栈仓（product_240 §0.3 裁定 ruyin 不适用） | liaison L1：平台确认过渡态 / 沉淀 profile 标准后，10-standards 薄索引指向之 | open |
| TD-008 | macOS / Linux（含信创）构建缺位，仅出 win32-x64 | MVP 范围裁定（08 OQ-4；信创路线见 30-design/60 §11） | 平台矩阵专项：真实国产化合同或 mac 需求触发 | standing |
