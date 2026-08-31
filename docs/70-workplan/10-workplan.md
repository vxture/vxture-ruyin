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

## MVP · 承载任意一个业务超级智能体（当前批）

> **判据：装上 Ruyin 的机器，能不能承载一个业务超级智能体走完它的作业。**
>
> **不按任何具体产品规划。** `products/bid` 是测试夹具（TD-006），它的旅程
> —— 招标文件、需求矩阵、导出标书 —— **不构成 MVP 的定义**。用具体产品的
> 旅程去定义框架，得到的是那个产品的脚手架，不是框架。

### 与产品无关的旅程

任何业务超级智能体都要走这一遍，断点即范围：

| 步骤 | 现状 | 断点 |
|---|---|---|
| 装上 | ⚠️ | TD-001 证书未采购——外部用户装不上；内测可用开发模式绕过 |
| 登录、看到已订阅的产品 | ✅ | |
| **产品到本地** | ⚠️ | 拉取管线已通（M1）；**自动拉取还差平台给出「已订阅产品清单」**，见下 |
| 新建项目 | ⚠️ | 未按平台工作区归属 → **M5** |
| 授权本地资料 | ✅ | |
| **资料进入上下文** | ⚠️ | 承载面已可容纳非文本（M3）；**读懂 PDF / Word 仍缺**——属解析，归 Atlas（TD-018） |
| 任务循环：agent 迭代 → 工具过闸 → 人在回路 | ✅ | |
| **停在等人那一刻** | ⚠️ | 无人知晓 → **M4** |
| **产出落到本地** | ⚠️ | 字节能落盘了（M2）；**生成 .docx 仍缺渲染技能与结构化表示**（ADR-013 的 C，TD-019） |

### 范围（六项，均与产品无关）

- [x] **M6 · 不可信内容标记**（最小面，2026-08-31 完成 · ADR-014）
      上下文来自用户的文件，文件里可能写着给模型看的指令。硬底线（对外发送
      ≥ 需确认）已挡住最坏结果；本项只做最小面：标记来源为不可信，并在传输门
      与确认卡片上呈现。**排最前不是因为最急，是因为它改变上下文通道的形状，
      事后加装更贵。**
- [x] **M1 · 一级供给：契约拉取**（2026-08-31 完成 · ADR-012）
      走产品能力面 → 过 R1–R13 → id 相符 → 按版本落进**同一个产品库** →
      离线沿用。不依赖 Registry，不依赖签名信任锚。
      - 落盘位置与 `.ruyinpkg` 共用，于是版本并存 / 切换 / 回滚全部复用既有实现；
        来源记在 `.source.json`，`GET /products` 的 `supply` 字段据此区分
        `contract_fetch | package | builtin`——两级在信任上不是一回事。
      - **不签名不是省略**：契约不可执行，其唯一特权面是声明工具与默认权限，
        而工具闸硬底线以 `stricter()` 合并且不可配置，契约放松不了它。拉取走的
        是能力调用同一个主机，**没有扩大信任面**。
      - 网络类失败一律 `offline` 且不抛错（ADR-003）；抛错只留给「契约本身不可
        接受」。同版本内容变了 → **保留本地那份并报差异**，静默采纳会把产品
        违反 §18.4 的错误藏起来。
      - **遗留（外部依赖，不在本仓）**：自动拉取「已订阅但本地没有」的产品需要
        平台给出**已订阅产品清单**；现有 C2 只能就一批已知 id 回答是否订阅，
        查不到本地尚不知道的产品。管线已按 `productId` 单参数设计，清单一到即可
        直接驱动。当前入口为显式 `POST /products/:id/fetch`。
- [x] **M3 · 上下文承载面支持非文本**（2026-08-31 完成 · 40-context §4.1.1）
      `ContextItem.content` 由 string 改为带标签的联合
      `text | binary | unavailable`，`ContextFact` 同形（字节在线上走 base64）。
      **做的是接缝，不是格式**：媒体类型表是承载表不是支持矩阵，解析仍归产品
      能力面（ADR-008）。
      - **顺带修掉一个真问题**：原实现把
        `[binary or unsupported file type: X]` 当作**内容**送进上下文——那句话
        的形状和文件内容一模一样，模型分辨不出来；审计的 `content_hash` 哈希的
        还是这句我们自己编的话；FTS 索引也把这些词收了进去，搜「binary」能命中
        全部二进制文件。三处一并修正。
      - `unavailable` 是一等答案且**照样过线**：静默丢掉会让提供方以为资料齐了。
        它不带 `content_hash`——没有内容就没有内容哈希。
      - 截断改为标志位（`truncated: true`），不再把注解追加进正文；超限二进制
        一律 `unavailable`，**截断的二进制不是小一点的文档，是坏掉的文档**。
      - 大小闸读**读取时**的 stat，不读 discover 时的旧数字。
- [x] **M2 · 产出落盘支持二进制**（2026-08-31 完成 · ADR-013 落地状态）
      `writeArtifact(path, bytes, grants)`：授权护栏 + 上限 + **原子改名**。
      渲染成什么格式仍是技能的事，不在本项。
      - **字节路径是唯一的写入路径**：`write_document` 把文本编码后也走它。
        护栏 / 上限 / 原子性因此不会因为新增第二个写入方而被漏掉——**只贴合某一
        个调用方形状的护栏，下一个调用方就绕过去了**。
      - **原子性不是洁癖**：半个 `.docx` 不是短一点的文档，是打不开的文档，
        而它就摆在用户等成果的位置。
      - **没有加 base64 工具参数**，并在别人会去实现它的位置留了说明：那是
        ADR-013 否决的 A，会让字节流经对话（2MB 文档 → 2.7MB base64 进上下文）。
      - 顺带修正 `read_file`：原本把任意文件按 UTF-8 硬解，非文本文件以乱码
        形式当正文交给模型（与 M3 修的是同一个毛病，只是在另一条通路上）。
        现如实报错并指向上下文通路——**工具结果进对话，而字节进对话正是 A 被
        否决的理由**，所以这里既不硬解也不回传字节。
- [ ] **M4 · 人在回路的通知**
      任务停在等人那一刻若无人知晓，等于没停。桌面壳系统通知（02 §17）+
      界面上一个未决确认的入口。
- [ ] **M5 · 项目按工作区归属**（TD-017、ADR-007）
      项目记录带来源工作区并按它过滤。**会改变用户看到的东西。**

顺序：**M6 ✅ → M1 ✅ → M3 ✅ → M2 ✅ → M4 → M5**。M6 先行是形状问题；M3/M2 是一对接缝，
挨着做最省；其余按旅程排。

### 明确不在 MVP

并发与调度 · 上下文预算 · 本地资源治理 · 跨产品协作 · 契约版本升级路径 ·
二级供给的签名与 Registry · Cloud Runtime 与一致性套件 · 同步 ·
用户策略持久化 · **任何具体格式的解析与渲染技能**。

### 外部依赖（本仓做不了，但决定 MVP 能否被真实使用）

| 依赖 | 归属 | 影响 |
|---|---|---|
| 一个业务超级智能体的能力面 | **产品线** | 没有它，任务跑不出真实结果；本仓只能做到「就绪待接」 |
| 代码签名证书（TD-001） | 采购 | 没有它，外部用户装不上——MVP 只能内测 |

**注意 MVP 的验收方式随之改变**：不能拿某个产品的成品去验，只能验
**接缝是否就位** —— 契约能拉到、非文本内容能进上下文、字节能落盘、等人时
有通知、项目按工作区分隔、不可信内容被标出。承载哪个智能体，是之后的事。
