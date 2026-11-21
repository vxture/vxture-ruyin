/** Existing encrypted stores must never be given newly generated replacement keys. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { KeyManager } from "./keys.js";
import { SqliteStoragePort } from "./storage.js";

test("fresh keys reopen sealed data, while missing master never replaces existing protected data", async () => {
  const root = mkdtempSync(join(tmpdir(), "ruyin-keys-guard-"));
  try {
    const fresh = join(root,"fresh"), keys = await KeyManager.open(fresh);
    const sealed = keys.seal(Buffer.from("synthetic state"));
    assert.equal((await KeyManager.open(fresh)).open(sealed).toString(), "synthetic state");
    for (const file of ["projects/p/project.db","libraries/l/project.db","workspaces/w/workspace.db",
      "projects/p/key.enc","platform/instance-key.bin","platform/session.bin","runtime/platform-session.enc","models/private-model.bin"]) {
      const target = join(root,file.replaceAll("/","-")), existing = join(target,file);
      mkdirSync(join(existing,".."),{recursive:true});writeFileSync(existing,"original encrypted bytes");
      await assert.rejects(KeyManager.open(target),/Original master key is missing/);
      assert.equal(existsSync(join(target,"runtime/master.key.dpapi")),false);
      assert.equal(existsSync(join(target,"runtime/master.key")),false);
      assert.equal(readFileSync(existing,"utf8"),"original encrypted bytes");
    }
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test("missing per-container keys refuse nonempty databases; new empty containers still get keys", async () => {
  const root = mkdtempSync(join(tmpdir(), "ruyin-project-key-guard-"));
  try {
    const keys = await KeyManager.open(root);
    for (const name of ["project.db","workspace.db"]) {
      const dir=join(root,name);mkdirSync(dir);writeFileSync(join(dir,name),"encrypted original");
      assert.throws(()=>keys.workspaceKeyHex(dir),/Original project key.enc is missing/);
      assert.equal(existsSync(join(dir,"key.enc")),false);
      assert.equal(readFileSync(join(dir,name),"utf8"),"encrypted original");
    }
    const empty=join(root,"empty");mkdirSync(empty);writeFileSync(join(empty,"project.db"),"");
    const generated=keys.workspaceKeyHex(empty);assert.equal(generated.length,64);
    assert.equal(keys.workspaceKeyHex(empty),generated);
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test("existing SQLite data stays byte-identical when a missing project key prevents opening", async () => {
  const root=mkdtempSync(join(tmpdir(),"ruyin-key-storage-"));
  let storage:SqliteStoragePort|undefined;
  try {
    const keys=await KeyManager.open(root);storage=new SqliteStoragePort(root,keys);
    const store=await storage.createProjectStore("p");await store.setBusinessState("preserved");storage.closeAll();
    const dir=join(root,"projects/p"),before=readFileSync(join(dir,"project.db"));rmSync(join(dir,"key.enc"));
    for(let attempt=0;attempt<2;attempt++)await assert.rejects(storage.openProjectStore("p"),/Original project key.enc is missing/);
    assert.deepEqual(readFileSync(join(dir,"project.db")),before);assert.equal(existsSync(join(dir,"key.enc")),false);
  } finally { storage?.closeAll();rmSync(root,{recursive:true,force:true}); }
});
