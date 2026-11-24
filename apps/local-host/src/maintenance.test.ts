import assert from "node:assert/strict";
import test from "node:test";
import {existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {KeyManager} from "./keys.js";
import {SqliteStoragePort} from "./storage.js";
import {MaintenanceService,applyPendingMaintenance} from "./maintenance.js";
import {createBackup,restoreBackup,verifyBackup} from "./runtime-backup.js";
import {acquireRuntimeOwnership} from "./runtime-ownership.js";
const host={platform:"linux" as const,env:{},execPath:"/opt/ruyin/node"};
async function rig(){
 const root=mkdtempSync(join(tmpdir(),"ruyin-maintenance-")),data=join(root,"data"),file=join(root,"location.json");mkdirSync(data);
 const keys=await KeyManager.open(data),storage=new SqliteStoragePort(data,keys),store=await storage.createProjectStore("p");
 await store.putMeta({id:"p",productId:"fixture",productVersion:"1.0.0",contractVersion:"0.1",name:"Private name",projectType:"project",createdAt:new Date().toISOString()});
 storage.openHostStore("p")!.putProductDocument("fixture","saved","Private saved result",0);storage.closeAll();writeFileSync(file,JSON.stringify({dataDir:data,language:"en"}));
 return {root,data,file,service:new MaintenanceService(file,data,host),clean:()=>rmSync(root,{recursive:true,force:true})};
}
test("queued backup runs before storage, retains keys and verifies; restore switches only to a new verified copy",async()=>{
 const r=await rig();try{
  mkdirSync(join(r.data,"chromium"));writeFileSync(join(r.data,"chromium","cache"),"mutable cache");
  const backup=join(r.root,"backup"),restored=join(r.root,"restored");
  assert.equal(r.service.view().operation,null);await r.service.queue({action:"backup",target:backup});assert.ok(!existsSync(backup));
  await assert.rejects(r.service.queue({action:"backup",target:join(r.root,"other")}),/existing maintenance/);
  await applyPendingMaintenance(r.file,host);assert.equal(r.service.view().operation!.state,"completed");assert.equal((await verifyBackup(backup)).databases,1);assert.ok(!existsSync(join(backup,"chromium")));
  const original=readFileSync(join(r.data,"projects/p/project.db"));
  await r.service.queue({action:"restore",source:backup,target:restored});await applyPendingMaintenance(r.file,host);
  assert.equal(JSON.parse(readFileSync(r.file,"utf8")).dataDir.toLowerCase(),realpathSync.native(restored).toLowerCase());assert.equal(JSON.parse(readFileSync(r.file,"utf8")).language,"en");assert.deepEqual(readFileSync(join(r.data,"projects/p/project.db")),original);
  const keys=await KeyManager.open(restored),storage=new SqliteStoragePort(restored,keys);await storage.openProjectStore("p");assert.equal(storage.openHostStore("p")!.getProductDocument("fixture","saved")!.markdown,"Private saved result");storage.closeAll();
  assert.equal((await verifyBackup(backup)).integrity,"ok");
 }finally{r.clean();}
});
test("invalid destinations, busy owners, corrupted backups and failed restore never change current data",async()=>{
 const r=await rig();try{
  for(const target of ["relative",r.data,join(r.data,"inside"),r.root])await assert.rejects(r.service.queue({action:"backup",target}));
  await assert.rejects(r.service.queue({action:"unknown",target:join(r.root,"target")}));
  await assert.rejects(r.service.queue({action:"restore",source:r.data,target:join(r.root,"restore")}));
  const release=await acquireRuntimeOwnership([r.data]);await r.service.queue({action:"backup",target:join(r.root,"locked")});await applyPendingMaintenance(r.file,host);await release();assert.equal(r.service.view().operation!.state,"failed");assert.ok(!existsSync(join(r.root,"locked")));
  const backup=join(r.root,"backup");await createBackup(r.data,backup);writeFileSync(join(backup,"projects/p/key.enc"),"wrong");
  await assert.rejects(verifyBackup(backup));await assert.rejects(restoreBackup(backup,join(r.root,"bad-restore")));await assert.rejects(r.service.queue({action:"restore",source:backup,target:join(r.root,"restored")}));
  assert.equal(JSON.parse(readFileSync(r.file,"utf8")).dataDir,r.data);
 }finally{r.clean();}
});
test("cancel clears only queued intent; interrupted work is reported without retrying or replacing files",async()=>{
 const r=await rig();try{
  await r.service.queue({action:"backup",target:join(r.root,"backup")});assert.equal(r.service.cancel().operation,null);
  const next=await r.service.queue({action:"backup",target:join(r.root,"interrupted")});
  writeFileSync(r.file,JSON.stringify({dataDir:r.data,maintenance:{...next.operation,state:"running"}}));
  assert.throws(()=>r.service.cancel(),/already in progress/);await applyPendingMaintenance(r.file,host);assert.equal(r.service.view().operation!.state,"failed");assert.equal(r.service.view().operation!.failure,"interrupted");assert.ok(!existsSync(next.operation.target));
  await applyPendingMaintenance(r.file,host);assert.equal(r.service.view().operation!.state,"failed");
 }finally{r.clean();}
});
