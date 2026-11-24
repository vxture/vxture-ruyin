// Mounted P7.2 screen regression with synthetic source only.
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../apps/ui-workspace/package.json',import.meta.url)),{JSDOM}=require('jsdom');
const root=resolve(process.argv[2]||'');if(!process.argv[2])throw Error('Pass desktop product directory');
const html=await readFile(resolve(root,'src/index.html'),'utf8'),dom=new JSDOM(html,{url:'http://localhost/?hostOrigin=http://localhost'});
for(const k of ['window','document','location','Option'])globalThis[k]=dom.window[k];globalThis.parent=dom.window;
const {buildTenderBatches,batchContext}=await import(pathToFileURL(resolve(root,'src/batch-analysis.mjs')).href);
const reading={id:'reading',fileId:'file',hash:'a'.repeat(64),state:'completed',units:1,name:'synthetic.md',createdAt:new Date().toISOString(),flags:[]};
const unit={index:0,text:'Supplier must provide 8 units.',location:{page:1},flags:[],tables:[]},plan=buildTenderBatches([unit],reading),batch=plan.batches[0];
const result={verified:true,content:{requirement_analysis:JSON.stringify({...batchContext(plan,batch),processedSegmentIds:batch.segments.map(s=>s.id),requirements:[{segmentId:batch.segments[0].id,category:'technical',text:'Provide 8 units.',quote:unit.text}],issues:[]})}};
const job={id:plan.runId,state:'running',sources:[{id:'bid_analysis_manifest_'+plan.runId,revision:1}],steps:[{id:batch.id,taskId:'analyze_tender_batch',context:{markdown:JSON.stringify(batchContext(plan,batch))},state:'done',resultDocument:'result'}],createdAt:new Date().toISOString()};
const calls=[],bridge={request:async(method,path)=>{
 calls.push({method,path});
 if(path==='/files')return {ok:true,body:{items:[{id:reading.fileId,hash:reading.hash,name:reading.name}]}};
 if(path==='/readings')return {ok:true,body:{items:[reading]}};
 if(path.includes('/units/'))return {ok:true,body:unit};
 if(path==='/jobs')return {ok:true,body:{items:[job]}};
 if(path.startsWith('/jobs/'))return {ok:true,body:job};
 if(path.includes('bid_analysis_manifest_'))return {ok:true,body:{markdown:JSON.stringify(plan),revision:1}};
 if(path==='/documents/result')return {ok:true,body:{markdown:JSON.stringify(result)}};
 return {ok:false,status:404};
}};
const {mountReading}=await import(pathToFileURL(resolve(root,'src/reading-ui.mjs')).href),{mountBatchAnalysis}=await import(pathToFileURL(resolve(root,'src/batch-analysis-ui.mjs')).href);
const timers=new Map();let nextTimer=0;const realSetTimeout=globalThis.setTimeout,realClearTimeout=globalThis.clearTimeout;
try{
 await mountReading(bridge);await mountBatchAnalysis(bridge);
 assert.match(document.getElementById('batch-progress').textContent,/1\/1/);
 const candidate=document.querySelector('.source-candidate');assert.ok(candidate);
 candidate.querySelector('button').click();for(let i=0;i<30;i++)await Promise.resolve();assert.ok(document.querySelector('.source-drawer'));
 document.querySelector('.source-drawer-head button').click();assert.ok(!document.querySelector('.source-drawer'));
 globalThis.setTimeout=(fn,ms)=>{timers.set(++nextTimer,{fn,ms});return nextTimer;};globalThis.clearTimeout=id=>timers.delete(id);
 const navigate=section=>window.dispatchEvent(new window.MessageEvent('message',{source:parent,origin:'http://localhost',data:{ns:'ruyin.navigation',kind:'navigate',section}}));
 navigate('analysis');for(let i=0;i<30;i++)await Promise.resolve();
 assert.ok([...timers.values()].some(t=>t.ms===2500));assert.equal(document.querySelector('.source-candidate'),candidate);
 navigate('requirements');for(let i=0;i<30;i++)await Promise.resolve();assert.equal(timers.size,0);assert.equal(calls.filter(c=>c.method==='POST').length,0);
 console.log('PASS batch UI: persisted candidates, source drawer, stable DOM, inactive polling stopped, no automatic job restart');
}finally{window.dispatchEvent(new window.Event('pagehide'));globalThis.setTimeout=realSetTimeout;globalThis.clearTimeout=realClearTimeout;dom.window.close();}
