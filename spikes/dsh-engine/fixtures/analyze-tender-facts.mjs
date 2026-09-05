// ADR-019 探针 · analyze_tender 任务的事实（与 products/bidproposal/ruyin.product.yaml:186-197 一致）。
//
// tools 的 description 是 harness.ts:1189 会算出来的 `${category} (risk: ${risk})`：
// read_file = local_read / low（yaml:133-141），write_document = local_write / medium（yaml:143-153）。
// dsh 这边只注册了 read_file，所以适配器求交集后只会 offer read_file，write_document 计入 toolsNotVisible。

/** @type {import('../task-facts.mjs').TaskFacts} */
export const analyzeTenderFacts = Object.freeze({
  capability: "requirement_analysis",
  product: "bidproposal",
  taskId: "t1",
  workspace: "ws_spike",
  objective: "解析招标文件，生成需求矩阵",
  constraints: ["需求条目必须可回溯到招标原文"],
  context: [
    {
      type: "tender_document",
      name: "tender.pdf",
      content: {
        kind: "text",
        text: "第一章 项目概况\n1.1 本项目为某市政务云平台建设。\n第二章 技术要求\n2.1 系统须支持国密算法。\n2.2 数据须本地存储。",
      },
      origin: { kind: "local_file", connector: "local-fs" },
    },
  ],
  tools: [
    { id: "read_file", description: "local_read (risk: low)" },
    { id: "write_document", description: "local_write (risk: medium)" },
  ],
});

/** 同一任务换一个 taskId（一个 dsh 会话对应一个任务实例，会话 id = taskId）。 */
export function factsForTask(taskId) {
  return { ...analyzeTenderFacts, taskId };
}
