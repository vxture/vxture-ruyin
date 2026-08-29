# Liaison request: L3 补充——原生客户端登记三处实测卡点（L3-s1）

- Stamp: 2608301530 (2026-08-30 15:30)
- From: ruyin line
- To: platform line (owns identity / entitlement infrastructure)
- Status: open - awaiting platform-line action
- 关联: 本仓 `30-2607241450-ruyin-native-client-integration.md`（L3）的补充；
  三项均有**对生产端点的实测证据**（2026-08-30），非推测
- 阻塞关系: 阻塞 **C1 登录闭环**（ruyin 侧代码已就绪并合入：daemon PKCE 客户端、
  loopback 回调、RS256 验签、DPAPI 会话密封，见 `apps/local-host/src/platform.ts`）

## 实测现状（accounts.vxture.com，2026-08-30）

| 探测 | 结果 | 结论 |
|---|---|---|
| `GET /.well-known/openid-configuration` | 200，PKCE S256 / refresh_token / token-exchange 均在 | 发现面就绪 |
| `authorize?client_id=ruyin&redirect_uri=http://127.0.0.1:7420/oauth/callback` | `400 invalid_redirect_uri` | **client 已注册，回调未登记** |
| 同上，127.0.0.1 其它端口 / localhost / `/callback` / 自定义 scheme | 全部 `400 invalid_redirect_uri` | 无 loopback 白名单 |
| `authorize?client_id=ruyin-beta` | `400 invalid_client` | **ruyin-beta 未注册** |
| discovery `token_endpoint_auth_methods_supported` | 仅 `client_secret_basic` / `client_secret_post` | **未声明 `none`**（public client 换票口径存疑） |
| `api.vxture.com/platform/entitlements`（含各前缀变体） | `404 Gateway route not found` | **权益 API 无桌面可达路由** |

## Request (platform line) —— 三件

### (1) ruyin client 登记 loopback 回调（阻塞登录闭环）

- 为 `ruyin` 登记 redirect URI `http://127.0.0.1:{port}/oauth/callback`，
  **按 RFC 8252 §7.3 对 loopback 地址忽略端口比对**（桌面端口不可预留：
  开发 7420 / smoke 17420 / 将来可配）。若平台实现只支持精确匹配，请告知
  并至少登记 `7420` 与 `17420` 两个值作为过渡。
- 同时确认 token 端点对 public client 接受 `token_endpoint_auth_method=none`
  （授权码 + PKCE、无 client_secret；discovery 当前未声明 `none`）。
  客户端零机密是桌面分发硬规则，confidential 口径对 ruyin 不可用。

### (2) 注册 `ruyin-beta` public client

- 双客户端惯例（通则 C1：prod / beta 各一）落地 beta 渠道所需；
  参数同 `ruyin`，仅 client_id 与回调登记独立。

### (3) 权益 API 的桌面可达基址（L3(b) 收口）

- 请给出桌面 Runtime 以**用户 access token** 调用 `/platform/entitlements`
  的公网/边缘基址（tailnet 内网口径对最终用户设备不可达）。
- ruyin 侧已按 45s TTL / 不落库纪律实现完毕，基址以
  `RUYIN_PLATFORM_API_BASE` 注入即通，无需等发版。

## 优先级建议

(1) > (3) > (2)。(1) 就绪当日登录闭环即可演示；(2) 仅影响 beta 渠道。
