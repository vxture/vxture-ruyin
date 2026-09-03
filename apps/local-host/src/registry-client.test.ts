/**
 * Static registry client: index reading (every way an index can be bad is
 * `unreachable` with a reason) and package download checked against the
 * listing (origin, size, sha256). fetch is injected; nothing here touches
 * the network.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  INDEX_SCHEMA,
  RegistryError,
  downloadPackage,
  fetchRegistryIndex,
  type RegistryEntry,
} from "./registry-client.js";

const BASE = "https://dl.example.test/ruyin/products";
const PKG = Buffer.from("PKfake-package-bytes");
const SHA = createHash("sha256").update(PKG).digest("hex");

function entry(over: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    id: "vxture.bid",
    name: "标书编写",
    version: "1.0.0",
    publisher: "vxture",
    runtime: { minimum: "0.1.0" },
    file: "vxture.bid/vxture.bid-1.0.0.ruyinpkg",
    url: `${BASE}/vxture.bid/vxture.bid-1.0.0.ruyinpkg`,
    sha256: SHA,
    size: PKG.length,
    signed: false,
    ...over,
  };
}

function respond(body: string | Buffer, status = 200, headers: Record<string, string> = {}): typeof fetch {
  return (async () => new Response(body, { status, headers })) as unknown as typeof fetch;
}

test("index: a good index is ok with its items; the default base is the dl host layout", async () => {
  const index = { schema: INDEX_SCHEMA, generatedAt: "2026-09-03T00:00:00Z", items: [entry()] };
  const out = await fetchRegistryIndex({ base: BASE, fetchImpl: respond(JSON.stringify(index)), now: () => "t" });
  assert.equal(out.status, "ok");
  if (out.status !== "ok") return;
  assert.equal(out.base, BASE);
  assert.equal(out.items[0]?.id, "vxture.bid");
  assert.equal(out.checkedAt, "t");
  const dflt = await fetchRegistryIndex({ fetchImpl: respond("", 404) });
  assert.equal(dflt.base, "https://dl.vxture.com/ruyin/products");
});

test("index: every bad index is unreachable with the reason - HTTP error, not JSON, wrong schema, malformed entry, duplicate, thrown fetch", async () => {
  const cases: Array<[typeof fetch, RegExp]> = [
    [respond("", 503), /HTTP 503/],
    [respond("<html>"), /not JSON/],
    [respond(JSON.stringify({ schema: "other", items: [] })), /schema is other/],
    [respond(JSON.stringify({ schema: INDEX_SCHEMA })), /no items array/],
    [respond(JSON.stringify({ schema: INDEX_SCHEMA, items: [{ id: "x" }] })), /malformed entry/],
    [respond(JSON.stringify({ schema: INDEX_SCHEMA, items: [entry({ sha256: "nothex" })] })), /malformed entry/],
    [respond(JSON.stringify({ schema: INDEX_SCHEMA, items: [entry(), entry()] })), /lists vxture.bid@1.0.0 twice/],
    [(async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch, /unreachable: ECONNREFUSED/],
  ];
  for (const [fetchImpl, reason] of cases) {
    const out = await fetchRegistryIndex({ base: BASE, fetchImpl });
    assert.equal(out.status, "unreachable");
    if (out.status === "unreachable") assert.match(out.reason, reason);
  }
});

test("download: bytes must match the listing's size and sha256, and come from the registry's origin", async () => {
  const ok = await downloadPackage(entry(), { base: BASE, fetchImpl: respond(PKG) });
  assert.ok(ok.equals(PKG));

  await assert.rejects(
    downloadPackage(entry({ url: "https://evil.example.test/x.ruyinpkg" }), { base: BASE, fetchImpl: respond(PKG) }),
    (e: unknown) => e instanceof RegistryError && /not on the registry's origin/.test(e.message),
  );
  await assert.rejects(
    downloadPackage(entry({ url: "not a url" }), { base: BASE, fetchImpl: respond(PKG) }),
    /not a valid url/,
  );
  await assert.rejects(
    downloadPackage(entry({ sha256: "0".repeat(64) }), { base: BASE, fetchImpl: respond(PKG) }),
    /sha256 .* does not match/,
  );
  await assert.rejects(
    downloadPackage(entry({ size: PKG.length + 1 }), { base: BASE, fetchImpl: respond(PKG) }),
    /bytes, index says/,
  );
  await assert.rejects(downloadPackage(entry(), { base: BASE, fetchImpl: respond("", 404) }), /HTTP 404/);
  await assert.rejects(
    downloadPackage(entry(), { base: BASE, fetchImpl: (async () => { throw new Error("reset"); }) as unknown as typeof fetch }),
    /download failed: reset/,
  );
  await assert.rejects(
    downloadPackage(entry({ size: 300 * 1024 * 1024 }), { base: BASE, fetchImpl: respond(PKG) }),
    /over the .* cap/,
  );
  await assert.rejects(
    downloadPackage(entry(), { base: BASE, fetchImpl: respond(PKG, 200, { "content-length": String(300 * 1024 * 1024) }) }),
    /exceeds the size cap/,
  );
});
