# ADR-001 能力调用通路：Ruyin 不直连 Atlas

- 状态：已接受
- 日期：2026-08-31
- 相关：30-design/50-harness.md §4、30-design/30-contract-schema.md、
  平台《产品接入通则》（C1b S2S、Atlas 章、十个坑之八）

## 背景

Harness 的能力调用当前是 `MockAIGateway`，返回固定字符串。要换成真实推理，
必须先确定「能力解析到哪」。

三条已核实的事实：

1. Atlas `POST /v1/chat` 是回合制生成端点（`stream:true` 走 SSE）。
2. 通则原文：Atlas 的产品身份取自**校验后 token 的 `act.sub`，永远不是查询
   参数**。
3. 拿到 `act.sub` 需要 S2S token-exchange，而 token-exchange 需要
   `client_secret`；平台侧明令禁止 public client 走 token-exchange
   （该约束由本仓在平台 PR 中实现）。

Ruyin 是 RFC 8252 原生／public client，且本仓硬规则是**客户端零密钥**
（shipped client contains ZERO secrets）。

## 决策

**Ruyin 不直连 Atlas。** 契约声明的能力解析到**业务产品自己的云端服务**，
由该服务持 confidential 凭据换 `act.sub` 调 Atlas。

```text
Harness（本地，持循环）
  └─ Capability Resolver ─→ 业务产品云端服务（持 client_secret）
                                └─ S2S 换票 act.sub=产品码 ─→ Atlas /v1/chat
                                     └─ Atlas 统一上报推理用量（C3）
```

Ruyin 是调用方，不是执行点。

## 后果

- **用量不由 Ruyin 上报。** 通则「谁执行谁上报」＋「AI 推理用量由 Atlas 统一
  上报，其他 provider 不重复计」。Ruyin 报了就是账单翻倍。
- **契约不带提供方，这是原则不是漏。** 初稿曾判定「契约缺解析字段」，**该判定被
  R6 推翻**：`capabilities` 不得出现模型／Provider 绑定键（03 Principle 4，schema
  以 `additionalProperties: false` 结构性强制）。契约只声明能力的**语义**
  （`id` + `kind`），由谁实现是 Runtime 的事。
- **因此缺的是 Capability Resolver 本身，不是契约字段。** 解析输入用契约里已有的
  `product.id` + capability id；提供方基址由 Runtime **单点配置**，不进契约
  （亦符合通则「不得成为第二处存放主机名的地方」）。**无需改契约。**
- 基址从哪来仍待定：Runtime 配置 / 平台随订阅下发 / 约定式推导。见《能力登记册》。
- **与 Atlas 授权模型自洽。** Atlas 授权给业务 agent，Ruyin 从来就不该出现在
  Atlas 的调用方名单里。
- 目标接口形态是通用回合制推理，因此 §5 的本地重构不必等通路落地。

## 备选方案

| 方案 | 为什么不取 |
|---|---|
| Ruyin 直接持 `client_secret` | 违反客户端零密钥硬规则——secret 会随安装包分发给每个用户 |
| 登记 `AUTH_INTERNAL_TOKEN` 式共享口令 | 通则明确：只为存量兼容保留，新产品不生在退役凭证上；且共享口令没有调用方身份 |
| Atlas 新开「接受用户 token」的客户端面 | 需平台侧改动，且绕过 `act.sub` 归因模型；在 Ruyin 侧无收益 |
