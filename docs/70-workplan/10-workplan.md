# 工作计划（live tracker）

> 批次制：每批一个明确里程碑 + 机器可验的验收。技术债另见 `../60-operations/10-tech-debt.md`；
> 平台侧依赖走 `../80-liaison/`。阶段划分依据：`../30-design/60-technical-architecture.md` §12。

## W1 · 治理骨架落地（进行中）

已完成（本批提交）：

- [x] 根治理文件（.editorconfig/.gitattributes/.npmrc/.gitignore/.gitleaks.toml/.osv-scanner.toml/.env.example）
- [x] CLAUDE.md（ASCII）/ README 重写
- [x] CI 三件：ci.yml（quality-gate/build/test-coverage/audit 四 context）+ secret-scan.yml（gitleaks）+ codeql.yml
- [x] .husky/pre-commit + docs 十段骨架 + 编号护栏 + temp/ 设计文档迁入 taxonomy
- [x] pnpm workspace（packages/apps/products 三槽）+ 锁文件
- [x] main-ruleset.json 入库（apply 见下）

收尾（依赖 GitHub 侧操作）：

- [x] 推 main → 五个 required context 全绿（fcca640，2026-07-24）
- [x] apply ruleset：ruleset id 19652673 `main-protection` active（TD-002 已回收）
- [x] secret scanning + push protection 已开启（API PATCH，2026-07-24）
- [x] org 级 NODE_AUTH_TOKEN 已确认（visibility=all，org 全仓可见，2026-07-24 核实）
- [x] 本地 hook 接线（本机已配；新 clone 仍需 `git config core.hooksPath .husky`）

## W2 · Phase A：骨架贯通（下一批，无外部依赖）

里程碑：**03-A §16 的 Bid 示例契约被真实校验、加载并创建 Workspace。**

- [x] `packages/contract-schema`：TS 类型 + JSON Schema + ajv 校验器 + R1–R11（23 用例：Bid 通过 + 逐规则违规变异）
- [x] `packages/cli`：`ruyin lint`（文件 / 产品目录 / 产品集目录三种输入）
- [x] `packages/runtime-core`：ports + Workspace 生命周期 + 业务状态机（confirm:human 强制）+ Harness 状态机（waiting_human 挂起 / rebuild-on-resume）+ 审计哈希链 + 内存参照存储；9 单测
- [x] `apps/local-host`：SQLite 存储（每 Workspace 一库，WAL）+ Local API（127.0.0.1 + token）+ 开发模式产品加载；2 集成测试
- [x] **Phase A 里程碑达成**：Bid 契约真实校验 → 加载 → 创建 Workspace → 任务跑到人工确认 → 重启后恢复决策 → 审计链校验通过（integration.test.ts）
- [ ] `apps/shell`：启动 Runtime + 加载一个未打包产品目录（开发模式，跳签名）——W2 收尾项
- [x] `products/bid`：`ruyin.product.yaml`（30-contract-schema §16 落地，同时是测试主 fixture）
- [x] CI 转实（部分）：contract-lint job 接入 quality-gate（TD-004 已回收）；build/test-coverage 已有真实工作（TD-003 待 runtime-core 单测后关闭）

## W3 · Phase B：Bid 单产品可用

里程碑：**本地招标文件 → 需求矩阵 → 方案生成 → 人工确认 → 导出，全程审计可查。**

- [ ] Context Runtime：local-fs 连接器 + Grant + FTS5 索引 + Selection 管线
- [ ] AI Gateway 真实对接（**前置：liaison L3 平台侧就绪**）+ Transmission Gate + 审计哈希链
- [ ] Checkpoint UI + 验证编排 + 修订轮 + 恢复语义
- [ ] `packages/product-sdk`：桥 API 面冻结（40-implementation/10 §6.2 基线）

## W4 · 发布基建（可与 W3 并行启动）

里程碑：**推 `beta-*` tag 自动产出安装包并发布到 dl 主机，网站可下载。**

- [ ] release.yml：electron-builder（win32-x64）→ 构件 + latest.yml + manifest.json + SHA256SUMS
- [ ] 签名步（**前置：TD-001 证书采购**；beta 内测期可暂缺）
- [ ] dl 主机 + `dl.vxture.com` vhost（**前置：liaison L2**）+ tailnet-ssh-connect 上载 + staging 原子切换
- [ ] production Environment + Required reviewers（stable 渠道审批门）
- [ ] products/ 静态清单目录（流 C 的 MVP Registry）

## W5 · npm 发布流

- [ ] publish-packages.yml：contract-schema / runtime-core / product-sdk / cli → GitHub Packages
- [ ] 版本策略定案（changesets vs 手动；runtime-core 版本 = 规范实现版本，08 OQ-2）

## W6 · Phase C：双端与同步

里程碑：**同一 Workspace 云端 ↔ 本地往返，冲突可解，C1–C7 一致性套件通过。**

- [ ] Cloud Runtime 宿主接入 runtime-core（平台侧协同）
- [ ] Sync Engine：三向对比 + 冲突 UI + 离线队列
- [ ] 身份完整链：PKCE / 设备绑定 / 宽限期（**前置：liaison L3**）
- [ ] Conformance 测试套件（50-harness §10 C1–C7）

## Liaison（平台侧依赖，函件在 80-liaison/）

| # | 事项 | 阻塞 |
|---|---|---|
| L1 | 桌面分发剖面报备 + 建议平台沉淀 profile 标准 | 无（纪律性报备） |
| L2 | `dl.vxture.com` 边缘 vhost + 下载主机选址（08 OQ-3） | W4 |
| L3 | 原生客户端三件：PKCE 客户端注册 / entitlement 原生凭证 / AI Gateway 端点与服务端计量口径 | W3、W6 |
