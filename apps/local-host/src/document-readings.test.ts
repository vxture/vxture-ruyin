import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import type {ProjectRuntime} from "@vxture/ruyin-core";
import type {JobDocuments} from "./background-jobs.js";
import {DocumentReadings} from "./document-readings.js";
import type {SourceReader,ReadUnit} from "./document-reader.js";
const unit=(index:number):ReadUnit=>({index,markdown:"Original 8523700.00 >= 98%",text:"Original 8523700.00 >= 98%",location:{page:index+1},tables:[],images:[],flags:["images-not-transcribed"]});
function rig(reader?:SourceReader){
 const data=new Map<string,{id:string;markdown:string;revision:number}>(),key=(p:string,b:string,id:string)=>JSON.stringify([p,b,id]);
 const docs:JobDocuments={get:(p,b,id)=>data.get(key(p,b,id)),list:(p,b,prefix)=>[...data.entries()].filter(([k])=>{const a=JSON.parse(k);return a[0]===p&&a[1]===b&&a[2].startsWith(prefix);}).map(([,v])=>v),put:(p,b,id,markdown,revision)=>{const k=key(p,b,id);if((data.get(k)?.revision??0)!==revision)return;const v={id,markdown,revision:revision+1};data.set(k,v);return v;}};
 let archived=false,calls=0;const bytes=Buffer.from("synthetic"),hash=createHash("sha256").update(bytes).digest("hex");let actual=bytes;
 const runtime={openProject:async()=>({meta:{productId:"product",archivedAt:archived?"now":undefined}}),listProjects:async()=>[{id:"p",productId:"product"}]} as unknown as ProjectRuntime;
 const files={get:(_p:string,id:string)=>id==="f"?{name:"tender.pdf",hash,bytes:bytes.length}:undefined,read:async()=>actual};
 const service=()=>new DocumentReadings(runtime,docs,files,async(...args)=>{calls++;if(reader)return reader(...args);args[2]({engine:{adapter:"test"},total:2});args[3](unit(0));args[3](unit(1));});
 return{docs,hash,service,s:service(),input:{id:randomUUID(),fileId:"f",hash},get calls(){return calls;},tamper:()=>{actual=Buffer.from("different");},archive:()=>{archived=true;}};
}
const flush=async()=>{for(let i=0;i<30;i++)await new Promise(r=>setImmediate(r));};
test("reading continues without page, saves all blocks, scopes data and reuses request identity",async()=>{
 const r=rig();await r.s.create("p","product",r.input);await flush();const j=r.s.get("p","product",r.input.id)!;assert.equal(j.state,"completed");assert.equal(j.units,2);assert.equal(r.s.unit("p","product",j.id,0)!.text,"Original 8523700.00 >= 98%");assert.equal(r.s.unit("other","product",j.id,0),undefined);assert.equal(r.s.unit("p","other",j.id,0),undefined);assert.deepEqual(j.flags,["images-not-transcribed"]);await r.s.create("p","product",r.input);assert.equal(r.calls,1);assert.equal(r.service().get("p","product",j.id)!.state,"completed");assert.equal(r.s.available("p",j),true);
});

test("activity counts a running source read and returns idle only after it settles",async()=>{
 let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;});
 const r=rig(async(_b,_f,start)=>{start({engine:{adapter:"test"},total:0});await wait;});
 assert.equal(r.s.activeCount,0);await r.s.create("p","product",r.input);assert.equal(r.s.activeCount,1);
 release();await flush();assert.equal(r.s.activeCount,0);r.s.close();
});
test("invalid source revisions, paths, overlapping work and archived projects are refused",async()=>{
 let release!:()=>void;const wait=new Promise<void>(r=>release=r);const r=rig(async(_b,_f,start)=>{start({engine:{adapter:"test"},total:0});await wait;});
 for(const v of [{...r.input,hash:"0".repeat(64)},{...r.input,path:"C:/file.pdf"},{...r.input,fileId:"../file"}])await assert.rejects(r.s.create("p","product",v));
 await r.s.create("p","product",r.input);await assert.rejects(r.s.create("p","product",{...r.input,id:randomUUID()}),/already active/);await assert.rejects(r.s.create("p","product",{...r.input,fileId:"another"}),/another source/);release();await flush();r.archive();await assert.rejects(r.s.create("p","product",{...r.input,id:randomUUID()}),/unavailable/);
});
test("mismatching bytes never reach parser; partial errors preserve blocks and restart marks interruption",async()=>{
 const tampered=rig();tampered.tamper();await tampered.s.create("p","product",tampered.input);await flush();assert.equal(tampered.calls,0);assert.equal(tampered.s.get("p","product",tampered.input.id)!.state,"failed");
 const r=rig(async(_b,_f,start,save)=>{start({engine:{adapter:"test"},total:2});save(unit(0));throw Error("Cannot read page 2");});await r.s.create("p","product",r.input);await flush();assert.equal(r.s.get("p","product",r.input.id)!.units,1);assert.match(r.s.get("p","product",r.input.id)!.error!,/page 2/);assert.ok(r.s.unit("p","product",r.input.id,0));assert.equal(r.s.unit("p","product",r.input.id,1),undefined);
 const j=r.s.get("p","product",r.input.id)!;j.state="running";const d=r.docs.get("p","product","runtime_reading_"+j.id)!;r.docs.put("p","product",d.id,JSON.stringify(j),d.revision);await r.service().recoverAll();assert.equal(r.s.get("p","product",j.id)!.state,"failed");assert.match(r.s.get("p","product",j.id)!.error!,/restarted/);assert.ok(r.s.unit("p","product",j.id,0));
});

test("runtime close aborts reading and leaves saved blocks for recovery without late writes",async()=>{
 let aborted=false;const r=rig(async(_b,_f,start,save,signal)=>{start({engine:{adapter:"test"},total:2});save(unit(0));await new Promise<void>((_resolve,reject)=>signal!.addEventListener("abort",()=>{aborted=true;reject(Error("stopped"));},{once:true}));});
 await r.s.create("p","product",r.input);await flush();const before=r.docs.get("p","product","runtime_reading_"+r.input.id)!;
 r.s.close();await flush();assert.equal(aborted,true);assert.equal(r.docs.get("p","product",before.id)!.revision,before.revision);assert.ok(r.s.unit("p","product",r.input.id,0));
 await assert.rejects(r.s.create("p","product",{...r.input,id:randomUUID()}),/stopping/);await r.service().recoverAll();assert.equal(r.s.get("p","product",r.input.id)!.state,"failed");
});
