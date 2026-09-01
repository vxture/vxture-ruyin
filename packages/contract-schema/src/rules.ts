/**
 * Semantic validation rules (L2 referential + L3 compatibility layers).
 *
 * 编号是稀疏的：R2 已退役且编号不复用，R6/R12 属于别的层。**权威清单是
 * docs/30-design/30-contract-schema.md 的规则表**，不是这里的某个区间写法 ——
 * 写成区间的地方每加一条规则就会过期一次，而过期的注释读起来和正确的一样。
 * Design authority: docs/30-design/30-contract-schema.md section 15.
 *
 * R6 (no model/provider binding on capabilities) is enforced structurally by
 * `additionalProperties: false` in the JSON Schema; validate.ts maps those
 * structural hits back to rule id R6. R12 (package signature) is a package-
 * layer check (L4) and lives outside this validator.
 *
 * Rules assume a structurally valid document (they run only after L1 passes).
 */

import type { RuyinContract, ValidationError } from "./types.js";
import { SUPPORTED_CONTRACT_VERSIONS } from "./schema.js";

type Rule = (c: RuyinContract, errors: ValidationError[]) => void;

function err(
  errors: ValidationError[],
  rule: string,
  path: string,
  message: string,
): void {
  errors.push({ rule, path, message });
}

function dupes(ids: string[]): string[] {
  const seen = new Set<string>();
  const out = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) out.add(id);
    seen.add(id);
  }
  return [...out];
}

// R1 - supported contract schema version (top-level key completeness is L1).
const r1: Rule = (c, errors) => {
  if (!SUPPORTED_CONTRACT_VERSIONS.includes(c.contract)) {
    err(
      errors,
      "R1",
      "contract",
      `contract schema version "${c.contract}" is not supported (supported: ${SUPPORTED_CONTRACT_VERSIONS.join(", ")})`,
    );
  }
};

// R2 - RETIRED. It checked that the container type and lifecycle agreed,
// which was only ever necessary because the two fields said the same thing in
// different words. They are now one field, so the rule has nothing left to
// check. The number is not reused.

// R3 - relations reference declared objects; exactly one primary object.
const r3: Rule = (c, errors) => {
  const ids = new Set(c.objects.map((o) => o.id));
  c.objects.forEach((o, i) => {
    (o.relations ?? []).forEach((rel, j) => {
      if (!ids.has(rel.to)) {
        err(
          errors,
          "R3",
          `objects[${i}].relations[${j}].to`,
          `relation target "${rel.to}" is not a declared object`,
        );
      }
    });
  });
  const primaries = c.objects.filter((o) => o.primary === true);
  if (primaries.length !== 1) {
    err(
      errors,
      "R3",
      "objects",
      `exactly one object must have primary: true (found ${primaries.length})`,
    );
  }
};

// R4 - state machine mounted on the primary object; initial and all
// transition targets declared; no unreachable states.
const r4: Rule = (c, errors) => {
  const primary = c.objects.filter((o) => o.primary === true);
  if (primary.length === 1 && primary[0] && c.states.object !== primary[0].id) {
    err(
      errors,
      "R4",
      "states.object",
      `state machine must be mounted on the primary object "${primary[0].id}", got "${c.states.object}"`,
    );
  }
  const names = new Set(c.states.items.map((s) => s.name));
  if (!names.has(c.states.initial)) {
    err(
      errors,
      "R4",
      "states.initial",
      `initial state "${c.states.initial}" is not declared in states.items`,
    );
    return; // reachability is meaningless without a valid initial state
  }
  let targetsValid = true;
  c.states.items.forEach((s, i) => {
    s.transitions.forEach((t, j) => {
      if (!names.has(t.to)) {
        targetsValid = false;
        err(
          errors,
          "R4",
          `states.items[${i}].transitions[${j}].to`,
          `transition target "${t.to}" is not a declared state`,
        );
      }
    });
  });
  if (!targetsValid) return;
  const adjacency = new Map(
    c.states.items.map((s) => [s.name, s.transitions.map((t) => t.to)]),
  );
  const visited = new Set<string>([c.states.initial]);
  const queue = [c.states.initial];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  for (const name of names) {
    if (!visited.has(name)) {
      err(errors, "R4", "states.items", `state "${name}" is unreachable from initial "${c.states.initial}"`);
    }
  }
};

// R5 - unique ids across every collection; required context types must
// declare at least one allowed source.
const r5: Rule = (c, errors) => {
  const collections: Array<[string, string[]]> = [
    ["objects", c.objects.map((o) => o.id)],
    ["context.types", c.context.types.map((t) => t.id)],
    ["capabilities", c.capabilities.map((x) => x.id)],
    ["tools", c.tools.map((x) => x.id)],
    ["tasks", c.tasks.map((x) => x.id)],
    ["states.items", c.states.items.map((s) => s.name)],
  ];
  for (const [path, ids] of collections) {
    for (const d of dupes(ids)) {
      err(errors, "R5", path, `duplicate id "${d}"`);
    }
  }
  c.context.types.forEach((t, i) => {
    if (t.required && t.sources.length === 0) {
      err(
        errors,
        "R5",
        `context.types[${i}].sources`,
        `required context type "${t.id}" must declare at least one source`,
      );
    }
  });
};

// R7 - high-risk tools may not default to allow; external_send is fixed to ask.
const r7: Rule = (c, errors) => {
  c.tools.forEach((t, i) => {
    if (t.risk === "high" && t.default === "allow") {
      err(
        errors,
        "R7",
        `tools[${i}].default`,
        `high-risk tool "${t.id}" must not default to allow`,
      );
    }
    if (t.category === "external_send" && t.default !== "ask") {
      err(
        errors,
        "R7",
        `tools[${i}].default`,
        `external_send tool "${t.id}" default is fixed to ask`,
      );
    }
  });
};

// R8 - task references resolve; output types are generated or derived.
const r8: Rule = (c, errors) => {
  const contextIds = new Set(c.context.types.map((t) => t.id));
  const contextClass = new Map(c.context.types.map((t) => [t.id, t.class]));
  const capabilityIds = new Set(c.capabilities.map((x) => x.id));
  const toolIds = new Set(c.tools.map((x) => x.id));
  c.tasks.forEach((task, i) => {
    task.input_types.forEach((id, j) => {
      if (!contextIds.has(id)) {
        err(errors, "R8", `tasks[${i}].input_types[${j}]`, `unknown context type "${id}"`);
      }
    });
    task.output_types.forEach((id, j) => {
      if (!contextIds.has(id)) {
        err(errors, "R8", `tasks[${i}].output_types[${j}]`, `unknown context type "${id}"`);
        return;
      }
      const cls = contextClass.get(id);
      if (cls !== "generated" && cls !== "derived") {
        err(
          errors,
          "R8",
          `tasks[${i}].output_types[${j}]`,
          `output type "${id}" must have class generated or derived (got ${cls})`,
        );
      }
    });
    task.capabilities.forEach((id, j) => {
      if (!capabilityIds.has(id)) {
        err(errors, "R8", `tasks[${i}].capabilities[${j}]`, `unknown capability "${id}"`);
      }
    });
    task.tools.forEach((id, j) => {
      if (!toolIds.has(id)) {
        err(errors, "R8", `tasks[${i}].tools[${j}]`, `unknown tool "${id}"`);
      }
    });
  });
};

// R9 - every task verifies (minItems is L1); tasks producing generated-class
// output must include a human verification step.
const r9: Rule = (c, errors) => {
  const contextClass = new Map(c.context.types.map((t) => [t.id, t.class]));
  c.tasks.forEach((task, i) => {
    const producesGenerated = task.output_types.some(
      (id) => contextClass.get(id) === "generated",
    );
    const hasHuman = task.verification.some((v) => v.kind === "human");
    if (producesGenerated && !hasHuman) {
      err(
        errors,
        "R9",
        `tasks[${i}].verification`,
        `task "${task.id}" produces generated-class output and must include a human verification rule`,
      );
    }
  });
};

// R10 - hard floors: delete / external_send / sync_to_cloud never default allow.
const r10: Rule = (c, errors) => {
  const floors: Array<keyof RuyinContract["permissions"]> = [
    "delete",
    "external_send",
    "sync_to_cloud",
  ];
  for (const key of floors) {
    if (c.permissions[key] === "allow") {
      err(errors, "R10", `permissions.${key}`, `"${key}" must not default to allow`);
    }
  }
};

// R11 - temporary data class is fixed to local_only.
const r11: Rule = (c, errors) => {
  c.sync.classes.forEach((entry, i) => {
    if (entry.class === "temporary" && entry.policy !== "local_only") {
      err(
        errors,
        "R11",
        `sync.classes[${i}].policy`,
        `temporary data class sync policy is fixed to local_only (got ${entry.policy})`,
      );
    }
  });
};

/**
 * R13 - a tool's input_schema must be usable by the Tool Gate.
 *
 * L1 already fixes the shape; this checks the parts a JSON Schema cannot:
 * every name in `required` is actually declared, and a path-class tool
 * carries at least one annotated parameter. The second half matters most -
 * a tool that writes files but marks no parameter as a path would sail past
 * the grant check with nothing to check, which reads as "allowed" rather
 * than "unverifiable".
 */
const PATH_CLASS: ReadonlySet<string> = new Set([
  "local_read",
  "local_write",
  "export",
]);

const r13: Rule = (c, errors) => {
  c.tools.forEach((tool, i) => {
    const schema = tool.input_schema;
    const declared = Object.keys(schema.properties ?? {});
    for (const name of schema.required ?? []) {
      if (!declared.includes(name)) {
        err(
          errors,
          "R13",
          `tools[${i}].input_schema.required`,
          `tool "${tool.id}" requires parameter "${name}" but does not declare it`,
        );
      }
    }
    if (PATH_CLASS.has(tool.category)) {
      const annotated = declared.some(
        (name) => schema.properties[name]?.["x-ruyin-ref"] === "path",
      );
      if (!annotated) {
        err(
          errors,
          "R13",
          `tools[${i}].input_schema.properties`,
          `tool "${tool.id}" is category ${tool.category} but marks no parameter with x-ruyin-ref: path - the gate would have nothing to check against the granted folders`,
        );
      }
    }
  });
};

/**
 * R14 - a task that declares tools must declare a capability to call them with.
 *
 * Tools are only ever invoked from inside a capability turn: the runtime runs
 * one loop per declared capability, and the provider asks for tools from
 * within it. A task with `capabilities: []` therefore never takes a turn and
 * never calls a tool, no matter how many it declares.
 *
 * This is not a tidiness rule. The bid contract's `export_deliverable` had
 * exactly this shape - objective "汇总并导出最终投标成果包", tools
 * `[read_file, export_result]`, capabilities `[]` - and it ran to
 * **completed** having made zero provider calls, zero tool calls, and an empty
 * result, after asking a person to sign off on a deliverable that was never
 * produced. Nothing in the system said otherwise; the task simply succeeded at
 * doing nothing.
 */
const r14: Rule = (c, errors) => {
  c.tasks.forEach((task, i) => {
    if (task.tools.length > 0 && task.capabilities.length === 0) {
      err(
        errors,
        "R14",
        `tasks[${i}].capabilities`,
        `task "${task.id}" declares tools (${task.tools.join(", ")}) but no capability to call them from - ` +
          `tools only run inside a capability turn, so this task would complete without using any of them`,
      );
    }
  });
};

const RULES: Rule[] = [r1, r3, r4, r5, r7, r8, r9, r10, r11, r13, r14];

export function runRules(contract: RuyinContract): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const rule of RULES) rule(contract, errors);
  return errors;
}
