// ADR-019 探针 · 第一步：dsh 能不能在进程内组合起来，并且用我们自己的 ctx.llm 适配器。
import { resolve } from "node:path";
import { boot, installFailLoud } from "@deepseek-ai/dsh-app-boot";
import { LlmAdapter, createUserMessage } from "@deepseek-ai/dsh-llm";

installFailLoud("ruyin-spike");

/** 指向产品能力面的适配器桩：这里只回一段固定文本，证明接缝在哪。 */
class RuyinAdapter extends LlmAdapter {
  providerInfo(provider) { return { id: provider, name: "Ruyin capability surface (stub)" }; }
  async *stream(options) {
    console.log(`[adapter] stream called: system=${JSON.stringify(options.system ?? null).slice(0, 300)}`);
    console.log(`[adapter] first user block: ${JSON.stringify(options.messages.at(-1)?.content?.[0] ?? null).slice(0, 200)}`);
    const text = `[llm-ruyin] provider=${options.provider} model=${options.model} messages=${options.messages.length} tools=${options.tools?.length ?? 0} system=${options.system ? options.system.length + " chars" : "none"}`;
    yield { type: "block-start", index: 0, blockType: "text" };
    yield { type: "text-delta", index: 0, text };
    yield { type: "block-end", index: 0, block: { type: "text", text } };
    yield { type: "usage", usage: { inputTokens: 1, outputTokens: 1 } };
    yield { type: "finish", reason: { kind: "stop" } };
  }
}

const t0 = Date.now();
const ctx = await boot("ruyin-spike", resolve("cordis.yml"), [], async (ctx) => {
  ctx.plugin({
    name: "llm-ruyin",
    inject: ["llm"],
    apply(ctx) {
      ctx.llm.registerAdapter(["ruyin"], new RuyinAdapter());
    },
  });
});
console.log(`[probe] booted in ${Date.now() - t0} ms; providers = ${JSON.stringify(ctx.llm.listProviders())}`);
console.log(`[probe] services on ctx: ${["llm", "agents", "session", "tools", "sessions"].filter((k) => ctx[k] !== undefined).join(", ")}`);
console.log(`[probe] rss ${(process.memoryUsage().rss / 1048576).toFixed(0)} MB`);

const sessionId = `spike-session-${Date.now()}`;
const handle = await ctx.agents.create({ sessionId, agentOptions: { provider: "ruyin", model: "capability" } });
console.log(`[probe] agent created: ${handle.agent.id}; agent keys: ${Object.keys(handle.agent).slice(0, 12).join(", ")}`);
const msg = createUserMessage({ content: [{ type: "text", text: "你好，探针。" }] });
handle.agent.followup(msg);
await new Promise((r) => setTimeout(r, 3000));
console.log(`[probe] agent status after 3s: ${JSON.stringify(handle.agent.status)}`);
try {
  const s = handle.agent.session;
  const snap = typeof s.eventsSnapshot === "function" ? s.eventsSnapshot() : s.eventsSnapshot;
  const events = Array.isArray(snap) ? snap : (snap?.events ?? []);
  console.log(`[probe] session events (${events.length}): ${events.map((e) => e.type ?? e.kind ?? "?").join(" → ")}`);
  for (const e of events) {
    const t = e.type ?? e.kind;
    if (t === "message" || /message/.test(String(t))) console.log("  ", JSON.stringify(e).slice(0, 300));
  }
} catch (e) { console.log("[probe] no session view:", e.message); }
await handle.dispose();
await ctx.stop?.();
process.exit(0);
