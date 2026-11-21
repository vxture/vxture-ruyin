import nodeTest from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
const ready=existsSync(new URL("../../apps/local-host/dist/runtime-backup.js",import.meta.url));
const {createBackup,verifyBackup}=ready?await import("./runtime-backup.mjs"):{};
const {KeyManager}=ready?await import("../../apps/local-host/dist/keys.js"):{};
const {resolveNativeBinding}=ready?await import("../../apps/local-host/dist/storage.js"):{};
const {acquireRuntimeOwnership}=ready?await import("../../apps/local-host/dist/runtime-ownership.js"):{};
const Database=ready?createRequire(new URL("../../apps/local-host/package.json",import.meta.url))("better-sqlite3-multiple-ciphers"):undefined;
const test=(name,fn)=>nodeTest(name,async t=>{
 if(!ready){
  assert.notEqual(process.env.RUYIN_REQUIRE_BUILT_TESTS,"1","Build the runtime before its backup integration tests");
  return t.skip("Requires built runtime; mandatory in CI build job");
 }
 return fn(t);
});
const temporary=()=>mkdtempSync(join(tmpdir(),"ruyin-backup-test-"));
function clean(root){assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));rmSync(root,{recursive:true,force:true});}
async function fixture(root){
 const live=join(root,"live"),source=join(root,"source"),keys=await KeyManager.open(live),dir=join(live,"projects","p");
 mkdirSync(dir,{recursive:true});const key=keys.workspaceKeyHex(dir),nativeBinding=resolveNativeBinding();
 const db=new Database(join(dir,"project.db"),nativeBinding?{nativeBinding}:{});
 try{
  db.pragma("cipher='sqlcipher'");db.pragma(`key="x'${key}'"`);db.pragma("journal_mode=WAL");db.pragma("wal_autocheckpoint=0");
  db.exec("CREATE TABLE proof(value TEXT); INSERT INTO proof VALUES ('synthetic WAL state')");
  assert.ok(existsSync(join(dir,"project.db-wal")));cpSync(live,source,{recursive:true});
 }finally{db.close();}
 return {source,dir:join(source,"projects","p")};
}

test("offline backup retains original keys and committed WAL, verifies, and reopens from an independent restored copy",async()=>{
 const root=temporary();try{
  const {source}=await fixture(root),backup=join(root,"backup");
  const result=await createBackup(source,backup);assert.equal(result.databases,1);
  assert.equal((await verifyBackup(backup)).integrity,"ok");
  const restored=join(root,"restored");cpSync(backup,restored,{recursive:true});
  const keys=await KeyManager.open(restored),nativeBinding=resolveNativeBinding();
  const db=new Database(join(restored,"projects/p/project.db"),{readonly:true,...(nativeBinding?{nativeBinding}:{})});
  try{db.pragma("cipher='sqlcipher'");db.pragma(`key="x'${keys.workspaceKeyHex(join(restored,"projects/p"))}'"`);
   assert.equal(db.prepare("SELECT value FROM proof").get().value,"synthetic WAL state");
  }finally{db.close();}
  assert.equal((await verifyBackup(backup)).integrity,"ok");
  writeFileSync(join(backup,"projects/p/key.enc"),"corrupt copy");
  await assert.rejects(verifyBackup(backup),/manifest does not match/);
  assert.notEqual(readFileSync(join(source,"projects/p/key.enc"),"utf8"),"corrupt copy");
 }finally{clean(root);}
});

test("missing keys, wrong master and damaged databases never produce a successful backup",async()=>{
 const root=temporary();try{
  const {source,dir}=await fixture(root),target=join(root,"backup");
  const key=readFileSync(join(dir,"key.enc"));rmSync(join(dir,"key.enc"));
  await assert.rejects(createBackup(source,target),/container key is missing/);assert.equal(existsSync(target),false);
  writeFileSync(join(dir,"key.enc"),key);
  const master=join(source,"runtime",existsSync(join(source,"runtime/master.key.dpapi"))?"master.key.dpapi":"master.key"),bytes=readFileSync(master);
  rmSync(master);await assert.rejects(createBackup(source,target),/master key is missing/);assert.equal(existsSync(master),false);
  writeFileSync(master,bytes);
  const other=await KeyManager.open(join(root,"other"));writeFileSync(join(dir,"key.enc"),other.seal(Buffer.alloc(32)));
  await assert.rejects(createBackup(source,target));assert.equal(existsSync(target),false);
  writeFileSync(join(dir,"key.enc"),key);writeFileSync(join(dir,"project.db"),"corrupt DB");
  await assert.rejects(createBackup(source,target),/Database or original key cannot be verified/);assert.equal(existsSync(target),false);
 }finally{clean(root);}
});

test("active ownership, source changes, nested targets and existing targets refuse without overwriting",async()=>{
 const root=temporary();try{
  const {source}=await fixture(root),target=join(root,"backup");
  const release=await acquireRuntimeOwnership([source]);
  try{await assert.rejects(createBackup(source,target),/ownership unavailable/);assert.equal(existsSync(target),false);}finally{await release();}
  await assert.rejects(createBackup(source,join(source,"nested")),/must be disjoint/);
  await assert.rejects(createBackup(source,root),/must be disjoint/);
  mkdirSync(target);writeFileSync(join(target,"keep"),"original");
  await assert.rejects(createBackup(source,target),/already exists/);assert.equal(readFileSync(join(target,"keep"),"utf8"),"original");
  writeFileSync(join(source,"sentinel"),"initial");let changed=false;
  await assert.rejects(createBackup(source,join(root,"unstable"),()=>{if(!changed){changed=true;writeFileSync(join(source,"sentinel"),"changed");}}),/Source changed during backup/);
  assert.equal(existsSync(join(root,"unstable")),false);
 }finally{clean(root);}
});

test("directory links cannot pull external files into the backup and malformed manifests cannot be verified",async()=>{
 const root=temporary();try{
  const {source}=await fixture(root),external=join(root,"external"),link=join(source,"outside");mkdirSync(external);writeFileSync(join(external,"keep"),"external bytes");
  symlinkSync(external,link,process.platform==="win32"?"junction":"dir");
  await assert.rejects(createBackup(source,join(root,"backup")),/symbolic links/);
  await assert.rejects(createBackup(link,join(root,"linked-root")),/symbolic links/);
  assert.equal(readFileSync(join(external,"keep"),"utf8"),"external bytes");rmSync(link);
  const backup=join(root,"valid");await createBackup(source,backup);writeFileSync(join(backup,".ruyin-backup.json"),'{"format":99}');
  await assert.rejects(verifyBackup(backup),/Invalid backup manifest/);
 }finally{clean(root);}
});
