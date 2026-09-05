/**
 * Runtime Conformance 套件 C1–C7（清单见 docs/30-design/50-harness.md §10）。
 *
 * runtime-core 是**规范实现**：Cloud Runtime 复用同一个内核，两个宿主各自实现
 * ports。「两个宿主行为一致」在此之前**没有任何东西保证** —— 各写各的单测，
 * 验的是各自的实现，验不出两边是否说同一种话。
 *
 * 所以这不是一批测试文件，是一个**可以跑在任何 ports 上的套件**：
 *
 *     const results = await runConformance(() => myHostPorts());
 *
 * 它不依赖任何测试框架 —— 返回结构化结果，各宿主用自己的 runner 包一层。
 * 依赖 node:test 就等于宣布只有 Node 宿主能验一致性，而那正好否定了它的用途。
 *
 * **它也不依赖任何具体产品。** 契约由调用方给（本仓用 products/bidproposal 这个夹具），
 * 检查断言的全是契约无关的语义：状态序列、闸门决策、检查点种类、审计顺序、
 * 恢复语义、验证顺序、硬底线。
 */

import { Harness } from "./harness.js";
import { decideTool } from "./tool-gate.js";
import { ProjectRuntime } from "./project.js";
import { toAuditView } from "./audit.js";
import type { RuyinContract as RuntimeContract } from "@vxture/ruyin-contract-schema";
import type { ProjectStore, RuntimePorts } from "./ports.js";
import type { TaskInstanceRecord } from "./harness.js";

export interface ConformanceCheck {
  /** C1..C7，对应 50-harness §10 的清单编号。 */
  id: string;
  title: string;
  passed: boolean;
  /** 没过时说清哪里不一致；过了也可以带上观察到的事实。 */
  detail: string;
}

export interface ConformanceInput {
  /** 每次检查都要一套干净的 ports —— 检查之间不共享状态。 */
  makePorts: () => Promise<RuntimePorts> | RuntimePorts;
  /** 被验的契约。本仓用 products/bidproposal 夹具；任何合法契约都应当通过。 */
  contract: RuntimeContract;
  /** 用完一套 ports 后的清理（关库、删临时目录）。 */
  dispose?: (ports: RuntimePorts) => Promise<void> | void;
}

type Check = (input: ConformanceInput) => Promise<ConformanceCheck>;

/** 每次检查独立开一套 ports，跑完即清理。 */
async function withPorts<T>(
  input: ConformanceInput,
  fn: (ports: RuntimePorts) => Promise<T>,
): Promise<T> {
  const ports = await input.makePorts();
  try {
    return await fn(ports);
  } finally {
    await input.dispose?.(ports);
  }
}

/**
 * 记录每一次任务实例落盘时的状态。
 *
 * 从**存储口**观察而不是从内存对象读：状态序列是持久化出来的事实，任何宿主
 * 都看得见同一串。读内存对象只能验到本进程里那一份。
 */
function recordStates(ports: RuntimePorts): string[] {
  const seen: string[] = [];
  const inner = ports.storage;
  // Proxy 而不是对象展开：宿主的 ProjectStore 多半是**类实例**，展开只复制自有
  // 可枚举属性，原型上的方法一个都不会跟过来 —— 包出来的东西看着像个 store，
  // 一调 putMeta 就炸。套件要能包住任何宿主的实现，就不能对它的构造方式做假设。
  const wrap = (store: ProjectStore): ProjectStore =>
    new Proxy(store, {
      get(target, prop, receiver) {
        if (prop !== "putTaskInstance") {
          const value = Reflect.get(target, prop, receiver) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        }
        return async (id: string, json: string) => {
          const state = (JSON.parse(json) as { state?: string }).state;
          // 连续同态不记：落盘次数是实现细节，状态**序列**才是一致性要求。
          if (state && seen[seen.length - 1] !== state) seen.push(state);
          return target.putTaskInstance(id, json);
        };
      },
    });
  ports.storage = {
    createProjectStore: async (id) => wrap(await inner.createProjectStore(id)),
    openProjectStore: async (id) => {
      const store = await inner.openProjectStore(id);
      return store ? wrap(store) : undefined;
    },
    listProjectIds: () => inner.listProjectIds(),
  };
  return seen;
}

/** 一个只回文本的提供方：任务能跑完，且不引入任何工具调用。 */
function plainProvider(): RuntimePorts["gateway"] {
  return {
    turn: async (req) =>
      req.capability.startsWith("verify:")
        ? { kind: "verdict" as const, passed: true }
        : { kind: "content" as const, content: `[${req.capability}]` },
  };
}

/** 一个什么工具都跑得了的执行器，并记下真正被执行过几次。 */
function countingTools(log: string[]): NonNullable<RuntimePorts["tools"]> {
  return {
    supports: () => true,
    execute: async (req) => {
      log.push(req.tool);
      return { content: "ok" };
    },
  };
}

async function drive(
  harness: Harness,
  taskId: string,
  inputs?: Record<string, unknown>,
  approvals = 12,
): Promise<TaskInstanceRecord> {
  const created = await harness.startTask(taskId, inputs);
  let instance = await harness.advance(created.id);
  for (let i = 0; i < approvals && instance.state === "waiting_human"; i++) {
    await harness.decideCheckpoint(instance.id, true);
    instance = await harness.advance(instance.id);
  }
  return instance;
}

/** 契约无关地挑一个可跑的任务：第一个带能力的。 */
function pickTask(contract: RuntimeContract): string {
  const task = contract.tasks.find((t) => t.capabilities.length > 0);
  if (!task) throw new Error("契约里没有带能力的任务，无法验一致性");
  return task.id;
}

/**
 * 手动模式的输入：**从契约推出来**，不写死任何类型名。
 *
 * 手动模式跳过选取，但**必需上下文照样要有** —— 这是对的（缺了就跑不出结果），
 * 而套件不该因此绑死某个产品的类型名。给每个声明的输入类型一个占位引用即可：
 * 一致性验的是状态序列、检查点、审计顺序，不是资料内容。
 */
/**
 * 从工具的 input_schema 凑一份能过闸的参数。
 *
 * 闸门会校验必填项与 `x-ruyin-ref: path`（必须落在已授权目录内）。C5 要验的是
 * **恢复语义**，不是参数校验 —— 所以这里按 schema 生成合法值，路径统一放在
 * 调用方授权过的那个根下面。同样不写死任何产品的参数名。
 */
function toolArgs(
  contract: RuntimeContract,
  toolId: string,
  grantedRoot: string,
): Record<string, unknown> | undefined {
  const tool = contract.tools.find((t) => t.id === toolId);
  if (!tool) return undefined;
  const props = tool.input_schema.properties ?? {};
  const out: Record<string, unknown> = {};
  for (const name of tool.input_schema.required ?? []) {
    const spec = props[name];
    if (!spec) return undefined; // R13 会挡住这种契约，走到这里说明契约本身有问题
    if (spec["x-ruyin-ref"] === "path") {
      out[name] = `${grantedRoot}/conformance.md`;
    } else if (spec["x-ruyin-ref"] === "context_item") {
      return undefined; // 需要真实上下文项，换一个工具验
    } else if (spec["type"] === "array") {
      out[name] = [`${grantedRoot}/conformance.md`];
    } else if (spec["type"] === "integer" || spec["type"] === "number") {
      out[name] = 1;
    } else if (Array.isArray(spec["enum"])) {
      out[name] = spec["enum"][0];
    } else {
      out[name] = "conformance";
    }
  }
  return out;
}

function manualInputs(
  contract: RuntimeContract,
  taskId: string,
): Record<string, unknown> {
  const task = contract.tasks.find((t) => t.id === taskId);
  const out: Record<string, unknown> = {};
  for (const type of task?.input_types ?? []) {
    out[type] = { ref: `conformance://${type}` };
  }
  return out;
}

/* ── C1 ─────────────────────────────────────────────────────────────────── */

const c1: Check = async (input) => {
  const taskId = pickTask(input.contract);
  const runOnce = async (): Promise<string[]> =>
    withPorts(input, async (ports) => {
      const states = recordStates(ports);
      ports.gateway = plainProvider();
      ports.tools = countingTools([]);
      const runtime = new ProjectRuntime(ports);
      const meta = await runtime.createProject(input.contract, "c1", "wsp_conf");
      const harness = await runtime.createHarness(meta.id);
      await drive(harness, taskId, manualInputs(input.contract, taskId));
      return states;
    });
  const a = await runOnce();
  const b = await runOnce();
  const same = a.length > 0 && a.join(">") === b.join(">");
  return {
    id: "C1",
    title: "同一契约 + 同一输入 → 状态序列一致",
    passed: same,
    detail: same ? a.join(" > ") : `两次不同：\n  ${a.join(" > ")}\n  ${b.join(" > ")}`,
  };
};

/* ── C2 ─────────────────────────────────────────────────────────────────── */

const c2: Check = async (input) => {
  // 闸门是纯函数：同一份契约默认 + 同一用户策略，决策必须逐条相同。
  const rows = input.contract.tools.map((tool) => {
    const base = decideTool({
      tool,
      permissions: input.contract.permissions,
      askCache: new Set<string>(),
    });
    const relaxed = decideTool({
      tool,
      permissions: input.contract.permissions,
      userPolicy: "allow",
      askCache: new Set<string>(),
    });
    return `${tool.id}:${base.value}/${base.source}|allow→${relaxed.value}/${relaxed.source}`;
  });
  const again = input.contract.tools.map((tool) => {
    const base = decideTool({
      tool,
      permissions: input.contract.permissions,
      askCache: new Set<string>(),
    });
    const relaxed = decideTool({
      tool,
      permissions: input.contract.permissions,
      userPolicy: "allow",
      askCache: new Set<string>(),
    });
    return `${tool.id}:${base.value}/${base.source}|allow→${relaxed.value}/${relaxed.source}`;
  });
  const same = rows.join("\n") === again.join("\n");
  return {
    id: "C2",
    title: "同一契约默认 + 同一用户策略 → Tool Gate 决策一致",
    passed: same && rows.length > 0,
    detail: rows.join("\n"),
  };
};

/* ── C3 ─────────────────────────────────────────────────────────────────── */

const c3: Check = async (input) => {
  const taskId = pickTask(input.contract);
  const kinds = await withPorts(input, async (ports) => {
    ports.gateway = plainProvider();
    ports.tools = countingTools([]);
    const runtime = new ProjectRuntime(ports);
    const meta = await runtime.createProject(input.contract, "c3", "wsp_conf");
    const harness = await runtime.createHarness(meta.id);
    const instance = await drive(harness, taskId, manualInputs(input.contract, taskId));
    return {
      kinds: instance.checkpoints.map((c) => c.kind),
      state: instance.state,
      error: instance.error,
    };
  });
  // 契约里带 human 验证的任务必须停在 verification_review —— 停不下来，
  // 「人在回路」就只是文档里的一句话。
  const ok = kinds.kinds.includes("verification_review");
  return {
    id: "C3",
    title: "Checkpoint 触发点与 kind 一致",
    passed: ok,
    detail: ok
      ? kinds.kinds.join(" > ")
      : `未出现 verification_review｜检查点 ${kinds.kinds.join(" > ") || "（无）"}` +
        `｜末态 ${kinds.state}${kinds.error ? `｜${kinds.error}` : ""}`,
  };
};

/* ── C4 ─────────────────────────────────────────────────────────────────── */

const c4: Check = async (input) => {
  const taskId = pickTask(input.contract);
  const runOnce = async (): Promise<string[]> =>
    withPorts(input, async (ports) => {
      ports.gateway = plainProvider();
      ports.tools = countingTools([]);
      const runtime = new ProjectRuntime(ports);
      const meta = await runtime.createProject(input.contract, "c4", "wsp_conf");
      const harness = await runtime.createHarness(meta.id);
      await drive(harness, taskId, manualInputs(input.contract, taskId));
      // 只取动作名与结果：内容哈希随 AI 非确定输出而变，清单已把它排除在外。
      return (await runtime.listAuditEvents(meta.id))
        .map(toAuditView)
        .map((e) => `${e.action}:${e.outcome}`);
    });
  const a = await runOnce();
  const b = await runOnce();
  const same = a.length > 0 && a.join(">") === b.join(">");
  return {
    id: "C4",
    title: "审计事件种类与顺序一致（内容哈希除外）",
    passed: same,
    detail: same ? `${a.length} 条：${a.join(" > ")}` : `两次不同：\n  ${a.join(" > ")}\n  ${b.join(" > ")}`,
  };
};

/* ── C5 ─────────────────────────────────────────────────────────────────── */

const c5: Check = async (input) => {
  const taskId = pickTask(input.contract);
  const executed: string[] = [];
  const outcome = await withPorts(input, async (ports) => {
    ports.tools = countingTools(executed);
    // 提供方第一回合要一次工具，第二回合交答案。第一次 advance 之后进程「死」，
    // 由一个全新的 Harness 走 recover —— 这正是 journal-before-write 要保证的
    // 那件事：已经发生过的副作用不重来。
    const grantedRoot = "/conformance-root";
    // 挑第一个参数凑得出来的工具：有的工具要真实上下文项，那种换一个。
    const candidates = input.contract.tasks.find((t) => t.id === taskId)?.tools ?? [];
    let toolId: string | undefined;
    let args: Record<string, unknown> | undefined;
    for (const id of candidates) {
      const a = toolArgs(input.contract, id, grantedRoot);
      if (a) { toolId = id; args = a; break; }
    }
    let asked = false;
    ports.gateway = {
      turn: async (req) => {
        if (req.capability.startsWith("verify:")) return { kind: "verdict" as const, passed: true };
        if (!asked && toolId) {
          asked = true;
          return {
            kind: "tool_calls" as const,
            calls: [{ id: "c5", tool: toolId, arguments: args ?? {} }],
          };
        }
        return { kind: "content" as const, content: "done" };
      },
    };
    const runtime = new ProjectRuntime(ports);
    const meta = await runtime.createProject(input.contract, "c5", "wsp_conf");
    await runtime.addGrant(meta.id, grantedRoot, "readwrite");
    const harness = await runtime.createHarness(meta.id);
    const created = await harness.startTask(taskId, manualInputs(input.contract, taskId));
    let instance = await harness.advance(created.id);
    // 工具是 ask 类时先过检查点，好让它真的执行一次。
    for (let i = 0; i < 4 && instance.state === "waiting_human"; i++) {
      await harness.decideCheckpoint(instance.id, true);
      instance = await harness.advance(instance.id);
    }
    const before = executed.length;
    // 全新 Harness 重入：模拟进程死后恢复。
    const revived = await runtime.createHarness(meta.id);
    await revived.recover(instance.id).catch(() => undefined);
    return { before, after: executed.length, toolId, state: instance.state, error: instance.error };
  });
  const ok = outcome.before > 0 && outcome.after === outcome.before;
  return {
    id: "C5",
    title: "恢复后副作用不重复（journal-before-write 语义一致）",
    passed: ok,
    detail:
      outcome.before === 0
        ? `工具一次也没执行，这条检查没有验到东西｜末态 ${outcome.state}${outcome.error ? `｜${outcome.error}` : ""}`
        : `${outcome.toolId} 执行 ${outcome.before} 次，恢复后 ${outcome.after} 次`,
  };
};

/* ── C6 ─────────────────────────────────────────────────────────────────── */

const c6: Check = async (input) => {
  const taskId = pickTask(input.contract);
  const result = await withPorts(input, async (ports) => {
    ports.tools = countingTools([]);
    // 让自动验证一直失败：修订轮必须有界，且末端恒为人。
    ports.gateway = {
      turn: async (req) =>
        req.capability.startsWith("verify:")
          ? { kind: "verdict" as const, passed: false, reason: "conformance" }
          : { kind: "content" as const, content: "x" },
    };
    const runtime = new ProjectRuntime(ports);
    const meta = await runtime.createProject(input.contract, "c6", "wsp_conf");
    const harness = await runtime.createHarness(meta.id);
    const instance = await drive(harness, taskId, manualInputs(input.contract, taskId), 12);
    // **从审计轨迹读，不从 instance.verification 读**：修订轮会把失败项从那个
    // 数组里过滤掉（好让它重做），所以内存里那份不是执行历史。审计是。
    const events = (await runtime.listAuditEvents(meta.id)).map(toAuditView);
    const order = events
      .filter((e) => e.action === "verification.run")
      .map((e) => (e.payload as { kind?: string }).kind ?? "?");
    const revisions = events.filter((e) => e.action === "task.revision").length;
    const humanGate = events.some(
      (e) =>
        e.action === "checkpoint.raised" &&
        (e.payload as { kind?: string }).kind === "verification_review",
    );
    return { state: instance.state, revisions, order, humanGate, error: instance.error };
  });
  // 顺序：便宜的先跑，人最后（50-harness 7.1）。每一轮内部都要满足这个次序。
  const rank: Record<string, number> = { automated: 0, ai_assisted: 1, human: 2 };
  const order = result.order;
  const sorted = order.every(
    (k, i) => i === 0 || rank[order[i - 1]!]! <= rank[k]! || rank[k] === 0,
  );
  const bounded = result.revisions <= 2;
  // **末端恒为人**：自动验证一直失败，最后一定要停到人那里 —— 否则「修订有界」
  // 的结局就成了机器自己判自己过。
  const endsOnHuman = result.humanGate;
  const ok = sorted && bounded && endsOnHuman;
  return {
    id: "C6",
    title: "验证规则执行顺序与修订轮语义一致",
    passed: ok,
    detail:
      `顺序 ${order.join(">") || "（无）"}｜修订 ${result.revisions} 轮｜末态 ${result.state}｜人工门 ${result.humanGate}${result.error ? `｜${result.error}` : ""}` +
      (ok ? "" : `｜顺序对=${sorted} 有界=${bounded} 末端有人=${endsOnHuman}`),
  };
};

/* ── C7 ─────────────────────────────────────────────────────────────────── */

const c7: Check = async (input) => {
  // **硬底线不能靠契约里恰好有那种工具来验。**
  //
  // 第一版只遍历契约自带的工具，而这份契约一个 external_send 都没有 —— 于是
  // 这条检查永远通过：把 HARD_FLOOR 整条删掉它也照样绿。一条不可能失败的检查
  // 比没有这条检查更糟，因为它让人以为验过了。
  //
  // 所以底线用**合成工具**验：底线是内核的不变量，与任何契约无关。
  const synthetic = {
    id: "conformance.external_send",
    category: "external_send",
    risk: "high",
    default: "allow", // 契约把它写成最宽松的，底线也必须压住
    input_schema: { type: "object", properties: {}, required: [] },
  } as unknown as RuntimeContract["tools"][number];

  const violations: string[] = [];
  const probe = (tool: RuntimeContract["tools"][number], label: string) => {
    for (const policy of ["allow", "ask", "deny"] as const) {
      const d = decideTool({
        tool,
        permissions: input.contract.permissions,
        userPolicy: policy,
        // askCache 也不能松开被兜底的操作：「批准过一次」不是对下一次的同意。
        askCache: new Set([tool.id]),
      });
      if (tool.category === "external_send" && d.value === "allow") {
        violations.push(`${label} 在 userPolicy=${policy} 下变成了 allow`);
      }
    }
  };
  probe(synthetic, "合成 external_send 工具");
  for (const tool of input.contract.tools) probe(tool, tool.id);

  // 契约层的底线（permissions 三项不得为 allow）由 R10 挡；这里再验一次运行时
  // 侧：契约就算写了 allow，闸门也不放行。
  const floorHeld = decideTool({
    tool: synthetic,
    permissions: { ...input.contract.permissions, external_send: "allow" } as RuntimeContract["permissions"],
    userPolicy: "allow",
    askCache: new Set([synthetic.id]),
  });
  if (floorHeld.value === "allow") {
    violations.push("permissions.external_send=allow 时底线被绕过");
  }

  return {
    id: "C7",
    title: "硬底线在任何配置下不可绕过",
    passed: violations.length === 0,
    detail:
      violations.length === 0
        ? `合成 external_send + 契约自带 ${input.contract.tools.length} 个工具，` +
          `在 allow/ask/deny × askCache 命中 × permissions 放宽下均未放行`
        : violations.join("\n"),
  };
};

const CHECKS: Check[] = [c1, c2, c3, c4, c5, c6, c7];

/**
 * 跑完 C1–C7。**任何一条抛错也算不通过**，不让异常冒出去 —— 一个中途炸掉的
 * 套件和一个报告失败的套件，对调用方是两回事。
 */
export async function runConformance(
  input: ConformanceInput,
): Promise<ConformanceCheck[]> {
  const out: ConformanceCheck[] = [];
  for (const check of CHECKS) {
    try {
      out.push(await check(input));
    } catch (cause) {
      out.push({
        id: "?",
        title: "检查抛出异常",
        passed: false,
        detail: cause instanceof Error ? cause.stack ?? cause.message : String(cause),
      });
    }
  }
  return out;
}
