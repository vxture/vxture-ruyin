// Mounted requirement persistence and legacy task migration, using synthetic data only.
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../apps/ui-workspace/package.json',import.meta.url));
const {JSDOM}=require('jsdom');
if(!process.argv[2])throw Error('Usage: node scripts/dev/bid-autosave-ui-probe.mjs PRODUCT_DESKTOP_DIR');
const root=resolve(process.argv[2]);
const html=await readFile(resolve(root,'src/index.html'),'utf8');
const dom=new JSDOM(html,{url:'http://localhost/?hostOrigin=http://localhost'});
for(const key of ['window','document','location','sessionStorage'])globalThis[key]=dom.window[key];
const docs=new Map();let legacyReads=0;
const bridge={request:async(method,path,body)=>{
 if(path==='/project')return{ok:true,body:{projectId:'autosave-synthetic'}};
 if(path==='/tasks'){legacyReads++;return{ok:true,body:{items:[]}};}
 const old=docs.get(path);if(method==='GET')return old?{ok:true,body:structuredClone(old)}:{ok:false,status:404};
 if((old?.revision??0)!==body.revision)return{ok:false,status:409};
 const next={markdown:body.markdown,revision:body.revision+1};docs.set(path,next);return{ok:true,body:structuredClone(next)};
}};
const source=name=>import(pathToFileURL(resolve(root,'src',name)).href);
try{
 const {Requirements}=await source('requirements.mjs'),{mountRequirements}=await source('requirements-ui.mjs');
 const matrix=new Requirements(bridge);matrix.add({text:'Daily backup',quote:'Backup daily',location:'Section 1'});matrix.confirm();await matrix.save();
 docs.set('/documents/bid_analysis_request',{markdown:JSON.stringify({applied:true,spec:{id:'finished-job'}}),revision:1});sessionStorage.setItem('bid-analysis:autosave-synthetic','undefined');
 await mountRequirements(bridge);assert.equal(sessionStorage.getItem('bid-analysis:autosave-synthetic'),null);assert.equal(legacyReads,0);
 document.querySelector('.requirement-open').click();const input=document.getElementById('detail-text');input.value='Daily backup with audit records';input.dispatchEvent(new window.Event('input'));window.dispatchEvent(new window.Event('pagehide'));
 for(let n=0;n<30&&!docs.get('/documents/bid_requirements').markdown.includes('with audit records');n++)await new Promise(r=>setTimeout(r,10));
 const reopened=new Requirements(bridge);await reopened.load();assert.equal(reopened.rows[0].text,input.value);assert.equal(reopened.rows[0].confirmed,false);
 document.body.innerHTML=new JSDOM(html).window.document.body.innerHTML;await mountRequirements(bridge);assert.equal(document.querySelector('.requirement-open').textContent,'Daily backup with audit records');assert.equal(legacyReads,0);
 console.log('PASS: requirement edits save on page exit, reopen retains unconfirmed edits, and applied background analysis ignores legacy session IDs');
}finally{dom.window.close();}
