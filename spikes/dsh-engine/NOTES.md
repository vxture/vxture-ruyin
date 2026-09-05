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

## 2026-09-05 · llm-ruyin 真适配（跑通于 09-06 凌晨；分支 spike/dsh-engine）

**结论：接缝 A 完整跑通。** `RuyinCapabilityAdapter extends LlmAdapter` 把 dsh 的 `GenerateOptions`
映射成 `CapabilityTurnRequest`（事实，不是措辞），把能力面的三种应答映射回 `StreamChunk`；
`tool_calls` 走完 dsh-tools 的真实流水线（`tool/call` → 执行 → `tool/result`），callId 一路不变，
下一次请求的 `messages[]` 读回来正是内核 harness.ts:1094 / 1415-1423 推的那两条。
对 `MockAIGateway`（apps/local-host/dist 里的真模块）也通：首轮 `0 message(s)`，验证轮 `1 message(s)`。
`node probe.mjs` 全部断言通过；`node --test llm-ruyin.test.mjs` 19/19。

### 文件

- `llm-ruyin.mjs` —— 适配器 + 纯函数 `toTurnRequest / mapMessages / turnToChunks / classifyFailure / raceAbort`。
  只 import `@deepseek-ai/dsh-llm` 和 `../../packages/runtime-core/dist/index.js`（`TransientError`）。
  无 URL / token / fetch / ctx：网关是构造参数（client-zero-secrets 靠构造保证）。
- `task-facts.mjs` —— `TaskFacts`（= harness.ts:1059-1076 组装的 11 个字段）+ `MemoryTaskFacts`，按 dsh `sessionId` 取。
- `scripted-surface.mjs` —— 有剧本的 `AIGatewayPort`，记下每个请求。
- `spike-tools.mjs` —— 手写 `read_file` ToolDefinition（契约 schema 原样，含 `x-ruyin-ref`）。
- `fixtures/analyze-tender-facts.mjs` —— analyze_tender 的事实（yaml:186-197）。
- `probe.mjs` —— 三组场景 A/B/C；`cordis.yml` —— system-prompt 关 identity + runtime-context，删 agent-default-model。
- `llm-ruyin.test.mjs` —— node:test。

### 映射

请求侧（`GenerateOptions` → `CapabilityTurnRequest`）：capability/product/taskId/workspace/objective/constraints/
context/skills/revision 全部来自 `TaskFacts`（按 `options.sessionId` 取）；`messages` = `mapMessages(options.messages)`；
`tools` = 契约 offer ∩ `options.tools` 的名字（dsh 的 tools 只当"此刻能执行什么"的可见性事实，
其 description / parameters 永不转发）。**丢弃**：`options.system`（只记长度）、provider/model/temperature/
maxTokens/stop/reasoningEffort；`purpose` 有值 → `UNSUPPORTED_PURPOSE`。

消息侧（dsh `Message` → `TurnMessage`）：assistant/model → `{role:'assistant', content: 文本块拼接, toolCalls?}`
（tool-call 块的 arguments 由字符串 parse 回对象；只剩判定/推理块的 assistant 整条丢）；user/tool →
`{role:'tool', callId, content, isError?, origin?}`（origin 只在能从前面的 tool-call 块找回工具名时附上）；
user/user → `{role:'user', content}`；user/plugin（Ruyin 开场、dsh 运行时上下文、工具附加上下文）、system、
未知 source → 丢并计数。首轮请求 `messages: []`，与内核一致（harness.ts:1029-1038）。

应答侧（`CapabilityTurn` → `StreamChunk[]`，整个数组先算完再 yield，校验全在第一个 chunk 之前）：
- content → `block-start(text) / text-delta / block-end / finish{stop}`（空串也是一个文本块）。
- tool_calls → 每个 call：`block-start(tool-call) / tool-call-delta{id,name,argumentsDelta} / block-end{完整块}`，
  最后 `finish{tool-calls}`；arguments = `JSON.stringify(call.arguments)`（dsh 要原始 JSON 字符串）；
  id 原样透传（`ToolCallId` 运行时恒等）。校验：非空 id、批内不重复、历史里没用过、tool 非空、arguments 是对象，
  否则 `INVALID_TURN`；`calls: []` → `EMPTY_RESPONSE`。
- verdict → 仅当 capability 以 `verify:` 开头：`block-start(ruyin-verdict) / block-end{type,passed,reason?} / finish{stop}`
  （非核心块类型必须 block-end 关闭）；生成能力答判定 → `VERDICT_IN_GENERATION`（镜像 harness.ts:1084-1092）。
- **永不发 usage**（计量在网关服务端）；永不发 max-tokens（会丢 tool-call 块）。

失败：适配器只抛 `LlmError`（普通 Error 过 normalizeLlmFailure 会变 UNKNOWN）：`TransientError` → `TRANSPORT`；
其它 Error → `CAPABILITY_ERROR`；信号 → `ABORTED`；缺事实 → `NO_TASK_FACTS`。`providerRetryPolicy` =
normal / maxRetries 2 / [TRANSPORT, EMPTY_RESPONSE] / 500→1000 ms 无抖动（镜像内核 MAX_TRANSIENT_ATTEMPTS=3）。

### 观测到的序列（run A1，一个 tool_calls 回合 + 一个 content 回合）

会话事件：`agent/inbox/spliced → turn/start → agent/inbox/spliced → step/start → user/message → request/header →
request/context → assistant/chunk×4 → assistant/message → tool/call → tool/result → step/end → step/start →
assistant/chunk×4 → assistant/message → step/end → turn/end{completed}`。
第 1 步的 4 个 chunk：`block-start{0,tool-call}` / `tool-call-delta{0,call_1,read_file,'{"path":"tender.pdf"}'}` /
`block-end{0,完整块}` / `finish{tool-calls}`。`tool/call.callId = call_1`；`tool/result.message` =
role user、source `{kind:'tool', callId:'call_1'}`、content `[{tool-result, toolCallId:'call_1',
content:[{text:'[spike] contents of tender.pdf'}], isError:false}]`。
第 2 次请求 `messages` = `[{assistant, content:'', toolCalls:[{id:'call_1', tool:'read_file', arguments:{path:'tender.pdf'}}]},
{tool, callId:'call_1', content:'[spike] contents of tender.pdf', origin:{tool_result, read_file}}]`。
任何一个请求都没有 `system` 键；适配器每次看到 `systemPromptChars = 0`。
适配器抛错时：恰好一个 `assistant/chunk` = `finish{error, failure{message, code}}`（dsh 把终态失败也记进日志），
然后 `turn/end{error}` + `agent/error`；`whenIdle()` 正常返回。

### 度量

boot 185–195 ms（15 → 14 个插件）；RSS boot 后 85–86 MB，跑完 11 个回合 87–89 MB。
回合延迟（不含能力面）：A1 12–13 ms（含一次工具执行），其余 1–4 ms。重试路径 ≈ 1.52 s = 500 + 1000 ms 退避。
全局 `ctx.on('session/event')` 收到 8 个会话 150 个事件（读日志的正确 API：`session.snapshotEvents(fromSeq)`；
day-1 读的 `eventsSnapshot` 是私有缓存字段）。

### 出路 (a) 的代价 —— ADR-011 账目（丢弃了什么 dsh 文本）

- `options.system` 整个：identity 段、persona、任何插件段。组合里已直接关掉（`includeHarnessIdentity:false`），
  所以长度是 0；打开的话也只记长度不读。**dsh 的提示通道从此是死的**：靠段落 / 注入文本说话的 dsh 插件
  （运行时上下文快照、技能目录提醒、PTC/SDK 段、沙箱告示、未来的 dsh-skills）全部失效，其价值要重新表达成
  Ruyin 事实（skills[] / tools[] 已经是）。这是对"dsh 生态广度"论点的实质折价。
- dsh `ToolSchema.description / parameters`：offer 只带契约的 `${category} (risk: ${risk})`；能力面得自己重建
  模型面的工具 schema 与技能目录（而 `CapabilityClient` 今天连 skills 都不发，capability-client.ts:74-91）。
  同一份 input_schema 两份拷贝（dsh 注册表用于冻结/校验，契约用于呈现）。
- 每个 plugin 来源的 user 消息（每回合 1 条 Ruyin 开场；历史里累计）；reasoning 块；历史里的判定块；finish 种类；
  usage 槽（不自报计量）；image 块（text-only 路由在适配器之前投影成 dsh 的占位文本——Ruyin 不会产生带图的 user 消息）。
- 每请求的 `dropped` 计数把上面变成数字：本探针里 pluginMessages 1→3（随回合累计）、toolsNotVisible 1（write_document
  没在 dsh 注册）、toolsNotInContract 1（验证轮 tools=[] 时 read_file 仍可见）、其它全 0。
- 语义差异变成 LlmError code 而不是内核分支：`calls: []` 被重试 2 次再失败（内核是 MAX_TURNS=12 内静默重问）；
  所有 TransientError 塌成 TRANSPORT，`Retry-After` 不可用；宿主要把重试后的 TRANSPORT 映射成 suspended。
- 工具结果形状漂移：dsh 的拒绝带 `Error: ` 前缀且带 origin（内核的 gate 拒绝是裸 reason、无 origin，harness.ts:1290-1295）；
  中断收尾是 dsh 的英文文本。
- 取消到不了在途的能力面调用（`AIGatewayPort.turn` 没有 signal）：只能在等待侧竞争，孤儿 fetch 跑到
  `CapabilityClient` 自己的超时（默认 120 s）。端口改动在探针之外。

### 与设计稿的偏差

1. "适配器抛错 → 该回合零个 assistant/chunk" 不成立：`LlmRuntime.adapterStream` 把抛错变成唯一一个
   `finish{error}` chunk（dsh-llm index.js:1690-1693, 1743-1756），循环照记（agent-loop 628-633）。
   断言改成"恰好一个 chunk 且是 error finish、没有内容块"。
2. `probe-roundtrip.mjs` 并进 `probe.mjs`（交付清单指定 `node probe.mjs` 为入口）；day-1 的桩适配器随之移除。
3. `dropped` 多两项：`otherMessages`（缺 source / 未知 kind，按 bug 计）、`emptyAssistantMessages`
   （只有 reasoning 的 assistant，与 verdictOnlyAssistant 分开数）。`classifyFailure` 对已是 LlmError 的值原样放行。

### 遗留

- `ruyin-verdict` 是 dsh 消费者不认识的块类型（headless 无碍；session-log-deepseek 默认关；TS 增强以后再说）。
- 手写 ToolDefinition 没有参数校验（只有 defineTool 会包）—— Tool Gate（第三天：`tools/pre-execute` + `guard`）。
- use_skill / read_skill_resource 还没有 dsh 侧的 ToolDefinition；声明 skills 的任务还不能往返。
- capability / tools / revision 是宿主维护的可变事实：`facts.patch` + `followup` 必须是一个操作（探针里 `runTurn`）。
- 开场消息是 `content: []` 的 plugin 来源 user 消息；所有已读路径都不校验空内容（inbox / live append /
  RuntimeContextProjection），备选是一个 taskId 文本块。
- `docs/40-implementation/30-harness-dsh-spike.md` 与 ADR-019 不在本分支树上（main 的 68456ec 在分叉点之后）；
  收口写 §8 前要 merge/rebase main。
- **重建**：`dist/` 被 git 忽略（.gitignore:40）；新 checkout 先 `pnpm -r build`（pnpm 走 nvm 路径前缀），
  再从 spikes/dsh-engine 用 node ≥ 22.19 跑。

## 2026-09-06 · 修正（验证轮反驳之后；`node probe.mjs` 全绿，`node --test llm-ruyin.test.mjs` 34/34）

- **工具结果出处不再猜**（反驳 1）。原先 mapMessages 对每条 callId 能对上历史 tool-call 块的结果都附
  `origin:{tool_result, tool}`，把 dsh 运行时自己写的文本（拒绝 `Error: ${reason}` dsh-tools 3128-3140、未知工具 / 抛错
  `Error: ${message}` 3491-3503、取消 3550-3577、循环补记的跳过 agent-loop 277-292）也算成"工具 X 产出的"。
  派生的 Message 不带 error.info（createToolResultMessage 只收 callId/content/isError，agent-loop 296-300），所以适配器
  从 options.messages 分不出来。新增 **`tool-ledger.mjs`（ToolLedger，宿主维护、按会话记）**，三个 dsh-tools 公开观察点
  （index.d.ts:38-83）：`tools/execute` 瀑布记"工具体被到达 + 工具体自己的 isError/error.message"、`tools/result` 通知拿最终
  结果（含 error.message 与 info；它在 tool/result 事件 append 之前同步触发：dsh-tools 3271 → 3285-3300，agent-loop 176-185）、
  `session/event` 的 tool/result 只给从未进调度器的跳过调用兜底。分类规则（`classifyToolResult`，纯函数）：无 error → 工具的；
  有 info.code（HarnessError）或工具体没到达 → 运行时的；工具体到达且 message 就是工具体抛的 → 工具的；其余（post-execute
  block 3381-3389）→ 运行时的。适配器只拿 `provenanceOf(callId)` 回调：运行时写的 → `{role:'tool', callId, content: 裸 reason
  （dsh 记在 error.message 里的那句，不是去前缀的字符串手术）, isError:true}`、**无 origin**（= harness.ts:1290-1295）；
  工具写的 → origin 用账本里实际执行的 `exec.name`（= harness.ts:1415-1423）；账本没记录 → 内容照转、不附 origin
  （fail closed，`unattributedToolResults` 计数）。**没有账本时永远不出 origin**——不知道是谁写的就不声称。
  探针 run D 真跑了三条路径：D1 guard 拒绝（`Error: path "/etc/passwd" is outside the workspace`，事件无 error.info）、
  D2 工具体抛错（origin 保留，content 是工具的 message `ENOENT: …`，去掉 dsh 的 `Error: ` 渲染前缀）、D3 执行中取消
  （call_d3 ABORTED 经 tools/result，call_d4 ABORTED_BEFORE_DISPATCH 只经 session 事件）→ D4 下一次请求的 messages[]
  九条全部按上面的形状（见 `[D4] R6`）。单元测试把拒绝 / 未知工具 / 取消 / 跳过四种形状都钉死（原 test:93-103 那条已改）。
- **offer 现在约束应答**（反驳 2）。`turnToChunks(turn, request, options, emittedIds)` 对着**发出去的请求**校验：
  call.tool ∉ request.tools → `TOOL_NOT_OFFERED`（发第一个 chunk 之前，整批拒绝；镜像 gate 的 tool-not-in-contract 拒绝
  harness.ts:1280-1295，因为 dsh 派发只看注册表可见性 dsh-tools 2907-2912、agent-loop 690-692 对每个块都派发）；
  `verify:*` 轮答 tool_calls → `NON_VERDICT_IN_VERIFICATION`（不可重试，宿主按 code 升级 pending_human = harness.ts:1576-1584）。
  验证轮答 content **不是**错误：它到不了工具流水线，宿主看"没有判定块"就升级（B2 保持不变）。探针 C8（验证轮 + tool_calls）、
  C9（生成轮调 write_document：契约里有、dsh 没注册）都是零 tool/call、唯一 chunk 是 error finish。
  代价：UNKNOWN_TOOL 的往返（dsh-tools 3190-3197）在这个组合里只剩"组装与派发之间工具被注销"的竞争窗口可达，探针不构造。
- **取消的真实序列**（反驳 2b）。"适配器抛错 → 恰好一个终态 finish chunk"**只对 error 成立**。取消时 adapterStream 确实产出
  finish{aborted}（dsh-llm 1743-1756），但循环在 append 每个 chunk 之前先 `signal.throwIfAborted()`（agent-loop 626-627），
  所以它到不了日志：C7（等待能力面时 cancel）= 零 assistant/chunk、零 assistant/message、`turn/end{aborted, reason:{kind:'user'}}`、
  **没有 agent/error**（turn() 的 catch 对 aborted 只记 turn/end 不 throwError，579-584），`whenIdle()` 正常返回；
  孤儿应答晚到时会话 seq 不变。raceAbort 的监听器：once 语义 + settle 时摘除，单元测试用计数桩证明三条路径都归零。
- **ruyin-verdict 的类型账**（反驳 3）。运行时无碍，但 block-start.blockType / block-end.block 要合规需要
  `declare module '@deepseek-ai/dsh-llm' { interface ContentBlockMap { 'ruyin-verdict': {...} } }`（types.d.ts:76-89 的可合并
  扩展）——转 TS 时补；中断的回合里判定块被 interruptedBlocks() 丢弃（assembler.js:155-165），设计如此。已写进 llm-ruyin.mjs 注释。
- **两处加固**（反驳 4）。classifyFailure 对非 Error 的抛出值用 try/catch 包住 String()（敌意 toString / 无原型对象 → 
  `capability surface failed`，镜像 adapter-failure.js:28-36）；"id 没用过"的检查并上账本里本会话发出过的 id
  （`ledger.noteEmittedCalls` 在 yield 之前登记；compaction replace 之后表面看不见也算用过；保守：中途取消、块没进日志的也算）。
- 度量（本次）：boot 181–202 ms；RSS boot 后 86 MB、18 个回合后 89 MB；D3（两个 tool-call + 取消）10–15 ms，C7 2–3 ms；
  全局 session/event 12 个会话 254 个事件。
- 遗留更新：Tool Gate 的 guard 半边已在探针里真跑（registerSpikeGuard）；`tools/pre-execute` 半边仍是第三天；
  post-execute block 的归属规则有单元测试但组合里没有这种策略插件，探针不构造。

## 2026-09-06 · 修正（第二轮）——ADR-011 四条反驳 + 两处协议加固（`node probe.mjs` 全绿 114 条断言，`node --test llm-ruyin.test.mjs` 44/44）

- **反驳 1 · 取消路径漏 dsh 英文进 messages[]**（`tool call aborted` dsh-tools 3551-3568、`tool call aborted before dispatch` 3570-3580 / agent-loop 276-292）。
  原先账本分类成 authored:'runtime' 后仍以裸 reason 转发，句子还是 dsh 的。现在 mapMessages 对 authored:'runtime' 且 code ∈
  {ABORTED, ABORTED_BEFORE_DISPATCH} 的结果：**结果整条抹掉，发出它的 assistant 那条 toolCalls 条目一并抹掉**，发出方只剩空壳
  （content '' 且无 toolCalls）就整条抹掉——镜像内核"被取消的步骤从不记录"。计数 `dropped.droppedCancelledCalls`，适配器累计在
  `adapter.counters`。探针 D4：R6 = 六条（D3 那步整个消失），`/tool call aborted/` 在请求 JSON 里为 false、在 dsh 自己的 tool/result
  事件里仍在（丢是适配器做的）。单元：整批取消 / 混合批 / 发出方带文本 / 发出方不在表面（compaction）四种。
- **反驳 2 · 无账本模式照转 dsh 渲染文本**。账本改成**必需的构造依赖**（缺席、或缺 provenanceOf / reconcileEmitted /
  noteEmittedCalls → TypeError）；删掉"账本没记录就照转"的分支和 `unattributedToolResults` 计数；账本没记录的工具结果 →
  `INVALID_HISTORY`（成功结果也一样；authored:'tool' 但没有工具名也是）。适配器级测试：网关一次都没被调用。
  代价：换进程 / 重启后恢复的会话，历史里的工具结果没有账本记录 → 该会话不能续（见遗留）。
- **反驳 3 · resolveModel 声明 inputModalities ['text']** 让 `LlmRuntime.adapterStream` 在适配器之前把 image 块改写成
  `[image omitted because this model accepts text only; …]`（dsh-llm 521-523, 600-625；条件在 1684：`inputModalities !== void 0 && !includes('image')`）。
  现在不声明 inputModalities，image 块原样到达适配器，mapMessages 自己丢（user / tool-result 内层 / assistant 三处），计数
  `droppedImageBlocks`——一个数字，不是一句话。探针 E1 宿主消息真带了一个 image 块：R1 = 只有文本，`/image omitted/` 全程 false。
- **反驳 4 · 工具附加的上下文可以冒充用户**（additionalContexts: UserMessage[]，source 任意，dsh-tools index.d.ts:397/408/436-445；
  循环拼进下一步 agent-loop 185 → 692，claim 后记成 user/message 559）。原先只丢 kind:'plugin'。现在**宿主是 user 角色的唯一作者**：
  `MemoryTaskFacts.noteHostMessage(sessionId, id)` / `isHostMessage()`（createUserMessage 入 inbox 之前就有 id，dsh-llm 40-52，跨表示层不变）；
  探针的 `hostFollowup` 先登记再 followup；适配器只把名单上的 kind:'user' 转成 role 'user'，其余丢并计 `droppedForeignUserMessages`。
  探针 E1：read_file "poser.pdf" 用 `exec.deferContext` 附一条 kind:'user' 的伪造消息——dsh 日志里真有两条 user/message（宿主的 + 伪造的），
  R2 只有宿主那条。名单按会话：同一 id 在别的会话不算。
- **加固 5 · JSON.stringify(call.arguments) 无防护**。`serializeArguments` 在校验循环里、第一个 chunk 之前：抛（BigInt `{n:1n}`、循环引用）/
  返回 undefined（`{toJSON(){return undefined}}`）/ 非对象 JSON（toJSON 返回数组或字符串，`!startsWith('{')`）→ 都是 `INVALID_TURN`；
  第二个 call 才坏也是整批零 chunk；账本什么都不登记。
- **加固 6 · 发出过的 id 永久禁用会卡死无状态能力面**（中途取消：agent-loop 626-627 在 append 之前 throwIfAborted；interruptedBlocks 从不留
  tool-call 块，dsh-llm 935-942——块到不了日志）。账本分两格：`pending`（yield 之前 noteEmittedCalls）和 `logged`（进过日志）。
  下一次请求 `reconcileEmitted(sessionId, historyCallIds(options))`：pending 里出现在历史表面的 → logged，没出现的 → 忘掉；另外 session/event
  的 `assistant/message` 里的 tool-call 块直接确认为 logged（agent-loop 680-688，session.append 同步触发 dsh-session 1428-1435）。
  复用检查 = 历史表面 ∪ logged：进过日志的 id 在 compaction 之后仍拒绝（保住第一轮的 compaction 覆盖），没进日志的可以重发。
  探针 E2/E3/E4 真跑：E2 在 noteEmittedCalls 之后 queueMicrotask(cancel)，事件序列 `step/start → user/message → step/end → turn/end{aborted}`、
  零 chunk、call_e2 pending 不 logged；E3 能力面重发 call_e2 → 接受、工具真跑、call_e2 转 logged；E4 再发 → INVALID_TURN、零 tool/call。
- 其它：`mapMessages(messages, dropped, host)` 第三参改成 `{ provenanceOf, isHostMessage }`，缺哪一半按"什么都不知道"（fail closed）；
  `usedCallIds` 改成导出的纯函数 `historyCallIds(options)`；`ledger.emittedCalls` 改名 `loggedCalls` + 新增 `pendingCalls`（只给测试 / 探针）。
- 度量（本次）：boot 208–248 ms；RSS 结束 91 MB；E1 3–6 ms、E2 1 ms、E3 2–3 ms、E4 1 ms、D3 13–16 ms；全局 session/event 13 个会话 316 个事件。
- 遗留新增：(a) 账本是进程内存——重启后恢复的会话历史里的工具结果无记录 → INVALID_HISTORY，续跑要持久化账本（或宿主重放 tool/result 事件
  喂回 attach 的 session/event 分支）；(b) 工具还能伪造 **tool 结果**：deferContext 一条 source.kind 'tool' + 真实 callId 的消息，账本按 callId
  查会命中真记录——要堵得让账本记下真结果的 message.id（session/event tool/result 的 message.id）并按 id 核对，本轮未做；
  (c) `droppedForeignUserMessages` / `droppedImageBlocks` 是每请求重映射的累计数，不是"发生过几次"。
