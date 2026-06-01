# ruyin-server（@vxture/agent-server-ruyin）

> ⚠️ 待大版本重构 | 内容待核查补充
> 架构层参考：[`docs/architecture/06-agent-server.md`](../../architecture/06-agent-server.md)
> 产品规格：[`docs/product/agents/ruyin/spec.md`](../../product/agents/ruyin/spec.md)

---

## 包信息

| 项     | 值                                     |
| ------ | -------------------------------------- |
| 包名   | `@vxture/agent-server-ruyin`           |
| 路径   | `agent-server/ruyin/`                  |
| @layer | `Application` / `Domain`（agent 私有） |
| 端口   | 3112                                   |

## 当前状态

🟡 **运行中**（server 端），`agent-studio/ruyin` 和 `bff/ruyin-bff` 建设中。

## 已知特性

- 使用 BullMQ（Redis）处理异步任务队列
- 依赖 `@vxture/ai-gateway-client` 进行 LLM 调用
- 与 AI Gateway（端口 3100）通信

## 依赖约束

**允许：**

- `@vxture/ai-gateway-client` / `@vxture/service-billing` / `@vxture/service-subscription`
- `@vxture/core-*` / `@vxture/shared`
- NestJS / BullMQ / `@prisma/client`

**禁止：**

- 其他 `agent-server/*`（ruyin 独立治理）
- `bff-*` / `design-system` / `platform-*` / React / Next.js

## 架构设计

**异步任务模式**（区别于 vela-server 的同步 Tool Use Loop）：

```
ruyin-bff → Redis BullMQ → ruyin-server（Worker）
                                │
                        ai-gateway（LLM 调用）
                                │
                        ruyin-postgres（结果持久化）
```

- BullMQ Worker 消费队列任务，完成后 ruyin-bff 轮询结果
- AI Gateway 调用走 HTTP，地址从 `core-config` 读取（`AI_GATEWAY_URL`）
- Prisma schema 与 platform_main 完全隔离，独立数据库实例

## 待补充（需代码核查）

- 已实现的核心任务类型（JobType 枚举）
- AI Gateway 接口协议（请求/响应格式）
