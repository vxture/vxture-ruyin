/**
 * Flow C end to end: the CLI builds a static registry from a product
 * directory; the daemon's client reads the index, downloads the package
 * against the listing, and the existing install pipeline takes it from
 * there - refused in production (unsigned), installed in development.
 * The "network" is a fetch that serves the registry directory from disk.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { InstallError, installPackage } from "./installer.js";
import { readPackage, verifyIntegrity } from "./pkg.js";
import { downloadPackage, fetchRegistryIndex } from "./registry-client.js";

const CLI = fileURLToPath(new URL("../../../packages/cli/dist/main.js", import.meta.url));
const BID = fileURLToPath(new URL("../../../products/bid/ruyin.product.yaml", import.meta.url));
const BASE = "https://dl.example.test/ruyin/products";

/** Serve files under `dir` for urls under BASE; anything else is 404. */
function serveFrom(dir: string): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (!url.href.startsWith(BASE + "/")) return new Response("", { status: 404 });
    const rel = decodeURIComponent(url.href.slice(BASE.length + 1));
    const file = join(dir, rel);
    if (!existsSync(file)) return new Response("", { status: 404 });
    return new Response(readFileSync(file), { status: 200 });
  }) as unknown as typeof fetch;
}

test("flow C: CLI registry -> index -> download checked against the listing -> installer (refused unsigned in production, installed in development)", () => {
  const root = mkdtempSync(join(tmpdir(), "ruyin-flowc-"));
  try {
    // A products dir with the real fixture, so what ships is what is tested.
    mkdirSync(join(root, "products", "bid"), { recursive: true });
    writeFileSync(join(root, "products", "bid", "ruyin.product.yaml"), readFileSync(BID));
    const registryDir = join(root, "registry");
    const built = spawnSync(
      process.execPath,
      [CLI, "registry", join(root, "products"), "--out", registryDir, "--base-url", BASE],
      { encoding: "utf8" },
    );
    assert.equal(built.status, 0, built.stderr);

    return (async () => {
      const fetchImpl = serveFrom(registryDir);
      const index = await fetchRegistryIndex({ base: BASE, fetchImpl });
      assert.equal(index.status, "ok");
      if (index.status !== "ok") return;
      const entry = index.items.find((i) => i.id === "vxture.bid");
      assert.ok(entry);
      assert.equal(entry.signed, false);
      assert.equal(entry.runtime.minimum, "0.1.0");

      const bytes = await downloadPackage(entry, { base: BASE, fetchImpl });
      // The runtime's own reader accepts what the CLI wrote, integrity included.
      const contents = readPackage(bytes);
      verifyIntegrity(contents);
      assert.ok(contents.has("ruyin.product.yaml"));
      assert.ok(!contents.has("SIGNATURE"));

      const storeDir = join(root, "store");
      assert.throws(
        () => installPackage(bytes, { storeDir, runtimeVersion: "0.1.0", requireSignature: true }),
        (e: unknown) => e instanceof InstallError && /not countersigned/.test(e.message),
      );
      const installed = installPackage(bytes, { storeDir, runtimeVersion: "0.1.0", requireSignature: false });
      assert.equal(installed.productId, "vxture.bid");
      assert.equal(installed.signed, false);
      assert.ok(existsSync(join(installed.dir, "ruyin.product.yaml")));

      // A tampered package on the host is caught by the listing, before the installer.
      const file = join(registryDir, entry.file);
      writeFileSync(file, Buffer.concat([readFileSync(file), Buffer.from("x")]));
      await assert.rejects(downloadPackage(entry, { base: BASE, fetchImpl }), /bytes, index says/);
    })();
  } finally {
    // The async body above holds the dir open; cleanup happens on the returned promise.
    setTimeout(() => rmSync(root, { recursive: true, force: true }), 2000).unref();
  }
});
