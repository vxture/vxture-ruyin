# ADR-019 探针 · 工作记录（分支 spike/dsh-engine，不进 main）

时间盒 2026-09-06 → 2026-09-19。计划与判据：`docs/40-implementation/30-harness-dsh-spike.md` §6；
这里记每天的事实，收口时整理回该文档 §8。

## 2026-09-05（立项当天）

- dsh 的包**在 npm 上**（`@deepseek-ai/dsh-*`，tag `next` = 0.1.2-rc.1，`alpha` = 0.1.2-alpha.5；
  仓里是 0.1.3-alpha.1）。探针钉 **0.1.2-rc.1**，不从 git 构建。
- **进程内组合成立**：`boot("ruyin-spike", cordis.yml, [], prepare)` 起一棵 15 个插件的最小树
  （timer / llm / llm-retry / session / session-log / session-projection / typert ×2 / system-prompt /
  agent / agent-default-model / tools / agent-loop / 两个 deepseek 扩展）—— **没有 DeepSeek 适配器、
  没有凭据、没有 web、没有沙箱**。缺什么它会 fail-loud 点名（第一次少了 `systemPrompt`）。
- **接缝 A（模型提供方）成立**：`prepare(ctx)` 里 `ctx.plugin({ inject: ["llm"], apply })` 调
  `ctx.llm.registerAdapter(["ruyin"], adapter)`；`listProviders()` 只有 `ruyin`。`LlmAdapter` 唯一
  必需的方法是 `stream(options): AsyncIterable<StreamChunk>`（block-start / text-delta / block-end /
  usage / finish）。`ctx.agents.create({ sessionId, agentOptions: { provider: "ruyin", model } })`
  → `handle.agent.followup(createUserMessage(...))` → 我们的 `stream()` 真的被调用。
- **度量**：boot 196–236 ms；RSS 79 MB（纯守护进程无壳）；15 个包 `node_modules` 待量。
- **ADR-011 张力当场出现**：适配器收到的 `options.system` 是 dsh 自己的
  `"You are an AI agent powered by DeepSeek Harness."`（system-prompt 插件组装），
  `options.messages` 是它的消息词表。要么在适配器里把 dsh 的提示丢弃、只把 messages 映射成
  我们的回合协议字段（§2.3 出路 a），要么承认框架性提示（出路 b）。**下一步先做 a。**
- 未解：`session.eventsSnapshot` 返回空 —— 读会话事件的正确 API 还没找到（不影响接缝结论）。

## 下一步（第一周）

1. `llm-ruyin` 真适配：`GenerateOptions` ↔ `CapabilityTurnRequest`（objective / constraints /
   context[] 从契约与上下文集取，dsh 的 messages 映射成 `messages[]`，dsh 的 tools 映射成
   `tools[]`），对着 `MockAIGateway` / bid 能力面的 mock 跑通；`tool_calls` 回合映射成
   `tool-call-delta` 块。
2. Tool Gate 作 `tools/pre-execute` + `guard`：先读 `@deepseek-ai/dsh-tools` 的钩子契约。
3. 审计：找会话事件的订阅 API（`agentEvents(ctx, agent)` / session log），接 `emitAudit`。
