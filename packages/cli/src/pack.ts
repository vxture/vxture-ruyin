/**
 * Product packaging and the static registry index (03-A §18.1 / §18.3;
 * repo organization §7.4 "flow C, MVP form").
 *
 * `packProduct` turns a product directory into a .ruyinpkg: every file under
 * it, the manifest at the root, CHECKSUMS covering all of them. **No
 * SIGNATURE entry** - there is no Registry root to sign with yet (TD-012),
 * and writing a placeholder signature would be the exact thing the
 * installer's "do not pretend to have verified" comment warns against. The
 * package says what it is: unsigned.
 *
 * `buildRegistry` packs every product under a directory and writes the
 * static index the runtime reads. The index is plain JSON over TLS; it is
 * not signed either (TD-037). Each entry carries the package sha256 and size
 * so that a download can be checked against what the index promised.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { parseContract, validateContract, type RuyinContract } from "@vxture/ruyin-contract-schema";
import { writeZip, type ZipEntry } from "./zip.js";

export const MANIFEST = "ruyin.product.yaml";
export const CHECKSUMS = "CHECKSUMS";
export const INDEX_FILE = "index.json";
export const INDEX_SCHEMA = "ruyin-registry/1";

/** Files that never belong in a package. */
const EXCLUDED = new Set([".gitkeep", ".DS_Store", "Thumbs.db", CHECKSUMS, "SIGNATURE"]);
/** Per-file and per-package caps mirror the runtime's reader (pkg.ts). */
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;

export class PackError extends Error {}

export interface PackedProduct {
  id: string;
  name: string;
  version: string;
  publisher: string;
  runtimeMinimum: string;
  fileName: string;
  buffer: Buffer;
  sha256: string;
  /** Always false today - see the file header. Present so an index cannot omit the question. */
  signed: false;
  entries: string[];
}

export interface RegistryEntry {
  id: string;
  name: string;
  version: string;
  publisher: string;
  runtime: { minimum: string };
  file: string;
  url: string;
  sha256: string;
  size: number;
  signed: false;
}

export interface RegistryIndex {
  schema: typeof INDEX_SCHEMA;
  generatedAt: string;
  baseUrl: string;
  items: RegistryEntry[];
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Every file under dir, as forward-slash relative names, sorted for determinism. */
function walk(dir: string): string[] {
  const out: string[] = [];
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        visit(full);
      } else if (entry.isFile() && !EXCLUDED.has(entry.name)) {
        out.push(relative(dir, full).split(sep).join("/"));
      }
    }
  };
  visit(dir);
  return out;
}

export function packProduct(productDir: string): PackedProduct {
  const manifestPath = join(productDir, MANIFEST);
  if (!existsSync(manifestPath)) {
    throw new PackError(`no ${MANIFEST} in ${productDir}`);
  }
  const manifestText = readFileSync(manifestPath, "utf8");
  let parsed: unknown;
  try {
    parsed = parseContract(manifestText);
  } catch (cause) {
    throw new PackError(`manifest parse error: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  const validation = validateContract(parsed);
  if (!validation.ok) {
    const first = validation.errors[0];
    throw new PackError(
      `contract invalid (${validation.errors.length} error(s)); first: ${first?.rule} ${first?.path}: ${first?.message}`,
    );
  }
  const contract = parsed as RuyinContract;
  // id and version are path-safe by construction: the contract schema pins
  // both to a strict grammar (L1), and validateContract just passed.
  const { id, name, version, publisher } = contract.product;

  const names = walk(productDir);
  const entries: ZipEntry[] = [];
  const sums: string[] = [];
  let total = 0;
  for (const relName of names) {
    const data = readFileSync(join(productDir, relName));
    if (data.length > MAX_ENTRY_BYTES) throw new PackError(`file too large for a package: ${relName}`);
    total += data.length;
    if (total > MAX_TOTAL_BYTES) throw new PackError("package exceeds the total size limit");
    entries.push({ name: relName, data });
    sums.push(`${sha256(data)}  ${relName}`);
  }
  // CHECKSUMS last, covering everything before it (§18.2 "摘要一致").
  entries.push({ name: CHECKSUMS, data: Buffer.from(sums.join("\n") + "\n", "utf8") });

  const buffer = writeZip(entries);
  return {
    id,
    name,
    version,
    publisher,
    runtimeMinimum: contract.product.runtime.minimum,
    fileName: `${id}-${version}.ruyinpkg`,
    buffer,
    sha256: sha256(buffer),
    signed: false,
    entries: entries.map((e) => e.name),
  };
}

export interface BuildRegistryOptions {
  productsDir: string;
  outDir: string;
  /** Where the index will be served from; urls in it are built on this. */
  baseUrl: string;
  now?: () => string;
}

/**
 * Pack every product directory (an immediate child holding a manifest) and
 * write `<outDir>/<id>/<id>-<version>.ruyinpkg`, `index.json`, `SHA256SUMS`.
 * A directory with no products is an error, not an empty index: an empty
 * registry published by mistake reads exactly like "nothing to install".
 */
export function buildRegistry(opts: BuildRegistryOptions): RegistryIndex {
  const base = opts.baseUrl.replace(/\/+$/, "");
  if (!/^https?:\/\//.test(base)) throw new PackError(`base url must be http(s): ${opts.baseUrl}`);
  const children = readdirSync(opts.productsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(opts.productsDir, e.name, MANIFEST)))
    .map((e) => join(opts.productsDir, e.name))
    .sort();
  if (children.length === 0) throw new PackError(`no product directories under ${opts.productsDir}`);

  mkdirSync(opts.outDir, { recursive: true });
  const items: RegistryEntry[] = [];
  const sums: string[] = [];
  const seen = new Set<string>();
  for (const dir of children) {
    const packed = packProduct(dir);
    if (seen.has(packed.id)) throw new PackError(`two product directories declare id ${packed.id}`);
    seen.add(packed.id);
    const productOut = join(opts.outDir, packed.id);
    mkdirSync(productOut, { recursive: true });
    writeFileSync(join(productOut, packed.fileName), packed.buffer);
    const rel = `${packed.id}/${packed.fileName}`;
    items.push({
      id: packed.id,
      name: packed.name,
      version: packed.version,
      publisher: packed.publisher,
      runtime: { minimum: packed.runtimeMinimum },
      file: rel,
      url: `${base}/${rel}`,
      sha256: packed.sha256,
      size: packed.buffer.length,
      signed: false,
    });
    sums.push(`${packed.sha256}  ${rel}`);
  }
  const index: RegistryIndex = {
    schema: INDEX_SCHEMA,
    generatedAt: opts.now?.() ?? new Date().toISOString(),
    baseUrl: base,
    items,
  };
  writeFileSync(join(opts.outDir, INDEX_FILE), JSON.stringify(index, null, 2) + "\n", "utf8");
  writeFileSync(join(opts.outDir, "SHA256SUMS"), sums.join("\n") + "\n", "utf8");
  return index;
}
