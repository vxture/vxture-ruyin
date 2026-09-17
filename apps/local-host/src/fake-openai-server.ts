/**
 * 一个 OpenAI 兼容的假模型服务端，**只给用例用**。
 *
 * 它存在的理由是一段谁也没验过的接缝：`local-model-gateway.ts` 的 22 条用例
 * 每一条都把 `globalThis.fetch` 换掉了 —— 那验的是「我方按什么形状拼请求、
 * 怎么读回复」，**不是**「这个形状真发出去、真有一个服务端收下并回话」。
 * 而那段接缝错了，症状是任务安静地带着一段空白往下走。
 *
 * 与 `fake-mcp-http-server.ts` 同一个套路：跑在用例进程里（HTTP 本来就没有
 * 进程边界要跨，另起一个子进程只会把这个文件从覆盖率里藏起来），一条用例一个
 * 实例，行为由选项而不是 argv 决定。
 *
 * **它不装聪明**：回什么由脚本说了算。脚本按「第几回合」取，因为闭环的关键正是
 * 回合之间 —— 第一回合要工具、第二回合给内容，工具结果得在第二回合的请求里
 * 出现，而那才是这条链真正要证明的事。
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/** 一条脚本回复。与 OpenAI 的 `choices[0].message` 同形，但只留用得上的字段。 */
export type FakeReply =
  | { kind: "content"; content: string }
  | {
      kind: "tool_calls";
      calls: Array<{ id: string; name: string; arguments: unknown }>;
    };

export interface FakeOpenAI {
  /** `http://127.0.0.1:<port>/v1` —— 直接交给 `LocalModelGateway` 的基址。 */
  readonly base: string;
  /** 收到的每一个请求体，按顺序。断言「工具结果回喂了没有」就看它。 */
  readonly seen: Array<Record<string, unknown>>;
  close(): Promise<void>;
}

function reply(r: FakeReply): unknown {
  const message =
    r.kind === "content"
      ? { role: "assistant", content: r.content }
      : {
          role: "assistant",
          content: null,
          tool_calls: r.calls.map((c) => ({
            id: c.id,
            type: "function",
            function: { name: c.name, arguments: JSON.stringify(c.arguments) },
          })),
        };
  return {
    id: "chatcmpl-fake",
    object: "chat.completion",
    choices: [{ index: 0, message, finish_reason: r.kind === "content" ? "stop" : "tool_calls" }],
  };
}

/**
 * 对话形状检查 —— 真提供方会拒的那一条，这里也拒。
 *
 * OpenAI 的约定：一条带 `tool_calls` 的 assistant 消息，**每一个 `tool_call_id`
 * 都必须有一条对应的 tool 消息**。少一个就是 400（"An assistant message with
 * 'tool_calls' must be followed by tool messages responding to each
 * tool_call_id"）。
 *
 * 只查这一条，不查别的：它是这条链**真的踩过**的那个坑（一批工具里混了要人
 * 批准的，放行的那些既没跑也没回答），而一个宽容的假服务端会让它一路绿灯。
 * 返回一句话说明哪里不对，返回 `undefined` 表示没问题。
 */
function malformed(body: Record<string, unknown>): string | undefined {
  const messages = body["messages"];
  if (!Array.isArray(messages)) return "messages must be an array";
  const answered = new Set(
    messages
      .filter((m) => (m as Record<string, unknown>)["role"] === "tool")
      .map((m) => String((m as Record<string, unknown>)["tool_call_id"])),
  );
  for (const m of messages as Array<Record<string, unknown>>) {
    const calls = m["tool_calls"];
    if (!Array.isArray(calls)) continue;
    for (const c of calls as Array<Record<string, unknown>>) {
      const id = String(c["id"]);
      if (!answered.has(id)) {
        return `an assistant message with 'tool_calls' must be followed by a tool message for ${id}`;
      }
    }
  }
  return undefined;
}

/**
 * 起一个假服务端。
 *
 * `script` 收到的是**这一次请求的请求体**与它是第几次（从 0 起），返回这一回合
 * 要回什么。让脚本看得到请求体是有意的：闭环要证明的一半正是「上一轮的工具
 * 结果确实到了下一轮的请求里」，而那只有脚本自己看得见。
 */
export async function startFakeOpenAI(
  script: (body: Record<string, unknown>, turn: number) => FakeReply,
): Promise<FakeOpenAI> {
  const seen: Array<Record<string, unknown>> = [];
  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      const turn = seen.length;
      seen.push(body);
      // **像真提供方一样挑剔**：对话形状不合规就 400，不宽容地照答。宽容的
      // 假服务端会让一条真实存在的缺陷一路绿灯，而那正是这个文件要防的事。
      const bad = malformed(body);
      if (bad) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: bad, type: "invalid_request_error" } }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(reply(script(body, turn))));
    });
  };
  const server: Server = createServer(handler);
  // 端口交给系统挑：写死一个端口的用例会在并发跑的时候互相撞（本仓 CI 是 4 路
  // 并发），而那种失败看起来像随机的。
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}/v1`,
    seen,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections?.();
        server.close(() => done());
      }),
  };
}
