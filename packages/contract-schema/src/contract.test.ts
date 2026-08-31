/**
 * Rule-by-rule validator tests. The canonical Bid contract (products/bid,
 * from design doc 30-contract-schema.md section 16) is the passing fixture;
 * failure cases are targeted mutations of it, one per rule.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseContract,
  validateContract,
  validateContractYaml,
} from "./index.js";
import type { RuyinContract, ValidationResult } from "./index.js";

// Compiled test runs from dist/, so ../../../ is the repo root.
const bidUrl = new URL(
  "../../../products/bid/ruyin.product.yaml",
  import.meta.url,
);
const base = parseContract(readFileSync(bidUrl, "utf8")) as RuyinContract;

function mutate(fn: (c: RuyinContract) => void): ValidationResult {
  const clone = structuredClone(base);
  fn(clone);
  return validateContract(clone);
}

function rules(result: ValidationResult): string[] {
  return result.errors.map((e) => e.rule);
}

function tool(c: RuyinContract, id: string) {
  const found = c.tools.find((t) => t.id === id);
  assert.ok(found, `fixture tool ${id} missing`);
  return found;
}

function task(c: RuyinContract, id: string) {
  const found = c.tasks.find((t) => t.id === id);
  assert.ok(found, `fixture task ${id} missing`);
  return found;
}

test("bid example passes all rules", () => {
  const result = validateContract(base);
  assert.deepEqual(result.errors, []);
  assert.ok(result.ok);
});

test("L1: missing top-level key is a structural failure", () => {
  const result = mutate((c) => {
    delete (c as Partial<RuyinContract>).permissions;
  });
  assert.ok(rules(result).includes("L1"));
});

test("L1: malformed YAML reports a parse error", () => {
  const result = validateContractYaml("a: [unclosed");
  assert.equal(result.ok, false);
  assert.equal(result.errors[0]?.rule, "L1");
});

test("R1: unsupported contract version", () => {
  assert.ok(
    rules(
      mutate((c) => {
        c.contract = "9.9";
      }),
    ).includes("R1"),
  );
});

test("L1: a tool without input_schema is rejected", () => {
  // A tool the gate cannot validate is a tool it cannot let through, so the
  // schema is mandatory rather than a nicety.
  assert.ok(
    rules(
      mutate((c) => {
        delete (tool(c, "read_file") as unknown as Record<string, unknown>)[
          "input_schema"
        ];
      }),
    ).includes("L1"),
  );
});

test("L1: x-ruyin-ref only accepts the known reference kinds", () => {
  assert.ok(
    rules(
      mutate((c) => {
        tool(c, "read_file").input_schema.properties["path"]!["x-ruyin-ref"] =
          "anything" as never;
      }),
    ).includes("L1"),
  );
});

test("R13: required parameters must be declared", () => {
  assert.ok(
    rules(
      mutate((c) => {
        tool(c, "read_file").input_schema.required = ["path", "missing"];
      }),
    ).includes("R13"),
  );
});

test("R13: a path-class tool must annotate a path parameter", () => {
  // Without the annotation the gate has nothing to compare against the
  // granted folders - which reads as "allowed" rather than "unverifiable".
  assert.ok(
    rules(
      mutate((c) => {
        const t = tool(c, "write_document");
        delete t.input_schema.properties["path"]!["x-ruyin-ref"];
      }),
    ).includes("R13"),
  );
  // A query tool touches no path, so it needs no annotation.
  assert.ok(!rules(validateContract(structuredClone(base))).includes("R13"));
});

test("workspace.type is the single business form; the old pair is gone", () => {
  // R2 existed only to keep `type` and `lifecycle` in agreement. They were the
  // same statement twice (persistent/continuous, project/finite,
  // document/versioned), so the fields merged and the rule retired with them.
  assert.equal(base.workspace.type, "project");
  assert.ok(!("lifecycle" in base.workspace));
  // A leftover lifecycle key is now a structural failure (L1), not a rule.
  assert.ok(
    rules(
      mutate((c) => {
        (c.workspace as unknown as Record<string, unknown>)["lifecycle"] =
          "finite";
      }),
    ).includes("L1"),
  );
});

test("R3: relation target must be a declared object", () => {
  assert.ok(
    rules(
      mutate((c) => {
        c.objects[0]!.relations![0]!.to = "nonexistent";
      }),
    ).includes("R3"),
  );
});

test("R3: exactly one primary object (two declared)", () => {
  assert.ok(
    rules(
      mutate((c) => {
        c.objects[1]!.primary = true;
      }),
    ).includes("R3"),
  );
});

test("R3: exactly one primary object (none declared)", () => {
  assert.ok(
    rules(
      mutate((c) => {
        delete c.objects[0]!.primary;
      }),
    ).includes("R3"),
  );
});

test("R4: state machine must be mounted on the primary object", () => {
  assert.ok(
    rules(
      mutate((c) => {
        c.states.object = "requirement";
      }),
    ).includes("R4"),
  );
});

test("R4: initial state must be declared", () => {
  assert.ok(
    rules(
      mutate((c) => {
        c.states.initial = "nope";
      }),
    ).includes("R4"),
  );
});

test("R4: transition target must be declared", () => {
  assert.ok(
    rules(
      mutate((c) => {
        c.states.items[0]!.transitions[0]!.to = "nope";
      }),
    ).includes("R4"),
  );
});

test("R4: unreachable state is rejected", () => {
  assert.ok(
    rules(
      mutate((c) => {
        c.states.items.push({ name: "island", transitions: [] });
      }),
    ).includes("R4"),
  );
});

test("R5: duplicate context type id", () => {
  assert.ok(
    rules(
      mutate((c) => {
        c.context.types.push(structuredClone(c.context.types[0]!));
      }),
    ).includes("R5"),
  );
});

test("R5: required context type needs at least one source", () => {
  assert.ok(
    rules(
      mutate((c) => {
        c.context.types[0]!.sources = [];
      }),
    ).includes("R5"),
  );
});

test("R6: model binding on a capability is rejected", () => {
  const result = mutate((c) => {
    (c.capabilities[0] as unknown as Record<string, unknown>).model = "gpt-5";
  });
  assert.ok(rules(result).includes("R6"));
});

test("R7: high-risk tool must not default to allow", () => {
  assert.ok(
    rules(
      mutate((c) => {
        tool(c, "export_result").default = "allow";
      }),
    ).includes("R7"),
  );
});

test("R7: external_send tool default is fixed to ask", () => {
  assert.ok(
    rules(
      mutate((c) => {
        c.tools.push({
          id: "send_email",
          category: "external_send",
          risk: "medium",
          default: "allow",
          input_schema: {
            type: "object",
            properties: { to: { type: "string" } },
            required: ["to"],
          },
        });
      }),
    ).includes("R7"),
  );
});

test("R8: task input must reference a declared context type", () => {
  assert.ok(
    rules(
      mutate((c) => {
        task(c, "analyze_tender").input_types.push("bogus");
      }),
    ).includes("R8"),
  );
});

test("R8: task output class must be generated or derived", () => {
  assert.ok(
    rules(
      mutate((c) => {
        task(c, "analyze_tender").output_types = ["tender_document"];
      }),
    ).includes("R8"),
  );
});

test("R8: task capability and tool references must resolve", () => {
  const result = mutate((c) => {
    task(c, "analyze_tender").capabilities.push("bogus_cap");
    task(c, "analyze_tender").tools.push("bogus_tool");
  });
  assert.equal(
    result.errors.filter((e) => e.rule === "R8").length,
    2,
  );
});

test("R9: generated output requires a human verification rule", () => {
  assert.ok(
    rules(
      mutate((c) => {
        const t = task(c, "generate_proposal");
        t.verification = t.verification.filter((v) => v.kind !== "human");
      }),
    ).includes("R9"),
  );
});

test("R10: delete / external_send / sync_to_cloud never default allow", () => {
  const result = mutate((c) => {
    c.permissions.delete = "allow";
    c.permissions.sync_to_cloud = "allow";
  });
  assert.equal(result.errors.filter((e) => e.rule === "R10").length, 2);
});

test("R11: temporary data class sync policy is fixed to local_only", () => {
  assert.ok(
    rules(
      mutate((c) => {
        const entry = c.sync.classes.find((x) => x.class === "temporary");
        assert.ok(entry);
        entry.policy = "manual";
      }),
    ).includes("R11"),
  );
});
