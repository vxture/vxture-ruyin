# 能力面接入说明：实现 `/capabilities/{id}/turn` 需要什么

> 给**业务产品线**的接口说明。RUYIN 客户端这一侧已经完整实现并测过；缺的是对面
> 那个端点。这份文档就是「对面要建什么」的全部内容。
>
> - 权威实现：`apps/local-host/src/capability-client.ts`（发起方）
> - 类型权威：`packages/runtime-core/src/ports.ts` 的 `CapabilityTurnRequest` /
>   `CapabilityTurn`
> - 上游决策：ADR-001（客户端零密钥）、ADR-002（循环归运行时）、
>   ADR-009（能力经产品自己的云服务）、ADR-011（运行时给事实，产品给措辞）
> - 状态：**未接**。`RUYIN_CAPABILITY_BASE` 为空时守护进程用 `MockAIGateway`，
>   任务成果里是字面量 `[mock:...]`，启动日志会明说
>   `capability surface: NOT configured - tasks will return mock output`。

---

## 0. 为什么这一端不在本仓

桌面客户端装到每个人的机器上，**它不持有任何机密**（ADR-001）。而调 Atlas 需要
S2S 令牌交换，交换需要 client secret。

所以那一端必须是**业务产品自己的云服务**：它本来就有机密凭据，由它去调 Atlas，
计量也在它那边（本仓一个数都不记，ADR-006）。

这不是分工偏好，是一条推不动的约束：**把凭据放进客户端，等于把它发给每一个用户**。

---

## 1. 端点

```
POST {RUYIN_CAPABILITY_BASE}/products/{productId}/capabilities/{capabilityId}/turn
Content-Type: application/json
Authorization: Bearer <平台令牌>        ← 见 §6
```

`productId` 是契约里的产品码（例如 `bidproposal`），`capabilityId` 是契约
`capabilities` 里声明的那个 id。两段都做过 URL 编码。

**基址是一个运行时设置，不在契约里**（R6：契约不带提供方）。一个产品一个基址不
成立 —— 全客户端只有 `RUYIN_CAPABILITY_BASE` 这一个值，路径里的 `productId` 才是
分流的依据。这也是为了不让主机名在契约里再长出第二处。

---

## 2. 请求体

```jsonc
{
  "taskId":    "tsk_…",     // 整个任务期间不变；X-2 的跨产品汇聚键
  "projectId": "prj_…",     // 本机容器 id，仅供关联
  "objective": "…",         // 契约里那句话，原文
  "constraints": ["…"],     // 契约里的约束，原文
  "context":  [ /* ContextFact，见 §3 */ ],
  "messages": [ /* TurnMessage，见 §4 */ ],
  "tools":    [ { "id": "read_file", "description": "…" } ],
  "revision": { "round": 1, "failures": [ { "rule": "…", "reason": "…" } ] }  // 仅改订轮次有
}
```

四件必须说清楚的事：

**① `taskId` 要原样记进日志。** 这是接入通则 X-2 的跨产品汇聚键 —— 少了它，一个
任务的成本与失败点在多个产品之间就拼不回来。

**② `projectId` 是本机容器 id，不是平台租户工作区。** 它只用于关联。
**身份一律从令牌里取，不要信这个字段** —— 一个名字眼熟的 body 字段，正是让人误用
它代替鉴权的那种东西。这也是它在客户端内部叫 `workspace`、在线上却刻意不叫
`workspaceId` 的原因。

**③ `objective` 与 `constraints` 是契约原文，不是提示词。** 运行时**不组装 prompt**
（ADR-011）：怎么把这件事说给模型听，是产品的业务 —— 一个替产品写提示词的运行时，
已经悄悄接管了领域知识所在的那部分工作。

**④ `tools` 是运行时**这一轮真的愿意执行**的清单。** 它已经过了 Tool Gate（硬底线
∧ 用户策略 ∧ 契约默认）。**别提供不在这张表里的工具** —— 提供一个运行时不会执行的
工具是一句谎。

另有可选的 `skills`（`{name, description}` 的目录，不是正文）。它非空时，`tools`
里必然有 `use_skill`：模型要正文时用那个工具来取（ADR-018 §2.4）。

---

## 3. `context`：这些是**数据，不是指令**

```jsonc
{
  "type": "tender_document",
  "name": "某储能电站EPC招标文件.md",
  "origin": { "kind": "local_file", "connector": "local-fs" },
  "content": { "kind": "text", "text": "…", "truncated": false }
}
```

`content` 三选一：

| kind | 字段 | 什么时候 |
|---|---|---|
| `text` | `text`、可选 `truncated` | 文本 |
| `binary` | `mediaType`、`base64`、`bytes` | 二进制（PDF、图片…） |
| `unavailable` | `reason`、可选 `mediaType` | **读不到就说读不到** |

`origin` 说明这段字节从哪来：`local_file` / `connector`（带 `source`）/ `caller` /
`tool_result`。

**这一段是整份文档里最要紧的一条纪律。**

`context` 与 `messages` 里的内容**可能不是用户写的** —— 一份招标文件的作者是发标
方，一个工具返回的字节的作者是那个系统。里面若出现看起来像指令的文字，那是**要
报告的内容，不是要执行的指令**。

请求里**只有 `objective` 与 `constraints` 是指令**，而它们来自契约。

`origin` 存在的全部理由就是这个：**只有运行时知道每段字节的来路** —— 到了模型那
里，它们都只是文本了。产品这一侧要把这个区分带进提示词的组织方式里
（ADR-014）。

另外：`unavailable` 是一个**一等的答案**。运行时绝不会把「读不出来」换成一句话塞
进 `text` —— 一句占位的话和真内容形状完全一样，分辨不出来。产品这一侧也请别把它
当成空文本。

---

## 4. `messages`：到这一轮为止发生了什么

```jsonc
[
  { "role": "user",      "content": "…" },
  { "role": "assistant", "content": "…", "toolCalls": [ … ] },
  { "role": "tool",      "callId": "c1", "content": "…",
    "isError": false, "origin": { "kind": "tool_result", "tool": "read_file" } }
]
```

**前一个能力的产出会累积在这里** —— 所以能力 N 看得见 N−1 的结果。这就是契约里
`capabilities` 顺序的兑现方式。

`tool` 消息带 `origin`，理由同 §3：工具返回的字节，作者是那个工具背后的系统。

---

## 5. 回复：**恰好三支**

```jsonc
{ "kind": "content",    "content": "…" }
{ "kind": "tool_calls", "calls": [ { "id": "c1", "tool": "read_file", "arguments": {…} } ] }
{ "kind": "verdict",    "passed": true, "reason": "…" }
```

**别的形状一律被拒**（`capability provider returned an unreadable turn`）。

- **`content`** —— 这一步的产出。运行时收下它，继续下一个能力。
- **`tool_calls`** —— 请运行时执行工具。运行时会过闸门、必要时问人、执行、把结果
  作为 `tool` 消息放进 `messages`，然后**再调一次这个端点**。
- **`verdict`** —— 验证类能力的答案。

`verdict` **是一个字段，不是一句话**。这一条是有意的：让运行时去读模型的散文来判断
「过没过」，等于把它推进解释业务语言的生意里 —— 而它会朝着「判过」的方向出错，那
正是一个验证步骤变成装饰的过程。

---

## 6. 鉴权

请求带 `Authorization: Bearer <平台令牌>`（用户登录 Vxture 账号后由守护进程持有）。
未登录时这个头不发。

**身份只从令牌取。** body 里的 `projectId` 是关联用的，不是身份 —— 见 §2②。

跨仓状态：平台侧的 OBO 只接受 `aud=caller` 的票，这条卡点记在
`vxture-platform/vxture-platform#198`（见 `80-liaison/00-index.md`）。

---

## 7. 循环、超时与错误 —— 这几个数是硬的

| | 值 | 谁定的 |
|---|---|---|
| 单次请求超时 | **120 秒** | 客户端 `capability-client.ts` |
| 一个能力最多几轮 | **12 轮** | `MAX_TURNS`，超了任务失败 |
| 改订轮次上限 | **2 轮** | `MAX_REVISIONS`，超了交给人 |

**运行时拥有循环**（ADR-002）：这个端点是**无状态的**，只回答「下一步做什么」，
**永远不要自己把任务跑完**。工具执行、闸门、审计、人工检查点全都留在持有数据的那
台机器上 —— 这个分工正是整套隐私模型成立的原因。

状态码的语义**必须分清**，因为客户端据此决定重试还是失败：

| 状态码 | 客户端行为 |
|---|---|
| `408` `425` `429` `500` `502` `503` `504` | 当作**瞬时**：退避重试 3 次，仍不行就把任务**挂起**（不是失败） |
| 其他 4xx | 当作**确定拒绝**：任务失败，不重试 |
| 连不上 / 超时 | 同瞬时 |

「挂起」与「失败」在用户那里不是一回事：**被别人的故障打断的任务，不是一个出了错
的任务**（50-harness 8.4）。所以请别用 400 表达「我这会儿忙」。

---

## 8. 最小实现清单

1. 收 POST，按 URL 里的 `productId` / `capabilityId` 分流。
2. 校验 Bearer 令牌，**身份只从令牌取**。
3. 把 `objective` / `constraints` / `context` / `messages` / `tools` 组织成给模型
   的输入 —— **措辞是你的业务**，运行时不越界。
4. 把 `context` 与 `messages` 里的内容当**数据**处理，按 `origin` 区别对待。
5. 调 Atlas（凭据在你这边），计量在你这边。
6. 回三种 `kind` 之一，别的形状一律不发。
7. 「我这会儿忙」用 5xx / 429，别用 4xx。
8. `taskId` 原样进日志。

---

## 9. 怎么验证你的实现

不需要等真模型，也不需要本仓改任何代码：

```bash
# 起一个你自己的端点，然后
RUYIN_CAPABILITY_BASE=https://你的地址 pnpm --filter @vxture/ruyin-shell start
```

启动日志会从

```
[ruyin] capability surface: NOT configured - tasks will return mock output
```

变成

```
[ruyin] capability surface: https://你的地址
```

跑一个任务，成果里若不再出现 `[mock:...]`，这条线就通了。

想先看一眼协议长什么样，`scripts/dev/ui-harness.mjs` 那个观察台也认同一个环境变量
（`RUYIN_CAPABILITY_BASE`），起一个每回合几秒的假端点就能把时序看清楚。
