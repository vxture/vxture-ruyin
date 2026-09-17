/**
 * 真网关走一遍闭环（RY-001 §07 #47）。
 *
 * ## 这条用例补的是哪一段
 *
 * 闭环本身**已经被验过**：`bidproposal-e2e.test.ts` 把契约校验 → 上下文选取 →
 * 工具闸门 → 检索 → 渲染 → 导出 → 审计链连起来跑完了一遍。但它用的是一个直接
 * 实现 `AIGatewayPort` 的**桩**。
 *
 * 而真正要上场的那个网关（`local-model-gateway.ts`）有 22 条自己的用例，
 * **每一条都把 `globalThis.fetch` 换掉了** —— 它从没真发过一个请求，也从没
 * 进过闭环。于是中间留着一段谁也没验过的接缝：
 *
 * - 我方拼出来的请求体，一个 OpenAI 形状的服务端**收不收**；
 * - 它回来的工具调用，循环**能不能真的在本机执行**；
 * - 执行结果**能不能按形状喂回下一轮** —— 模型看不见上一轮的结果，等于每一轮
 *   都从头开始，而那种失败是安静的：任务照常走到 completed，只是内容是空的。
 *
 * 这一段错了，症状正是「首页那个产品不能真干活」，而那时多半会被归因到平台。
 *
 * ## 为什么它现在就能做
 *
 * **不需要平台，也不需要本机真有模型。** 假服务端只是一个说 OpenAI 形状的
 * HTTP 端点（`fake-openai-server.ts`），回什么由脚本说了算 —— 要证明的从来
 * 不是模型多聪明，是这条管道通不通。
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  MemorySkills,
  ProjectRuntime,
  verifyAuditChain,
  toAuditView,
  type Harness,
  type TaskInstanceRecord,
} from "@vxture/ruyin-core";
import { SqliteStoragePort } from "./storage.js";
import { nodeClock, nodeCrypto, nodeId } from "./host-ports.js";
import { LocalFsConnector } from "./connector-fs.js";
import { FtsRanker, reindexBinding, searchContext } from "./fts.js";
import { LocalToolExecutor } from "./tool-executor.js";
import { KeyManager } from "./keys.js";
import { loadProducts } from "./products.js";
import { LocalModelGateway } from "./local-model-gateway.js";
import { startFakeOpenAI, type FakeReply } from "./fake-openai-server.js";

const productsDir = new URL("../../../products", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
);

const TENDER = `# 招标文件

## 资质要求
- 具备电力工程施工总承包一级资质
- 近三年有储能项目业绩
`;

/** 与 bidproposal-e2e 同一个跑法：推进到底，人工确认一律放行。 */
async function runToEnd(harness: Harness, taskId: string): Promise<TaskInstanceRecord> {
  const created = await harness.startTask(taskId);
  let instance = await harness.advance(created.id);
  for (let guard = 0; guard < 10 && instance.state === "waiting_human"; guard++) {
    const pending = instance.checkpoints.find((c) => c.decision === undefined);
    if (!pending) break;
    await harness.decideCheckpoint(instance.id, true);
    instance = await harness.advance(instance.id);
  }
  return instance;
}

void test("真网关走闭环：HTTP 出去、工具在本机跑、结果按形状回喂", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "ruyin-gw-"));
  const work = mkdtempSync(join(tmpdir(), "ruyin-gw-work-"));
  const tender = join(work, "招标文件.md");
  const matrix = join(work, "需求矩阵.md");
  writeFileSync(tender, TENDER, "utf8");

  /*
   * 脚本按「第几回合」走，因为闭环的关键正在回合之间：第一回合要工具，第二
   * 回合给内容。第二回合的请求里必须带着第一回合那两个工具的返回 —— 那是这条
   * 用例真正要证明的事，所以断言放在最后，脚本这里只管答话。
   */
  const fake = await startFakeOpenAI((_body, turn): FakeReply => {
    if (turn === 0) {
      return {
        kind: "tool_calls",
        calls: [
          { id: "c1", name: "read_file", arguments: { path: tender } },
          {
            id: "c2",
            name: "write_document",
            arguments: {
              path: matrix,
              content: "# 需求矩阵\n\n| 编号 | 需求 |\n| --- | --- |\n| R1 | 一级资质 |\n",
            },
          },
        ],
      };
    }
    // 校验回合要的是裁决；这里用的契约那一条是 automated，走的仍是同一个网关。
    return { kind: "content", content: "需求矩阵已生成，两条需求均可回溯到招标原文。" };
  });

  const storage = new SqliteStoragePort(dataDir, await KeyManager.open(dataDir));
  const runtime = new ProjectRuntime({
    storage,
    clock: nodeClock,
    id: nodeId,
    crypto: nodeCrypto,
    // **这里就是这条用例的全部理由**：真网关，说真 HTTP。
    gateway: new LocalModelGateway({ baseUrl: fake.base, model: "fake-model" }),
    connectors: new Map([["local-fs", new LocalFsConnector()]]),
    ranker: new FtsRanker(storage),
    tools: new LocalToolExecutor((pid, q, scope, limit) =>
      searchContext(storage, pid, q, scope, limit),
    ),
    skills: MemorySkills.forContract(
      loadProducts(productsDir).loaded.find((p) => p.id === "bidproposal")!.contract,
    ),
  });

  try {
    const bid = loadProducts(productsDir).loaded.find((p) => p.id === "bidproposal");
    assert.ok(bid, "标书产品必须能通过契约校验才谈得上跑");
    const meta = await runtime.createProject(bid.contract, "网关闭环", "wsp_test");
    await runtime.addGrant(meta.id, work, "readwrite");
    const binding = await runtime.setBinding(meta.id, { type: "tender_document", root: work });
    await reindexBinding(storage, meta.id, binding, new LocalFsConnector());

    const harness = await runtime.createHarness(meta.id);
    const instance = await runToEnd(harness, "analyze_tender");
    assert.equal(instance.state, "completed", `没跑完：${instance.error ?? ""}`);

    /* ---- 一、工具真的在本机跑了 ------------------------------------------ */
    // 模型只是说了「写这个文件」，真把它写出来的是本机的工具执行器，而且是在
    // 过完闸门之后。文件在，就说明这一段是真的，不是被谁记了一笔就算了。
    assert.ok(existsSync(matrix), "模型要求写的文件没出现 —— 工具调用没有真的执行");
    assert.match(readFileSync(matrix, "utf8"), /一级资质/);

    /* ---- 二、请求真的发出去了，而且形状对 -------------------------------- */
    assert.ok(fake.seen.length >= 2, `至少要有两轮，实际 ${fake.seen.length}`);
    const first = fake.seen[0]!;
    assert.equal(first["model"], "fake-model");
    // 不要流式：循环要的是「下一步做什么」这个完整答案（RY-102 §08 B6）。
    assert.ok(first["stream"] !== true);
    // 工具带着契约里那份参数 schema 过去了 —— 模型因此能一次填对参数，而不是
    // 靠闸门驳回再猜。
    const tools = first["tools"] as Array<{ function: { name: string; parameters?: unknown } }>;
    const readFileTool = tools.find((t) => t.function.name === "read_file");
    assert.ok(readFileTool, "工具清单里没有 read_file");
    assert.ok(readFileTool.function.parameters, "参数 schema 没跟着过去");

    /* ---- 三、上一轮的工具结果回到了下一轮（**最要紧的一条**） ------------ */
    // 模型看不见上一轮的结果，等于每一轮都从头开始。这种失败是安静的：任务
    // 照常走到 completed，只是内容是空的 —— 所以必须逐条钉。
    const second = fake.seen[1]!;
    const messages = second["messages"] as Array<Record<string, unknown>>;
    const toolMessages = messages.filter((m) => m["role"] === "tool");
    assert.equal(toolMessages.length, 2, "两个工具的返回都要回喂，一个都不能少");
    assert.deepEqual(
      toolMessages.map((m) => m["tool_call_id"]).sort(),
      ["c1", "c2"],
      "工具返回要对得上是哪一次调用",
    );
    // 助手那一轮也要在，而且带着它当初提的调用 —— 少了它，OpenAI 形状的对话
    // 就是断的（一个 tool 消息前面必须有提出它的 assistant 消息）。
    const assistant = messages.find((m) => Array.isArray(m["tool_calls"]));
    assert.ok(assistant, "提出工具调用的那一轮没有回放");
    // 读文件读到的内容确实到了模型手上 —— 不然「基于招标原文」就是空话。
    assert.ok(
      toolMessages.some((m) => String(m["content"]).includes("一级资质")),
      "读到的招标原文没有回到模型手上",
    );

    /* ---- 四、整条链的审计可验 -------------------------------------------- */
    const events = await runtime.listAuditEvents(meta.id);
    assert.ok(verifyAuditChain(nodeCrypto, meta.id, events), "审计链校验不过");
    const executed = events
      .map(toAuditView)
      .filter((e) => e.action === "tool.executed" && e.outcome === "success");
    assert.ok(executed.length >= 2, "两次工具执行都要留痕");
  } finally {
    await fake.close();
    storage.closeAll();
    for (const d of [dataDir, work]) rmSync(d, { recursive: true, force: true });
  }
});

/**
 * 提供方半路不答了，任务**不能安静地完成**。
 *
 * 这是上面那条的反面，也是这一段接缝最容易骗人的地方：网络错误被吞掉之后，
 * 循环会拿到一个空回合，然后一路走到 completed —— 用户看到的是一个「做完了」
 * 的任务和一份空白成果。
 */
void test("真网关走闭环：提供方回不出东西时任务如实失败，不假装完成", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "ruyin-gw2-"));
  const work = mkdtempSync(join(tmpdir(), "ruyin-gw2-work-"));
  writeFileSync(join(work, "招标文件.md"), TENDER, "utf8");

  // 空 choices —— 形状问题，网关判它不可重试（再打一遍还是一样）。
  const fake = await startFakeOpenAI(() => ({ kind: "content", content: "" }));

  const storage = new SqliteStoragePort(dataDir, await KeyManager.open(dataDir));
  const runtime = new ProjectRuntime({
    storage,
    clock: nodeClock,
    id: nodeId,
    crypto: nodeCrypto,
    gateway: new LocalModelGateway({ baseUrl: fake.base, model: "fake-model" }),
    connectors: new Map([["local-fs", new LocalFsConnector()]]),
    ranker: new FtsRanker(storage),
    tools: new LocalToolExecutor((pid, q, scope, limit) =>
      searchContext(storage, pid, q, scope, limit),
    ),
    skills: MemorySkills.forContract(
      loadProducts(productsDir).loaded.find((p) => p.id === "bidproposal")!.contract,
    ),
  });

  try {
    const bid = loadProducts(productsDir).loaded.find((p) => p.id === "bidproposal")!;
    const meta = await runtime.createProject(bid.contract, "网关失败", "wsp_test");
    await runtime.addGrant(meta.id, work, "readwrite");
    const binding = await runtime.setBinding(meta.id, { type: "tender_document", root: work });
    await reindexBinding(storage, meta.id, binding, new LocalFsConnector());

    const harness = await runtime.createHarness(meta.id);
    const instance = await runToEnd(harness, "analyze_tender");
    assert.notEqual(instance.state, "completed", "空回复不能走成「做完了」");
  } finally {
    await fake.close();
    storage.closeAll();
    for (const d of [dataDir, work]) rmSync(d, { recursive: true, force: true });
  }
});
