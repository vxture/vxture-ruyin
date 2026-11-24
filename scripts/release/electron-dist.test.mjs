import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { verifyElectronArchive } from "./electron-dist.mjs";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "ruyin-electron-cache-"));
  const version = "42.11.18", platform = "win32", arch = "x64";
  const archive = `electron-v${version}-${platform}-${arch}.zip`;
  const bytes = Buffer.from("synthetic distribution bytes, never executed");
  const checksums = { [archive]: createHash("sha256").update(bytes).digest("hex") };
  return { directory, archive, bytes, opts: { directory, version, platform, arch, checksums },
    close() { assert.ok(resolve(directory).startsWith(join(tmpdir(), "ruyin-electron-cache-"))); rmSync(directory, { recursive: true, force: true }); } };
}

test("cached Electron uses only exact pinned bytes and treats a path with spaces/metacharacters literally", async () => {
  const f = fixture();
  try {
    const directory = join(f.directory, "cache with spaces & text"); mkdirSync(directory);
    writeFileSync(join(directory, f.archive), f.bytes);
    writeFileSync(join(directory, "electron-v42.11.17-win32-x64.zip"), "unrelated version");
    assert.deepEqual(await verifyElectronArchive({ ...f.opts, directory }), {
      directory, archive: f.archive, sha256: f.opts.checksums[f.archive], bytes: f.bytes.length,
    });
  } finally { f.close(); }
});

test("corrupt or missing explicit archive fails instead of selecting another version or downloading", async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.directory, "electron-v42.11.17-win32-x64.zip"), f.bytes);
    await assert.rejects(verifyElectronArchive(f.opts), /ENOENT/);
    writeFileSync(join(f.directory, f.archive), "changed distribution bytes");
    await assert.rejects(verifyElectronArchive(f.opts), /checksum mismatch/);
    writeFileSync(join(f.directory, f.archive), f.bytes);
    await assert.rejects(verifyElectronArchive({ ...f.opts, arch: "arm64" }), /no fixed checksum/);
  } finally { f.close(); }
});

test("cache reuse requires the package checksum and safe pinned selectors", async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.directory, f.archive), f.bytes);
    for (const changes of [{ directory: " " }, { version: "../../other" }, { platform: "../win32" }, { arch: "x64/other" },
        { checksums: {} }, { checksums: { [f.archive]: "not a digest" } },
        { checksums: Object.create(f.opts.checksums) }]) {
      await assert.rejects(verifyElectronArchive({ ...f.opts, ...changes }));
    }
  } finally { f.close(); }
});

test("cache reuse refuses nonregular and linked directories without reading another tree", async () => {
  const f = fixture();
  try {
    mkdirSync(join(f.directory, f.archive));
    await assert.rejects(verifyElectronArchive(f.opts), /regular file/);
    const actual = join(f.directory, "actual"), linked = join(f.directory, "linked"); mkdirSync(actual);
    symlinkSync(actual, linked, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(verifyElectronArchive({ ...f.opts, directory: linked }), /regular directory/);
    const notDir = join(f.directory, "not-directory"); writeFileSync(notDir, f.bytes);
    await assert.rejects(verifyElectronArchive({ ...f.opts, directory: notDir }), /regular directory/);
  } finally { f.close(); }
});
