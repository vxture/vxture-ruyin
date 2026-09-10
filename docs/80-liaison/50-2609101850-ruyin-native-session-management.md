# Liaison request: accounts 补齐原生客户端的会话管理（三件同源）

- Stamp: 2609101850 (2026-09-10 18:50)
- From: ruyin line
- To: platform line (owns accounts / identity infrastructure)
- Status: **open** — 2026-09-10 提出
- 关联: 本仓 `30-2607241450-ruyin-native-client-integration.md`（L3(a) 已 met）的**后续**；
  ADR-021 §5（归属判定）、TD-057
- 阻塞关系: 阻塞**「退出登录」在用户那里成立**。不阻塞任何开发工作 ——
  ruyin 侧能做的已全部做完并发布

## 0. 一句话

**登录已经通了（L3(a) 2026-08-31 met），但登进来之后这个会话没人管。** 三件事同源，
都在 accounts 的原生客户端这一档，建议一起做。

## 1. 起因：一次干净的实测（owner，2026-09-10）

桌面应用里点「退出登录」之后再点登录，**一路直接进来，没有任何验证过程**。

测法隔离了变量：

1. 先在浏览器里把 Vxture **全部手动登出**
2. 登录桌面应用 —— **第一次有验证**（此时没有 IdP cookie）
3. 在应用里退出登录 —— 成功（本机令牌清除 + `revocation_endpoint` 吊销 refresh token）
4. 浏览器里 `vxture.com` **仍是登录态**（这一条符合预期，见 §4）
5. 再点登录 —— **静默直入，零交互**

## 2. 三件请求

### (1) 登录流兑现 `prompt`（至少 `select_account` 与 `login`）

ruyin 的 authorize 请求**已经带着** `prompt=select_account`
（`apps/local-host/src/platform.ts` `beginLogin()`，v0.1.0 起随发布出去）。平台侧未兑现。

**实测证据**（2026-09-10，生产 `accounts.vxture.com`，未登录状态）：

| 请求 | 回应 |
|---|---|
| `authorize`（不带 prompt） | `302 → /login?login_challenge=54bb832d…&realm=customer` |
| `authorize&prompt=select_account` | `302 → /login?login_challenge=e29683dd…&realm=customer` |
| `authorize&prompt=login` | `302 → /login?login_challenge=9b8075ab…&realm=customer` |
| `authorize&prompt=bogus_value` | `302 → /login?login_challenge=b4039949…&realm=customer` |

四种**逐字相同**，没有 `invalid_request`。**连 `bogus_value` 都照单全收** —— 这说明这个
参数根本没被读，而不是「读了但这个值不支持」。

discovery 也没有公布 `prompt_values_supported`（可选字段，缺席本身不构成结论，
所以我们没有据此推断，而是实测）。

**验收**：桌面应用里退出登录 → 再点登录 → **出现账号选择屏或登录屏**。

### (2) `end_session` 兑现 `post_logout_redirect_uri`

**实测证据**（同日）：

| 请求 | 回应 |
|---|---|
| `end_session`（裸调） | `302 → /logout` |
| `end_session&post_logout_redirect_uri=<ruyin 的回环地址>&client_id=ruyin` | `302 → /logout` |
| `end_session&post_logout_redirect_uri=<一个乱写的地址>&client_id=ruyin` | `302 → /logout` |

三种逐字相同 —— 同样是参数没被读。

**后果**：「换个账号」这条路**接不成自动链**。ruyin 只能做成两步（用户点开链接 →
在浏览器里退出 → 回到应用再点登录），并在界面上明说第二步是什么，否则用户会在
浏览器里退完站着等它自己回来。

**请求**：对**已登记的** loopback redirect（`http://127.0.0.1:{port}/...`，RFC 8252 §7.3
端口不比对，与 L3(a) 已落地的 authorize 口径一致）接受 `post_logout_redirect_uri`。

### (3) 设备列表与远程吊销

**这一条 L3(a) 2026-07-24 就写过**，原文：「期望的离线语义：短期 access token +
refresh，**设备可远程吊销**，离线宽限期内本地功能可用」。(a) 的其余部分都 met 了，
这半句至今没有。

**请求**：账号侧能看见「哪些设备登录着」，并能单独吊销一台。ruyin 这一侧不需要新
接口 —— refresh 被拒即自行登出（`ensureAccessToken()` 里已实现并测过）。

## 3. 为什么建议一起做

discovery 已经公布 `backchannel_logout_supported: true` 与
`backchannel_logout_session_supported: true` —— **平台有会话管理这套底子**。三件缺的
是把它接到原生客户端这一档上，不是架构上没有。分三次提，对面会当成三个小需求；
合起来它是一个能一次做完的模块。

## 4. 明确**不**请求的事

**不要求「桌面应用退出时，浏览器里的 Vxture 也退出」。**

这是有意的。IdP 会话是**浏览器级、跨应用**的资产，因为退出一个桌面应用就把它杀掉，
等于顺手登出这台机器上同账号的所有网站和应用 —— 那是个比「没退干净」更意外的
副作用。行业默认（Slack / Zoom / Office / Figma / Discord / GitHub Desktop）也是
只退本地。

ruyin 的 `logout()` **绝不调用 `end_session`**，且这一条被用例钉住：它既断言退出打了
`/revoke`，也断言退出**没有**打 `/end_session`。

真正该拦一下的是**下一次登录那一屏** —— 那正是 (1)。

## 5. ruyin 侧已做完的（不必等我们）

| | |
|---|---|
| authorize 带 `prompt=select_account` | 已发布；平台哪天兑现，它自己就开始生效 |
| 退出后整个界面回登录页 | 此前只有侧栏那一格退了（TD-056，已修） |
| 登录页说明当前状态 | 「浏览器中若已登录 Vxture，会直接用那个账号继续」 |
| 「先在浏览器里退出 Vxture ↗」入口 | 平台没公布 `end_session_endpoint` 就不给这个入口 |
| `logout()` 吊销 refresh token | 打 `revocation_endpoint`，best effort |

**说清楚不能代替验证。** 我们把能说的都说了，剩下那一屏只有 accounts 画得出来。

## 优先级建议

**(1) > (3) > (2)。**

(1) 是 owner 直接报的问题，也是三件里最小的一件；(3) 是安全侧的实际缺口，且早已
承诺；(2) 只影响「换账号」是一步还是两步，两步现在能走通。
