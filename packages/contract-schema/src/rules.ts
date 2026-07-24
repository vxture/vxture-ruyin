/**
 * Semantic validation rules R1-R11 (L2 referential + L3 compatibility layers).
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

// R2 - legal workspace type/lifecycle combination.
const LIFECYCLE_FOR_TYPE: Record<string, string> = {
  persistent: "continuous",
  project: "finite",
  document: "versioned",
};

const r2: Rule = (c, errors) => {
  const expected = LIFECYCLE_FOR_TYPE[c.workspace.type];
  if (expected !== c.workspace.lifecycle) {
    err(
      errors,
      "R2",
      "workspace.lifecycle",
      `workspace type "${c.workspace.type}" requires lifecycle "${expected}", got "${c.workspace.lifecycle}"`,
    );
  }
};

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

const RULES: Rule[] = [r1, r2, r3, r4, r5, r7, r8, r9, r10, r11];

export function runRules(contract: RuyinContract): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const rule of RULES) rule(contract, errors);
  return errors;
}
