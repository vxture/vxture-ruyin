import assert from "node:assert/strict";
import test from "node:test";
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {collectDiagnostics} from "./diagnostics.js";
const base={version:"0.2.0",platform:"win32",arch:"x64",keyProtection:"dpapi",startupState:"ready",agents:1,invalidAgents:0};
test("report allowlist excludes names, paths, credentials and logs even when providers include them",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"ruyin-diagnostics-"));try{
  mkdirSync(join(dir,"assets"));writeFileSync(join(dir,"index.html"),'<script src="/assets/app.js"></script>');writeFileSync(join(dir,"assets/app.js"),"app");
  const rows=async()=>[{id:"Private agent",name:"C:/PrivateProject",token:"token-secret",health:{ok:true},status:"available"}];
  const result=await collectDiagnostics({...base,connectors:rows,tools:rows,components:()=>[{state:"acquired",password:"password-secret"}],uiDir:dir});
  assert.ok(result.checks.every(check=>check.status==="ok"));const text=JSON.stringify(result);for(const secret of ["Private agent","PrivateProject","token-secret","password-secret",dir])assert.ok(!text.includes(secret));
  writeFileSync(join(dir,"index.html"),'<script src="/assets/missing.js"></script>');assert.equal((await collectDiagnostics({...base,uiDir:dir})).checks.at(-1)!.status,"attention");
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test("registered, disabled and not-acquired capabilities never count as locally available",async()=>{
 const result=await collectDiagnostics({...base,connectors:async()=>[{state:"stashed",health:{ok:false}}],tools:async()=>[{status:"registered"},{status:"runos"}],components:()=>[{state:"not-acquired"}]});
 assert.deepEqual(result.checks.slice(3,6).map(c=>[c.status,c.available]),[["unknown",0],["unknown",0],["unknown",0]]);
 const errors=await collectDiagnostics({...base,connectors:async()=>[{state:"active",health:{ok:false}}],tools:async()=>[{status:"unavailable"}],components:()=>[{state:"payload-missing"}]});assert.ok(errors.checks.slice(3,6).every(c=>c.status==="attention"));
});
test("failed/unconfigured providers remain unknown; invalid assets, plain keys and failed startup require action",async()=>{
 const rows=async()=>{throw Error("secret path");};const result=await collectDiagnostics({...base,keyProtection:"plaintext",startupState:"failed",invalidAgents:1,connectors:rows,tools:async()=>[{state:"failed"}],components:()=>[{health:{status:"error"}}],uiDir:"missing"});
 assert.deepEqual(result.checks.map(c=>c.status),["attention","attention","attention","unknown","attention","attention","attention"]);
 const unknown=await collectDiagnostics({...base,startupState:"initializing"});assert.deepEqual(unknown.checks.map(c=>c.status),["unknown","ok","ok","unknown","unknown","unknown","unknown"]);
});
