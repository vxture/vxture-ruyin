/**
 * Static registry client (flow C, MVP form - repo organization §7.4).
 *
 * The registry is a directory on the download host: `index.json` listing
 * product packages, each with a url, sha256 and size. This client reads the
 * index and downloads one package **against what the index promised** - the
 * bytes must hash to the listed sha256, the url must sit on the index's own
 * origin (an index that points elsewhere is not this registry's business),
 * and the size is capped before the body is read.
 *
 * What it does not do: verify the index's authenticity. There is no signing
 * key yet (TD-012), so the index is trusted only as far as TLS to the host
 * (TD-037). The package itself still goes through installPackage, where an
 * unsigned package is refused in production - listing a catalog and
 * installing from it are two different levels of trust, and this file only
 * provides the first.
 *
 * Network failure is `unreachable`, never an exception: a catalog that cannot
 * be reached is not an error state of the machine (same posture as
 * updates/check and contract fetch).
 */

import { createHash } from "node:crypto";

export const DEFAULT_REGISTRY_BASE = "https://dl.vxture.com/ruyin/products";
export const INDEX_SCHEMA = "ruyin-registry/1";
/** Hard cap on one package download; the reader's own caps apply after. */
const MAX_PACKAGE_BYTES = 256 * 1024 * 1024;

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
  signed: boolean;
}

export type RegistryIndexOutcome =
  | { status: "ok"; base: string; generatedAt: string; items: RegistryEntry[]; checkedAt: string }
  | { status: "unreachable"; base: string; reason: string; checkedAt: string };

export interface RegistryClientOptions {
  base?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => string;
}

export class RegistryError extends Error {}

function isEntry(v: unknown): v is RegistryEntry {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e["id"] === "string" &&
    /^[A-Za-z0-9._-]{1,128}$/.test(e["id"]) &&
    typeof e["name"] === "string" &&
    typeof e["version"] === "string" &&
    /^[A-Za-z0-9._-]{1,128}$/.test(e["version"]) &&
    typeof e["publisher"] === "string" &&
    typeof e["url"] === "string" &&
    typeof e["sha256"] === "string" &&
    /^[0-9a-f]{64}$/.test(e["sha256"]) &&
    typeof e["size"] === "number" &&
    Number.isInteger(e["size"]) &&
    e["size"] >= 0 &&
    typeof e["signed"] === "boolean" &&
    !!e["runtime"] &&
    typeof (e["runtime"] as Record<string, unknown>)["minimum"] === "string"
  );
}

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** Read and validate the index. Every failure to get a good index is `unreachable` with the reason. */
export async function fetchRegistryIndex(opts: RegistryClientOptions = {}): Promise<RegistryIndexOutcome> {
  const base = (opts.base ?? DEFAULT_REGISTRY_BASE).replace(/\/+$/, "");
  const checkedAt = opts.now?.() ?? new Date().toISOString();
  const doFetch = opts.fetchImpl ?? fetch;
  const unreachable = (reason: string): RegistryIndexOutcome => ({ status: "unreachable", base, reason, checkedAt });

  let text: string;
  try {
    const res = await withTimeout(opts.timeoutMs ?? 15_000, (signal) =>
      doFetch(`${base}/index.json`, { signal, headers: { accept: "application/json" } }),
    );
    if (!res.ok) return unreachable(`index returned HTTP ${res.status}`);
    text = await res.text();
  } catch (cause) {
    return unreachable(`index unreachable: ${cause instanceof Error ? cause.message : String(cause)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return unreachable("index is not JSON");
  }
  const index = parsed as { schema?: unknown; generatedAt?: unknown; items?: unknown };
  if (index?.schema !== INDEX_SCHEMA) {
    return unreachable(`index schema is ${String(index?.schema)}, expected ${INDEX_SCHEMA}`);
  }
  if (!Array.isArray(index.items)) return unreachable("index has no items array");
  const items: RegistryEntry[] = [];
  const ids = new Set<string>();
  for (const raw of index.items) {
    if (!isEntry(raw)) return unreachable("index has a malformed entry");
    const key = `${raw.id}@${raw.version}`;
    if (ids.has(key)) return unreachable(`index lists ${key} twice`);
    ids.add(key);
    items.push(raw);
  }
  return {
    status: "ok",
    base,
    generatedAt: typeof index.generatedAt === "string" ? index.generatedAt : "",
    items,
    checkedAt,
  };
}

/**
 * Download one listed package and check it against the listing. Throws
 * RegistryError - this is an explicit user action with a definite answer,
 * unlike reading the catalog.
 */
export async function downloadPackage(
  entry: RegistryEntry,
  opts: RegistryClientOptions = {},
): Promise<Buffer> {
  const base = (opts.base ?? DEFAULT_REGISTRY_BASE).replace(/\/+$/, "");
  const doFetch = opts.fetchImpl ?? fetch;
  let url: URL;
  let origin: URL;
  try {
    url = new URL(entry.url);
    origin = new URL(base);
  } catch {
    throw new RegistryError(`package url is not a valid url: ${entry.url}`);
  }
  if (url.origin !== origin.origin) {
    throw new RegistryError(
      `package url ${url.origin} is not on the registry's origin ${origin.origin}; refusing`,
    );
  }
  if (entry.size > MAX_PACKAGE_BYTES) {
    throw new RegistryError(`package is listed at ${entry.size} bytes, over the ${MAX_PACKAGE_BYTES} cap`);
  }

  let bytes: Buffer;
  try {
    const res = await withTimeout(opts.timeoutMs ?? 120_000, (signal) => doFetch(url, { signal }));
    if (!res.ok) throw new RegistryError(`package download returned HTTP ${res.status}`);
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > MAX_PACKAGE_BYTES) throw new RegistryError("package download exceeds the size cap");
    bytes = Buffer.from(await res.arrayBuffer());
  } catch (cause) {
    if (cause instanceof RegistryError) throw cause;
    throw new RegistryError(
      `package download failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  if (bytes.length > MAX_PACKAGE_BYTES) throw new RegistryError("package download exceeds the size cap");
  if (bytes.length !== entry.size) {
    throw new RegistryError(`package is ${bytes.length} bytes, index says ${entry.size}`);
  }
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== entry.sha256) {
    throw new RegistryError(`package sha256 ${actual} does not match the index's ${entry.sha256}`);
  }
  return bytes;
}
