#!/usr/bin/env node
/**
 * ruyin CLI - contract lint.
 *
 * Usage:
 *   ruyin lint <path...>
 *
 * Each path may be a contract file, a product directory (containing
 * ruyin.product.yaml), or a directory of product directories (each immediate
 * child containing ruyin.product.yaml is linted). Exit code 1 when any
 * contract fails, 2 on usage errors.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { validateContractYaml } from "@vxture/ruyin-contract-schema";

const MANIFEST = "ruyin.product.yaml";

function usage(): never {
  console.error("usage: ruyin lint <path...>");
  process.exit(2);
}

function collectTargets(input: string): string[] {
  const path = resolve(input);
  if (!existsSync(path)) {
    console.error(`ruyin lint: path not found: ${input}`);
    process.exit(2);
  }
  if (statSync(path).isFile()) return [path];
  const direct = join(path, MANIFEST);
  if (existsSync(direct)) return [direct];
  const found: string[] = [];
  for (const entry of readdirSync(path)) {
    const candidate = join(path, entry, MANIFEST);
    if (existsSync(candidate)) found.push(candidate);
  }
  if (found.length === 0) {
    console.error(`ruyin lint: no ${MANIFEST} found under ${input}`);
    process.exit(2);
  }
  return found;
}

function lint(paths: string[]): number {
  const targets = paths.flatMap(collectTargets);
  let failed = 0;
  for (const target of targets) {
    const result = validateContractYaml(readFileSync(target, "utf8"));
    if (result.ok) {
      console.log(`[OK]   ${target}`);
    } else {
      failed += 1;
      console.error(`[FAIL] ${target}`);
      for (const e of result.errors) {
        console.error(`  ${e.rule} ${e.path}: ${e.message}`);
      }
    }
  }
  console.log(`contract lint: ${targets.length - failed}/${targets.length} passed`);
  return failed > 0 ? 1 : 0;
}

const [, , command, ...rest] = process.argv;
if (command !== "lint" || rest.length === 0) usage();
process.exit(lint(rest));
