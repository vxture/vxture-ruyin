# @vxture/bff-ruyin

> ⚠️ 待大版本重构 | 迁移自 `bff/ruyin-bff/AGENTS.md`
> 架构层参考：[`docs/architecture/05-bff-layer.md`](../../architecture/05-bff-layer.md)

---

## 包信息

| 项       | 值                                          |
| -------- | ------------------------------------------- |
| 包名     | `@vxture/bff-ruyin`                         |
| 路径     | `bff/ruyin-bff/`                            |
| @layer   | `Application`                               |
| 服务对象 | `agent-studio/ruyin` ↔ `agent-server/ruyin` |
| 端口     | 3111                                        |

## 职责

Agent BFF，桥接前端和 agent 后端：

```
agent-studio/ruyin → bff/ruyin-bff → agent-server/ruyin（HTTP）
                                    → @vxture/service-*
```

## 跨域 SSO（v1.4）

本 BFF **不签发 JWT**。跨域登录委托 `@vxture/bff-auth` 完成：

- `GET /api/auth/callback?token=` 接收一次性 token
- 调用 auth-bff `POST /auth/crossdomain/verify` 验证
- 验证通过后调用 auth-bff `POST /auth/internal/sign` 在 ruyin.ai 域签发 Cookie
- `POST /api/auth/logout` 先清 ruyin.ai 本域 `ry_*` Cookie，再通知 auth-bff

## 依赖约束

**允许：**

- `@vxture/core-auth` / `@vxture/core-tenant` / `@vxture/core-config` / `@vxture/core-*`
- `@vxture/shared`
- `@vxture/service-billing` / `@vxture/service-subscription`
- NestJS / class-validator

**禁止：** `@vxture/ai-gateway-client` / 直接 import `agent-server/ruyin` 代码（只 HTTP）/ `design-system`

## Agent BFF 专有约束

- agent-server 地址通过 `@vxture/core-config` 读取，不硬编码
- AI 流式输出使用 SSE 在 router 层转发，不在 aggregator 处理
- agent-server 通信失败时独立处理，不影响 service-\* 路由
