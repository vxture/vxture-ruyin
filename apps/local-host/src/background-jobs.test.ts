import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import type {ProjectRuntime} from "@vxture/ruyin-core";
import type {TaskRunner} from "./task-runner.js";
import {BackgroundJobs,type JobDocuments,type JobInput} from "./background-jobs.js";

function gate(r:ReturnType<typeof rig>,i=0,kind='context_confirm'){
 const doc=r.docs.get('p','product','context')!;
 Object.assign(r.tasks[i],{state:'waiting_human',checkpoints:[{id:'cp-'+i,kind}],contextSet:[{connector:'project-document',ref:'context',documentRevision:doc.revision}]});
}
test('cancel actively settles a waiting child, preserves unverified output and refuses resume',async()=>{
 const r=rig(),s=r.service();try{await s.create('p','product',r.input);await s.tick('p','product',r.input.id);gate(r,0,'verification_review');Object.assign(r.tasks[0],{capabilityOutputs:{review:'Partial saved result'}});
  const cancelling=await s.control('p','product',r.input.id,'cancel');assert.equal(cancelling.state,'cancelling');await assert.rejects(s.control('p','product',r.input.id,'resume'),/Cancellation/);
  await s.tick('p','product',r.input.id);const job=s.get('p','product',r.input.id)!;assert.equal(job.state,'cancelled');assert.equal(r.tasks[0].state,'cancelled');assert.equal(r.tasks[0].checkpoints[0].decision,undefined);assert.equal(JSON.parse(r.docs.get('p','product',job.steps[0]!.resultDocument!)!.markdown).verified,false);assert.equal(r.tasks.length,1);
 }finally{s.close();}
});
test('cancel during uncertain submission recovers an existing child but never submits missing work',async()=>{
 for(const existing of [false,true]){const r=rig(),s=r.service();try{await s.create('p','product',r.input);if(existing)await s.tick('p','product',r.input.id);
  const doc=r.docs.get('p','product','runtime_job_'+r.input.id)!,job=JSON.parse(doc.markdown);job.steps[0].state='submitting';delete job.steps[0].taskInstanceId;r.docs.put('p','product',doc.id,JSON.stringify(job),doc.revision);
  await s.control('p','product',r.input.id,'cancel');s.close();const recovered=r.service();try{await recovered.recoverAll();await recovered.tick('p','product',r.input.id);assert.equal(recovered.get('p','product',r.input.id)!.state,'cancelled');assert.equal(r.tasks.length,existing?1:0);if(existing)assert.equal(r.tasks[0].state,'cancelled');}finally{recovered.close();}
 }finally{s.close();}}
});
test('exact batch approval survives restart, decides only matching source checkpoints, never result review',async()=>{
 const r=rig(),s=r.service();await s.create('p','product',r.input);await s.tick('p','product',r.input.id);gate(r);
 await s.tick('p','product',r.input.id);assert.equal(r.tasks[0].state,'waiting_human');
 await assert.rejects(s.approveContext('p','product',r.input.id,'wrong'),/stale/);
 await s.approveContext('p','product',r.input.id,s.get('p','product',r.input.id)!.requestHash);s.close();
 const next=r.service();try{await next.recoverAll();await next.tick('p','product',r.input.id);assert.equal(r.tasks[0].state,'executing');
 r.done(0);await next.tick('p','product',r.input.id);await next.tick('p','product',r.input.id);gate(r,1,'verification_review');
 await next.tick('p','product',r.input.id);assert.equal(r.tasks[1].state,'waiting_human');assert.equal(r.tasks[1].checkpoints[0].decision,undefined);
 }finally{next.close();}
});
test('approval cannot be injected by product input and changed context/source/contract cannot inherit it',async()=>{
 for(const change of ['context','source','contract']){
  const r=rig(),s=r.service();try{
   await s.create('p','product',{...r.input,contextApproval:{requestHash:'forged'}} as JobInput);
   assert.equal(s.get('p','product',r.input.id)!.contextApproval,undefined);
   await s.tick('p','product',r.input.id);gate(r);
   await s.approveContext('p','product',r.input.id,s.get('p','product',r.input.id)!.requestHash);
   if(change==='context')r.docs.put('p','product','context','Tampered',1);
   if(change==='source')r.docs.put('p','product','draft','Changed',1);
   if(change==='contract')r.contract.product.id='changed';
   await s.tick('p','product',r.input.id);assert.equal(s.get('p','product',r.input.id)!.state,'error');assert.equal(r.tasks[0].checkpoints[0].decision,undefined);
  }finally{s.close();}
 }
});


function rig(){
 const rows=new Map<string,{id:string;markdown:string;revision:number}>(), tasks:any[]=[];let starts=0;
 const key=(pid:string,product:string,id:string)=>JSON.stringify([pid,product,id]);
 const docs:JobDocuments={get:(p,b,id)=>rows.get(key(p,b,id)),put:(p,b,id,markdown,revision)=>{const k=key(p,b,id),old=rows.get(k);if((old?.revision??0)!==revision)return;const v={id,markdown,revision:revision+1};rows.set(k,v);return v;},list:(p,b,prefix)=>[...rows.entries()].filter(([k])=>{const a=JSON.parse(k);return a[0]===p&&a[1]===b&&a[2].startsWith(prefix);}).map(([,v])=>v)};
 const contract={product:{id:"product"},tasks:[{id:"review",input_types:["snapshot"]}],context:{types:[{id:"snapshot",project_document:"context"}]}};
 const runtime={openProject:async()=>({meta:{productId:"product"},contract}),listProjects:async()=>[{id:"p",productId:"product"}],listTaskInstances:async()=>structuredClone(tasks),createHarness:async()=>({decideCheckpoint:async(id:string,input:any)=>{const t=tasks.find(t=>t.id===id);t.checkpoints.find((c:any)=>c.id===input.checkpointId).decision=input;t.state='executing';return structuredClone(t);},startTask:async(taskId:string,_:unknown,o:any)=>{let t=tasks.find(t=>t.requestKey===o.requestKey);if(!t){t={id:randomUUID(),taskId,requestKey:o.requestKey,state:"created",checkpoints:[],capabilityOutputs:{},verification:[]};tasks.push(t);}return t;}})} as unknown as ProjectRuntime;
 const runner={start:()=>starts++,cancel:async(_pid:string,id:string)=>{tasks.find(t=>t.id===id).state='cancelled';}} as unknown as TaskRunner;
 const input:JobInput={id:randomUUID(),label:"Synthetic review",sources:[{id:"draft",revision:1}],steps:[{id:"chapter1",taskId:"review",context:{id:"context",markdown:"Chapter one"}},{id:"chapter2",taskId:"review",context:{id:"context",markdown:"Chapter two"}}]};docs.put("p","product","draft","Saved source",0);
 const service=()=>new BackgroundJobs(runtime,runner,docs);
 const done=(i:number)=>Object.assign(tasks[i],{state:"completed",capabilityOutputs:{review:"Report "+i},result:{content:{review:"Report "+i}}});
 return {docs,tasks,input,service,done,contract,runtime,get starts(){return starts;}};
}
test("background steps and reports persist without a product page, same ID is idempotent",async()=>{
 const r=rig(),s=r.service();try{await s.create("p","product",r.input);await s.create("p","product",r.input);await s.tick("p","product",r.input.id);assert.equal(r.tasks.length,1);r.done(0);await s.tick("p","product",r.input.id);await s.tick("p","product",r.input.id);assert.equal(r.tasks.length,2);r.done(1);await s.tick("p","product",r.input.id);const j=s.get("p","product",r.input.id)!;assert.equal(j.state,"completed");assert.equal(JSON.parse(r.docs.get("p","product",j.steps[1]!.resultDocument!)!.markdown).verified,true);assert.equal(s.get("other","product",r.input.id),undefined);}finally{s.close();}
});

test("execution activity excludes paused and human-waiting batches without losing their durable work",async()=>{
 const r=rig(),s=r.service();try{
  assert.equal(s.activeCount,0);await s.create("p","product",r.input);assert.equal(s.activeCount,1);
  await s.control("p","product",r.input.id,"pause");assert.equal(s.activeCount,0);
  await s.control("p","product",r.input.id,"resume");assert.equal(s.activeCount,1);
  await s.tick("p","product",r.input.id);gate(r);await s.tick("p","product",r.input.id);assert.equal(s.activeCount,0);
  assert.equal(s.get("p","product",r.input.id)!.state,"waiting");
 }finally{s.close();}
});
test("restart recovers the same submitted task and pause still collects its result",async()=>{
 const r=rig(),s=r.service();await s.create("p","product",r.input);await s.tick("p","product",r.input.id);s.close();const reopened=r.service();try{await reopened.recoverAll();await reopened.control("p","product",r.input.id,"pause");r.done(0);await reopened.tick("p","product",r.input.id);await reopened.tick("p","product",r.input.id);assert.equal(r.tasks.length,1);assert.equal(reopened.get("p","product",r.input.id)!.steps[0]!.state,"done");await reopened.control("p","product",r.input.id,"resume");await reopened.tick("p","product",r.input.id);assert.equal(r.tasks.length,2);}finally{reopened.close();}
});
test("pending human review output is saved as unverified and cannot advance the next step",async()=>{
 const r=rig(),s=r.service();try{await s.create("p","product",r.input);await s.tick("p","product",r.input.id);Object.assign(r.tasks[0],{state:"waiting_human",checkpoints:[{kind:"verification_review"}],capabilityOutputs:{review:"Unreviewed draft"}});await s.tick("p","product",r.input.id);const j=s.get("p","product",r.input.id)!;assert.equal(j.state,"waiting");assert.equal(JSON.parse(r.docs.get("p","product",j.steps[0]!.resultDocument!)!.markdown).verified,false);assert.equal(r.tasks.length,1);assert.equal(s.owns("p","product","review"),true);}finally{s.close();}
});
test("source and contract changes halt scheduling and preserve already saved results",async()=>{
 for(const kind of ["source","contract"]){const r=rig(),s=r.service();try{await s.create("p","product",r.input);await s.tick("p","product",r.input.id);r.done(0);await s.tick("p","product",r.input.id);if(kind==="source")r.docs.put("p","product","draft","New source",1);else r.contract.product.id="changed";await s.tick("p","product",r.input.id);assert.equal(s.get("p","product",r.input.id)!.state,"error");assert.equal(r.tasks.length,1);assert.ok(s.get("p","product",r.input.id)!.steps[0]!.resultDocument);}finally{s.close();}}
});
test("unknown contexts, protected documents, changed request IDs and overlapping jobs are refused",async()=>{
 const r=rig(),s=r.service();try{await assert.rejects(s.create("p","product",{...r.input,steps:[{id:"x",taskId:"review",context:{id:"other",markdown:"foreign"}}]}),/not declared/);await assert.rejects(s.create("p","product",{...r.input,sources:[{id:"runtime_job_fake",revision:0}]}),/Invalid/);await s.create("p","product",r.input);await assert.rejects(s.create("p","product",{...r.input,label:"changed"}),/different request/);await assert.rejects(s.create("p","product",{...r.input,id:randomUUID()}),/already owns/);}finally{s.close();}
});
test("task accepted before job task-ID commit recovers by durable request correlation",async()=>{
 const r=rig(),s=r.service();try{await s.create("p","product",r.input);await s.tick("p","product",r.input.id);const stored=r.docs.get("p","product","runtime_job_"+r.input.id)!;const j=JSON.parse(stored.markdown);j.steps[0].state="submitting";delete j.steps[0].taskInstanceId;r.docs.put("p","product",stored.id,JSON.stringify(j),stored.revision);await s.tick("p","product",r.input.id);assert.equal(r.tasks.length,1);assert.equal(s.get("p","product",r.input.id)!.steps[0]!.taskInstanceId,r.tasks[0].id);}finally{s.close();}
});

test('retry resumes only the failed chapter, preserves completed reports and old task IDs',async()=>{
 const r=rig(),s=r.service();try{await s.create('p','product',r.input);await s.tick('p','product',r.input.id);r.done(0);await s.tick('p','product',r.input.id);await s.tick('p','product',r.input.id);r.tasks[1].state='failed';await s.tick('p','product',r.input.id);assert.equal(s.get('p','product',r.input.id)!.state,'error');await s.control('p','product',r.input.id,'retry');await s.tick('p','product',r.input.id);assert.equal(r.tasks.length,3);assert.equal(s.get('p','product',r.input.id)!.steps[0]!.state,'done');assert.deepEqual(s.get('p','product',r.input.id)!.steps[1]!.previousTasks,[r.tasks[1].id]);r.done(2);await s.tick('p','product',r.input.id);assert.equal(s.get('p','product',r.input.id)!.state,'completed');}finally{s.close();}
});
test('cancel retains the submitted result and prevents scheduling later steps',async()=>{
 const r=rig(),s=r.service();try{await s.create('p','product',r.input);await s.tick('p','product',r.input.id);await s.control('p','product',r.input.id,'cancel');r.done(0);await s.tick('p','product',r.input.id);assert.equal(s.get('p','product',r.input.id)!.state,'cancelled');assert.ok(s.get('p','product',r.input.id)!.steps[0]!.resultDocument);await s.tick('p','product',r.input.id);assert.equal(r.tasks.length,1);}finally{s.close();}
});

test('requested cancellation settles as cancelled when a waiting child task is cancelled',async()=>{
 const r=rig(),s=r.service();try{
  await s.create('p','product',r.input);await s.tick('p','product',r.input.id);gate(r);
  await s.control('p','product',r.input.id,'cancel');r.tasks[0].state='cancelled';
  await s.tick('p','product',r.input.id);
  const job=s.get('p','product',r.input.id)!;
  assert.equal(job.state,'cancelled');assert.equal(job.steps[0]!.runtimeState,'cancelled');assert.equal(job.error,undefined);
  assert.equal(r.tasks[0].checkpoints[0].decision,undefined);
  await s.tick('p','product',r.input.id);assert.equal(r.tasks.length,1);
 }finally{s.close();}
});

test('requested cancellation survives restart and preserves unverified partial output',async()=>{
 const r=rig(),s=r.service();await s.create('p','product',r.input);await s.tick('p','product',r.input.id);
 await s.control('p','product',r.input.id,'cancel');s.close();
 Object.assign(r.tasks[0],{state:'cancelled',capabilityOutputs:{review:'Partial source-backed output'}});
 const reopened=r.service();try{
  await reopened.recoverAll();await reopened.tick('p','product',r.input.id);
  const job=reopened.get('p','product',r.input.id)!;
  assert.equal(job.state,'cancelled');assert.equal(job.steps[0]!.state,'running');
  const result=JSON.parse(r.docs.get('p','product',job.steps[0]!.resultDocument!)!.markdown);
  assert.equal(result.verified,false);assert.deepEqual(result.content,{review:'Partial source-backed output'});
  await reopened.tick('p','product',r.input.id);assert.equal(r.tasks.length,1);
 }finally{reopened.close();}
});

test('unexpected child cancellation and genuine execution failure remain errors',async()=>{
 for(const [cancelRequested,state] of [[false,'cancelled'],[true,'failed'],[true,'rejected']] as const){
  const r=rig(),s=r.service();try{
   await s.create('p','product',r.input);await s.tick('p','product',r.input.id);
   if(cancelRequested)await s.control('p','product',r.input.id,'cancel');
   r.tasks[0].state=state;await s.tick('p','product',r.input.id);
   const job=s.get('p','product',r.input.id)!;assert.equal(job.state,'error');assert.match(job.error!,new RegExp(state));
   assert.equal(r.tasks.length,1);
  }finally{s.close();}
 }
});

test('host summaries correlate only the exact pending context and never approve it',async()=>{
 const r=rig(),s=r.service();try{
  await s.create('p','product',r.input);await s.tick('p','product',r.input.id);gate(r);
  const before=structuredClone(r.tasks),starts=r.starts;
  const [summary]=await s.summaries('p','product');
  assert.equal(summary!.approvable,true);assert.equal(summary!.approved,false);
  assert.deepEqual(summary!.contextConfirmations,[{taskInstanceId:r.tasks[0].id,checkpointId:'cp-0'}]);
  assert.equal(summary!.steps,2);assert.equal(summary!.bytes,Buffer.byteLength('Chapter oneChapter two'));
  assert.deepEqual(r.tasks,before);assert.equal(r.starts,starts);
  assert.equal(JSON.stringify(summary).includes('Chapter one'),false);
  assert.equal(JSON.stringify(summary).includes('Saved source'),false);
  s.close();const reopened=r.service();try{
   assert.deepEqual((await reopened.summaries('p','product'))[0]!.contextConfirmations,summary!.contextConfirmations);
   await reopened.approveContext('p','product',r.input.id,summary!.requestHash);
   const approved=(await reopened.summaries('p','product'))[0]!;
   assert.equal(approved.approved,true);assert.deepEqual(approved.contextConfirmations,summary!.contextConfirmations);
   assert.deepEqual(r.tasks,before);
  }finally{reopened.close();}
 }finally{s.close();}
});

test('uncertain batch ownership never consolidates a standalone checkpoint',async()=>{
 for(const change of ['source','contract','context-version','context-content','missing-context','other-connector','other-ref','extra-context','wrong-task','decided-checkpoint','result-review','tool-confirm','completed','cancel-requested','archived','missing-task','not-submitted']){
  const r=rig(),s=r.service();try{
   await s.create('p','product',r.input);await s.tick('p','product',r.input.id);gate(r);
   const task=r.tasks[0],stored=r.docs.get('p','product','runtime_job_'+r.input.id)!,job=JSON.parse(stored.markdown);
   if(change==='source')r.docs.put('p','product','draft','New source',1);
   if(change==='contract')r.contract.context.types[0]!.project_document='other-context';
   if(change==='context-version')task.contextSet[0].documentRevision++;
   if(change==='context-content')job.steps[0].context.markdown='Changed input';
   if(change==='missing-context')task.contextSet=[];
   if(change==='other-connector')task.contextSet[0].connector='local-fs';
   if(change==='other-ref')task.contextSet[0].ref='other-context';
   if(change==='extra-context')task.contextSet.push({...task.contextSet[0]});
   if(change==='wrong-task')task.taskId='different-task';
   if(change==='decided-checkpoint')task.checkpoints[0].decision={choice:'approve'};
   if(change==='result-review')task.checkpoints[0].kind='verification_review';
   if(change==='tool-confirm')task.checkpoints[0].kind='tool_ask';
   if(change==='completed')job.state='completed';
   if(change==='cancel-requested')job.cancelRequested=true;
   if(change==='archived')r.runtime.openProject=async()=>({meta:{productId:'product',archivedAt:'2026-11-20T00:00:00Z'},contract:r.contract}) as never;
   if(change==='missing-task')job.steps[0].taskInstanceId='not-present';
   if(change==='not-submitted')job.steps[0].state='pending';
   r.docs.put('p','product',stored.id,JSON.stringify(job),stored.revision);
   const [summary]=await s.summaries('p','product');
   assert.deepEqual(summary!.contextConfirmations,[],change);
   assert.equal(r.starts,1,change);
  }finally{s.close();}
 }
});

test('summary scope and unsupported batches retain fallback without exposing source bodies',async()=>{
 const r=rig(),s=r.service();try{
  await s.create('p','product',{...r.input,steps:[{id:'plain',taskId:'review'}]});
  const [summary]=await s.summaries('p','product');
  assert.equal(summary!.approvable,false);assert.equal(summary!.bytes,0);assert.deepEqual(summary!.contextConfirmations,[]);
  assert.deepEqual(await s.summaries('other-project','product'),[]);
  await assert.rejects(s.summaries('p','other-product'),/unavailable/);
 }finally{s.close();}
});
