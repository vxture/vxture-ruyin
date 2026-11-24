import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import type {AddressInfo} from "node:net";
import {mkdtempSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {parseContract,type RuyinContract} from "@vxture/ruyin-contract-schema";
import {ProjectRuntime,MemorySkills,type CapabilityTurnRequest} from "@vxture/ruyin-core";
import {RuntimeGateway,ModelNotConfiguredError} from "./runtime-gateway.js";
import {KeyManager} from "./keys.js";
import {PrivateModelStore} from "./private-model.js";
import {SqliteStoragePort} from "./storage.js";
import {nodeClock,nodeCrypto,nodeId} from "./host-ports.js";

const request:CapabilityTurnRequest={product:"bidproposal",taskId:"synthetic",workspace:"synthetic",capability:"draft",objective:"SYNTHETIC ONLY",constraints:[],context:[],messages:[],tools:[]};

test("production gateway uses current sealed model settings and stops after removal",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"ruyin-model-live-")),calls:{url:string;body:any}[]=[];
 const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;calls.push({url:req.url!,body:JSON.parse(body)});res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:'SYNTHETIC result'}}]}));});
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 try{
  const model=new PrivateModelStore(await KeyManager.open(dir),dir),gateway=new RuntimeGateway({capabilityBase:'',token:async()=>undefined,localModel:()=>model.effective()}),base='http://127.0.0.1:'+(server.address() as AddressInfo).port;
  assert.equal(gateway.surface,'unavailable');await assert.rejects(gateway.turn(request),e=>e instanceof ModelNotConfiguredError&&e.code==='MODEL_NOT_CONFIGURED');assert.equal(calls.length,0);
  model.save({baseUrl:base+'/first',model:'synthetic-a'});assert.equal(gateway.surface,'local_model');assert.equal((await gateway.turn(request)).kind,'content');
  model.save({baseUrl:base+'/second',model:'synthetic-b'});await gateway.turn(request);
  assert.deepEqual(calls.map(c=>[c.url,c.body.model]),[['/first/chat/completions','synthetic-a'],['/second/chat/completions','synthetic-b']]);
  model.clear();assert.equal(gateway.surface,'unavailable');await assert.rejects(gateway.turn(request),ModelNotConfiguredError);assert.equal(calls.length,2);
 }finally{await new Promise<void>(done=>server.close(()=>done()));rmSync(dir,{recursive:true,force:true});}
});

test("explicit remote provider uses a fresh token and never falls back to a private endpoint",async()=>{
 const realFetch=globalThis.fetch,calls:{url:string;token:unknown}[]=[];let current='first',fail=false;
 globalThis.fetch=(async(url,init)=>{calls.push({url:String(url),token:(init?.headers as Record<string,string>)?.['authorization']});return new Response(JSON.stringify(fail?{message:'Synthetic outage'}:{kind:'content',content:'SYNTHETIC remote'}),{status:fail?503:200});}) as typeof fetch;
 try{
  const gateway=new RuntimeGateway({capabilityBase:'https://synthetic.invalid',token:async()=>current,localModel:()=>{throw Error('Private endpoint must not be read');}});
  assert.equal(gateway.surface,'configured');await gateway.turn(request);current='second';await gateway.turn(request);fail=true;await assert.rejects(gateway.turn(request),/503/);
  assert.equal(calls.length,3);assert.deepEqual(calls.map(c=>c.token),['Bearer first','Bearer second','Bearer second']);assert.ok(calls.every(c=>c.url.startsWith('https://synthetic.invalid/')));
 }finally{globalThis.fetch=realFetch;}
});

test("missing production model persists a failed real task with no generated result",async()=>{
 const dir=mkdtempSync(join(tmpdir(),'ruyin-missing-model-')),keys=await KeyManager.open(dir);let storage=new SqliteStoragePort(dir,keys);
 const gateway=new RuntimeGateway({capabilityBase:'',token:async()=>undefined,localModel:()=>undefined});
 const contract=parseContract(readFileSync(new URL('../../../products/bidproposal/ruyin.product.yaml',import.meta.url),'utf8')) as RuyinContract;
 const source=contract.context.types.find(t=>t.id==='tender_document')!;source.sources=['project'];source.project_document='synthetic_tender';
 const ports=()=>({storage,clock:nodeClock,id:nodeId,crypto:nodeCrypto,gateway,skills:MemorySkills.forContract(contract),tools:{supports:()=>true,execute:async()=>({content:'SYNTHETIC tool'})},projectDocuments:{get:()=>({markdown:'SYNTHETIC ONLY',revision:1})}});
 try{
  const runtime=new ProjectRuntime(ports()),project=await runtime.createProject(contract,'P11 no model - SYNTHETIC','wsp_synthetic'),harness=await runtime.createHarness(project.id);
  let task=await harness.startTask('analyze_tender');task=await harness.advance(task.id);assert.equal(task.state,'waiting_human');await harness.decideCheckpoint(task.id,{choice:'approve'});task=await harness.advance(task.id);
  assert.equal(task.state,'failed');assert.equal(task.result,undefined);assert.deepEqual(task.capabilityOutputs,{});assert.ok(JSON.stringify(task).includes('MODEL_NOT_CONFIGURED'));assert.equal(JSON.stringify(task).includes('[mock:'),false);
  storage.closeAll();storage=new SqliteStoragePort(dir,keys);const reopened=new ProjectRuntime(ports());assert.deepEqual((await reopened.listTaskInstances(project.id)).find(t=>t.id===task.id),JSON.parse(JSON.stringify(task)));
 }finally{storage.closeAll();rmSync(dir,{recursive:true,force:true});}
});
