/**
 * Contract validation entry points: YAML parsing + the layered validation
 * pipeline (L1 structural via ajv, then the R-series semantic rules). L4 signature checks
 * live at the package layer, not here.
 */

import { parse } from "yaml";
import { Ajv } from "ajv";
import type { ErrorObject, ValidateFunction } from "ajv";
import { contractJsonSchema } from "./schema.js";
import { runRules } from "./rules.js";
import type {
  RuyinContract,
  ValidationError,
  ValidationResult,
} from "./types.js";

let compiled: ValidateFunction | undefined;

function structuralValidator(): ValidateFunction {
  if (compiled) return compiled;
  const ajv = new Ajv({ allErrors: true });
  const validator = ajv.compile(contractJsonSchema);
  compiled = validator;
  return validator;
}

function toDottedPath(instancePath: string): string {
  // "/tools/2/default" -> "tools[2].default"
  const parts = instancePath.split("/").filter((p) => p.length > 0);
  let out = "";
  for (const part of parts) {
    if (/^\d+$/.test(part)) {
      out += `[${part}]`;
    } else {
      out += out.length > 0 ? `.${part}` : part;
    }
  }
  return out.length > 0 ? out : "(root)";
}

function translateAjvError(e: ErrorObject): ValidationError {
  // Structural failures are L1 - except extra keys on a capability entry,
  // which is exactly what R6 (no model/provider binding) forbids.
  const isCapabilityExtraKey =
    e.keyword === "additionalProperties" && /^\/capabilities\/\d+$/.test(e.instancePath);
  const extra =
    e.keyword === "additionalProperties"
      ? ` (unexpected key: ${String((e.params as { additionalProperty?: string }).additionalProperty)})`
      : "";
  return {
    rule: isCapabilityExtraKey ? "R6" : "L1",
    path: toDottedPath(e.instancePath),
    message: `${e.message ?? "invalid"}${extra}`,
  };
}

/** Parse contract YAML text. Throws on malformed YAML. */
export function parseContract(text: string): unknown {
  return parse(text);
}

/** Validate a parsed contract document through L1 structure + the R-series rules. */
export function validateContract(raw: unknown): ValidationResult {
  const structural = structuralValidator();
  if (!structural(raw)) {
    const errors = (structural.errors ?? []).map(translateAjvError);
    return { ok: false, errors };
  }
  const errors = runRules(raw as RuyinContract);
  return { ok: errors.length === 0, errors };
}

/** Convenience: parse YAML text and validate in one step. */
export function validateContractYaml(text: string): ValidationResult {
  let raw: unknown;
  try {
    raw = parseContract(text);
  } catch (cause) {
    return {
      ok: false,
      errors: [
        {
          rule: "L1",
          path: "(root)",
          message: `YAML parse error: ${cause instanceof Error ? cause.message : String(cause)}`,
        },
      ],
    };
  }
  return validateContract(raw);
}
