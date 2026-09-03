#!/usr/bin/env node
/**
 * ruyin CLI.
 *
 * Usage:
 *   ruyin lint <path...>
 *   ruyin pack <productDir> [--out <dir>]
 *   ruyin registry <productsDir> --out <dir> --base-url <url>
 *
 * lint: each path may be a contract file, a product directory (containing
 * ruyin.product.yaml), or a directory of product directories. Exit code 1
 * when any contract fails, 2 on usage errors.
 *
 * pack: builds <id>-<version>.ruyinpkg from a product directory (03-A §18.1).
 * Unsigned - there is no Registry root yet (TD-012) - and it says so.
 *
 * registry: packs every product under a directory and writes the static
 * registry (index.json + packages + SHA256SUMS) the runtime reads (repo
 * organization §7.4). --base-url is where the index will be served from.
 */

import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { validateContractYaml } from "@vxture/ruyin-contract-schema";
import { buildRegistry, packProduct, PackError } from "./pack.js";

const MANIFEST = "ruyin.product.yaml";

function usage(): never {
  console.error(
    "usage: ruyin lint <path...>\n" +
      "       ruyin pack <productDir> [--out <dir>]\n" +
      "       ruyin registry <productsDir> --out <dir> --base-url <url>",
  );
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

/** `--name value` pairs after the positional; anything else is a usage error. */
function flags(args: string[], allowed: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i] ?? "";
    const value = args[i + 1];
    if (!key.startsWith("--") || !allowed.includes(key.slice(2)) || value === undefined) usage();
    out[key.slice(2)] = value;
  }
  return out;
}

function pack(args: string[]): number {
  const [dir, ...rest] = args;
  if (!dir) usage();
  const opt = flags(rest, ["out"]);
  try {
    const packed = packProduct(resolve(dir));
    const outDir = resolve(opt["out"] ?? ".");
    mkdirSync(outDir, { recursive: true });
    const target = join(outDir, packed.fileName);
    writeFileSync(target, packed.buffer);
    console.log(`[pack] ${packed.id}@${packed.version} -> ${target}`);
    console.log(`[pack] ${packed.entries.length} entries, sha256 ${packed.sha256}, unsigned`);
    return 0;
  } catch (cause) {
    if (cause instanceof PackError) {
      console.error(`ruyin pack: ${cause.message}`);
      return 1;
    }
    throw cause;
  }
}

function registry(args: string[]): number {
  const [dir, ...rest] = args;
  if (!dir) usage();
  const opt = flags(rest, ["out", "base-url"]);
  if (!opt["out"] || !opt["base-url"]) usage();
  try {
    const index = buildRegistry({
      productsDir: resolve(dir),
      outDir: resolve(opt["out"]),
      baseUrl: opt["base-url"],
    });
    for (const item of index.items) {
      console.log(`[registry] ${item.id}@${item.version} ${item.size} bytes ${item.signed ? "signed" : "unsigned"}`);
    }
    console.log(`[registry] ${index.items.length} package(s) -> ${resolve(opt["out"])}`);
    return 0;
  } catch (cause) {
    if (cause instanceof PackError) {
      console.error(`ruyin registry: ${cause.message}`);
      return 1;
    }
    throw cause;
  }
}

const [, , command, ...rest] = process.argv;
if (command === "lint" && rest.length > 0) process.exit(lint(rest));
else if (command === "pack") process.exit(pack(rest));
else if (command === "registry") process.exit(registry(rest));
else usage();
