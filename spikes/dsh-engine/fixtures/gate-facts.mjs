// ADR-019 探针 · Tool Gate（H 组）的契约事实与工具体。
//
// 五个工具的 category / risk / default 与 products/bidproposal/ruyin.product.yaml:129-186 一一对应，
// 只是换了名字：第一~四轮注册的 `read_file` 还挂在同一棵启动树上（它的工具体是那几轮的攻击面），
// 同名注册会撞车。类别与默认值才是闸门看的东西，名字不是。
//
//   read_notes    ← read_file        local_read / low    / allow
//   write_note    ← write_document   local_write / medium/ ask     （path + content + context_item）
//   search_notes  ← search_knowledge query / low         / allow   （无 PERMISSION_KEY 的类别）
//   export_bundle ← export_result    export / high       / ask     （sources 是一**组**路径）
//   delete_draft  —— 契约默认 deny 的那一个（yaml 里没有；C5/C7 之外闸门的 deny 支要有人验）
//   send_report   —— 合成的 external_send 工具，契约默认 **allow**。
//                    bid 契约里没有任何 external_send 工具，所以 conformance C7 也是拿一个合成工具
//                    去验硬底线的（conformance.ts:438-448）—— 这里同理。
//
// permissions 与 yaml:237-242 相同（local_read allow / local_write ask / 其余 ask）。
// 场景 (c) 会把 external_send 放松成 allow：**decideTool 根本不读它**（external_send 没有
// PERMISSION_KEY，tool-gate.ts:52-57），放松了也不生效，硬底线照样把它顶到 ask。

export const GRANTED_ROOT = "C:/work/bid";
/** 兄弟前缀陷阱：它不在 GRANTED_ROOT 里（isPathGranted 在比较前给两边都补了尾斜杠，project.ts:93-98）。 */
export const SIBLING_ROOT = "C:/work/bid-secrets";

const pathParam = { type: "string", "x-ruyin-ref": "path" };

/** 契约的 Tool 记录（contract-schema types.ts:127-136；input_schema 必填）。 */
export const GATE_CONTRACT_TOOLS = Object.freeze([
  {
    id: "read_notes",
    category: "local_read",
    risk: "low",
    default: "allow",
    input_schema: { type: "object", properties: { path: pathParam }, required: ["path"] },
  },
  {
    id: "write_note",
    category: "local_write",
    risk: "medium",
    default: "ask",
    input_schema: {
      type: "object",
      properties: { path: pathParam, content: { type: "string" }, source: { type: "string", "x-ruyin-ref": "context_item" } },
      required: ["path", "content"],
    },
  },
  {
    id: "search_notes",
    category: "query",
    risk: "low",
    default: "allow",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 50 } },
      required: ["query"],
    },
  },
  {
    id: "export_bundle",
    category: "export",
    risk: "high",
    default: "ask",
    input_schema: {
      type: "object",
      properties: { path: pathParam, format: { type: "string", enum: ["docx", "pdf"] }, sources: { type: "array", "x-ruyin-ref": "path" } },
      required: ["path", "format", "sources"],
    },
  },
  {
    id: "delete_draft",
    category: "local_write",
    risk: "high",
    default: "deny",
    input_schema: { type: "object", properties: { path: pathParam }, required: ["path"] },
  },
  {
    id: "send_report",
    category: "external_send",
    risk: "high",
    default: "allow", // 故意的：契约说 allow，硬底线仍然把它顶到 ask
    input_schema: {
      type: "object",
      properties: { recipient: { type: "string" }, path: pathParam },
      required: ["recipient", "path"],
    },
  },
]);

/** 与 yaml:237-242 相同。 */
export const GATE_PERMISSIONS = Object.freeze({
  local_read: "allow",
  local_write: "ask",
  delete: "ask",
  external_send: "ask",
  sync_to_cloud: "ask",
});

/** store.getGrants() 的形状（ports.ts:309-315；文件夹授权没有 kind）。 */
export const GATE_GRANTS = Object.freeze([
  Object.freeze({ id: "grant_1", path: GRANTED_ROOT, mode: "readwrite", createdAt: "2026-09-06T00:00:00.000Z" }),
]);

/** instance.contextSet（ports.ts:379-394）：x-ruyin-ref: context_item 的上限。 */
export const GATE_CONTEXT_SET = Object.freeze([
  Object.freeze({
    id: "ci_tender",
    type: "tender_document",
    source: "local",
    connector: "local-fs",
    ref: `${GRANTED_ROOT}/tender.pdf`,
    name: "tender.pdf",
    bytes: 4096,
    modifiedAt: "2026-09-05T10:00:00.000Z",
  }),
]);

/** 默认的任务级白名单（= instance.definition.tools）。send_report / write_note 由场景按需加。 */
export const DEFAULT_TASK_TOOLS = Object.freeze(["read_notes", "write_note", "search_notes", "delete_draft"]);

/** dsh 注册表里真会被派发的那几个（= 适配器算 offer 时的"可见性"）。 */
export const REGISTERED_TOOLS = Object.freeze(["read_notes", "write_note", "search_notes", "delete_draft", "send_report"]);

/**
 * 工具体真的跑过几次 —— 每个场景的核心断言。无原型对象：工具名来自契约字符串。
 * @type {Record<string, number>}
 */
export const toolRuns = Object.assign(Object.create(null), {});
/** 工具体**实际收到**的参数（不是模型发的那份）：判定之后被换过没有，只有这里看得见。 */
export const lastArgs = Object.assign(Object.create(null), {});
export function resetToolRuns() {
  for (const key of Object.keys(toolRuns)) delete toolRuns[key];
  for (const key of Object.keys(lastArgs)) delete lastArgs[key];
}
function ran(name, args) {
  toolRuns[name] = (Object.hasOwn(toolRuns, name) ? toolRuns[name] : 0) + 1;
  lastArgs[name] = args;
  return `[gate] ${name} ran`;
}

/**
 * 手写 ToolDefinition（不走 defineTool）：契约的 input_schema 原样进注册表，
 * dsh 因此**不替我们校验参数**（dsh-tools/lib/types/schema.js:293-316 只包 defineTool 的那一层）——
 * 未声明的参数、越界的路径都会原样到达闸门，这正是 H 组要验的。
 */
const definition = (name, properties, required) => ({
  name,
  description: `spike gate tool ${name}`,
  parameters: { type: "object", properties, required },
  output: { schema: { type: "string" }, render: (_args, value) => [{ type: "text", text: value }] },
  async execute(args) {
    return ran(name, args);
  },
});

/** 在一个 inject 了 'tools' 的 ctx 上注册 H 组的工具。返回注销函数。 */
export function registerGateTools(ctx) {
  const disposers = GATE_CONTRACT_TOOLS.filter((t) => REGISTERED_TOOLS.includes(t.id)).map((t) =>
    ctx.tools.register(definition(t.id, t.input_schema.properties, t.input_schema.required)),
  );
  return () => {
    for (const dispose of disposers) if (typeof dispose === "function") dispose();
  };
}

/**
 * 一个会话的全部事实。offer（facts.tools）按 harness.toolOffers 的文案算
 * （`${category} (risk: ${risk})`，harness.ts:1189）。
 *
 * 注意 offer 与 gate.taskTools 是**两个**清单：内核里 offer 就是从任务的 tools[] 来的，
 * 两者不会不一致；这里故意让它们能不一致（场景 h），因为闸门正是"万一不一致"时的那道底 ——
 * 派发只看 dsh 注册表可见性，不看 offer（dsh-tools 2907-2912）。
 *
 * @param {string} taskId
 * extraOffer 是「契约里没有、但这一轮报给能力面了」的工具（H11：dsh 注册表里那个第一~四轮的
 * read_file）。闸门要能拦住它 —— 注册表可见 ≠ 契约声明过。
 *
 * @param {{permissions?: object, taskTools?: string[], userPolicy?: object, askCache?: string[], gate?: null, offer?: string[], extraOffer?: Array<{id: string, description: string}>}} [overrides]
 */
export function gateFactsFor(taskId, overrides = {}) {
  const offerIds = overrides.offer ?? REGISTERED_TOOLS;
  const facts = {
    capability: "requirement_analysis",
    product: "bidproposal",
    taskId,
    workspace: "ws_spike",
    objective: "解析招标文件，生成需求矩阵",
    constraints: ["需求条目必须可回溯到招标原文"],
    context: [
      {
        type: "tender_document",
        name: "tender.pdf",
        content: { kind: "text", text: "第一章 项目概况\n2.1 系统须支持国密算法。" },
        origin: { kind: "local_file", connector: "local-fs" },
      },
    ],
    tools: [
      ...GATE_CONTRACT_TOOLS.filter((t) => offerIds.includes(t.id)).map((t) => ({
        id: t.id,
        description: `${t.category} (risk: ${t.risk})`,
      })),
      ...(overrides.extraOffer ?? []),
    ],
  };
  if (overrides.gate === null) return facts; // 场景 H0：这个会话没有闸门事实 → 闸门必须拒
  return {
    ...facts,
    gate: {
      tools: [...GATE_CONTRACT_TOOLS],
      permissions: { ...GATE_PERMISSIONS, ...(overrides.permissions ?? {}) },
      taskTools: overrides.taskTools ?? [...DEFAULT_TASK_TOOLS],
      grants: [...GATE_GRANTS],
      contextSet: [...GATE_CONTEXT_SET],
      ...(overrides.userPolicy === undefined ? {} : { userPolicy: overrides.userPolicy }),
      askCache: [...(overrides.askCache ?? [])],
    },
  };
}
