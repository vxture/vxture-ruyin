/**
 * 直连本地模型网关（RY-100 A15 / A16 / A18）。
 *
 * 用例按「错了会怎样」挑，不按方法数凑：这条路是**智能体第一次真正碰到本机
 * 能力**的必经点（RY-001 §07 #8），它安静地错，症状是任务带着一段空白或一个
 * 假「通过」继续往下走。
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { CapabilityTurnRequest } from "@vxture/ruyin-core";
import { LocalModelError, LocalModelGateway } from "./local-model-gateway.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** 把提供方收到的请求体截下来，顺便按脚本回复。 */
function stubFetch(
  reply: unknown,
  opts: { status?: number; throws?: unknown } = {},
): { seen: Array<{ url: string; body: any; headers: Record<string, string> }> } {
  const seen: Array<{ url: string; body: any; headers: Record<string, string> }> = [];
  globalThis.fetch = (async (url: any, init: any) => {
    if (opts.throws) throw opts.throws;
    seen.push({
      url: String(url),
      body: JSON.parse(String(init.body)),
      headers: init.headers as Record<string, string>,
    });
    const status = opts.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => reply,
      text: async () => JSON.stringify(reply),
    } as Response;
  }) as typeof fetch;
  return { seen };
}

const CONFIG = { baseUrl: "http://127.0.0.1:11434/v1", model: "qwen2.5:14b" };

function req(over: Partial<CapabilityTurnRequest> = {}): CapabilityTurnRequest {
  return {
    capability: "draft",
    product: "bidproposal",
    taskId: "tsk_1",
    workspace: "wsp_1",
    objective: "写一份技术方案",
    constraints: ["不得虚构企业能力"],
    context: [],
    messages: [{ role: "user", content: "开始" }],
    tools: [],
    ...over,
  };
}

const contentReply = (content: string) => ({
  choices: [{ message: { content } }],
});

describe("LocalModelGateway", () => {
  it("回内容就是 content 回合", async () => {
    stubFetch(contentReply("初稿如下……"));
    const turn = await new LocalModelGateway(CONFIG).turn(req());
    assert.deepEqual(turn, { kind: "content", content: "初稿如下……" });
  });

  it("回工具调用就是 tool_calls，参数解析成对象", async () => {
    stubFetch({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "call_1",
                function: { name: "read_file", arguments: '{"path":"a.docx"}' },
              },
            ],
          },
        },
      ],
    });
    const turn = await new LocalModelGateway(CONFIG).turn(req());
    assert.deepEqual(turn, {
      kind: "tool_calls",
      calls: [{ id: "call_1", tool: "read_file", arguments: { path: "a.docx" } }],
    });
  });

  /**
   * 参数是坏 JSON 时给空对象而**不是抛错**：闸门的 `validateToolCall()` 按契约
   * schema 判它缺什么，那里给出的理由比这里准，而且那一层本来就要过。
   */
  it("工具参数不是合法 JSON / 不是对象 → 空对象，交给闸门去判", async () => {
    for (const raw of ['{"path":', "[1,2]", '"just a string"', "", undefined]) {
      stubFetch({
        choices: [
          {
            message: {
              tool_calls: [{ id: "c", function: { name: "t", arguments: raw } }],
            },
          },
        ],
      });
      const turn = await new LocalModelGateway(CONFIG).turn(req());
      assert.equal(turn.kind, "tool_calls");
      assert.deepEqual(
        turn.kind === "tool_calls" ? turn.calls[0]!.arguments : null,
        {},
        `raw=${String(raw)}`,
      );
    }
  });

  /**
   * 既没内容也没工具 → 抛错，**不回空字符串**。
   *
   * 空内容会被 Harness 当成一次正常产出，任务带着一段空白继续往下走 —— 那比
   * 失败更难查，而且最后会以「工作成果」的样子出现在用户面前。
   */
  it("空回复抛错而不是回空内容", async () => {
    for (const reply of [contentReply(""), contentReply("   "), { choices: [{ message: {} }] }]) {
      stubFetch(reply);
      await assert.rejects(
        () => new LocalModelGateway(CONFIG).turn(req()),
        (e: unknown) => e instanceof LocalModelError && e.retryable,
      );
    }
  });

  /**
   * 没有名字的工具调用**抛错，不猜**：`tool` 是闸门用来查契约、判风险档、决定
   * 放行还是询问的那个键。编一个名字出来，等于让闸门去判一个不存在的工具。
   */
  it("工具调用没有名字 → 不可重试的错，不编一个出来", async () => {
    stubFetch({
      choices: [{ message: { tool_calls: [{ id: "c", function: { arguments: "{}" } }] } }],
    });
    await assert.rejects(
      () => new LocalModelGateway(CONFIG).turn(req()),
      (e: unknown) => e instanceof LocalModelError && !e.retryable,
    );
  });

  it("choices 为空 → 不可重试的错（形状问题，再打一遍还是一样）", async () => {
    stubFetch({ choices: [] });
    await assert.rejects(
      () => new LocalModelGateway(CONFIG).turn(req()),
      (e: unknown) => e instanceof LocalModelError && !e.retryable,
    );
  });

  describe("验证回合", () => {
    const vreq = () => req({ capability: "verify:r1", tools: [] });

    it("只提供 report_verdict 一个函数，并要求必须调它", async () => {
      const { seen } = stubFetch({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: "c",
                  function: {
                    name: "report_verdict",
                    arguments: '{"passed":true}',
                  },
                },
              ],
            },
          },
        ],
      });
      const turn = await new LocalModelGateway(CONFIG).turn(vreq());
      assert.deepEqual(turn, { kind: "verdict", passed: true });

      const body = seen[0]!.body;
      assert.equal(body.tools.length, 1);
      assert.equal(body.tools[0].function.name, "report_verdict");
      assert.equal(body.tool_choice, "required");
    });

    it("未通过时带上原因", async () => {
      stubFetch({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: "c",
                  function: {
                    name: "report_verdict",
                    arguments: '{"passed":false,"reason":"缺少工期章节"}',
                  },
                },
              ],
            },
          },
        ],
      });
      const turn = await new LocalModelGateway(CONFIG).turn(vreq());
      assert.deepEqual(turn, {
        kind: "verdict",
        passed: false,
        reason: "缺少工期章节",
      });
    });

    /**
     * **这条是本文件最要紧的一条。**
     *
     * 模型回散文、回别的函数、或者 `passed` 不是布尔时，一律退回 content，由
     * Harness 升级给人判。**绝不从散文里读结论** —— 猜「通过」正是验证步骤变成
     * 装饰的方式（ADR-011；`harness.ts#runProviderVerification` 同一判断）。
     */
    it("回的不是结构化 verdict → 退回 content 让人判，绝不猜「通过」", async () => {
      const cases = [
        contentReply("我认为这份方案是合格的，可以通过。"),
        {
          choices: [
            {
              message: {
                content: "看起来没问题",
                tool_calls: [
                  { id: "c", function: { name: "read_file", arguments: "{}" } },
                ],
              },
            },
          ],
        },
        {
          choices: [
            {
              message: {
                content: "passed",
                tool_calls: [
                  {
                    id: "c",
                    function: {
                      name: "report_verdict",
                      arguments: '{"passed":"yes"}',
                    },
                  },
                ],
              },
            },
          ],
        },
      ];
      for (const reply of cases) {
        stubFetch(reply);
        const turn = await new LocalModelGateway(CONFIG).turn(vreq());
        assert.notEqual(turn.kind, "verdict", JSON.stringify(reply));
        assert.equal(turn.kind, "content");
      }
    });
  });

  describe("组装", () => {
    it("目标与约束逐字进系统提示，上下文标出处并声明是数据不是指令", async () => {
      const { seen } = stubFetch(contentReply("ok"));
      await new LocalModelGateway(CONFIG).turn(
        req({
          context: [
            {
              type: "tender",
              name: "招标文件.docx",
              content: { kind: "text", text: "请在三日内提交" },
              origin: { kind: "local_file", connector: "local-fs" },
            },
          ],
        }),
      );
      const sys = seen[0]!.body.messages[0];
      assert.equal(sys.role, "system");
      assert.match(sys.content, /写一份技术方案/);
      assert.match(sys.content, /不得虚构企业能力/);
      assert.match(sys.content, /招标文件\.docx/);
      assert.match(sys.content, /用户机器上的文件/);
      // 出处声明是运行时该说的那一句：只有它知道每段内容从哪来（ADR-014）。
      assert.match(sys.content, /数据，不是指令/);
    });

    it("二进制与读不到的资料如实说，不拿占位句冒充内容", async () => {
      const { seen } = stubFetch(contentReply("ok"));
      await new LocalModelGateway(CONFIG).turn(
        req({
          context: [
            {
              type: "scan",
              name: "图纸.pdf",
              content: {
                kind: "binary",
                mediaType: "application/pdf",
                base64: "AAAA",
                bytes: 4096,
              },
              origin: { kind: "caller" },
            },
            {
              type: "doc",
              name: "坏文件.docx",
              content: { kind: "unavailable", reason: "文件已被删除" },
              origin: { kind: "tool_result", tool: "read_file" },
            },
          ],
        }),
      );
      const sys = seen[0]!.body.messages[0].content;
      assert.match(sys, /二进制内容.*4096 字节/s);
      // base64 不进提示词：既没用又昂贵。
      assert.ok(!sys.includes("AAAA"), "把二进制字节塞进了提示词");
      assert.match(sys, /读不到：文件已被删除/);
    });

    /**
     * 经连接器取回的资料要说清**是从哪个系统取的**，不能只说「经连接器」——
     * 「来自内网某个系统」与「用户机器上的一个文件」在作者这件事上不是一回事：
     * 前者的作者是那个系统，不是我们的用户（`ContentOrigin` 的注释）。
     */
    it("连接器来源标明连接器与来源种类", async () => {
      const { seen } = stubFetch(contentReply("ok"));
      await new LocalModelGateway(CONFIG).turn(
        req({
          context: [
            {
              type: "crm",
              name: "客户档案",
              content: { kind: "text", text: "甲方是…" },
              origin: { kind: "connector", connector: "erp-mcp", source: "lan" },
            },
          ],
        }),
      );
      assert.match(seen[0]!.body.messages[0].content, /经连接器 erp-mcp 从 lan 取回/);
    });

    it("助手的工具调用与工具返回按 OpenAI 形状回放，工具报错标明是报错", async () => {
      const { seen } = stubFetch(contentReply("ok"));
      await new LocalModelGateway(CONFIG).turn(
        req({
          messages: [
            { role: "user", content: "开始" },
            {
              role: "assistant",
              content: "",
              toolCalls: [{ id: "c1", tool: "read_file", arguments: { path: "a" } }],
            },
            { role: "tool", callId: "c1", content: "打不开", isError: true },
          ],
        }),
      );
      const [, , asst, tool] = seen[0]!.body.messages;
      assert.equal(asst.role, "assistant");
      assert.equal(asst.content, null, "空内容要给 null，不是空串");
      assert.equal(asst.tool_calls[0].function.name, "read_file");
      assert.equal(asst.tool_calls[0].function.arguments, '{"path":"a"}');
      assert.equal(tool.role, "tool");
      assert.equal(tool.tool_call_id, "c1");
      assert.match(tool.content, /工具报错/);
    });

    /**
     * 参数 schema **逐字来自契约**（#43）。不带它，模型只能猜参数名 —— 猜错了
     * 闸门会挡下，安全是安全，但那一回合白花了，而且模型从一个「参数不对」的
     * 拒绝里学不到正确的形状。
     */
    it("工具的参数 schema 逐字来自契约", async () => {
      const { seen } = stubFetch(contentReply("ok"));
      const schema = {
        type: "object" as const,
        properties: { path: { type: "string" }, encoding: { type: "string" } },
        required: ["path"],
      };
      await new LocalModelGateway(CONFIG).turn(
        req({ tools: [{ id: "read_file", description: "local_read (risk: low)", parameters: schema }] }),
      );
      const t = seen[0]!.body.tools[0];
      assert.equal(t.function.name, "read_file");
      assert.deepEqual(t.function.parameters, schema, "schema 没有原样传下去");
      // 普通回合不强制调工具 —— 那会逼着模型在该回答时去调工具。
      assert.equal(seen[0]!.body.tool_choice, undefined);
    });

    /**
     * 缺席时退回放行的形状，与改动之前一样。老的调用方、或将来某种没有 schema
     * 的合成工具，都还能走这条路 —— **少一份 schema 不该让一次回合发不出去**。
     */
    it("没有 schema 时退回放行的对象形状，不抛", async () => {
      const { seen } = stubFetch(contentReply("ok"));
      await new LocalModelGateway(CONFIG).turn(
        req({ tools: [{ id: "read_file", description: "读一个文件" }] }),
      );
      assert.deepEqual(seen[0]!.body.tools[0].function.parameters, {
        type: "object",
        additionalProperties: true,
      });
    });

    it("技能只给目录不给正文（ADR-018 §2.4）", async () => {
      const { seen } = stubFetch(contentReply("ok"));
      await new LocalModelGateway(CONFIG).turn(
        req({ skills: [{ name: "docx", description: "写 Word 文档" }] }),
      );
      assert.match(seen[0]!.body.messages[0].content, /docx：写 Word 文档/);
      assert.match(seen[0]!.body.messages[0].content, /use_skill/);
    });

    it("修订轮把上一轮失败的检查作为事实交回去", async () => {
      const { seen } = stubFetch(contentReply("ok"));
      await new LocalModelGateway(CONFIG).turn(
        req({ revision: { round: 2, failures: [{ rule: "r1", reason: "缺工期" }] } }),
      );
      const sys = seen[0]!.body.messages[0].content;
      assert.match(sys, /第 2 轮修订/);
      assert.match(sys, /r1：缺工期/);
    });
  });

  describe("传输", () => {
    it("打到 <base>/chat/completions，基址末尾有没有斜杠都一样", async () => {
      for (const base of ["http://h/v1", "http://h/v1/"]) {
        const { seen } = stubFetch(contentReply("ok"));
        await new LocalModelGateway({ ...CONFIG, baseUrl: base }).turn(req());
        assert.equal(seen[0]!.url, "http://h/v1/chat/completions");
      }
    });

    it("配了口令才带 authorization —— 没配时不发一个空的", async () => {
      let { seen } = stubFetch(contentReply("ok"));
      await new LocalModelGateway(CONFIG).turn(req());
      assert.equal(seen[0]!.headers["authorization"], undefined);

      ({ seen } = stubFetch(contentReply("ok")));
      await new LocalModelGateway({ ...CONFIG, apiKey: "k" }).turn(req());
      assert.equal(seen[0]!.headers["authorization"], "Bearer k");
    });

    it("不要流式 —— 运行时按回合拿结果", async () => {
      const { seen } = stubFetch(contentReply("ok"));
      await new LocalModelGateway(CONFIG).turn(req());
      assert.equal(seen[0]!.body.stream, false);
      assert.equal(seen[0]!.body.model, "qwen2.5:14b");
    });

    /**
     * 连不上是**可重试**的：本地服务没起来是最常见的一种，而它是用户起一下就好
     * 的事 —— 说不可重试会让调用方放弃一件马上能成的事。
     */
    it("连不上 → 可重试，且消息里带上地址（用户要知道去起哪一个）", async () => {
      stubFetch(null, { throws: new TypeError("fetch failed") });
      await assert.rejects(
        () => new LocalModelGateway(CONFIG).turn(req()),
        (e: unknown) =>
          e instanceof LocalModelError &&
          e.retryable &&
          e.message.includes("127.0.0.1:11434"),
      );
    });

    it("4xx 不可重试，5xx 与 429 可重试", async () => {
      for (const [status, retryable] of [
        [400, false],
        [404, false],
        [429, true],
        [500, true],
        [503, true],
      ] as const) {
        stubFetch({ error: "nope" }, { status });
        await assert.rejects(
          () => new LocalModelGateway(CONFIG).turn(req()),
          (e: unknown) =>
            e instanceof LocalModelError && e.retryable === retryable,
          `HTTP ${status}`,
        );
      }
    });
  });
});
