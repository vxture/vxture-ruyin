/**
 * @package @vxture/ruyin-node-runtime
 * @layer Infrastructure
 * @category Tests
 * @author AI-Generated
 * @date 2026-11-25
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { SqliteStoragePort } from "./storage.js";

test("injected keys protect durable documents and files without native key management", async () => {
  const root = mkdtempSync(join(tmpdir(), "ruyin-node-storage-"));
  const key = randomBytes(32).toString("hex");
  const keys = { workspaceKeyHex: () => key };
  let storage = new SqliteStoragePort(root, keys);
  try {
    assert.match(storage.selfCheck().sqliteVersion, /^\d+\./);
    await storage.createProjectStore("prj_test");
    const store = storage.openHostStore("prj_test")!;
    assert.ok(store.putProductDocument("bidproposal", "bid_draft", "private proposal", 0));
    assert.equal(store.putProductDocument("bidproposal", "bid_draft", "stale overwrite", 0), undefined);
    const bytes = Buffer.from("private original source"), files = storage.openFileStore("prj_test")!;
    const written = await files.putBytes(bytes);
    storage.closeAll();
    assert.equal(readFileSync(join(root, "projects/prj_test/project.db")).includes(Buffer.from("private proposal")), false);
    storage = new SqliteStoragePort(root, keys);
    assert.equal(storage.openHostStore("prj_test")!.getProductDocument("bidproposal", "bid_draft")!.markdown, "private proposal");
    assert.deepEqual(await storage.openFileStore("prj_test")!.read(written.hash), bytes);
    storage.closeAll();
    storage = new SqliteStoragePort(root, { workspaceKeyHex: () => randomBytes(32).toString("hex") });
    assert.throws(() => storage.openHostStore("prj_test"), /cannot be unlocked/);
    storage.closeAll();
    storage = new SqliteStoragePort(root, { workspaceKeyHex: () => "invalid" });
    assert.throws(() => storage.openHostStore("prj_test"), /32-byte hexadecimal/);
  } finally {
    storage.closeAll();
    rmSync(root, { recursive: true, force: true });
  }
});
