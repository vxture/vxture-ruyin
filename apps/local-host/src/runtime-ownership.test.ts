/** Runtime ownership integration tests. @package @vxture/ruyin-local-host */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { acquireRuntimeOwnership } from "./runtime-ownership.js";
import { fileURLToPath } from "node:url";
import { KeyManager } from "./keys.js";
import { performMove } from "./data-location.js";
import { createServer, type AddressInfo } from "node:net";

test("daemon preserves pending migration when a legacy runtime holds its port", async () => {
  const root = mkdtempSync(join(tmpdir(), "ruyin-legacy-port-"));
  const source = join(root, "source"), destination = join(root, "destination");
  const location = join(root, "location.json");
  mkdirSync(source);
  writeFileSync(join(source, "sentinel.txt"), "unchanged");
  const pointer = JSON.stringify({ dataDir: source, pending: destination });
  writeFileSync(location, pointer);
  const legacy = createServer();
  await new Promise<void>((ok) => legacy.listen(0, "127.0.0.1", ok));
  const child = spawn(process.execPath, [fileURLToPath(new URL("./main.js", import.meta.url))], {
    env: { ...process.env, NODE_V8_COVERAGE: "", RUYIN_LOCATION_FILE: location, RUYIN_DATA_DIR: source,
      RUYIN_LEGACY_DATA_DIR: "", RUYIN_PORT: String((legacy.address() as AddressInfo).port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr!.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  try {
    const [code] = await once(child, "exit");
    assert.notEqual(code, 0);
    assert.match(stderr, /Migration cannot start/);
    assert.equal(readFileSync(location, "utf8"), pointer);
    assert.equal(readFileSync(join(source, "sentinel.txt"), "utf8"), "unchanged");
    assert.equal(existsSync(destination), false);
    assert.equal(existsSync(join(source, "runtime")), false);
  } finally {
    child.kill();
    await new Promise<void>((done) => legacy.close(() => done()));
    rmSync(root, { recursive: true, force: true });
  }
});

test("Windows DPAPI key still decrypts sealed state after directory migration", { skip: process.platform !== "win32" }, async () => {
  const root = mkdtempSync(join(tmpdir(), "ruyin-dpapi-move-"));
  const source = join(root, "source"), destination = join(root, "destination");
  try {
    const keys = await KeyManager.open(source);
    assert.equal(keys.protection, "dpapi");
    const sealed = keys.seal(Buffer.from("temporary-session-fixture"));
    const outcome = await performMove(source, destination);
    assert.equal(outcome.status, "moved");
    const reopened = await KeyManager.open(destination);
    assert.equal(reopened.protection, "dpapi");
    assert.equal(reopened.open(sealed).toString(), "temporary-session-fixture");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("competing owners fail; releasing permits restart; partial acquisition rolls back", async () => {
  const root = mkdtempSync(join(tmpdir(), "ruyin-owner-"));
  const a = join(root, "a"), b = join(root, "b");
  const release = await acquireRuntimeOwnership([b, b]);
  try {
    await assert.rejects(acquireRuntimeOwnership([a, b]), /ownership unavailable/);
    const releaseA = await acquireRuntimeOwnership([a]);
    await releaseA();
  } finally { await release(); }
  const again = await acquireRuntimeOwnership([b]);
  await again();
  rmSync(root, { recursive: true, force: true });
});

for (const conflict of ["location", "source", "destination"] as const) {
  test(`daemon refuses ${conflict} ownership conflict before migration or key creation`, async () => {
    const root = mkdtempSync(join(tmpdir(), "ruyin-startup-lock-"));
    const location = join(root, "location.json");
    const source = join(root, "source");
    const destination = join(root, "destination");
    mkdirSync(source);
    writeFileSync(join(source, "sentinel.txt"), "unchanged");
    const pointer = JSON.stringify({ dataDir: source, pending: destination });
    writeFileSync(location, pointer);
    const release = await acquireRuntimeOwnership([
      conflict === "location" ? location : conflict === "source" ? source : destination,
    ]);
    const child = spawn(process.execPath, [fileURLToPath(new URL("./main.js", import.meta.url))], {
      // Match main-wiring.test: entrypoint subprocesses have separate assertions.
      env: { ...process.env, NODE_V8_COVERAGE: "", RUYIN_LOCATION_FILE: location, RUYIN_DATA_DIR: source,
        RUYIN_LEGACY_DATA_DIR: "", RUYIN_PORT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr!.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    try {
      const [code] = await once(child, "exit");
      assert.notEqual(code, 0);
      assert.match(stderr, /runtime ownership unavailable/);
      assert.equal(readFileSync(location, "utf8"), pointer);
      assert.equal(readFileSync(join(source, "sentinel.txt"), "utf8"), "unchanged");
      assert.equal(existsSync(destination), false);
      assert.equal(existsSync(join(source, "runtime")), false);
    } finally {
      child.kill();
      await release();
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("OS releases ownership after forced child termination", { skip: !["win32", "linux"].includes(process.platform) }, async () => {
  const root = mkdtempSync(join(tmpdir(), "ruyin-owner-crash-"));
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import { acquireRuntimeOwnership } from ${JSON.stringify(new URL("./runtime-ownership.js", import.meta.url).href)};
    await acquireRuntimeOwnership([${JSON.stringify(root)}]);
    process.stdout.write('ready');
    setInterval(() => {}, 1000);
  `], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    await once(child.stdout!, "data");
    await assert.rejects(acquireRuntimeOwnership([root]), /ownership unavailable/);
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
    const release = await acquireRuntimeOwnership([root]);
    await release();
  } finally {
    child.kill();
    rmSync(root, { recursive: true, force: true });
  }
});
