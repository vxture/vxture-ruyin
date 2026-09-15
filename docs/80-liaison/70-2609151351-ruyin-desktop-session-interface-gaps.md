# Liaison request: console-bff 补齐桌面会话够得着的三个接口（切换租户 / 工作区、退出、能力目录清单）

- Stamp: 2609151351 (2026-09-15 13:51)
- From: ruyin line
- To: platform line (owns console-bff / Runos catalog exposure)
- Status: **open** — 2026-09-15 提出（owner 同意开 issue）
- 关联: 本仓 ADR-020 §6.2（能力清单，owner 2026-09-15）；TD-063 / TD-064 / TD-065；
  `50-2609101850-ruyin-native-session-management.md`（vxture-platform#271）；
  vxture-platform#264 / #297 / #306
- 阻塞关系: A 阻塞「有多个租户或工作区的用户在桌面上切到非默认工作区」；B 阻塞
  「退出登录在服务端成立」；C 阻塞 ADR-020 §6.2 能力清单落地。**三件都不阻塞**现有登录
  与默认工作区内的工作
- 核实基线: vxture-platform origin/main `9b814c97`、vxture-runos origin/main `bd26817a`
  （2026-09-15 读码）。除注明「实测」者外，均为读码结论

## 0. 一句话

#297 让桌面和浏览器走上了同一条会话路径 —— 读请求带 `X-Vxture-Session` 就进得去 `api/*`。
但**会话之外那几件事的入口仍然只认 cookie，或只对运营者开**：切租户 / 切工作区、退出、
看能力目录。三件缺的都是**桌面环境这一侧的接口** —— 浏览器那一侧三件都有，底子在。

## 1. 基线：今天桌面会话怎么走（读码核实）

路径均相对 vxture-platform `bff/console-bff/src/`。

| 步 | 端点 | 位置 |
|---|---|---|
| 登录 | 系统浏览器打开 `GET https://console.vxture.com/auth/login?surface=native&handle=…` | `routers/oidc-auth.router.ts:138-187` |
| 领取 | `POST /auth/native/claim` → `{rpsid, expiresInSec}` | `routers/native-auth.router.ts:132` |
| 读 | 任意 `api/*` 带 `X-Vxture-Session: <rpsid>` | `middleware/auth.middleware.ts:73-83`：`cookie ?? header` |

## 2. 三件请求

### A. 桌面会话切换租户 / 工作区，并能读到会话真正的当前工作区

**事实**

- `GET /auth/switch-tenant`（`routers/tenant-switch.router.ts:75-135`）与
  `GET /auth/switch-workspace`（`:152-219`）是 `@Public` 的顶层浏览器跳转；rpsid **只从
  cookie 读**（`:88`、`:165`），结束时**设浏览器 cookie**。桌面会话走不进去，也拿不回结果。
- `/auth/login` 不收租户 / 工作区提示（`oidc-auth.router.ts:138-187`，入参只有
  `returnTo` / `prompt` / `surface` / `handle`）—— 所以也没法「带着目标重新握手一次」。
- `api/*` 下没有切换端点。**能列不能切**：`GET /api/tenant-context/options`
  （`routers/tenant-context.router.ts:34-41`）header 会话可达。
- **读到的也不准**：`GET /api/tenant-context` 返回的是**租户的默认工作区**，不是令牌里的
  `active_workspace`（TenantMiddleware 不传工作区提示；`aggregators/session.aggregator.ts:554-563`）；
  `/api/subscription/*` 一律走 `resolveDefaultWorkspace`（`routers/subscription.router.ts:1692-1703`）。
  **没有任何 header 可达的办法读到 `active_workspace`。**

**后果**：桌面会话被钉在登录时解析出的租户、以及该租户的默认工作区上。ruyin 里项目
必须归属工作区（ADR-015），工作区由平台定义（ADR-007）—— 有多个租户或多个工作区的
用户，在桌面上只能在默认那一个里干活，订阅信息也只按默认工作区给。

**ruyin 需要**

1. 桌面会话能切换租户、切换工作区（切完 rpsid 不变或换发都行，只要桌面端拿得到结果）；
2. 桌面会话能读到**本会话真正的** active tenant / active workspace；`/api/tenant-context`
   与 `/api/subscription/*` 按它给，而不是按默认工作区给（或给出明确的另一种读法）。

**形状建议（仅供参考，设计归平台）**：`POST /api/session/switch {tenantId?, workspaceId?}`，
cookie 或 header 会话皆可，返回切换后的上下文；或让 `/auth/login` 接受 `tenantId` /
`workspaceId` 提示，桌面端重走一次原生握手。前者对用户零跳转，后者复用现有握手。

### B. 桌面会话的退出

**事实**

- `GET /auth/logout` 与 `GET /auth/switch`（`oidc-auth.router.ts:345`、`:355`，共用
  `endCentralSession`，rpsid 在 `:329` 读）**只从 cookie 读 rpsid**；
- console-bff 里**没有 `POST /auth/logout`**，只有 `@Get("logout")`；
- header 会话能被销毁的途径只剩 `DELETE /api/me/sessions/:sid`（`routers/me.router.ts:288`）
  或 backchannel logout。

ruyin 今天退出时打的是 `POST {console}/auth/logout`，带 `X-Vxture-Session`
（vxture-ruyin `apps/local-host/src/platform-session.ts:99`、`:378-388`）。按上面三条，
**这一下销毁不了服务端那条 RP 会话** —— 方法对不上路由，就算对上也读不到 header。本机
那份清掉了，服务端那份活到过期。（生产上这一下具体返回什么，没实测。）

**ruyin 需要**：一个桌面会话可调的退出端点，销毁这条 RP 会话（连同服务端替它持有的令牌）。

**形状建议**：`POST /auth/native/logout`，带 `X-Vxture-Session`，幂等，成功 204。

**IdP 中央会话结不结束，由平台按策略定。** 提醒一条既有立场，免得两封函互相打架：
50 号函（#271）§4 明确**不请求**「桌面退出时浏览器里的 Vxture 也退出」—— IdP 会话是
浏览器级、跨应用的资产。平台若定 native logout 也结束中央会话，请在答复里写明，ruyin
界面上的说明文字要跟着改。

**旁问**：如果平台的意图是桌面端用 `DELETE /api/me/sessions/:sid` 自删，请告诉我们桌面端
怎么知道自己的 `sid`（claim 只回 `rpsid` / `expiresInSec`）。

与 #271 的关系：#271 是 accounts（IdP）那一层的原生会话管理；本条是 console-bff（RP）
这一层。同源不同层，分开记。

### C. 能力目录清单：桌面会话可读的 console-bff 端点

**起因**：owner 2026-09-15 定 —— Ruyin 本地要保有一份与平台 Runos 能力目录一致的**清单**
（ruyin ADR-020 §6.2）。清单不是安装；调用路径不变（Runos 能力仍经平台 / 产品云端换票
到达，#264）；Ruyin 不据此判权益。**权威在平台，所以取法只能是平台端点。**

**事实：今天没有桌面会话够得着的取法**

- console-bff 没有列 Runos 能力的路由（`bff/console-bff/src` 里 git grep runos / registry /
  catalog：无）；`/api/capabilities`（`routers/capabilities.router.ts:21`）返回的是治理权限码。
- Runos 管理面 `GET /capability/capabilities`（vxture-runos
  `service/src/registry/registry.controller.ts:47-77`）：`OperatorAuthGuard`（workforce 运营者，
  `mgmt:runos`）。
- Runos 消费面 `runos_discover`（`POST /v1/mcp`）：S2S `aud=runos`
  （`service/src/gateway/s2s-auth.guard.ts:50-137`）—— 桌面 public client 永不持有（#264 平台答复）。
- opera-bff / admin-bff 的代理（vxture-platform `bff/opera-bff/src/routers/runos.router.ts:439,568,607`）：
  只对运营者。

**Runos 侧已有的分页形状（可以直接沿用）**

| 面 | 分页 | 响应 |
|---|---|---|
| 管理面 | `cursor` + `limit`（服务端钳制，上限 1000）+ `dir` | `{items, nextCursor, prevCursor, total}` |
| 消费面 `runos_discover` | `cursor` + `limit`（1..5000） | `{total, next_cursor, capabilities: [{capability_id, title, display_name, primitive_type, …}]}` |

规模：预置台账 877 个 `capabilityId`（`deploy/preset/ledger.json` @ `bd26817a`）；生产
2026-09-13 实测 886 行（#306）。按 A-3 / #306，这张表要 cursor 分页。

**ruyin 需要**：console-bff 上一个**会话鉴权**（cookie 或 `X-Vxture-Session`）的只读端点，
返回能力目录清单：

- cursor 分页 + `total`；
- 每条至少：`capability_id`、`title`、`display_name`、`primitive_type`、`category`、`tags`；
- 可选但很有用：目录版本或 `ETag`（`If-None-Match` → 304），桌面端据此判断「是否仍一致」，
  不必每次全量翻页。

**不需要**：`inputSchema` / 完整契约、技能正文、凭证需求、端点实例、按用户算出的权益结论
（Ruyin 不拿它做判定；平台若按可见性过滤条目，写明规则即可）。

**形状建议**：`GET /api/runos/capabilities?cursor=&limit=`，或并入平台已有的「平台有什么」
全量目录面（#264 答复里提到的那一层）—— 放哪归平台。

## 3. 明确**不**请求的事

- 不请求 Ruyin 直连 Runos，也不请求任何形状的下游令牌（#264 已定，ruyin 接受）。
- 不请求平台替 Ruyin 判「这个用户能用哪些能力」—— Ruyin 的门控只到产品级（ADR-006），
  清单只是列表。
- B 不请求结束浏览器里的 IdP 会话（见 B 末段）。

## 4. ruyin 这一侧

| | 现状 / 接上之后 |
|---|---|
| A | 无可绕：切换只能在平台做。ruyin **不在本地模拟切换** —— 本地另存一个 active workspace 就是第二份事实。接口就位后守护进程接上切换，读取按真实工作区 |
| B | 本机那份已清（`signOutLocal()`）。端点就位后 `PLATFORM_PATHS.logout` 改指它，并加用例断言带 header 打到新端点 |
| C | 口径已定（ADR-020 §6.2）。端点就位前**不实现**，也不从构建产物推导一份代替 —— 权威不在本仓 |

## 优先级建议

**B > A > C。**

B 是安全侧的：用户以为退出了，服务端那条会话还活着。A 挡住的是一整类用户（多租户 /
多工作区），且读到的工作区与会话不符是静默的。C 是新能力的前提，不影响已有功能。
