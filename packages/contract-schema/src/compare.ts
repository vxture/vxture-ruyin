/**
 * 既有项目能不能直接升到产品的新版本（ADR-024）—— 新契约对项目快照「只增不删、不改窄」。
 *
 * **看实际差异，不看版本号标签**：一个标成 minor 却删了东西的版本，照样不兼容
 * （30-contract-schema §18.4 的规则由这里执行）。新增的一律放行；文案、`input_schema`、
 * 默认权限、敏感度这些的变化随升级生效，不在这里拦（owner 2026-09-12：「无需这么重」）。
 *
 * 纯函数、放在同构的包里：本地与云端升级项目用的是同一个判断（§4 Same Validator,
 * Any Runtime）。
 */

import type { RuyinContract } from "./types.js";

export interface ContractBreak {
  /** 出问题的那一处：`tasks.generate_proposal`、`states.review->submitted`…… */
  path: string;
  /** 删了，还是改窄了。 */
  change: "removed" | "narrowed";
}

export interface ContractComparison {
  compatible: boolean;
  breaks: ContractBreak[];
}

function byId<T extends { id: string }>(list: readonly T[]): Map<string, T> {
  return new Map(list.map((x) => [x.id, x]));
}

/** 新契约对旧快照的「删 / 改窄」清单（ADR-024 §2.2 那张表，逐行对应）。 */
export function compareContracts(prev: RuyinContract, next: RuyinContract): ContractComparison {
  const breaks: ContractBreak[] = [];
  const removed = (path: string) => breaks.push({ path, change: "removed" });
  const narrowed = (path: string) => breaks.push({ path, change: "narrowed" });

  // project.type：容器形态（continuous ↔ project）变了，既有项目的形态就对不上了。
  if (prev.project.type !== next.project.type) narrowed("project.type");

  // objects：删对象、删关系、换主对象。
  const nextObjects = byId(next.objects);
  for (const o of prev.objects) {
    const n = nextObjects.get(o.id);
    if (!n) {
      removed(`objects.${o.id}`);
      continue;
    }
    if (o.primary && !n.primary) narrowed(`objects.${o.id}.primary`);
    for (const r of o.relations ?? []) {
      if (!(n.relations ?? []).some((x) => x.to === r.to && x.kind === r.kind)) {
        removed(`objects.${o.id}.relations.${r.kind}:${r.to}`);
      }
    }
  }

  // states：换挂载对象；删状态；删一条既有的转换。改 initial 只影响新项目，不算。
  if (prev.states.object !== next.states.object) narrowed("states.object");
  const nextStates = new Map(next.states.items.map((s) => [s.name, s]));
  for (const s of prev.states.items) {
    const n = nextStates.get(s.name);
    if (!n) {
      removed(`states.${s.name}`);
      continue;
    }
    for (const t of s.transitions) {
      if (!n.transitions.some((x) => x.to === t.to)) removed(`states.${s.name}->${t.to}`);
    }
  }

  // context.types：删类型；required false→true（既有项目可能没绑它，任务突然起不来）；
  // 删来源；改 class。
  const nextTypes = byId(next.context.types);
  for (const t of prev.context.types) {
    const n = nextTypes.get(t.id);
    if (!n) {
      removed(`context.types.${t.id}`);
      continue;
    }
    if (!t.required && n.required) narrowed(`context.types.${t.id}.required`);
    if (t.sources.some((s) => !n.sources.includes(s))) narrowed(`context.types.${t.id}.sources`);
    if (t.class !== n.class) narrowed(`context.types.${t.id}.class`);
  }

  // capabilities：删能力；改 kind。
  const nextCaps = byId(next.capabilities);
  for (const c of prev.capabilities) {
    const n = nextCaps.get(c.id);
    if (!n) removed(`capabilities.${c.id}`);
    else if (c.kind !== n.kind) narrowed(`capabilities.${c.id}.kind`);
  }

  // tools：删工具；改 category / provider（provider 缺省 runtime）。
  const nextTools = byId(next.tools);
  for (const t of prev.tools) {
    const n = nextTools.get(t.id);
    if (!n) {
      removed(`tools.${t.id}`);
      continue;
    }
    if (t.category !== n.category) narrowed(`tools.${t.id}.category`);
    if ((t.provider ?? "runtime") !== (n.provider ?? "runtime")) narrowed(`tools.${t.id}.provider`);
  }

  // tasks：删任务；删它声明过的 output_types（既有成果的类型就没了着落）。
  const nextTasks = byId(next.tasks);
  for (const t of prev.tasks) {
    const n = nextTasks.get(t.id);
    if (!n) {
      removed(`tasks.${t.id}`);
      continue;
    }
    for (const o of t.output_types) {
      if (!n.output_types.includes(o)) removed(`tasks.${t.id}.output_types.${o}`);
    }
  }

  return { compatible: breaks.length === 0, breaks };
}

/**
 * 两个产品版本号比大小（SemVer：数字三段，同号时正式版大于预发布版）。负数 = a 更旧。
 * 升级只往上走（ADR-024 §2.1），所以宿主与内核都要用同一个比法。
 */
export function compareProductVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core = "", pre] = v.split("-", 2);
    return { nums: core.split(".").map((x) => Number.parseInt(x, 10) || 0), pre };
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0);
    if (d !== 0) return d;
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === undefined) return 1;
  if (pb.pre === undefined) return -1;
  return pa.pre < pb.pre ? -1 : 1;
}
