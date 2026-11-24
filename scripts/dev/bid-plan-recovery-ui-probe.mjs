// Terminal planning recovery, using synthetic documents and no model calls.
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../apps/ui-workspace/package.json',import.meta.url)),{JSDOM}=require('jsdom');
if(!process.argv[2])throw Error('Pass desktop product directory');
const source=name=>import(pathToFileURL(resolve(process.argv[2],'src',name)).href),{mountPlanning}=await source('plan-ui.mjs'),{Requirements}=await source('requirements.mjs'),{PlanSession}=await source('plan.mjs');
const until=async condition=>{for(let n=0;n<120&&!condition();n++)await new Promise(r=>setTimeout(r,10));assert.ok(condition(),'Planning recovery did not settle');};
for(const scenario of ['cancelled','error','unverified','malformed']){
 const dom=new JSDOM('<main></main>',{url:'http://localhost/?hostOrigin=http://localhost'});for(const key of ['window','document','location','sessionStorage'])globalThis[key]=dom.window[key];
 const docs=new Map(),jobs=new Map();let posts=0;
 const bridge={request:async(method,path,body)=>{if(path==='/project')return {ok:true,body:{projectId:'synthetic-'+scenario}};if(path==='/files')return {ok:true,body:{items:[]}};if(path==='/tasks')throw Error('Terminal background work must not become a legacy task');if(path==='/jobs'&&method==='POST'){posts++;jobs.set(body.id,{...structuredClone(body),state:'cancelled'});return {ok:true,body:structuredClone(jobs.get(body.id))};}if(path.startsWith('/jobs/'))return jobs.has(path.slice(6))?{ok:true,body:structuredClone(jobs.get(path.slice(6)))}:{ok:false,status:404};const old=docs.get(path);if(method==='GET')return old?{ok:true,body:structuredClone(old)}:{ok:false,status:404};if((old?.revision||0)!==body.revision)return {ok:false,status:409};const next={markdown:body.markdown,revision:body.revision+1};docs.set(path,next);return {ok:true,body:next};}};
 try{
  const m=new Requirements(bridge);m.add({text:'Daily backup',quote:'Backup daily',location:'Synthetic tender'});m.confirm();await m.save();const p=new PlanSession(bridge);await p.load();await p.save();const spec={id:'old-'+scenario,sources:[{id:'bid_plan',revision:p.revision}],steps:[{id:'outline',taskId:'plan_outline',context:{markdown:'{}'},state:['unverified','malformed'].includes(scenario)?'done':'pending',resultDocument:'result'}]};jobs.set(spec.id,{...structuredClone(spec),state:scenario==='error'?'error':scenario==='cancelled'?'cancelled':'completed',error:scenario==='error'?'Synthetic model timeout':undefined});docs.set('/documents/bid_plan_request',{revision:1,markdown:JSON.stringify({spec})});docs.set('/documents/result',{revision:1,markdown:JSON.stringify({verified:scenario!=='unverified',content:{proposal_generation:'not valid JSON'}})});
  const mounted=await mountPlanning(bridge,{states:{},emit(){},async mark(){}});const action=()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='\u8ba9\u667a\u80fd\u4f53\u751f\u6210\u89c4\u5212');await until(()=>action()&&!action().disabled);assert.equal(mounted.value.outline.length,0);assert.ok(!docs.has('/documents/bid_plan_candidate'));action().click();await until(()=>posts===1);assert.notEqual(JSON.parse(docs.get('/documents/bid_plan_request').markdown).spec.id,spec.id);assert.equal(docs.get('/documents/result').revision,1);assert.ok(!docs.has('/documents/bid_draft'));await until(()=>action()&&!action().disabled);window.dispatchEvent(new window.Event('pagehide'));
 }finally{dom.window.close();}
}
console.log('PASS planning recovery: cancelled/error/unverified/malformed work retains output, never becomes a candidate, and permits an explicit new request without touching drafts');
