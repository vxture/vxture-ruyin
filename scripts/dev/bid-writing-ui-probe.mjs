// Synthetic mounted product UI check. No real files, credentials or model calls.
import {createRequire} from 'node:module';
import {mkdtemp,cp,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../apps/ui-workspace/package.json',import.meta.url));
const {JSDOM}=require('jsdom');
if(!process.argv[2])throw Error('Usage: node scripts/dev/bid-writing-ui-probe.mjs PRODUCT_DESKTOP_DIR');
const root=resolve(process.argv[2]),temp=await mkdtemp(join(tmpdir(),'bid-writing-ui-'));
const dom=new JSDOM('<main></main>',{url:'http://localhost/?hostOrigin=http://localhost'});
for(const key of ['window','document','location','parent'])globalThis[key]=key==='parent'?dom.window:dom.window[key];
Object.defineProperty(globalThis,'navigator',{configurable:true,value:dom.window.navigator});
const docs=new Map(),tasks=[],jobs=new Map();let reads=0,published=0;
const reviewRequests=[];const bridge={review:id=>reviewRequests.push(id),request:async(method,path,body)=>{
 if(path.startsWith('/jobs')){
  if(path==='/jobs'&&method==='POST'){const job={...structuredClone(body),state:'running',paused:false,steps:body.steps.map(s=>({...s,state:'pending'}))};jobs.set(job.id,job);}
  const id=path==='/jobs'?body.id:path.split('/')[2],job=jobs.get(id);if(!job)return{ok:false,status:404};
  if(path.endsWith('/control')){job.paused=body.action!=='resume';if(body.action==='cancel')job.state='cancelled';}
  if(job.state!=='cancelled'){
   for(const step of job.steps){const t=tasks.find(t=>t.id===step.taskInstanceId);if(t?.hasResult){step.state=t.state==='completed'?'done':'running';step.waitingOn=t.state==='completed'?[]:['verification_review'];step.resultDocument='runtime_result_'+t.id;docs.set('/documents/'+step.resultDocument,{markdown:JSON.stringify({verified:t.state==='completed',verification:[{kind:'human',status:t.state==='completed'?'passed':'pending_human'}],content:{proposal_generation:t.result}}),revision:1});}}
   const active=job.steps.find(s=>s.state==='running');if(!active&&!job.paused){const step=job.steps.find(s=>s.state==='pending');if(step){const task={id:'task-'+(tasks.length+1),taskId:step.taskId,state:'waiting_human',hasResult:false,context:JSON.parse(step.context.markdown)};tasks.push(task);step.taskInstanceId=task.id;step.state='running';}}
   job.state=job.steps.every(s=>s.state==='done')?'completed':job.paused?'paused':'running';
  }
  return{ok:true,body:structuredClone(job)};
 }
 if(path==='/project')return{ok:true,body:{projectId:'synthetic-ui'}};
 if(path.startsWith('/readings/')&&path.includes('/units/'))return{ok:true,body:{text:'SYNTHETIC evidence: gateway capacity is 256.',tables:[]}};
 if(path==='/tasks'&&method==='GET')return{ok:true,body:{items:tasks}};
 if(path==='/tasks'&&method==='POST'){const task={id:'task-'+(tasks.length+1),taskId:'write_chapter',state:'waiting_human',hasResult:false,context:JSON.parse(docs.get('/documents/bid_chapter_context').markdown)};tasks.push(task);return{ok:true,body:task};}
 if(path.startsWith('/tasks/')&&path.endsWith('/result'))return{ok:true,body:{content:{proposal_generation:tasks.find(t=>path==='/tasks/'+t.id+'/result').result}}};
 const doc=docs.get(path);if(method==='GET'){reads++;return doc?{ok:true,body:structuredClone(doc)}:{ok:false,status:404};}
 if((doc?.revision||0)!==body.revision)return{ok:false,status:409};
 const next={markdown:body.markdown,revision:(doc?.revision||0)+1};docs.set(path,next);return{ok:true,body:next};
}};
const flush=async()=>{for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));};
const settled=async()=>{const refresh=()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='\u5237\u65b0\u8fdb\u5ea6');for(let n=0;n<300&&refresh()?.disabled;n++)await new Promise(r=>setTimeout(r,10));assert.equal(refresh()?.disabled,false,'writing UI action must settle before advancing synthetic host state');};
const navigate=()=>window.dispatchEvent(new window.MessageEvent('message',{source:window,origin:'http://localhost',data:{ns:'ruyin.navigation',kind:'navigate',section:'chapters'}}));
try{
 await cp(join(root,'src'),temp,{recursive:true});
 await copyFile(join(root,'node_modules/marked/lib/marked.esm.js'),join(temp,'vendor-marked.mjs'));
 await copyFile(join(root,'node_modules/dompurify/dist/purify.es.mjs'),join(temp,'vendor-dompurify.mjs'));
 const source=name=>import(pathToFileURL(join(temp,name)).href);
 const {Requirements}=await source('requirements.mjs'),{PlanSession}=await source('plan.mjs');
 const matrix=new Requirements(bridge);matrix.add({text:'Daily backup',quote:'Backup daily',location:'Synthetic section'});matrix.add({text:'Incident response',quote:'Respond promptly',location:'Synthetic section 2'});matrix.confirm();await matrix.save();
 const plan=new PlanSession(bridge);await plan.load();plan.build(matrix);plan.add();plan.assign(plan.value.outline[0].id,matrix.rows[1].id,false);plan.assign(plan.value.outline[1].id,matrix.rows[1].id,true);plan.approve(matrix);await plan.save();
 const {mountWriting}=await source('writing-ui.mjs');
 const workflow={states:{},emit(){published++;if(published>30)throw Error('Navigation feedback loop');queueMicrotask(navigate);},async mark(){this.emit();}};
 const mounted=await mountWriting(bridge,workflow);navigate();await flush();
 for(let n=0;n<150&&document.querySelector('.writing-toolbar .primary').disabled;n++)await new Promise(r=>setTimeout(r,10));assert.equal(document.querySelector('.writing-toolbar .primary').disabled,false,'initial evidence digests must settle before idle-navigation checks');
 const toggle=document.querySelector('.writing-assistant-toggle');assert.equal(document.querySelector('.writing-agent').hidden,true,'medium desktop width keeps the document primary');toggle.click();assert.equal(document.querySelector('.writing-agent').hidden,false);toggle.click();assert.equal(document.querySelector('.writing-agent').hidden,true);toggle.click();assert.equal(document.querySelector('.writing-agent').hidden,false);
 const before=reads;for(let i=0;i<4;i++)navigate();await flush();assert.equal(reads,before,'same-route host echoes must not reread or lock controls');
 const start=[...document.querySelectorAll('button')].find(b=>b.textContent==='\u5f00\u59cb\u5206\u7ae0\u7f16\u5199');assert.equal(start.disabled,false);start.click();await flush();
 for(let i=0;i<100&&(tasks.length!==1||start.disabled);i++)await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(tasks.length,1,document.querySelector('[role=status]').textContent);assert.equal(start.disabled,false,'host registration echo must leave controls usable');assert.ok(published<10);
 const button=value=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===value);assert.ok(b,value);return b;};
 button('\u6682\u505c\u540e\u7eed\u7ae0\u8282').click();await flush();
 const finish=(task,body,pending=false)=>{task.state=pending?'waiting_human':'completed';task.hasResult=true;task.result=JSON.stringify({...task.context,markdown:body,summary:'Synthetic summary',materialGaps:[],coveredRequirementIds:task.context.chapter.requirementIds,evidenceDigest:task.context.enterpriseEvidence?.digest,usedEvidence:[]});};
 finish(tasks[0],'## First draft\n\nSynthetic body with measurable daily backup, evidence and verification.');await settled();await mounted.run.step();mounted.render();await flush();
 const paragraph=document.querySelector('.markdown-body p');mounted.render();assert.equal(document.querySelector('.markdown-body p'),paragraph,'polling must retain the rendered document when its content did not change');
 const original=docs.get('/documents/bid_draft').markdown;
 document.querySelector('textarea').value='Expand verification steps';button('\u8ba9\u667a\u80fd\u4f53\u91cd\u5199\u672c\u7ae0').click();document.querySelectorAll('.writing-chapter')[1].click();
 for(let i=0;i<100&&tasks.length<2;i++)await new Promise(resolve=>setTimeout(resolve,10));await flush();assert.equal(tasks.length,2);assert.equal(tasks[1].context.chapterId,plan.value.outline[0].id,'changing the reading selection during submission must not retarget the rewrite');document.querySelectorAll('.writing-chapter')[0].click();
 finish(tasks[1],'## Revised draft\n\nRevised synthetic body with ownership, measurable checks and evidence.',true);await settled();await mounted.run.step();mounted.render();await flush();
 assert.equal(docs.get('/documents/bid_draft').markdown,original,'rewrite preview leaves accepted body intact');
 button('\u67e5\u770b\u5e76\u786e\u8ba4\u91c7\u7528').click();await flush();assert.equal(reviewRequests.at(-1),tasks[1].id);assert.equal(docs.get('/documents/bid_draft').markdown,original);tasks[1].state='completed';await settled();await mounted.run.step();mounted.render();for(let i=0;i<100&&mounted.run.value.items[0].state!=='done';i++)await new Promise(resolve=>setTimeout(resolve,10));await flush();assert.match(docs.get('/documents/bid_draft').markdown,/Revised draft/);
 button('\u67e5\u770b\u66ff\u6362\u524d\u7248\u672c 1').click();await flush();mounted.render();assert.match(document.querySelector('.markdown-body').textContent,/First draft/);assert.match(document.querySelector('.writing-document>p').textContent,/\u5386\u53f2/);
 button('\u8fd4\u56de\u5f53\u524d\u7a3f').click();assert.match(document.querySelector('.markdown-body').textContent,/Revised draft/);
 // P8.3 UI fixture: actual immutable snapshot documents, source preview and
 // changed-evidence single-chapter rewrite on the same mounted writing surface.
 const {chapterEvidence,saveChapterEvidence}=await source('chapter-evidence.mjs');
 const fact={id:'synthetic-fact-0001',kind:'product',subject:'SYNTHETIC gateway',attribute:'capacity',value:'256',quote:'Gateway capacity is 256.',validity:'not_applicable',validUntil:null,dateQuote:'',source:{id:'synthetic',version:1,name:'SYNTHETIC-evidence.md',fileId:'synthetic-file',readingId:'synthetic-reading',hash:'a'.repeat(64)},segment:{unit:0,location:{page:1}},flags:[],decision:{action:'adopt',value:'',note:'',at:'2026-11-20'}};
 let enterpriseState={state:'ready',facts:[fact],recommendations:[{requirement:{id:matrix.rows[0].id},factIds:[fact.id],status:'available',reasons:['Synthetic requirement evidence.']}]};
 const originalSources=mounted.run.sources.bind(mounted.run);mounted.run.sources=async()=>{const value=await originalSources();mounted.run.enterpriseState=enterpriseState;return value;};
 const firstId=mounted.run.value.items[0].id,firstTask=mounted.run.plan.writingTasks(mounted.run.matrix)[0],evidence=await chapterEvidence(enterpriseState,firstTask),reference=await saveChapterEvidence(bridge,evidence);
 const refreshSettled=async()=>{for(let n=0;n<150&&button('\u5237\u65b0\u8fdb\u5ea6').disabled;n++)await new Promise(r=>setTimeout(r,10));assert.equal(button('\u5237\u65b0\u8fdb\u5ea6').disabled,false);await flush();};
 mounted.run.value.items[0].evidenceRef=reference;mounted.run.value.items[0].usedEvidence=[{factId:fact.id,quote:'Revised synthetic body with ownership, measurable checks and evidence.'}];await mounted.run.save();button('\u5237\u65b0\u8fdb\u5ea6').click();await refreshSettled();
 for(let n=0;n<100&&!document.querySelector('.writing-evidence-fact');n++)await new Promise(r=>setTimeout(r,10));assert.match(document.querySelector('.writing-evidence').textContent,/SYNTHETIC-evidence.md/);assert.match(document.querySelector('.writing-evidence').textContent,/\u5df2\u5f15\u7528/);
 document.querySelector('.writing-evidence-fact').open=true;button('\u56de\u770b\u8be5\u7248\u539f\u6587').click();await flush();assert.match(document.querySelector('.writing-evidence-source').textContent,/capacity is 256/);
 enterpriseState=structuredClone(enterpriseState);enterpriseState.facts[0].value='512';enterpriseState.facts[0].quote='Gateway capacity is 512.';enterpriseState.facts[0].source.version=2;button('\u5237\u65b0\u8fdb\u5ea6').click();await refreshSettled();assert.match(document.querySelector('.writing-evidence-status').textContent,/\u5df2\u66f4\u65b0/);
 const beforeEvidenceRewrite=docs.get('/documents/bid_draft').markdown;for(let n=0;n<100&&button('\u8865\u8d44\u6599\u540e\u91cd\u5199\u672c\u7ae0').disabled;n++)await new Promise(r=>setTimeout(r,10));assert.equal(button('\u8865\u8d44\u6599\u540e\u91cd\u5199\u672c\u7ae0').disabled,false);button('\u8865\u8d44\u6599\u540e\u91cd\u5199\u672c\u7ae0').click();for(let i=0;i<200&&tasks.length<3;i++)await new Promise(r=>setTimeout(r,10));assert.equal(tasks.length,3,document.querySelector('[role=status]').textContent);assert.equal(tasks[2].context.chapterId,firstId);assert.equal(tasks[2].context.enterpriseEvidence.facts[0].source.version,2);
 finish(tasks[2],'## Updated evidence draft\n\nGateway capacity is 512. Verification will record measurements and compare the tender threshold.',true);const updated=JSON.parse(tasks[2].result);updated.usedEvidence=[{factId:fact.id,quote:'Gateway capacity is 512.'}];tasks[2].result=JSON.stringify(updated);await settled();await mounted.run.step();mounted.render();await flush();assert.equal(docs.get('/documents/bid_draft').markdown,beforeEvidenceRewrite);for(let n=0;n<150&&!/v2/.test(document.querySelector('.writing-evidence').textContent);n++)await new Promise(r=>setTimeout(r,10));assert.match(document.querySelector('.writing-evidence').textContent,/v2/);
 button('\u67e5\u770b\u5e76\u786e\u8ba4\u91c7\u7528').click();await flush();assert.equal(reviewRequests.at(-1),tasks[2].id);assert.equal(docs.get('/documents/bid_draft').markdown,beforeEvidenceRewrite);tasks[2].state='completed';await settled();await mounted.run.step();mounted.render();for(let n=0;n<100&&mounted.run.value.items[0].state!=='done';n++)await new Promise(r=>setTimeout(r,10));await flush();assert.match(docs.get('/documents/bid_draft').markdown,/capacity is 512/);const oldEvidenceHistory=JSON.parse(docs.get('/documents/'+mounted.run.value.items[0].history.at(-1)).markdown);assert.equal(oldEvidenceHistory.evidenceRef.digest,reference.digest);assert.equal(mounted.run.value.paused,true);
 window.dispatchEvent(new window.Event('pagehide'));
 const {renderMarkdown}=await source('markdown-view.mjs');const target=document.createElement('div');
 renderMarkdown(target,'## Safe heading\n\n| Item | Value |\n| --- | --- |\n| Backup | Daily |\n\n<script>window.pwned=1</script><img src="https://example.com/private" onerror="window.pwned=1"><iframe src="https://example.com"></iframe><svg onload="window.pwned=1"></svg>[bad](javascript:alert(1))');
 assert.equal(target.querySelector('h2').textContent,'Safe heading');assert.ok(target.querySelector('table'));assert.equal(target.querySelectorAll('script,img,iframe,svg,[href],[src],[onerror],[onload]').length,0);assert.equal(window.pwned,undefined);
 docs.clear();tasks.length=0;jobs.clear();document.body.innerHTML='<main></main>';
 const empty=await mountWriting(bridge,{states:{},emit(){},async mark(){}});empty.render();
 assert.match(document.querySelector('.writing-document').textContent,/\u5148\u786e\u8ba4\u7f16\u5199\u89c4\u5212/);
 assert.equal(document.querySelector('.writing-toolbar .primary').disabled,true,'new projects must render a disabled writing action before a plan exists');
 window.dispatchEvent(new window.Event('pagehide'));
 console.log('PASS: empty project initialization; idle navigation; stable Markdown; candidate/history; P8.3 source preview, evidence update warning, v2 single-chapter rewrite with preserved v1 source history; active/remote content stripping');
}finally{dom.window.close();assert.ok(temp.startsWith(join(tmpdir(),'bid-writing-ui-')),'cleanup stays inside the named temporary test directory');await rm(temp,{recursive:true,force:true});}
