import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import type {ProjectRuntime} from "@vxture/ruyin-core";
import type {JobDocuments} from "./background-jobs.js";
import {DocumentRenders,type RenderInput} from "./document-renders.js";
import type {LayoutFields} from "./word-layout.js";
function rig(){
 const rows=new Map<string,{id:string;markdown:string;revision:number}>();const key=(p:string,b:string,id:string)=>JSON.stringify([p,b,id]);
 const docs:JobDocuments={get:(p,b,id)=>rows.get(key(p,b,id)),list:(p,b,prefix)=>[...rows.entries()].filter(([k])=>{const a=JSON.parse(k);return a[0]===p&&a[1]===b&&a[2].startsWith(prefix);}).map(([,v])=>v),put:(p,b,id,markdown,revision)=>{const k=key(p,b,id);if((rows.get(k)?.revision??0)!==revision)return;const v={id,markdown,revision:revision+1};rows.set(k,v);return v;}};
 const runtime={openProject:async()=>({meta:{productId:"product"}}),listProjects:async()=>[{id:"p",productId:"product"}]} as unknown as ProjectRuntime;
 docs.put("p","product","manuscript","# Chapter\n\nSaved content",0);
 let release!:()=>void,calls=0,captured:LayoutFields|undefined;const wait=new Promise<void>(r=>release=r);const bytes=Buffer.from("template"),hash=createHash("sha256").update(bytes).digest("hex");
 const service=()=>new DocumentRenders(runtime,docs,{get:()=>({name:"layout.docx",hash}),read:async()=>bytes},async(_bytes,_template,fields)=>{calls++;captured=fields;await wait;return{docx:Buffer.from("docx"),pdf:Buffer.from("%PDF-synthetic"),pages:2,engine:"synthetic"};});
 const input:RenderInput={id:randomUUID(),title:"Synthetic",source:{id:"manuscript",revision:1}};const s=service();return{docs,input,s,service,release,get calls(){return calls;},get captured(){return captured;},hash};
}
const flush=async()=>{for(let i=0;i<25;i++)await new Promise(r=>setImmediate(r));};
test("render persists without page, pins source bytes and preserves exact PDF download hash",async()=>{
 const r=rig();await r.s.create("p","product",r.input);await r.s.create("p","product",r.input);r.docs.put("p","product","manuscript","Changed later",1);r.release();for(let i=0;i<150&&r.s.get('p','product',r.input.id)?.state!=='completed';i++)await new Promise(r=>setTimeout(r,10));
 assert.equal(r.calls,1);assert.equal(r.s.list("p","product").length,1);assert.equal(r.s.get("p","product",r.input.id)!.state,"completed");assert.equal(r.s.get("other","product",r.input.id),undefined);
 const md=r.s.file("p","product",r.input.id,"md"),pdf=r.s.file("p","product",r.input.id,"pdf");assert.match(Buffer.from(md.base64,"base64").toString(),/Saved content/);assert.equal(pdf.sha256,createHash("sha256").update(Buffer.from(pdf.base64,"base64")).digest("hex"));assert.throws(()=>r.s.file("other","product",r.input.id,"pdf"),/not found/);r.s.close();
});
test("wrong revision, tampered template, conflicting ID and overlapping render are rejected",async()=>{
 const r=rig();await assert.rejects(r.s.create("p","product",{...r.input,source:{id:"manuscript",revision:2}}),/revision/);await assert.rejects(r.s.create("p","product",{...r.input,template:{fileId:"f",hash:"0".repeat(64)}}),/revision/);await r.s.create("p","product",r.input);await assert.rejects(r.s.create("p","product",{...r.input,title:"Changed"}),/another request/);await assert.rejects(r.s.create("p","product",{...r.input,id:randomUUID()}),/already active/);r.release();await flush();r.s.close();
});
test("interrupted render becomes explicit failure on restart and Markdown remains available",async()=>{
 const r=rig();const at=new Date().toISOString();r.docs.put("p","product","runtime_render_"+r.input.id,JSON.stringify({...r.input,state:"running",createdAt:at,updatedAt:at,formats:["md"]}),0);r.docs.put("p","product","runtime_input_"+r.input.id,JSON.stringify({markdown:"Pinned source"}),0);await r.s.recoverAll();assert.equal(r.s.get("p","product",r.input.id)!.state,"failed");assert.match(r.s.get("p","product",r.input.id)!.error!,/restarted/);assert.equal(Buffer.from(r.s.file("p","product",r.input.id,"md").base64,"base64").toString(),"Pinned source");assert.equal(r.calls,0);r.s.close();
});

test("activity includes queued/running document layout until saved completion",async()=>{
 const r=rig();assert.equal(r.s.activeCount,0);await r.s.create("p","product",r.input);assert.equal(r.s.activeCount,1);
 r.release();for(let i=0;i<150&&r.s.activeCount>0;i++)await new Promise(r=>setTimeout(r,10));
 assert.equal(r.s.get("p","product",r.input.id)?.state,"completed");assert.equal(r.s.activeCount,0);r.s.close();
});
test("lossy Markdown fails visibly and still retains its canonical source",async()=>{
 const r=rig();r.docs.put("p","product","manuscript","# Unsafe\n\n![missing](https://example.com/image.png)",1);await r.s.create("p","product",{...r.input,source:{id:"manuscript",revision:2}});await flush();assert.equal(r.s.get("p","product",r.input.id)!.state,"failed");assert.equal(r.calls,0);assert.ok(r.s.file("p","product",r.input.id,"md").base64);r.s.close();
});

test('header fields are validated, pinned and included in request identity',async()=>{
 const r=rig(),fields={projectName:' Project A ',documentName:'Technical bid',documentNumber:''};
 for(const invalid of [{...fields,projectName:''},{...fields,documentNumber:'one\ntwo'},{...fields,documentName:'x'.repeat(81)},{...fields,extra:'ignored'},null,[]])await assert.rejects(r.s.create('p','product',{...r.input,fields:invalid}),/header fields/);
 await r.s.create('p','product',{...r.input,fields});fields.projectName='Changed after submission';r.release();for(let i=0;i<150&&r.s.get('p','product',r.input.id)?.state!=='completed';i++)await new Promise(r=>setTimeout(r,10));
 assert.deepEqual(r.captured,{projectName:'Project A',documentName:'Technical bid',documentNumber:''});assert.deepEqual(r.s.get('p','product',r.input.id)?.fields,r.captured);assert.equal((await r.s.create('p','product',{...r.input,fields:{...fields,projectName:'Project A'}})).id,r.input.id);await assert.rejects(r.s.create('p','product',{...r.input,fields}),/another request/);r.s.close();
});
