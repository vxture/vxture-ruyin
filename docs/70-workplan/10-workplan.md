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
- [x] `products/bidproposal`：`ruyin.product.yaml`（30-contract-schema §16 落地，同时是测试主 fixture）
- [x] CI 转实（部分）：contract-lint job 接入 quality-gate（TD-004 已回收）；build/test-coverage 已有真实工作（TD-003 待 runtime-core 单测后关闭）

## W3 · Phase B：Bid 单产品可用

- [x] SQLCipher 静态加密（TD-009 回收）：workspace.db 加密 + 每空间密钥 + 主密钥 DPAPI（win）

里程碑：**本地招标文件 → 需求矩阵 → 方案生成 → 人工确认 → 导出，全程审计可查。**

- [x] Context Runtime：local-fs 连接器（Grant 域内、深度/数量/大小限额）+ Grant/Binding 模型（绑定校验 + 选择期 Grant 复核）+ FTS5 索引与相关性排序（**CJK 分词已修，2026-09-01 · TD-022**：默认 unicode61 对中文实测四条查询全 0 命中，改 trigram 并迁移老库，两字词由 LIKE 子串扫描兜底）+ Selection 管线（候选→排序→每类型限额）+ **context_confirm 门**（高敏上下文执行前人工确认）+ **transmission.inference 审计事件**（哈希不落内容，04 §7.3 落地）
- [ ] 能力面真实对接 —— **本仓这一侧已就绪，等的是某个业务产品有一个真实部署的云端服务**实现 ADR-009 的回合协议（`POST /products/{id}/capabilities/{capability}/turn`），`RUYIN_CAPABILITY_BASE` 才有东西可配。已落地：`CapabilityClient`、基址单点配置、未配置时回落 mock 且**启动播报如实说明**（2026-09-02 补上；此前 `main.ts` 的注释承诺了播报却一行没有，界面那半见 TD-033）。传输侧的 `context_confirm` 门与 `transmission.inference` 审计事件见上一条；审计哈希链 W2 已落地。<br>**2026-09-03 更正**：此前写「前置：liaison L3 平台侧就绪」。ADR-009（2026-08-31）取的正是「经业务产品云端中转、**不需要平台侧任何改动**」那一条，L3(c) 已被它取代 —— 这盏黄灯挂错了人，且与下文 MVP 外部依赖表（归属：**产品线**）自相矛盾
- [x] Workspace UI（`apps/ui-workspace`，React + Vite）：Checkpoint 卡片（context_confirm 展示 Context Set / verification_review 展示验证结论）、Grant/绑定面板、契约驱动的状态转换按钮（confirm:human 弹确认）、任务发起（自动选择 / 手动 JSON）、审计表；daemon 静态托管于 `/`（壳与浏览器同源同页），Dev Console 迁 `/dev`；打包进安装包 resources/ui
- [x] **验证修订轮 + 恢复重放**（Harness 侧）——**这条曾长期标着未做，而它其实早已实现**：`MAX_REVISIONS` 有界、末端恒为人（`verify: revisions are bounded and the end is always a person`），中断任务由 `interruptedResumePoint` + `recoverAll` 重入且不重做已完成的能力（`harness: recovery resumes an interrupted task without redoing finished work`）。同批还有瞬时错误退避挂起与取消。2026-09-01 复核用例后更正
- [ ] `packages/product-sdk`：桥 API 面冻结（40-implementation/10 §6.2 基线）

## W4 · 发布基建（可与 W3 并行启动）

里程碑：**推 `beta-*` tag 自动产出安装包并发布到 dl 主机，网站可下载。**

- [x] release.yml + 打包链（2026-07-24）：`pack.mjs`（pnpm deploy --legacy 自包含 daemon → electron-builder NSIS）→ exe + blockmap + latest.yml + manifest.json + SHA256SUMS；本地实测产出 **123MB 安装包**，打包版 `Ruyin.exe --smoke` 通过（daemon 从 resources 启动、DPAPI 生效）
- [x] beta / production Environment 已建，production 必审人已配（tag→渠道审批拓扑就位）
- [x] tag↔版本一致性闸（2026-09-01）：`v*` tag 与 `apps/shell/package.json` 不符即 release 失败。此前版本只取自 package.json——**推 `v0.2.0` 而包里还是 `0.1.0`，会产出 `Ruyin-Setup-0.1.0.exe` 并当作 v0.2.0 发布，产物、更新 feed、下载清单全都带着一个没人发布过的版本号，而没有任何东西会报错**
- [x] ~~签名步~~ **不做（2026-09-02，owner 定：不采购证书，TD-001 转 standing）**。`signAndEditExecutable` 已于同日回开，但那是为了写入应用图标——**它不等于签名**，没有证书时 electron-builder 只编辑不签。连锁后果已一并处置：**自动更新改为不做**（见下一条）
- [ ] dl 主机上载（**前置：liaison L2**）——L2 落地后加 tailnet-ssh-connect + rsync 原子切换。
      **过渡已落地（2026-09-03）**：publish job 发到 GitHub Releases —— 版本化 release + 按渠道滚动的
      release（tag `stable` / `beta`），固定地址、不过期；更新 feed 缺省指向滚动的 stable（TD-038）。
      此前 run 产物 90 天过期、检查更新永远查不到，两条都由此收掉
- [x] products/ 静态清单目录（流 C 的 MVP Registry，2026-09-03）：`ruyin pack` / `ruyin registry`
      产出包与 `index.json`（无签名、清单里逐条写明 `signed: false`），release.yml 随安装包暂存；
      守护进程 `GET /registry` + `POST /registry/install`（下载与清单核对 size / sha256 / 同源后走
      既有安装管线）；首页「从产品库安装」三种回答各说各的（查不到 ≠ 空、能看不能装、能装）。
      **正式版只能看不能装**（未签名，TD-037）—— 那是 TD-012 的事，这里不绕。
- [x] **自动更新：MVP 不做，改为浏览器下载 + 手动安装（2026-09-02 · TD-021 closed）**。曾于 2026-09-01 整套接过 electron-updater（检查 + 闸门 + 意图 + 下载安装），**现已整段拆掉** —— 它在 Windows 上默认校验更新包签名，而 owner 定了不采购证书：要么关掉那道校验、让更新通道接受任何来自 feed 的包，要么不自动安装。**选了后者。**<br>**是拆掉不是留着不用**：壳里的 electron-updater 与依赖、守护进程的 install/intent/闸门、以及已无发布方的 `update-intent` 事件类型全部移除 —— 留着一条走不通的路，下一个人会以为它还能走。<br>**保留并加强了检查那一半**：`GET /updates/check` 现在还给出 `downloadUrl` 与 `channel`，地址由**刚校验过的那份 feed 自己的 `path`** 拼出、落在同一个渠道目录，**检查哪个渠道就下载哪个渠道**；feed 没写文件名就不给地址（猜出来的地址点下去是 404）。界面写明渠道 —— 不写明渠道的下载链接是有害的。<br>**这个功能最早的毛病仍被钉着**：不发请求就断言「当前已是最新」。`unreachable` 是独立状态，绝不折叠进「最新」，守卫盯着

## W5 · npm 发布流

- [x] publish-packages.yml（2026-09-01）：contract-schema / runtime-core / cli → GitHub Packages。
      **首次发布已完成（2026-09-03，owner 定，tag `packages-v0.1.0`）**：contract-schema / document /
      runtime-core / cli 四个包各 0.1.0，发布流水线按顺序全部发出、无跳过，包页已关联本仓。
      自此版本守卫有了真基线：改了包内容就必须升版本。
      **版本定位（2026-09-03，owner 定：按行业最简单的那套）**：四个包步调一致、tag 号 = 版本号；
      正式版 `X.Y.Z` 发到 dist-tag `latest`，预发布版 `X.Y.Z-(alpha|beta).N` 发到同名（三种足够，不要 rc）
      dist-tag，由发布脚本从版本号推出、不靠人记；守卫查步调一致、版本形状、tag 与版本相等
      （发布工作流传 `--tag`）。0.x 期间 `latest` 只表示最新，不表示稳定。安装包仍用渠道
      （beta / stable），两条线互不牵扯。
      `product-sdk` 尚不存在（W3，待契约冻结），到时排进 ORDER 即可——**守卫会提醒**。
      - **两套 tag**：`packages-v*` 与安装包的 `v*` 分开。库的版本不该被应用版本牵着走——
        runtime-core 的版本是「规范实现版本」（OQ-2），与桌面应用发到第几版无关。
      - **与 release.yml 不同，这里重跑构建与测试**：npm 版本不可变，**发错了收不回来**，
        这是最后一次能拦住的地方。
      - **已发布的版本跳过，但逐个报告；一个都没发成则整体失败**——「流水线全绿、
        其实什么都没发」是这里最坏的结局。
      - **发布顺序是必需的，不是好习惯**：实测 `pnpm pack` 把 `workspace:*` 重写成了
        `"@vxture/ruyin-contract-schema": "0.1.0"`，依赖没先发，包在注册表上就指向一个
        不存在的版本。`check-publish-order.mjs` 按真实依赖拓扑校验，接入 static-checks，
        顺序颠倒与漏排包两种失败均反证可抓。
- [x] 版本策略定案（2026-09-03，owner 定：**手工版本 + 守卫，不上 changesets**）。口径不变：
      版本写在各包的 package.json，推 `packages-v*` tag 触发，已存在的版本跳过，所以
      「发布」= 先改版本号。四个包、一个发布方，changesets 的工具链与机器开的 PR 开销大于收益。
      **补上它缺的那道守卫**（`check-package-versions.mjs`，接入 static-checks）：以最近一次
      `packages-v*` tag 为基线，包内容改了（*.test.ts 除外）而版本号没动 → 报错，版本倒退 → 报错；
      依赖方不强制跟着升（钉旧版在 semver 上成立），只提示。**还没有 tag 时如实放行**，不拿假
      基线装作检查过。反证：对 `--baseline HEAD~8` 跑，抓出当天改了内容没升版本的三个包。

## W6 · Phase C：双端与同步

里程碑：**同一 Workspace 云端 ↔ 本地往返，冲突可解，C1–C7 一致性套件通过。**

- [ ] Cloud Runtime 宿主接入 runtime-core（平台侧协同）
- [ ] Sync Engine：三向对比 + 冲突 UI + 离线队列
- [ ] 身份完整链：PKCE / 设备绑定 / 宽限期（此前写「前置：liaison L3」；**L3(a) 已于 2026-08-31 满足**，见下）
  - [x] C1 客户端侧先行落地（2026-08-30）：daemon PKCE public client（S256 +
    loopback 回调 + RS256 验签拒 none/HS* + refresh 续票 + 会话 DPAPI 密封 +
    吊销退出）+ C2 权益客户端（45s TTL 不落库，`RUYIN_PLATFORM_API_BASE` 注入）
    + 账户弹层/开通深链 UI + 壳外链走系统浏览器；8 项鉴权单测。
    **闭环已于 2026-08-31 打通**：平台侧的 public client 能力由本线提 PR 落地（vxture-platform
    `014f25b`：`token_endpoint_auth_method` 列与约束、public client 分支、loopback 回调端口无关
    匹配、discovery 列 `none`、ruyin / ruyin-beta 种子），80-liaison/40 的 (1)(2) 据此满足。
    (3) 权益基址：本仓侧以 `RUYIN_PLATFORM_API_BASE` 注入即通；用户设备可达的基址
    （截至 2026-09-02，api.vxture.com 未路由 platform-api）与「本工作区全部订阅清单」端点仍待
    平台（见 MVP 旅程表「产品到本地」）。**2026-09-03 更正**：此句此前仍写着「闭环待平台侧
    登记回调 / ruyin-beta / 权益基址」，而那三件里两件早已落地
- [x] **Conformance 测试套件 C1–C7**（2026-09-01 · `runtime-core/src/conformance.ts`）
      —— 不依赖平台、不依赖任何具体产品，因此**不必等 W6 的其余部分**。
      导出 `runConformance()`，当前在内存 ports 与 SQLite ports 上各跑一遍；
      Cloud Runtime 接第三套 ports 时直接复用。七条均反证过抓得到

## Liaison（平台侧依赖，函件在 80-liaison/）

| # | 事项 | 阻塞 |
|---|---|---|
| L1 | 桌面分发剖面报备 + 建议平台沉淀 profile 标准 | 无（纪律性报备） |
| L2 | `dl.vxture.com` 边缘 vhost + 下载主机选址（08 OQ-3） | W4 |
| L3 | 原生客户端三件：PKCE 客户端注册 / entitlement 原生凭证 / AI Gateway 端点与服务端计量口径 | (a) 已满足（2026-08-31，平台 `014f25b`）；(b) 部分 —— 用户设备可达基址与全量订阅清单端点待平台；(c) **由 ADR-009 取代，撤回**，不再阻塞 W3 |

---

## MVP · 承载任意一个业务超级智能体（当前批）

> **判据：装上 Ruyin 的机器，能不能承载一个业务超级智能体走完它的作业。**
>
> **不按任何具体产品规划。** `products/bidproposal` 是测试夹具（TD-006），它的旅程
> —— 招标文件、需求矩阵、导出标书 —— **不构成 MVP 的定义**。用具体产品的
> 旅程去定义框架，得到的是那个产品的脚手架，不是框架。

### 与产品无关的旅程

任何业务超级智能体都要走这一遍，断点即范围：

| 步骤 | 现状 | 断点 |
|---|---|---|
| 装上 | ⚠️ | **不签名（TD-001 已定不采购）**。用词更正：不是「装不上」——SmartScreen 是**警告**不是封锁，用户点「更多信息 → 仍要运行」即可装。代价是首次安装有一道劝退对话框，且**买了证书也不会立刻消除它**（EV 的 SmartScreen 特权已于 2024-03 被微软取消，EV/OV 一律靠下载量累积信誉） |
| 登录、看到已订阅的产品 | ✅ | |
| **产品到本地** | ⚠️ | 拉取管线已通（M1）；**自动拉取还差平台给出「已订阅产品清单」**，见下 |
| 新建项目 | ✅ | 按平台工作区归属并过滤（M5；未登录不可新建） |
| 授权本地资料 | ✅ | |
| **资料进入上下文** | ✅ | **本仓这一侧已交付**：承载面容纳非文本（M3）、媒体类型过线、审计记录齐全。**「读懂 PDF / Word」不是本仓的活** —— 解析属业务语义，归产品（ADR-011 的同一条界线；owner 2026-09-02 定性：ruyin 摆桌椅板凳，菜有人做）。TD-018 据此关闭。此前两版把它记成本仓欠账，还一度误写「归 Atlas」 |
| 任务循环：agent 迭代 → 工具过闸 → 人在回路 | ✅ | |
| **停在等人那一刻** | ✅ | 系统通知 + header 常驻未决入口（M4） |
| **产出落到本地** | ✅ | 字节能落盘（M2）；结构化表示与渲染已交付（2026-09-01，ADR-016/017 · TD-019/023 已关闭）：`@vxture/ruyin-document` 以 mdast 为内部表示、Markdown 上线，渲染 `.docx` 与 `.pdf`（PDF 经壳里的 Chromium），表达不了的构件拒渲而不是少渲。**2026-09-03 更正**：此格此前仍写着「生成 .docx 仍缺渲染技能与结构化表示」，而本页下文「MVP 之后」一节早已记着它落地 —— 同一份文档前后两说 |

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
- [x] **M4 · 人在回路的通知**（2026-08-31 完成）
      任务停在等人那一刻若无人知晓，等于没停——而未决确认原先只在它所属的
      那**一个**任务界面里看得到，也就是要求用户**已经在看**那个唯一会告诉他的
      地方。
      - `listPendingConfirmations()` + `GET /pending`：跨项目汇总，最久的排最前
        （等得越久越容易被忘掉）。单个项目读不出来不清空整张单——**部分答案仍
        能把人带到其余确认那里**。
      - **桌面壳轮询 HTTP 发系统通知**，不走 IPC：窗口保持「纯 Web 客户端、无
        preload、无 Node」，契约边界仍在 HTTP（60 §4.2）；且渲染进程忙碌或在
        别的视图时通知照发。点通知直接跳到该项目。
      - **只有新出现的确认才通知**，且**首轮只做基线不播报**：启动时本来就在等
        的是用户马上会看到的积压，不是新消息——否则每次启动都是一串弹窗。
      - 界面入口**常驻 header**：放进某个页面等于又要求用户先找对地方。
      - 两边看的是同一份事实（`GET /pending`），不会各说各话。
      - 已在浏览器里跑通全链路：停下 → 计数 → 清单 → 直达决定点 → 决定后清零。
- [x] **M5 · 项目按工作区归属**（2026-08-31 完成 · ADR-015、TD-017）
      口径由 owner 定（2026-08-31）：**不容许存在没有工作区的项目**。其余都是
      维持这个不变量的手段。**会改变用户看到的东西。**
      - **未登录不允许新建**——不是把功能藏起来，是这个动作**缺少它的主体**：
        没有工作区，「建在哪儿」没有答案，替用户回答就是编造。
      - **不变量由类型持有**：`createProject(contract, name, workspaceId)`
        第三参必填，**不存在能产出无归属项目的代码路径**。
      - **存量是待导入队列，不是一种状态**：单独分组、任何工作区下都可见、配
        「导入当前工作区」。**不回填**——回填是替用户猜，而**归错比不归更难
        发现**，因为界面看起来完全正常。导入**只填空白不搬家**（改已有归属
        是把数据挪过订阅与权益边界，另一件事）。
      - **别处的项目隐藏但报数量**，不报名字：隔离照做，又不让人以为数据没了。
      - **连带**：首页「暂不登录，先本地使用」语义变窄——本地模式剩运行环境
        本身，文案已同步。

顺序：**M6 ✅ → M1 ✅ → M3 ✅ → M2 ✅ → M4 ✅ → M5 ✅**。M6 先行是形状问题；M3/M2 是一对接缝，
挨着做最省；其余按旅程排。

### 明确不在 MVP

并发与调度 · 上下文预算 · 本地资源治理 · 跨产品协作 · 契约版本升级路径 ·
二级供给的签名与 Registry · Cloud Runtime 与一致性套件 · 同步 ·
用户策略持久化 · **具体格式的解析**（归产品，不在本仓范围内——TD-018 已于 2026-09-02 据此关闭）。

> **渲染已不在此列。** 这一条原本写作「任何具体格式的解析与渲染技能」。渲染在
> MVP 期间确实不做，但它是 ADR-013 选定的 C 的主体，由 TD-019 跟踪，并于
> 2026-09-01（MVP 关闭之后）落地：`@vxture/ruyin-document` 交出 mdast 表示与
> docx / PDF 渲染。**解析仍在此列，且归属未变** —— 解析要模型能力（ADR-008），
> 渲染是确定性转换（ADR-006 的技能）。

### 外部依赖（本仓做不了，但决定 MVP 能否被真实使用）

| 依赖 | 归属 | 影响 |
|---|---|---|
| 一个业务超级智能体的能力面 | **产品线** | 没有它，任务跑不出真实结果；本仓只能做到「就绪待接」 |
| ~~代码签名证书（TD-001）~~ | ~~采购~~ | **已移出外部依赖（2026-09-02）**：owner 定不采购，TD-001 转 standing。它本来就不是「MVP 能不能被使用」的闸门——SmartScreen 只警告不封锁 |

**注意 MVP 的验收方式随之改变**：不能拿某个产品的成品去验，只能验
**接缝是否就位** —— 契约能拉到、非文本内容能进上下文、字节能落盘、等人时
有通知、项目按工作区分隔、不可信内容被标出。承载哪个智能体，是之后的事。

---

## MVP 之后（2026-09-01 一批）

> MVP 关闭之后做的这一批，此前**计划文档里一个字都没有**。补记于此，因为
> 排下一步的依据就是这份文档 —— 依据过期，排出来的就是错的。

### 落地

| | 内容 |
|---|---|
| **ADR-016** | 结构化文档表示：内部 mdast，上线格式 Markdown，扩展走 `remark-directive`。**不违反 ADR-013 对 A 的否决** —— A 让模型转运它没创作的字节，C 让模型交出它本来就要创作的正文 |
| **ADR-017** | PDF 由壳里的 Chromium 渲染，字节回守护进程落盘（`writeArtifact` 仍是唯一写入路径） |
| **TD-019 / 023** | `@vxture/ruyin-document`：docx + PDF；表达不了的构件**拒渲而不是少渲** |
| **TD-020** | 项目导出：in-toto Statement + DSSE 信封，`signatures: []` 是合法状态（客户端零密钥）—— **可验篡改，不可归属** |
| **TD-022** | 检索落地，范围限定在**本任务的上下文集**；连带修掉 FTS 对中文零命中 |
| **TD-026** | `sources: [project]` 兑现：任务产出登记后回流给下游任务 |
| **TD-027 / 029** | 事件流（SSE）替掉界面与壳的七处轮询；轮询降为兜底 |
| **TD-025 / 028** | CI 打包冒烟；界面补上导出 / 启停 / 版本回滚 / 装包四个入口 |
| **R14** | 新契约规则：声明了 tools 的 task 必须有 capability |
| **UI** | chrome 三态（工作台 / 产品 / 设置），规则是**谁的导航就放在谁的侧栏里** |

### 这一批抓到的缺陷（都不是新写的功能，是既有的）

按同一条判据找出来的 —— **「这里说了一件事，实际是不是那样？」**

- `export_deliverable` 声明了工具却没有 capability，**零调用跑到 completed**，
  中间还让人确认一份从未产出的交付物 → R14
- **工作区边界只挡了列表**：`activeWorkspace()` 全服务端只用了三次，其余每条
  `/projects/:id/*` 都不检查归属 —— 切换工作区后面板还开着，能把上一个工作区
  的项目连审计链一起导出
- 安装更新**在第一步就断**：`downloadUpdate()` 前从未 `checkForUpdates()`，库
  直接 reject；`allowDowngrade` 吃默认值，而 `channel` setter 会把它翻成 true
- 审计页对**每一条完好的链**都喊「哈希链断裂」：X-3 改名后界面那份类型没跟
- 三处文件头说反了（改订轮次/瞬时挂起/取消都已实现却写着未做）

### 守卫（九道，每道都故意弄坏验证过）

`lint:contract`（R 系列）· `lint:api-shape`（X-1/B-3）· `lint:publish-order` ·
`lint:shared-shapes`（跨进程类型 + 事件词表 + 标题栏高度）·
`lint:update-policy`（owner 定的三条更新策略）· `lint:docs-numbering` ·
`lint:tech-debt`（登记册可解析、自计数一致）· `lint:brand-assets` ·
`lint:versions`（内容改了版本必须升，基线 = 最近的 packages-v* tag）；
（2026-09-03 更正：此处此前写「六道」，后几道加上后没改）
CI 另加 `packaged-smoke`（windows-latest，真启动 + 真排一份 PDF + 断言 DPAPI）。

**已提为第六个必需检查（2026-09-02，#73）** —— owner 定：ruyin 是桌面分发仓，平台模板明文不适用，
本仓自决、不等平台标准；CLAUDE.md「Required checks」是权威。**2026-09-03 更正**：此处此前写着
「咨询性，不是必需检查 —— 必需上下文恒为五个，加第六个属治理变更，待 owner 定」，在 #73 合入后
即过期 —— 一句写着「待定」的话读起来和真的待定一模一样。

### 通路二 · 本地连接器（ADR-005，2026-09-03 起，owner 定）

> 判据：**局域网 / 私有服务里的资料，能不能像本地文件夹一样绑定到项目、进入
> 上下文、过传输门、留审计。** 这是只有装在用户机器上才做得到、无人可代做的
> 那件事（ADR-006 的甲类）。

分步交付，每步一个 PR、各自可验：

- [x] **A · 内核接缝**（runtime-core）：ADR-005 列的五处里余下四处 —— `Binding.source`
      放宽为契约来源种类、条目自带 `connector`、注册表收窄为 `ConnectorLookup`
      （宿主持表、运行时可写）、`ConnectorPort` 可选生命周期；另加
      `ConnectorGrant`（授权以项目为边界，与文件夹授权并列、选择期复核、进审计）。
      传输审计每条记 `connector`。
- [x] **B · MCP 连接器**（local-host，2026-09-03）：stdio 传输的最小 MCP 客户端
      （initialize / resources/list 分页 / resources/read / ping；服务端反向请求一律
      `-32601`；超时、进程退出、stdout 混入非 JSON 各有出口）+ `McpConnector`
      实现 `ConnectorPort`（含 start / stop / health；读失败是 `unavailable` 条目，
      不是任务失败）+ 宿主注册表 `ConnectorRegistry`（清单 `connectors.json` 落
      data dir、启动时全部拉起、起不来的照样登记为不健康）+ `/connectors` 四个口。
      **安装口在签名信任锚（TD-012）就位前按包的先例处理**：生产 403 拒绝并点名
      TD-012，`RUYIN_ALLOW_UNSIGNED_CONNECTORS=1` 仅开发放行（TD-036）——
      「不接受任意 URL」是 ADR 的信任模型第一条。子进程只继承 PATH 与清单里
      写明的环境变量，守护进程的会话令牌不进去。用例跑的是真子进程、真管道
      （`fake-mcp-server.ts`），每条失败路径都在假服务器上开关得到。
- [x] **C · 界面**（2026-09-03）：项目「资料」板块多出「连接器授权」（只在机器上装了
      连接器时出现），绑定表单在有已授权连接器时多一个「经由」选择、根路径提示随之变成
      URI 前缀；经连接器的绑定卡标明连接器与来源；汇总行把连接器授权与文件夹分开计。
      设置页新增「连接器」分区：列已装连接器与**问出来的**健康、卸载、开发态安装
      （生产 403 原话照转，不软化成「暂不可用」；没有注册表的装配显示 503 原话并隐藏
      安装表单）。审计表的 payload 本就整段显示，连接器字段随之可见，不另加列。
- [x] **D · 连接器工具经 Tool Gate**（2026-09-03，owner 定：**契约声明**）：契约
      `tools[]` 加 `provider: connector`，映射就是 id 相同；category / risk / default
      仍由契约定，闸门一字不改。R15 把连接器工具限在 `query` / `external_send`
      （写进内网系统走 external_send 硬底线 ≥ ask）。执行器只路由到**本项目授权过**且
      暴露该工具的连接器（装了没授权的看不见；两个都暴露不猜，报歧义）；机器上没有
      连接器暴露时任务启动前就被拒并点名。审计 `tool.executed` 记连接器。MCP 客户端
      补 `tools/list` / `tools/call`，非文本内容点名省略而不是静默丢掉；设置页列出
      每个连接器暴露的工具名。
- [ ] **E · Streamable HTTP 传输**：stdio 之外的第二种标准传输。

**不采用 MCP 官方 SDK 的理由（B，2026-09-03）**：它把 express / hono / cors /
jose 等一整套服务端依赖带进**随安装包发出**的守护进程，而本仓只做客户端、只用
四个方法；audit 面随之扩大。协议子集小、可用假服务器完整测试，先自实现；
若后续要上 HTTP 传输或客户端能力面变宽，再评估换 SDK —— 到时是替换一个文件，
不是重写。

### 开发工具

`pnpm dev:ui`：带登录桩的界面观察台。此前界面改动只能靠类型与构建，视觉从未
过眼 —— 它只顶开登录这道门，服务端的授权护栏、工作区边界、审计全部照常。

### 测试与覆盖（2026-09-02）

`test-coverage` 这个必需检查从 TD-003 关闭那天起就只跑测试、从未量过覆盖率
（TD-030）——按包实测之后，最陡的一个窟窿是 `platform.ts`（OIDC 登录/会话/
刷新/权益查询整个类）17% 函数覆盖，只测过两个纯函数；`server.ts` 大片路由
（`/auth/*`、`/oauth/callback`、`/entitlements`、product 生命周期、
`/projects/:id` 下的 state/grants/bindings/cancel/context/import）从未经真实
HTTP 打过；`pdf.ts`（壳渲染通道）与 `loadProducts`（开发态产品扫描）从未被
任何用例加载过；`packages/cli` 连 `test` 脚本都没有。

按包补测后（PR #75–#80）：

| 包 | 覆盖率变化（行/分支/函数，仅自身源码） |
|---|---|
| runtime-core | 93.67%/80.60%/92.56% → 94.41%/83.48%/92.56%（tool-gate.ts、export.ts 补到 100%/96%/100% 与 100%/87%/100%） |
| local-host | 83.55%/74.01%/81.13% → 94.88%/84.33%/91.70% |
| document | 88.58%/74.85%/92.31% → 96.96%/86.60%/100% |
| contract-schema | 99.37%/93.89%/100% → 100%/95.49%/100% |
| cli | 0%（无测试） → 100%/100%/100% |

五个包的 `test` 脚本各自加了 `--experimental-test-coverage` + 按包 scope 的
行/分支/函数阈值（TD-030 已回收）。`apps/shell`（Electron 壳）与
`apps/ui-workspace`（React 界面）当时仍无 `test` 脚本，不在这批范围内
（TD-031）；两者后续由 #82（壳）与 #83–#84（ui-workspace 六个大组件）补齐，
TD-031 已回收。
