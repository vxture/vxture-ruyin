/**
 * Flow C end to end: the CLI builds a static registry from a product
 * directory; the daemon's client reads the index, downloads the package
 * against the listing, and the existing install pipeline takes it from
 * there - refused in production (unsigned), installed in development.
 * The "network" is a fetch that serves the registry directory from disk.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { InstallError, installPackage, preflightPackage } from "./installer.js";
import { countersignaturePayload, parsePackageTrust } from "./package-signature.js";
import { makeTestZip } from "./pkg-testkit.js";
import { CHECKSUMS_ENTRY, SIGNATURE_ENTRY, readPackage, sha256, verifyIntegrity } from "./pkg.js";
import { downloadPackage, fetchRegistryIndex } from "./registry-client.js";

const CLI = fileURLToPath(new URL("../../../packages/cli/dist/main.js", import.meta.url));
const BID = fileURLToPath(new URL("../../../products/bidproposal/ruyin.product.yaml", import.meta.url));
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

test("flow C: registry download, unsigned policy, and production installation with dual signatures", async () => {
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

    await (async () => {
      const fetchImpl = serveFrom(registryDir);
      const index = await fetchRegistryIndex({ base: BASE, fetchImpl });
      assert.equal(index.status, "ok");
      if (index.status !== "ok") return;
      const entry = index.items.find((i) => i.id === "bidproposal");
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
      assert.equal(installed.productId, "bidproposal");
      assert.equal(installed.signed, false);
      assert.ok(existsSync(join(installed.dir, "ruyin.product.yaml")));

      const publisher = installed.contract.product.publisher;
      const author = generateKeyPairSync("ed25519");
      const registry = generateKeyPairSync("ed25519");
      const checksums = contents.get(CHECKSUMS_ENTRY)!;
      const publisherSignature = sign(null, checksums, author.privateKey).toString("base64");
      const registrySignature = sign(null, countersignaturePayload(publisher, checksums, publisherSignature), registry.privateKey).toString("base64");
      const envelope = { version: 1, publisher, publisherSignature, registrySignature };
      const signedBytes = makeTestZip([
        ...Array.from(contents, ([name, data]) => ({ name, data })),
        { name: SIGNATURE_ENTRY, data: Buffer.from(JSON.stringify(envelope)) },
      ]);
      const signedFile = join(registryDir, entry.file);
      writeFileSync(signedFile, signedBytes);
      const downloaded = await downloadPackage({ ...entry, signed: true, sha256: sha256(signedBytes), size: signedBytes.length }, { base: BASE, fetchImpl });
      const trust = parsePackageTrust(JSON.stringify({
        version: 1,
        registryKey: registry.publicKey.export({ type: "spki", format: "pem" }),
        publisherKeys: { [publisher]: author.publicKey.export({ type: "spki", format: "pem" }) },
      }));
      const policy = { runtimeVersion: "0.1.0", requireSignature: true, trust };
      assert.equal(preflightPackage(downloaded, policy).signed, true);
      assert.equal(installPackage(downloaded, { ...policy, storeDir: join(root, "signed-store") }).productId, "bidproposal");

      // A tampered package on the host is caught by the listing, before the installer.
      const file = join(registryDir, entry.file);
      writeFileSync(file, Buffer.concat([bytes, Buffer.from("x")]));
      await assert.rejects(downloadPackage(entry, { base: BASE, fetchImpl }), /bytes, index says/);
    })();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
