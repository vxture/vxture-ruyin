# 如影仓库组织与发布模式设计

> **Ruyin Repository Organization & Release Model**
>
> 文档编号：08\
> 文档版本：v0.1\
> 文档状态：工程组织设计基线\
> 所属平台：Vxture Platform\
> 上游依据：`140-repo-governance-standard.md`（org 治理基座）、`product_240_repo-template.md`（模板设计，
> 其 §0 结论 3 已裁定 **ruyin 不适用模板**）、vxture-template（实践参照）、本仓 06《技术架构》\
> 关联文档：03-A §18（产品包分发）、06 §10（交付形态）

---

# 1. 定位与总判断

vxture-template 服务的是 **Web 全栈产品仓**（Docker 部署 + 服务器业务库 + OIDC RP + C3 webhook 服务端）。
Ruyin 是**桌面分发型仓库**，platform 侧已裁定不适用该模板。

本仓的组织原则一句话：

> **治理基座全盘继承，部署剖面整体替换：tag→环境 变为 tag→渠道，交付服务变为交付构件。**

---

# 2. 特殊性分析（与模板仓逐项对照）

| 维度 | 模板仓（Web 产品） | vxture-ruyin（本地运行时） |
|---|---|---|
| 交付物 | 运行中的服务（compose 栈） | 安装包 + 更新流 + npm 包 + 产品包 |
| "部署" | tag→env，SSH 到主机拉镜像 | tag→channel，构建构件并发布到下载点 |
| 数据层 | 服务器 `vxturebiz_{product}_{env}` + DDL 治理 | 用户机器上的 SQLite（06 §7），属应用内部，无服务器库 |
| 身份 | OIDC RP 五端点（服务端 cookie 会话） | 桌面原生：PKCE + loopback 回调（04 §9.1），无服务端 |
| C2 权益 | 服务端 entitlement 客户端 | Runtime 进程内 entitlement 客户端（需平台支持原生客户端凭证 → §10 liaison） |
| C3 用量 | 产品服务端缓冲 + flush | **不由客户端上报**：桌面端不可信，AI 用量在 AI Gateway 服务端计量（见 §2.1） |
| C3 webhook | 服务端单端点接收 | 无服务端可接收 → 订阅变更靠 Runtime 在线拉取 + 宽限期语义（04 §9.2） |
| 运行密钥 | 服务器 `.env` 注入 | **客户端零密钥**：全部客户端配置按公开处理；密钥只存在于 CI（签名）与用户 OS 凭据库（用户自己的 token） |
| 公开仓风险面 | 源码公开 | 源码 + 交付物全公开（安装包本就要分发），姿态一致 |

## 2.1 用量计量的特殊设计点

模板的 C3 模式（产品侧缓冲 → flush → consume）隐含"产品服务端可信"。桌面客户端不可信，
自报用量会被篡改。因此：

```text
AI 用量（ai.credit 等 counter 型）
    → 在 Vxture AI Gateway 服务端计量（请求即事实，客户端无法伪造）

本地行为类指标
    → 不作为计费依据，最多做匿名遥测（用户可关）
```

这与 06 T10（Runtime 不直连 Provider、一切经 Gateway）互相咬合：**Gateway 既是能力入口也是计量点**。

---

# 3. 治理基座映射表

| 治理条款（140） | 对本仓 | 说明 |
|---|---|---|
| §1 主干模式 + ruleset + 五项 checks | ✅ 原样继承 | `quality-gate` / `build` / `test-coverage` / `audit` / `gitleaks` 五个 job 名精确产出 |
| §2 密钥四层 | ✅ 原样继承 | push protection + gitleaks CI + husky pre-commit + 公开仓铁律 |
| §3 secret/variable 分类 | ✅ 原样继承 | 签名证书等归 CI secret；下载主机连接归 environment |
| §4 tag→环境 CD | 🔁 **替换为 tag→渠道**（§7） | 稳健 CD 构件（tailnet-ssh-connect / rsync staging / VERSION 溯源 / 审批门）复用，载荷换成构件 |
| §5 镜像仓库 profile | ➖ 不适用 | 无容器镜像；npm 包走 GitHub Packages（org 既有 NODE_AUTH_TOKEN 基建） |
| §6 环境与部署 bootstrap | 🔁 缩减 | 只需 `beta` / `production` 两个 Environment，指向下载主机而非应用主机 |
| §7 数据层（服务器 DB） | ➖ 不适用 | 无服务器库；SQLite 结构由应用内迁移管理（06 §7），另立仓内规范 |
| §8 护栏 | 🔁 按形态启用 | docs-numbering 必上；契约 lint（R1–R11）**新增为本仓特有护栏**；DDL/catalog 类不启用 |
| §9 SCA 门 | ✅ 原样继承 | osv-scanner pinned + `--config` 扫 pnpm-lock |
| §10 骨架与 docs 分类 | ✅ 继承（源码槽位按本形态） | 见 §4、§8 |
| 偏离纪律 | ✅ 遵守 | §4–§7 的剖面替换属"模板不适用"而非静默偏离，仍按三步向平台报备（§10 liaison） |

---

# 4. 仓库布局

依 06 §6.1 细化（本节起对其做 apps/packages/products 三分修正，以本文为准）：

```text
vxture-ruyin/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                  # PR + push:main，产出五项 required checks
│   │   ├── secret-scan.yml         # gitleaks（照模板）
│   │   ├── codeql.yml              # 照模板
│   │   ├── release.yml             # tag 触发：构建安装包 → 发布到下载主机（§7）
│   │   └── publish-packages.yml    # npm 包发布到 GitHub Packages（§6 流 A）
│   └── actions/tailnet-ssh-connect # 照模板复合动作，用于发布上载
├── .husky/pre-commit
├── 根配置（照模板）：.editorconfig .gitattributes .npmrc .gitignore
│   .gitleaks.toml .osv-scanner.toml .env.example
├── CLAUDE.md                       # ASCII-only（模板铁律），本仓工作纲领
├── README.md
├── docs/                           # 十段编号分类（§8 迁移 temp/）
├── scripts/
│   ├── guardrails/check-docs-numbering.mjs   # 模板收紧版复制
│   └── release/                    # 构件清单 / 校验和 / manifest 生成
├── packages/                       # 可发布的库（npm → GitHub Packages）
│   ├── contract-schema/            # @vxture/ruyin-contract-schema
│   ├── runtime-core/               # @vxture/ruyin-core（同构内核，云端 Runtime 消费）
│   ├── product-sdk/                # @vxture/ruyin-product-sdk（07 §6.2）
│   └── cli/                        # ruyin lint / dev / pack（07 §7–§9）
├── apps/                           # 不发布 npm，只进安装包
│   ├── local-host/                 # Node Runtime 守护进程（06 §4）
│   ├── shell/                      # Electron 壳 + electron-builder 配置
│   └── ui-workspace/               # Workspace UI（React）
├── products/                       # MVP 内置产品源码（后期迁出为独立产品仓）
│   └── bid/
└── pnpm-workspace.yaml             # packages/* + apps/* + products/*
```

要点：

- **packages/ 与 apps/ 的分界 = 是否被仓外消费**。云端 Runtime 与未来产品团队只消费
  packages/ 的 npm 包，绝不引用本仓源码（对齐平台"依赖 = 已发布 npm 包 + API 契约"的硬约束，方向对等适用）
- products/ 是过渡：MVP 期 Bid 产品与 Runtime 同仓联调最快；契约与 SDK 稳定后按 03-A 分发模型迁出
- `package.json` 预置机检契约脚本名：`type-check:all`、`lint`、`lint:docs-numbering`、
  **`lint:contract`**（本仓特有：对 products/*/ruyin.product.yaml 跑 R1–R11）

---

# 5. 分支与 CI（继承）

- `main` 唯一长期分支；feature 分支 → PR → squash → 删分支；直推 main 由 ruleset 阻断
- ci.yml 跑 PR 与 push:main，产出五项 checks：
  - `quality-gate`：`git diff --check` + docs 编号护栏 + **契约 lint**
  - `build`：全 workspace type-check + 构建（安装包构建不在此层，release 才做）
  - `test-coverage`：runtime-core 单测（状态机/Gate/校验器是天然的单测对象，本仓不需要恒绿占位）
  - `audit`：osv-scanner
  - `gitleaks`：secret-scan.yml
- **bootstrap 顺序**：本仓已有 main 与历史，与模板"空仓顺序"不同——先 PR 引入治理文件与 ci.yml
  → main 上跑绿一次产生五个 context → 再 apply `main-ruleset.json`。apply 之后本仓即告别直推模式

---

# 6. 构件与发布：三条流

| 流 | 构件 | 通道 | 消费者 |
|---|---|---|---|
| A | npm 包（contract-schema / runtime-core / product-sdk / cli） | GitHub Packages（@vxture scope，org NODE_AUTH_TOKEN 既有基建） | 云端 Runtime、产品团队 |
| B | 安装包（NSIS `.exe` + blockmap + `latest.yml` 更新 feed） | **网站平台下载（主通道，§7）** | 最终用户 |
| C | 产品包（`.ruyinpkg`） | MVP：与 B 同一下载主机的静态目录 + 清单文件；后期：Registry 服务（03-A §18.3） | Runtime 拉取 |

流 A 由 `publish-packages.yml` 承担（changesets 或手动版本，包版本独立于安装包版本）；
流 B/C 由 `release.yml` 承担。

---

# 7. 发布模型：tag → 渠道（网站平台下载优先）

## 7.1 渠道映射（替换模板的 tag→环境）

| tag | 渠道 | 门控 | 更新 feed |
|---|---|---|---|
| `beta-YYYYMMDD.N` | beta 渠道 | 无审批 | `dl.vxture.com/ruyin/beta/latest.yml` |
| `vX.Y.Z` | stable 渠道 | **production Environment 必审人门** | `dl.vxture.com/ruyin/stable/latest.yml` |

与模板同规：合并不发布，**只有推 tag 才发布**；tag 不重跑质量门（发的是 main 上已验证的提交）。

## 7.2 release.yml 流水线

```text
push tag
    ↓
windows runner：pnpm build → electron-builder
    → Ruyin-Setup-x.y.z.exe + .blockmap + latest.yml
    ↓
（代码签名步：证书就位后启用，见 §9 OQ-1）
    ↓
生成 manifest.json + SHA256SUMS
    ↓
[stable] production Environment 审批门 —— owner 手点
    ↓
tailnet-ssh-connect → rsync 到下载主机 staging 目录 → 原子切换
    （复用模板稳健 CD 构件：staging + --delete + VERSION 溯源，载荷换构件）
    ↓
校验：curl 拉回 latest.yml 比对版本与哈希
```

## 7.3 下载主机与网站对接

**MVP 形态**：境内既有 worker 上加 nginx 静态站点，边缘 vhost `dl.vxture.com`
（照 vxture-template `configs/edge/` 的 vhost 模式向平台线申请，走 80-liaison）：

```text
dl.vxture.com/ruyin/
├── stable/
│   ├── Ruyin-Setup-1.0.0.exe（+ .blockmap）
│   ├── latest.yml                 # electron-updater generic provider feed
│   └── manifest.json              # 网站消费的下载清单（见下）
├── beta/…（同构）
└── products/
    ├── index.json                 # MVP 版产品包清单（= 静态 Registry）
    └── vxture.bid/bid-1.0.0.ruyinpkg
```

**下载地址就是发布地址**（dl 主机的渠道目录，见上面的目录树）：

> 更正（2026-09-02，owner 定）：此处原本写着由 `vxture.com/appcenter` 消费，
> **那是错的**。appcenter 是智能体广场（列平台上的业务产品），不是桌面运行时的
> 装机包下载页 —— 两者被当成了同一个页面。
>
> 正确的说法简单得多：**包发在哪里，哪里就是下载地址**。不存在第三个需要维护的
> 地址契约，网站页面若要渲染下载入口，同样读这份 `manifest.json`。
>
> **下载必须区分渠道**：`stable` 与 `beta` 是同构但分开的目录，**默认且推荐
> stable**。给用户一个不写明渠道的下载链接是有害的 —— 他可能正装上一个 beta 包
> 而不自知。
>
> 本仓的更新检查据此实现：`GET /updates/check` 的 `downloadUrl` 由它刚校验过的
> 那份 `latest.yml` 所在的**同一个渠道目录** + feed 自己的 `path` 字段拼出
> （`updates.ts`）。检查哪个渠道，就下载哪个渠道，**两者不可能不一致** —— 这比
> 另存一个下载地址再去对齐它要可靠。

```json
// manifest.json —— 网站只读此文件渲染下载入口，不感知发布流程
{
  "product": "ruyin",
  "channel": "stable",
  "version": "1.0.0",
  "platforms": {
    "win32-x64": {
      "url": "https://dl.vxture.com/ruyin/stable/Ruyin-Setup-1.0.0.exe",
      "sha256": "…",
      "size": 134217728
    }
  },
  "releasedAt": "2026-08-01T10:00:00+08:00",
  "notes": "…"
}
```

**自动更新**：electron-updater generic provider 指向渠道目录；HTTPS + feed 内 sha512 校验完整性。

> **现状与此不同（2026-09-02，owner 定，TD-021）**：**MVP 阶段不做自动更新**，
> electron-updater 已从壳里整段移除、依赖也摘掉了。下面这一段与三条策略描述的是
> **设计目标**，不是当前实现 —— 别照着它去读代码。
>
> 现在的形态：守护进程照旧拉 `latest.yml` 比版本（不需要 Electron），并从**同一份
> feed 的 `path`** 拼出下载地址交给界面；用户在浏览器里下载、自己运行安装包。
> `latest.yml` 仍由 electron-builder 产出，格式不变 —— 改的是消费方，不是发布侧。
>
> 触发它的正是下面那条「签名是这条链的前置」：owner 定了不采购证书（TD-001 转
> standing），于是要么关掉签名校验、要么不自动安装，选了后者。

**更新策略（owner 定，2026-09-01）——三条，都指向同一件事：时机归用户。**

| # | 策略 | 落点 |
|---|---|---|
| 1 | **有任务在跑就不装** | 闸门在守护进程（只有它知道有没有任务在跑），界面据此禁用按钮，**壳在真正重启前再问一次** |
| 2 | **提示 → 用户决定是否更新、何时安装** | 不自动检查、不自动下载、不退出时静默安装；下载完成后**再问一次**才重启 |
| 3 | **渠道不允许降级** | 检查侧已保证：feed 版本不高于当前一律报「已是最新」。渠道切换尚未实现，实现时须带上这条 |

策略 1 为什么不能只做成禁用按钮：用户点下去到壳真正动手之间隔着一整段下载
（安装包上百 MB），任务完全可能在这期间起来。**只在按钮上禁用是挡误触，不是
挡竞态。** 所以闸门在守护进程侧每次被问到时重判，壳拿到下载完成后还要再问。

用户的安装意图**只存在内存里**：那是一次点击，不是一条设置。守护进程重启后它
消失，而那正对——用户是在看着「有新版本」那一刻点的，不是在授权一条长期规则。
同理，若期间任务起来了，意图被**丢弃**而不是留着等会儿装：悄悄挑一个时机装上，
正是策略 2 不允许的事。

**签名是这条链的前置，不只是下载的前置**：Windows 上 electron-updater 默认校验
更新包签名，未签名就得关掉那道校验，等于把更新通道的安全性一并降了（TD-001）。

**规模路径**：下载量上来后（150MB 级安装包吃带宽），构件源站不动、前面加
OSS/CDN 或对象存储直出——manifest 的 url 字段换域即可，网站与更新器均无感。

## 7.4 产品包通道（流 C 的 MVP 形态）

03-A §18.3 的 Registry 服务是目标态；MVP 用**静态目录 + 签名清单**过渡：

```text
products/index.json（由 release 流水线生成并签名）
    └── 列出各产品包：id / version / url / sha256 / 双签信息
Runtime 拉 index.json → 验平台签名 → 下载 .ruyinpkg → 验双签（03-A §18.2 不变）
```

订阅授权（Entitlement 过滤该用户可见的产品）在平台 API 侧完成，静态清单只是分发面——
**信任模型与目标态完全一致，只是没有动态服务**。

---

# 8. docs/ 迁移：temp/ → 十段编号

建 docs/ 骨架（照模板十段 + 收紧版编号护栏），temp/ 现有八份文档对号入座：

| temp/ 现文件 | 迁入 | 说明 |
|---|---|---|
| 如影…产品战略与顶层设计 | `docs/20-specs/10-product-strategy.md` | 产品定义归 specs |
| workspace-runtime-architecture | `docs/30-design/10-workspace-runtime.md` | |
| runtime-contract-design | `docs/30-design/20-runtime-contract.md` | |
| runtime-contract-schema | `docs/30-design/30-contract-schema.md` | 03-A 升正式编号 |
| context-architecture | `docs/30-design/40-context-architecture.md` | |
| harness-design | `docs/30-design/50-harness.md` | |
| technical-architecture | `docs/30-design/60-technical-architecture.md` | |
| product-integration-guide | `docs/40-implementation/10-product-integration-guide.md` | 面向实施 |
| 本文件 | `docs/30-design/70-repo-organization.md` | |

另建：`docs/30-design/decisions/`（ADR 寄存器，append-only）、`docs/60-operations/`（TD 登记）、
`docs/80-liaison/`（§10 的平台来往函）。文件名用英文 slug（编号护栏与跨仓一致性），正文中文不变。

---

# 9. Open Questions

- **OQ-1 代码签名证书**：Windows Authenticode（OV/EV）未采购。未签名 = SmartScreen 拦阻 +
  企业环境不可接受。公开发布前必须解决；beta 渠道内测期可暂缺（受众可控）
- **OQ-2 npm 包版本策略**：changesets 自动化 vs 手动 tag；runtime-core 版本 = 规范实现版本
  （03-A §5 runtime.minimum 的校验对象），需要严格的 semver 纪律
- **OQ-3 下载主机选址**：挂在哪台既有 worker、带宽余量、是否直接上 OSS —— 待平台线核实
- **OQ-4 macOS / Linux 构建**：MVP 只出 win32-x64；后续平台矩阵与信创路线（06 §11）合并规划

---

# 10. 向平台线的报备清单（80-liaison 首批）

按 140 偏离纪律"不静默"原则，虽属"模板不适用"仍报备三项：

1. **桌面分发剖面**：本仓以 tag→渠道替换 tag→环境，请求平台确认过渡态可接受，
   并建议平台侧沉淀一份"桌面分发型仓库 profile"标准（模板家族的空缺）
2. **边缘 vhost 申请**：`dl.vxture.com` 指向下载主机（照 vxtpl edge-vhost-request 函件格式）
3. **原生客户端对接**：桌面端 PKCE 客户端注册 + entitlement 原生客户端凭证 + AI Gateway
   服务端计量口径（§2.1）——这三项是 Phase B 的平台侧前置

---

# Final

> **一句话：治理随 org（五门、四层、编号、主干），交付走自己的路（tag→渠道，
> npm 包给云端，安装包给网站，产品包给 Runtime）；网站下载只消费一个 manifest.json。**
