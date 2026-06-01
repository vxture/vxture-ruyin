# @vxture/ruyin（Agent Studio）

> 架构层参考：[`docs/architecture/06-agent-server.md`](../../architecture/06-agent-server.md)

---

## 包信息

| 项     | 值                                                           |
| ------ | ------------------------------------------------------------ |
| 包名   | `@vxture/ruyin`                                              |
| 路径   | `business/ruyin/`（注意：在 business/ 层，非 agent-studio/） |
| @layer | `Presentation`                                               |
| 端口   | 3110                                                         |
| 框架   | Next.js                                                      |

## 职责

Ruyin 智能体独立应用（非嵌入式，独立部署）。面向终端用户提供 Ruyin Agent 的交互界面，包括任务提交、进度查看、结果展示。

> 注意：本包是 Vxture 内的 Ruyin Agent UI，使用 `3110`。独立 ruyin.ai 网站属于外部项目，本地端口 `3210/3220/3281` 由外部项目预留，Vxture 不占用。

## 外部 ruyin.ai 网站接口要求

外部 ruyin.ai 网站与本包不是同一个应用。对接 Vxture SSO 时，外部网站只依赖 Console SSO start 入口和服务端 token 交换，不依赖 Vxture 内部 Agent UI 端口。

| 项                  | 本地要求                                           | 说明                                 |
| ------------------- | -------------------------------------------------- | ------------------------------------ |
| 预留端口            | `3210`、`3220`、`3281`                             | Vxture 本地服务不得占用              |
| SSO callback origin | `http://localhost:3220`                            | 已加入 Console SSO dev 白名单        |
| SSO start           | `http://localhost:3020/{locale}/sso/start?ctx=...` | `{locale}` 通常为 `zh-CN`            |
| ctx.from            | `ruyin`                                            | Console 侧据此选择 ruyin SSO 策略    |
| ctx.returnTo        | `http://localhost:3220/...`                        | Vxture 会追加 `token` 和可选 `state` |
| token 交换          | 服务端/BFF 完成                                    | 浏览器不得直接调用内部 verify/sign   |

`ctx` 使用 URL 查询参数承载，字段要求与 `@vxture/shared` 的 `PortalNavContext` 一致：

```json
{
  "from": "ruyin",
  "returnTo": "http://localhost:3220/auth/callback",
  "caller": "ruyin.ai",
  "state": "opaque-client-state"
}
```

Vxture Console 校验 `returnTo.origin` 后，会重定向到：

```text
http://localhost:3220/auth/callback?token={oneTimeToken}&state={state}
```

外部网站收到 `token` 后必须交给服务端/BFF 处理。若复用 Vxture 当前 Ruyin BFF，相关接口为：

| 方法 | 路径                        | 用途                        |
| ---- | --------------------------- | --------------------------- |
| GET  | `/api/auth/callback?token=` | 校验一次性 token 并建立会话 |
| GET  | `/api/auth/session`         | 查询 ruyin 会话             |
| POST | `/api/auth/logout`          | 登出并清理 ruyin Cookie     |

## 依赖约束

```typescript
✅ @vxture/design-system / @vxture/shared / @vxture/core-locale
✅ ruyin-bff（HTTP only）
❌ @vxture/ai-gateway-client / agent-server/* / @vxture/service-*
```

## 关联包

| 包                    | 关系                                 |
| --------------------- | ------------------------------------ |
| `agent-studio/ruyin/` | Ruyin 前端（另一个入口，待确认定位） |
| `agent-server/ruyin`  | Ruyin 后端（BullMQ 异步任务）        |
| `bff/ruyin-bff`       | Ruyin BFF（HTTP 中间层）             |

## 路径说明

| 路径                          | 定位                                                                  |
| ----------------------------- | --------------------------------------------------------------------- |
| `business/ruyin/`（本包）     | **独立部署**的 Ruyin 应用，面向最终用户，独立域名（ruyin.vxture.com） |
| `agent-studio/ruyin/`（待建） | **嵌入式** Studio，供 console 内嵌使用（参考 vela-studio 模式）       |

两者均属于 Presentation 层，通过 ruyin-bff HTTP 接入，不共享代码。

## 待实施

- 已实现页面列表（任务提交 / 进度查看 / 结果展示）
