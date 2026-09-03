# Liaison request: 桌面原生客户端对接三件（L3）

- Stamp: 2607241450 (2026-07-24 14:50)
- From: ruyin line
- To: platform line (owns identity / entitlement / AI infrastructure)
- Status: **(a) met, (b) partial, (c) withdrawn** (re-stated 2026-09-03; facts as of 2026-08-31;
  was: open - awaiting platform-line design confirmation).
  (a) **met**: the platform now has native public-client support - PKCE without a secret,
  port-agnostic loopback redirect matching, `none` in discovery, `ruyin` / `ruyin-beta` seeds -
  landed through this line's own PR, vxture-platform `014f25b` (#85), merged 2026-08-31. Desktop
  login is real end to end.
  (b) **partial**: `/platform/entitlements` takes the user access token and the daemon proxies it
  (`RUYIN_PLATFORM_API_BASE`). Still the platform's to provide: a base reachable from the user's
  device (as of 2026-09-02 `api.vxture.com` does not route platform-api) and an endpoint listing
  *all* subscriptions of the current workspace - C2 only answers for ids the client already knows.
  Tracked on the workplan's MVP journey table.
  (c) **withdrawn**: ADR-009 (2026-08-31) routes capability calls through the business product's
  own cloud service, which holds the Atlas credentials - no platform change needed, and metering
  stays server-side at Atlas as this letter asked. Nothing left here for the platform line.
- 阻塞关系: **(c) 阻塞 W3**（Bid 单产品可用的真实 AI 调用）；(a)(b) 阻塞 W6（身份完整链）。
  W3 的上下文/索引/选择部分不受阻，已并行开发（mock gateway）

## Context

Ruyin 桌面端与 Web 产品仓的对接形态不同（`30-design/70-repo-organization.md` §2）：
无服务端进程，故 RP 五端点 / C3 webhook 均不适用；一切平台交互由用户设备上的
Runtime 守护进程以用户身份发起。设计权威: `30-design/40-context-architecture.md` §9。

## Request (platform line) —— 三件

### (a) OIDC 原生客户端注册（public client）

- 为 ruyin 注册 **public client**（无 client_secret——桌面分发的二进制装不下秘密）:
  Authorization Code + **PKCE S256**，redirect URI 为 loopback 形式
  `http://127.0.0.1:{port}/oauth/callback`（RFC 8252；port 任意高位口）
- 双客户端惯例照旧: `ruyin` / `ruyin-beta`
- token 端点需支持 refresh；期望的离线语义: 短期 access token + refresh，
  设备可远程吊销，离线宽限期内本地功能可用（宽限期时长平台可配，建议 7–30 天）

### (b) Entitlement 原生消费口径

- 桌面 Runtime 以**用户 access token** 直接调 entitlement 查询（现契约 C2 面向
  服务端 S2S/内部头，桌面端无此凭证）——请确认: 现有
  `/platform/entitlements` 是否接受终端用户 token？若否，需要一个
  user-token 口径或 token exchange 路径
- 消费不落库、45s TTL 缓存等纪律照 product_220 §3 在客户端同样遵守

### (c) AI Gateway 端点契约与服务端计量（阻塞 W3）

- Runtime 一切 AI 能力调用经 **Vxture AI Gateway** 单点（`30-design/60` T10），
  需要: 端点形态（建议 SSE 流式 + 结构化输出）、鉴权（用户 token）、
  capability 语义（产品契约声明能力 id，Gateway 侧解析到模型——契约禁止
  绑定模型，R6）
- **计量口径反转**: 桌面客户端不可信，ai.credit 类 counter 用量应在
  **Gateway 服务端计量**（请求即事实），产品侧 C3 缓冲上报对 ruyin 不适用
  ——请平台确认此口径并纳入 Gateway 设计
- **推理不持久化承诺**: 本地上下文经推理传输属临时数据流动
  （`30-design/10-workspace-runtime.md` §15.2「推理传输 ≠ 数据存储」），
  请确认 Gateway 推理端点的 no-persistence 语义，使客户端审计事件中的
  `persistence: none` 字段有实义（04 §7.3）

## 优先级建议

(c) > (a) > (b)。(c) 有最小可用形态即可解锁 W3 端到端（一个能力调用端点 +
用户 token 鉴权即可，计量与流式可迭代）。
