/**
 * Tool Gate - what stands between a model's request and an actual effect.
 * Design authority: docs/30-design/50-harness.md section 5.
 *
 * Two independent jobs, deliberately separate:
 *
 *   decideTool()      may this call happen at all, and who says so
 *   validateToolCall() are the arguments legal for this workspace
 *
 * Both must pass. Splitting them matters because they fail differently: a
 * denied call is a policy answer the user can change, an invalid call is a
 * bug in the request that the model should see and correct.
 */

import type {
  PermissionValue,
  Permissions,
  Tool,
  ToolCategory,
} from "@vxture/ruyin-contract-schema";
import { isPathGranted } from "./workspace.js";
import type { ContextItemMeta, FolderGrant } from "./ports.js";

export type GateSource =
  | "hard_floor"
  | "user_policy"
  | "contract_default"
  | "ask_cache";

export interface GateDecision {
  value: PermissionValue;
  source: GateSource;
  reason: string;
}

/** allow < ask < deny. "At least ask" means "no looser than ask". */
const STRICTNESS: Record<PermissionValue, number> = { allow: 0, ask: 1, deny: 2 };

function stricter(a: PermissionValue, b: PermissionValue): PermissionValue {
  return STRICTNESS[a] >= STRICTNESS[b] ? a : b;
}

/**
 * Spec-level floors (50-harness 5.1). Not configurable by anyone - that is
 * what makes them floors. Sending data outward cannot be taken back, so it
 * never happens without a person saying so.
 */
const HARD_FLOOR: Partial<Record<ToolCategory, PermissionValue>> = {
  external_send: "ask",
};

/** Category-level contract defaults that apply on top of the per-tool one. */
const PERMISSION_KEY: Partial<Record<ToolCategory, keyof Permissions>> = {
  local_read: "local_read",
  local_write: "local_write",
  export: "local_write",
};

export interface GateInput {
  tool: Tool;
  permissions: Permissions;
  /** Explicit user setting for this tool id, if the user set one. */
  userPolicy?: PermissionValue | undefined;
  /** Tool ids the user already approved for the rest of this task. */
  askCache?: ReadonlySet<string> | undefined;
}

/**
 * Combine floor, user policy and contract default into one answer.
 *
 * Order: the floor wins outright; below it an explicit user setting beats the
 * contract default. A user may tighten anything and loosen anything the floor
 * does not cover - loosening is a real choice they are entitled to make, which
 * is why the answer records *which* input produced it.
 */
export function decideTool(input: GateInput): GateDecision {
  const { tool, permissions, userPolicy, askCache } = input;
  const floor = HARD_FLOOR[tool.category];

  const categoryKey = PERMISSION_KEY[tool.category];
  const contractDefault = categoryKey
    ? stricter(tool.default, permissions[categoryKey])
    : tool.default;

  let value: PermissionValue;
  let source: GateSource;
  if (userPolicy !== undefined) {
    value = userPolicy;
    source = "user_policy";
  } else {
    value = contractDefault;
    source = "contract_default";
  }

  if (floor && STRICTNESS[value] < STRICTNESS[floor]) {
    return {
      value: floor,
      source: "hard_floor",
      reason: `${tool.category} is floored at "${floor}" and cannot be relaxed`,
    };
  }

  // A prior "yes, and stop asking for this task" turns ask into allow - but
  // never for a floored operation: 5.3 keeps those on every-time confirmation,
  // because "I approved it once" is not consent for the next one.
  if (value === "ask" && !floor && askCache?.has(tool.id)) {
    return {
      value: "allow",
      source: "ask_cache",
      reason: `approved earlier in this task`,
    };
  }

  return {
    value,
    source,
    reason:
      source === "user_policy"
        ? `user policy for "${tool.id}"`
        : `contract default for "${tool.id}"`,
  };
}

export interface ValidationInput {
  tool: Tool;
  args: Record<string, unknown>;
  grants: FolderGrant[];
  contextSet: ContextItemMeta[];
}

export type CallValidation = { ok: true } | { ok: false; reason: string };

/**
 * Check the arguments against the declared schema and against this
 * workspace's authorizations (50-harness 5.2).
 *
 * Scope, stated plainly: presence of required parameters, rejection of
 * undeclared ones, primitive type agreement, and the two Ruyin reference
 * checks. It is not a full JSON Schema validator - nested object and array
 * shapes are not walked. The parts that decide whether a call can reach data
 * it was never granted are all here; the rest is the executor's business.
 */
export function validateToolCall(input: ValidationInput): CallValidation {
  const { tool, args, grants, contextSet } = input;
  const properties = tool.input_schema.properties ?? {};

  for (const name of tool.input_schema.required ?? []) {
    if (!(name in args)) {
      return { ok: false, reason: `missing required parameter "${name}"` };
    }
  }

  for (const [name, value] of Object.entries(args)) {
    const spec = properties[name];
    if (!spec) {
      // An undeclared parameter is not harmless: it is a parameter nobody
      // decided the rules for, so there is nothing to check it against.
      return { ok: false, reason: `parameter "${name}" is not declared` };
    }

    const expected = spec["type"];
    if (typeof expected === "string" && !matchesType(value, expected)) {
      return {
        ok: false,
        reason: `parameter "${name}" must be ${expected}, got ${typeof value}`,
      };
    }

    const ref = spec["x-ruyin-ref"];
    if (ref === "path") {
      if (typeof value !== "string") {
        return { ok: false, reason: `parameter "${name}" must be a path string` };
      }
      if (!isPathGranted(value, grants)) {
        return {
          ok: false,
          reason: `path "${value}" is outside every granted folder`,
        };
      }
    } else if (ref === "context_item") {
      if (!contextSet.some((item) => item.id === value)) {
        return {
          ok: false,
          reason: `"${String(value)}" is not in this task's context set`,
        };
      }
    }
  }

  return { ok: true };
}

function matchesType(value: unknown, expected: string): boolean {
  switch (expected) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return value !== null && typeof value === "object" && !Array.isArray(value);
    default:
      // Unknown declared type: not something to silently pass.
      return false;
  }
}
