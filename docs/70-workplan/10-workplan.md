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
- [x] `apps/shell`：Electron 壳（utilityProcess 拉起 daemon + 健康等待 + 窗口指向 daemon 自服务的 Dev Console；`--smoke` 启动验证）；daemon 在 `/` 直接提供 Dev UI —— 浏览器访问（Local Web）与 Electron 同源同页，02 §17 "Web 是访问方式" 从第一天成立

**W2 完成（2026-07-24）。** 开发环境注意：国内网络安装 Electron 需 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`（README 已记）。
- [x] `products/bid`：`ruyin.product.yaml`（30-contract-schema §16 落地，同时是测试主 fixture）
- [x] CI 转实（部分）：contract-lint job 接入 quality-gate（TD-004 已回收）；build/test-coverage 已有真实工作（TD-003 待 runtime-core 单测后关闭）

## W3 · Phase B：Bid 单产品可用

- [x] SQLCipher 静态加密（TD-009 回收）：workspace.db 加密 + 每空间密钥 + 主密钥 DPAPI（win）

里程碑：**本地招标文件 → 需求矩阵 → 方案生成 → 人工确认 → 导出，全程审计可查。**

- [x] Context Runtime：local-fs 连接器（Grant 域内、深度/数量/大小限额）+ Grant/Binding 模型（绑定校验 + 选择期 Grant 复核）+ FTS5 索引与相关性排序（CJK 分词粗糙已注记）+ Selection 管线（候选→排序→每类型限额）+ **context_confirm 门**（高敏上下文执行前人工确认）+ **transmission.inference 审计事件**（哈希不落内容，04 §7.3 落地）
- [ ] AI Gateway 真实对接（**前置：liaison L3 平台侧就绪**）+ Transmission Gate + 审计哈希链
- [x] Workspace UI（`apps/ui-workspace`，React + Vite）：Checkpoint 卡片（context_confirm 展示 Context Set / verification_review 展示验证结论）、Grant/绑定面板、契约驱动的状态转换按钮（confirm:human 弹确认）、任务发起（自动选择 / 手动 JSON）、审计表；daemon 静态托管于 `/`（壳与浏览器同源同页），Dev Console 迁 `/dev`；打包进安装包 resources/ui
- [ ] 验证修订轮 + 恢复重放（Harness 侧，随真实 Gateway 一并做）
- [ ] `packages/product-sdk`：桥 API 面冻结（40-implementation/10 §6.2 基线）

## W4 · 发布基建（可与 W3 并行启动）

里程碑：**推 `beta-*` tag 自动产出安装包并发布到 dl 主机，网站可下载。**

- [x] release.yml + 打包链（2026-07-24）：`pack.mjs`（pnpm deploy --legacy 自包含 daemon → electron-builder NSIS）→ exe + blockmap + latest.yml + manifest.json + SHA256SUMS；本地实测产出 **123MB 安装包**，打包版 `Ruyin.exe --smoke` 通过（daemon 从 resources 启动、DPAPI 生效）
- [x] beta / production Environment 已建，production 必审人已配（tag→渠道审批拓扑就位）
- [ ] 签名步（**前置：TD-001 证书采购**；electron-builder 侧 `signAndEditExecutable` 待回开）
- [ ] dl 主机上载（**前置：liaison L2**）——publish job 已留占位，L2 落地后换 tailnet-ssh-connect + rsync 原子切换
- [ ] products/ 静态清单目录（流 C 的 MVP Registry）

## W5 · npm 发布流

- [ ] publish-packages.yml：contract-schema / runtime-core / product-sdk / cli → GitHub Packages
- [ ] 版本策略定案（changesets vs 手动；runtime-core 版本 = 规范实现版本，08 OQ-2）

## W6 · Phase C：双端与同步

里程碑：**同一 Workspace 云端 ↔ 本地往返，冲突可解，C1–C7 一致性套件通过。**

- [ ] Cloud Runtime 宿主接入 runtime-core（平台侧协同）
- [ ] Sync Engine：三向对比 + 冲突 UI + 离线队列
- [ ] 身份完整链：PKCE / 设备绑定 / 宽限期（**前置：liaison L3**）
  - [x] C1 客户端侧先行落地（2026-08-30）：daemon PKCE public client（S256 +
    loopback 回调 + RS256 验签拒 none/HS* + refresh 续票 + 会话 DPAPI 密封 +
    吊销退出）+ C2 权益客户端（45s TTL 不落库，`RUYIN_PLATFORM_API_BASE` 注入）
    + 账户弹层/开通深链 UI + 壳外链走系统浏览器；8 项鉴权单测。
    **闭环待平台侧登记回调 / ruyin-beta / 权益基址**（80-liaison/40，附实测）
- [ ] Conformance 测试套件（50-harness §10 C1–C7）

## Liaison（平台侧依赖，函件在 80-liaison/）

| # | 事项 | 阻塞 |
|---|---|---|
| L1 | 桌面分发剖面报备 + 建议平台沉淀 profile 标准 | 无（纪律性报备） |
| L2 | `dl.vxture.com` 边缘 vhost + 下载主机选址（08 OQ-3） | W4 |
| L3 | 原生客户端三件：PKCE 客户端注册 / entitlement 原生凭证 / AI Gateway 端点与服务端计量口径 | W3、W6 |

---

## MVP · 一次真实作业跑通（当前批）

> **判据只有一条：一个真实用户能不能用它完成一次真实业务作业。**
> 下面按用户实际走一遍，断在哪就是范围。

| 步骤 | 现状 | 断点 |
|---|---|---|
| 装上 | ⚠️ | TD-001 证书未采购——**外部用户装不上**；内测可用开发模式绕过 |
| 登录、看到已订阅的产品 | ✅ | |
| 打开产品 | ❌ | **契约从哪来** → M1 |
| 新建项目 | ⚠️ | 未按平台工作区归属（TD-017）→ M5 |
| 授权文件夹 | ✅ | |
| 读进招标文件 | ❌ | **PDF / Word 读不进**（TD-018）→ M3 |
| 跑任务（解析 / 生成 / 校验） | ⚠️ | 需要真实能力面——**产品线的事，不是本仓** |
| 人工确认需求矩阵 | ⚠️ | **没有通知**，用户不知道该回来 → M4 |
| 导出标书 | ❌ | **写不了二进制**（TD-019）→ M2 |

### 范围（本仓必做六项）

- [ ] **M1 · 一级供给：契约拉取**（ADR-012）
      来源走产品能力面 → 过 R1–R13 → 按版本缓存 → 离线沿用（复用 ADR-003 的宽限
      逻辑）。**不依赖 Registry，不依赖签名信任锚。**
- [ ] **M2 · 成果落盘**（ADR-013、TD-019）
      结构化文档表示 + 预制渲染技能 + 工具执行器支持写二进制。
      **前置：表示法形状待定**（够表达标书，又不能变成第二个 HTML）。
- [ ] **M3 · 本地文档读取**（TD-018）
      **范围待确认，见下方「一处待裁定」。**
- [ ] **M4 · 人在回路的通知**
      任务停在等人那一刻若无人知晓，等于没停。走桌面壳的系统通知（02 §17），
      并给界面一个未决确认的入口。
- [ ] **M5 · 项目按工作区归属**（TD-017、ADR-007）
      项目记录带来源工作区并按它过滤。**会改变用户看到的东西。**
- [ ] **M6 · 不可信内容标记**（最小面）
      上下文来自用户的文件，文件里可能写着给模型看的指令。硬底线（对外发送
      ≥ 需确认）已挡住最坏结果；本项只做**最小面**：标记来源为不可信，并在
      传输门与确认卡片上呈现给用户。完整缓解（提示结构隔离）不在 MVP。
      **先做，因为它改变上下文通道的形状，事后加装更贵。**

建议顺序：**M6 → M1 → M3 → M2 → M4 → M5**。M6 先行是因为它动通道形状；
其余按用户旅程排。

### 明确不在 MVP

并发与调度 · 上下文预算 · 本地资源治理 · 跨产品协作 · 契约版本升级路径 ·
二级供给的签名与 Registry · Cloud Runtime 与一致性套件 · 同步 ·
用户策略持久化。

### 外部依赖（本仓做不了，但决定 MVP 能否被真实使用）

| 依赖 | 归属 | 影响 |
|---|---|---|
| 一个业务产品的能力面 | **产品线** | 没有它，任务跑不出真实结果；本仓只能做到「就绪待接」 |
| 代码签名证书（TD-001） | 采购 | 没有它，外部用户装不上——MVP 只能内测 |
| Atlas 视觉解析 | Atlas | 仅影响扫描件；文本层文档不受影响（取决于下方裁定） |

### 一处待裁定 —— 它决定 MVP 是否受制于外部

「模型能力全面由 Atlas 提供」这条，对**扫描件**成立无疑。但按 ADR-013 已确立
的同一条判据（**渲染是确定性转换，归技能；解析需要理解，归模型**），提取似乎
应当对称拆开：

| | 判据 | 归属 |
|---|---|---|
| `.docx` / `.xlsx` 的 XML 取文本、有文本层的 PDF 取文本 | **确定性转换，不需要模型** | 技能 → 本仓 |
| 扫描件 OCR、版面重建、图表理解 | 需要理解、需要视觉模型 | 模型 → Atlas |

**若认可这一拆分**，M3 只做确定性提取，MVP 不被 Atlas 阻塞。
**若不认可**（一切解析都归 Atlas），M3 整项等 `/v1/parse` 落地——
**那样 ruyin 的 MVP 就不由 ruyin 决定。**

代价是要为确定性提取引入本地依赖，进的是签名客户端，选型需按此权衡。
