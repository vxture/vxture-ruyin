# ADR-021 Ruyin 是环境不是产品：对平台的登记只到 OIDC client 这一层

- 状态：**已接受**（owner 2026-09-10 问：「ruyin 与 platform、accounts 到底如何设计
  关系，是否需要将 ruyin 注册为 platform 平台的一个产品？」）
- 日期：2026-09-10
- 事实来源（每条都对过正文或代码）：`20-specs/10-product-strategy.md` §1.1–1.2、
  `30-design/70-repo-organization.md` §2 逐项对照表、
  `80-liaison/30-…-native-client-integration.md`、`80-liaison/40-…-l3-client-registration-blockers.md`、
  `apps/local-host/src/platform.ts`、`accounts.vxture.com` 的 discovery 实测
- 相关：ADR-007（workspace 让给平台定义）、ADR-008（一个内核两个宿主）、
  ADR-015（项目必须归属工作区）、TD-057（退出与会话边界）

## 0. 一句话

**Ruyin 是「工作环境」，不是「产品」；它在平台那一侧需要的登记只有一种 —— OIDC
public client，而那一种早就有了。** 把 ruyin 注册进产品目录是类别错误：环境会变成
跑在环境里的东西的同级。

## 1. 权威怎么说

`20-specs/10-product-strategy.md` §1.2 一句话定死：

> **产品属于 Vxture SaaS，工作环境可以是 Cloud 或 Ruyin。**

同节的关系图是这个形状 —— **Cloud Workspace 与 Ruyin 是同一层的两个环境**，挂在
同一份订阅下，跑**同一组**业务产品：

```text
Vxture SaaS Subscription
   ├── Cloud Workspace ──┐
   └── Ruyin Local ──────┴──> 同一组 Vxture 业务产品
```

订阅模型也不允许把它当产品卖：**0 订阅时本地只剩环境**，环境本身不是订阅项。

## 2. 「登记」有三种，容易混的是这里

| 登记种类 | 登记在哪 | ruyin | 依据 |
|---|---|---|---|
| **OIDC client** | accounts | **要，且已有**：`ruyin` / `ruyin-beta`，public client、PKCE S256、loopback 回调 | liaison L3(a)，2026-08-31 随 `vxture-platform` `014f25b`（#85）落地 |
| **产品码 / 产品目录** | platform | **不要** | 契约 id = 平台产品码，那是给业务产品的 |
| **RP 五端点 / C3 webhook** | platform | **不适用** | 桌面端没有服务端进程（`70-repo-organization` §2） |
| **订阅项** | platform | **不要** | 0 订阅只剩环境 |

所以准确的说法不是「ruyin 没在平台登记」，而是 —— **登记了，登记的是 client 这一
层，而这正是对的那一层。**

**代码可佐证**：全仓 `"ruyin"` 这个字面量只出现在两处 —— `platform.ts` 的 OIDC
`clientId`，与 MCP 的 `clientInfo.name`。**它从来不是一个 productId。**

## 3. 层级：不是上下游

client 登记那件事是 **ruyin 线自己去平台仓提 PR 解决的**（`014f25b` / #85）。这一点
本身就是层级的答案：环境与平台的差异是**职责差异，不是上下游差异**。缺什么自己去
补，不是排队等供货。

（这条写下来是因为本仓的记录里，同一个判断错过三次 —— 都是把 ruyin 写成下游。）

## 4. 边界画在哪：ruyin 向平台要什么、不要什么

| | 内容 |
|---|---|
| **要** | 身份（OIDC public client）、权益读取（C2 `/platform/entitlements`，只读、不判、45s TTL 不落库） |
| **不要** | 产品码、订阅项、AI 网关直连（ADR-001：ruyin 不直连 Atlas）、配额计量（桌面端不可信，计量在服务端） |
| **不适用** | RP 五端点、C3 webhook、服务端会话 —— 没有服务端进程可承接 |

## 5. 由此推出的一条：会话与设备管理属于 accounts，不属于产品目录

2026-09-10 owner 实测发现：应用退出登录之后再点登录，**静默直入**（TD-057）。三个
会话里只有本机那个被清掉，浏览器里 accounts 的会话还活着，而 authorize 上的
`prompt=select_account` 被平台忽略；`end_session` 也忽略 `post_logout_redirect_uri`。

按本 ADR 的边界，这些**一件都不是产品登记能解决的** —— 它们全部落在 **accounts 对
原生客户端的会话管理**这一档：

1. 登录流兑现 `prompt`（→ 二次登录能选账号／要确认）
2. `post_logout_redirect_uri` 生效（→ 换账号一步走完，而不是两步）
3. 设备列表与远程吊销 —— **这一条 liaison L3(a) 早就写过**：「设备可远程吊销」

三件同源。旁证：discovery 公布着 `backchannel_logout_supported: true`，说明平台**有
会话管理这套底子**，缺的是把它接到原生客户端这一档上，不是架构上没有。

## 6. 将来 ruyin 本身要分档收费怎么办

**仍然不是把它塞进产品目录。** 要的是**一个 entitlement 项**（「这个账号能不能用
Ruyin、能用几台设备」）加上 §5 那套设备管理。

**entitlement 项 ≠ 产品**：前者是账号上的一个开关；后者是有契约、有能力声明、能装
进环境里跑的东西。混为一谈，会让「Ruyin 里装了哪些产品」这句话自指。

## 7. 备选方案（为什么不选）

**把 ruyin 登记成产品，好处是控制台里能看见它。** 不选：控制台要显示的其实是
「这个账号有哪些设备装了 Ruyin」，那是设备列表，不是产品条目；为了一个展示需求把
环境降级成产品，会连带把订阅、契约、能力声明这一整套语义套到一个不适用的东西上。

**把 accounts 会话问题绕过去 —— 退出时顺手调 `end_session`。** 不选：那会把浏览器里
同账号的所有 Vxture 网站和应用一起登出，副作用是浏览器级的（TD-057 正文）。

## 后果

- **本仓不再讨论「要不要注册成产品」**；再问直接引本条。
- TD-057 的两个未决项由本条给出归属：它们是 accounts 的会话管理缺口，**不是**
  ruyin 这一侧能补的，也不是登记关系能改的。
- §5 那三件同源，若要提，**应合成一封 liaison 一起提**，不分三次。提不提由 owner
  定 —— 本仓不预先催（这条纪律见 `90-memory`）。
