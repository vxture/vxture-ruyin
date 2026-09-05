// ADR-019 探针 · 在 dsh 里注册一个真实工具，让 tool_calls 走完 dsh-tools 的流水线。
//
// 手写 ToolDefinition（node_modules/@deepseek-ai/dsh-tools/lib/types/index.d.ts:105-119），不走 defineTool：
// 契约里的 input_schema 是原生 JSON Schema，还带 `x-ruyin-ref`（ruyin.product.yaml:137-141）。
// register() 只校验 output / timeoutMs / 保留名（dsh-tools/lib/index.js:2774-2783），不碰 parameters，
// 所以契约 schema 原样进注册表。代价：dsh 不会替手写定义校验参数（只有 defineTool 会包一层，
// dsh-tools/lib/types/schema.js:293-316）—— 参数校验是 Tool Gate 那一步（第三天）的事。
//
// 三条"不是正常返回"的路径，给出处账本（tool-ledger.mjs）当探针：
//   path 以 "/" 开头   → registerSpikeGuard 的 guard 拒绝：工具体不被到达，dsh 写 `Error: ${reason}`（dsh-tools 3128-3140）
//   path "missing.pdf" → 工具体自己抛错：dsh 写 `Error: ${message}`（dsh-tools 3196-3197 → 3491-3503）
//   path "hang.pdf"    → 挂起到调用方取消，取消后**正常返回**：dsh 换成 toolAbortedResult（dsh-tools 3195, 3550-3565）。
//                        （若 reject 而不是 resolve，会落进 toolErrorResult，message 是 signal.reason 的字符串化——不是我们要的形状。）

/** 探针挂钩：hang.pdf 开始挂起时回调，探针用它选择取消时机。 */
export const spikeHooks = { onHang: undefined };

/** analyze_tender 声明的 read_file（yaml:133-141），description 与 harness.ts:1189 的 offer 文案相同。 */
export const READ_FILE_TOOL = {
  name: "read_file",
  description: "local_read (risk: low)",
  parameters: {
    type: "object",
    properties: { path: { type: "string", "x-ruyin-ref": "path" } },
    required: ["path"],
  },
  output: {
    schema: { type: "string" },
    render: (_args, value) => [{ type: "text", text: value }],
  },
  async execute(args, exec) {
    if (args.path === "missing.pdf") throw new Error(`ENOENT: no such file "${args.path}"`);
    if (args.path === "hang.pdf") {
      if (exec.signal.aborted) return "[spike] interrupted";
      return new Promise((resolve) => {
        exec.signal.addEventListener("abort", () => resolve("[spike] interrupted"), { once: true });
        spikeHooks.onHang?.(exec);
      });
    }
    return `[spike] contents of ${args.path}`;
  },
};

/** 在一个 inject 了 'tools' 的插件 ctx 上调用。返回注销函数。 */
export function registerSpikeTools(ctx) {
  return ctx.tools.register(READ_FILE_TOOL);
}

/**
 * Tool Gate 的雏形：dsh 的 guard（tools.guard()，dsh-tools/lib/index.js:2808-2822）在 tools/pre-execute 之后、
 * 工具体之前跑；返回字符串即拒绝，dsh 把它记成 `Error: ${reason}`（3128-3140）。
 * 这里只拒绝绝对路径（工作区之外）。返回注销函数。
 */
export function registerSpikeGuard(ctx) {
  return ctx.tools.guard((exec) => {
    if (exec.name !== "read_file") return undefined;
    const path = exec.arguments?.path;
    return typeof path === "string" && path.startsWith("/") ? `path "${path}" is outside the workspace` : undefined;
  });
}
