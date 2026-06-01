# Ruyin Agent 产品规格

> 版本：0.1.0 | 更新：2026-05-11
> 状态：🟡 server 端运行中，agent-studio 待建设
> 技术文档：[`docs/packages/agents/ruyin/server.md`](../../../packages/agents/ruyin/server.md) · [`docs/packages/bff/ruyin.md`](../../../packages/bff/ruyin.md)

---

## 定位

Ruyin（入音）是 Vxture 平台的**文档智能 Agent**，运行在独立域名 `ruyin.ai`，面向终端租户用户提供对话式文档分析能力。

| 维度     | 说明                                       |
| -------- | ------------------------------------------ |
| 目标用户 | 租户下的普通用户（非管理员）               |
| 核心场景 | 文档上传 → 解析 → 对话式问答 / 摘要 / 分析 |
| 交互模式 | 会话式（session）+ 异步任务（task）        |
| 域名     | `ruyin.ai`（独立于 `vxture.com`）          |

Ruyin 与 Vela 的核心差别：Vela 是**同步 Tool Use Loop**（管理员 / 租户管理操作），Ruyin 是**异步工作流**（文档分析任务，处理时间较长）。

---

## 三层架构

```
agent-studio/ruyin     ← 前端（⏳ 建设中）
        │ HTTP / WebSocket
bff/ruyin-bff          ← 应用层代理（port 3111）
        │ HTTP
agent-server/ruyin     ← AI 执行层（port 3112）
     │         │
ai-gateway    ruyin-postgres
（LLM 调用） （会话 + 文档持久化）
```

- **bff/ruyin-bff**：鉴权 + 路由代理，不持有 AI 逻辑
- **agent-server/ruyin**：会话管理、向量存储、工作流调度、LLM 调用
- **ruyin-postgres**：独立数据库容器（`vx-ruyin-pg`），不与 platform_main 共享

---

## 会话模型

Ruyin 以**会话（Session）**为核心单位组织对话。

| 字段        | 说明                             |
| ----------- | -------------------------------- |
| `sessionId` | 会话唯一 ID                      |
| `userId`    | 归属用户                         |
| `tenantId`  | 归属租户                         |
| `config`    | 会话配置（模型参数、文档 ID 等） |

**消息类型：**

| type       | 说明                   |
| ---------- | ---------------------- |
| `text`     | 普通文本消息           |
| `image`    | 图片内容               |
| `document` | 文档引用               |
| `action`   | 执行指令（触发工作流） |

---

## 异步任务模式

发送消息后，服务端返回 `requiresAsync: true` 时，前端需轮询任务状态：

```
POST /api/session/:id/message
  → { requiresAsync: true, taskId: "..." }

GET  /api/session/:id/task/:taskId/status
  → { status: 'pending' | 'running' | 'completed' | 'failed', progress, result }
```

任务状态由 `WorkflowTask` 模型跟踪，存储在 ruyin-postgres。

---

## 已实现工作流

| 工作流                     | 说明                     | 状态             |
| -------------------------- | ------------------------ | ---------------- |
| `DocumentAnalysisWorkflow` | 文档解析 + 向量化 + 问答 | ✅ server 端实现 |

工作流步骤：输入预处理 → LLM 调用（via ai-gateway）→ 结果持久化 → 返回。

---

## BFF 路由

| 路由                       | 方法 | 功能                                       |
| -------------------------- | ---- | ------------------------------------------ |
| `/api/session`             | POST | 创建会话                                   |
| `/api/session/:id/history` | GET  | 获取消息历史                               |
| `/api/session/:id/message` | POST | 发送消息（可能触发异步任务）               |
| `/api/auth/callback`       | GET  | 跨域 SSO 接收一次性 token                  |
| `/api/auth/logout`         | POST | 登出（清 ruyin.ai Cookie + 通知 auth-bff） |
| `/api/crossdomain/*`       | —    | 跨域认证辅助端点                           |

---

## 跨域认证

Ruyin 运行在 `ruyin.ai`，与 `vxture.com` 跨域。SSO 流程委托 `auth-bff` 完成：

```
用户点击「进入 Ruyin」
  → console 生成一次性 token，跳转 ruyin.ai/auth/callback?token=…
  → ruyin-bff 调用 auth-bff 验证 token
  → auth-bff 在 ruyin.ai 域签发 ry_* Cookie
  → 进入 Ruyin 会话
```

ruyin-bff **不签发 JWT**，JWT 签发唯一入口为 auth-bff。

---

## 向量存储

`vector.storage.ts` 提供语义检索能力，支持文档段落的向量化存储与相似度查询。具体实现（向量数据库类型、维度）待核查。

---

## 实施进度

| 组件                 | 状态                                                      |
| -------------------- | --------------------------------------------------------- |
| `agent-server/ruyin` | ✅ 核心实现（会话 / 消息 / 工作流 / 向量存储）            |
| `bff/ruyin-bff`      | 🟡 基础路由已完成（session / auth / crossdomain），待联调 |
| `agent-studio/ruyin` | ⏳ 未建设（前端 UI 待设计）                               |
| Prisma schema        | ⚠️ 待核查（独立 ruyin-postgres 实例）                     |

---

## 待确认事项

| 问题                                                     | 优先级 |
| -------------------------------------------------------- | ------ |
| `agent-studio/ruyin` 前端框架选型（Next.js / React SPA） | P1     |
| 文档支持格式（PDF / Word / TXT / Markdown）              | P1     |
| 向量数据库具体实现（pgvector / 独立向量库）              | P1     |
| 任务轮询 vs WebSocket 实时推送决策                       | P2     |
| 多会话管理 UI 设计                                       | P2     |
