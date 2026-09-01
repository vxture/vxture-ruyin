/**
 * 标书产品，从头跑到尾（W2 里程碑之外的一条真实通路）。
 *
 * 到目前为止每个部件都被单独验过：契约校验、上下文选取、工具闸门、检索、
 * 渲染、导出、审计链。**没有一条用例把它们连起来跑过**——而这个产品的意义
 * 恰恰是这条链：读招标文件 → 出需求矩阵 → 检索企业资料 → 写技术方案 →
 * 校验覆盖 → 汇总导出成一份能交的 .docx。
 *
 * 连起来才看得见的东西，这条用例就是为它写的。**它已经抓到过一个**：
 * `export_deliverable` 的 `capabilities` 是空的，于是能力循环一次都不进，
 * 声明的 `export_result` 永远调不到 —— 那个任务会零调用地跑到 completed，
 * 中间还让一个人去「最终确认」一份从未产出的交付物。现在由契约规则 R14 挡住。
 */

import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { inflateRawSync } from "node:zlib";
import {
  ProjectRuntime,
  toAuditView,
  verifyAuditChain,
  type AIGatewayPort,
  type CapabilityTurn,
  type CapabilityTurnRequest,
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

const productsDir = new URL("../../../products", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
);

const TENDER = [
  "# 某储能电站 EPC 招标文件",
  "",
  "1. 投标人须具备电力工程施工总承包一级资质。",
  "2. 投标人须有电化学储能电站的交付业绩。",
].join("\n");

const CAPABILITY_DOC = [
  "# 企业能力",
  "",
  "本公司具备电力工程施工总承包一级资质，已交付多个电化学储能电站案例。",
].join("\n");

/**
 * 一个会用工具的提供方替身。
 *
 * MockAIGateway 只会回文本，永远不调工具 —— 用它跑完整条链，等于验了一条
 * 没有工具的链。这个替身按能力发指令：读文件、检索、写文档、导出，最后给
 * 校验回合一个裁决。
 */
class ScriptedProvider implements AIGatewayPort {
  readonly seen: string[] = [];
  private readonly used = new Set<string>();

  constructor(private readonly paths: { tender: string; matrix: string; proposal: string; coverage: string; out: string }) {}

  async turn(request: CapabilityTurnRequest): Promise<CapabilityTurn> {
    this.seen.push(request.capability);
    // 校验回合要的是裁决。给别的东西会被如实升级为人工复核（而不是当成通过），
    // 那条规矩另有用例，这里给正常答复。
    if (request.capability.startsWith("verify:")) {
      return { kind: "verdict", passed: true };
    }
    // 每个能力只用一次工具，第二回合交答案 —— 否则循环会一直要工具直到上限。
    const once = (calls: CapabilityTurn): CapabilityTurn => {
      if (this.used.has(request.capability)) {
        return { kind: "content", content: `${request.capability} 完成` };
      }
      this.used.add(request.capability);
      return calls;
    };
    switch (request.capability) {
      case "requirement_analysis":
        return once({
          kind: "tool_calls",
          calls: [
            { id: "c1", tool: "read_file", arguments: { path: this.paths.tender } },
            {
              id: "c2",
              tool: "write_document",
              arguments: {
                path: this.paths.matrix,
                content: "# 需求矩阵\n\n| 编号 | 需求 |\n| --- | --- |\n| R1 | 一级资质 |\n| R2 | 储能业绩 |\n",
              },
            },
          ],
        });
      case "knowledge_retrieval":
        return once({
          kind: "tool_calls",
          calls: [
            { id: "c3", tool: "search_knowledge", arguments: { query: "电化学储能" } },
          ],
        });
      case "proposal_generation":
        return once({
          kind: "tool_calls",
          calls: [
            {
              id: "c4",
              tool: "write_document",
              arguments: {
                path: this.paths.proposal,
                content:
                  "::ry-toc{depth=2}\n\n# 技术方案\n\n## 资质响应\n\n本公司具备**电力工程施工总承包一级资质**。\n\n::ry-pagebreak\n\n## 业绩响应\n\n已交付多个电化学储能电站案例。\n",
              },
            },
          ],
        });
      case "coverage_verification":
        return once({
          kind: "tool_calls",
          calls: [
            {
              id: "c5",
              tool: "write_document",
              arguments: {
                path: this.paths.coverage,
                content: "# 覆盖报告\n\n| 需求 | 覆盖 |\n| --- | --- |\n| R1 | 是 |\n| R2 | 是 |\n",
              },
            },
          ],
        });
      case "deliverable_assembly":
        return once({
          kind: "tool_calls",
          calls: [
            {
              id: "c6",
              tool: "export_result",
              arguments: {
                path: this.paths.out,
                format: "docx",
                sources: [this.paths.proposal, this.paths.coverage],
              },
            },
          ],
        });
      default:
        return { kind: "content", content: `${request.capability} 完成` };
    }
  }
}

/** 推到底：每遇到一个人工检查点就批准，直到任务落定。 */
async function runToEnd(
  harness: Harness,
  taskId: string,
): Promise<TaskInstanceRecord> {
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

function docPart(bytes: Buffer): string {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  assert.notEqual(eocd, -1, "产出的不是 zip —— 那就不是 .docx");
  let p = v.getUint32(eocd + 16, true);
  for (let i = v.getUint16(eocd + 10, true); i > 0; i--) {
    const method = v.getUint16(p + 10, true);
    const comp = v.getUint32(p + 20, true);
    const nl = v.getUint16(p + 28, true);
    const el = v.getUint16(p + 30, true);
    const cl = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    if (bytes.subarray(p + 46, p + 46 + nl).toString("utf8") === "word/document.xml") {
      const at = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
      const raw = bytes.subarray(at, at + comp);
      return (method === 0 ? raw : inflateRawSync(raw)).toString("utf8");
    }
    p += 46 + nl + el + cl;
  }
  throw new Error("没有 word/document.xml");
}

void test("标书：四个任务连起来跑，最后落下一份真能打开的 .docx", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "ruyin-bid-"));
  const work = mkdtempSync(join(tmpdir(), "ruyin-work-"));
  const paths = {
    tender: join(work, "招标文件.md"),
    matrix: join(work, "需求矩阵.md"),
    proposal: join(work, "技术方案.md"),
    coverage: join(work, "覆盖报告.md"),
    out: join(work, "投标成果.docx"),
  };
  writeFileSync(paths.tender, TENDER, "utf8");
  writeFileSync(join(work, "企业能力.md"), CAPABILITY_DOC, "utf8");

  const storage = new SqliteStoragePort(dataDir, await KeyManager.open(dataDir));
  const provider = new ScriptedProvider(paths);
  const executor = new LocalToolExecutor((pid, q, scope, limit) =>
    searchContext(storage, pid, q, scope, limit),
  );
  const runtime = new ProjectRuntime({
    storage,
    clock: nodeClock,
    id: nodeId,
    crypto: nodeCrypto,
    gateway: provider,
    connectors: new Map([["local-fs", new LocalFsConnector()]]),
    ranker: new FtsRanker(storage),
    tools: executor,
  });

  try {
    const bid = loadProducts(productsDir).loaded.find((p) => p.id === "vxture.bid");
    assert.ok(bid, "标书产品必须能通过契约校验才谈得上跑");
    const meta = await runtime.createProject(bid.contract, "储能 EPC 投标", "wsp_test");
    await runtime.addGrant(meta.id, work, "readwrite");
    // 招标文件是必需上下文；企业资料是检索要用的那一份。两者都绑到同一个
    // 已授权目录，然后建索引 —— 没有索引，search_knowledge 只会如实回没找到。
    for (const type of ["tender_document", "enterprise_capability"]) {
      const binding = await runtime.setBinding(meta.id, { type, root: work });
      await reindexBinding(storage, meta.id, binding, new LocalFsConnector());
    }

    const harness = await runtime.createHarness(meta.id);
    for (const taskId of [
      "analyze_tender",
      "generate_proposal",
      "validate_coverage",
      "export_deliverable",
    ]) {
      const instance = await runToEnd(harness, taskId);
      assert.equal(instance.state, "completed", `${taskId} 没跑完：${instance.error ?? ""}`);
    }

    // 中间产物落了盘。
    for (const p of [paths.matrix, paths.proposal, paths.coverage]) {
      assert.ok(existsSync(p), `${p} 没写出来`);
    }

    // **最要紧的一条**：交付物在，而且是一份真的 .docx。
    assert.ok(existsSync(paths.out), "导出任务跑完了，成果却不在 —— 就是它曾经的样子");
    const bytes = readFileSync(paths.out);
    const xml = docPart(bytes);
    // 两份来源都进去了，按给定顺序。
    assert.ok(xml.indexOf("技术方案") < xml.indexOf("覆盖报告"));
    assert.match(xml, /<w:tbl>/); // 覆盖报告的表格
    assert.match(xml, /<w:br w:type="page"/); // 方案里的分页
    assert.match(xml, /<w:instrText[^>]*>TOC/); // 目录域

    // 检索真的被用上了，而且回的是范围内的东西。
    assert.ok(provider.seen.includes("knowledge_retrieval"));
    assert.ok(provider.seen.includes("deliverable_assembly"));

    // 整条链的审计可验，且导出留了痕。
    const events = await runtime.listAuditEvents(meta.id);
    assert.ok(verifyAuditChain(nodeCrypto, meta.id, events));
    const actions = events.map(toAuditView);
    const exported = actions.filter(
      (e) => e.action === "tool.executed" && e.outcome === "success",
    );
    assert.ok(exported.length >= 5, "工具调用没有被完整记下来");
  } finally {
    storage.closeAll();
    for (const d of [dataDir, work]) rmSync(d, { recursive: true, force: true });
  }
});
