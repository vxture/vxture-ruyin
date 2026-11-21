import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ensurePinnedPython} from './pinned-python.mjs';

test('repeated seeding keeps a materialized minor alias and reuses the verified exact patch',()=>{
 const root=mkdtempSync(join(tmpdir(),'ruyin-pin-'));
 try{const pinned=join(root,'cpython-3.13.15-windows-x86_64-none'),alias=join(root,'cpython-3.13-windows-x86_64-none');mkdirSync(pinned);mkdirSync(alias);writeFileSync(join(pinned,'python.exe'),'runtime');writeFileSync(join(alias,'keep.txt'),'materialized alias');let installs=0,probes=0;
  for(let i=0;i<2;i++)assert.equal(ensurePinnedPython({root,version:'3.13.15',platform:'win32',install:()=>installs++,probe:()=>{probes++;return'3.13.15';}}),join(pinned,'python.exe'));
  assert.equal(installs,0);assert.equal(probes,2);assert.equal(readFileSync(join(alias,'keep.txt'),'utf8'),'materialized alias');
  assert.throws(()=>ensurePinnedPython({root,version:'3.13.15',platform:'win32',install:()=>installs++,probe:()=>'3.13.16'}),/mismatch/);assert.equal(installs,0);
 }finally{assert.ok(root.startsWith(join(tmpdir(),'ruyin-pin-')));rmSync(root,{recursive:true,force:true});}
});
test('a missing patch installs its full pin and an absent result fails rather than using another version',()=>{
 const root=mkdtempSync(join(tmpdir(),'ruyin-pin-'));
 try{const calls=[];assert.throws(()=>ensurePinnedPython({root,version:'3.13.15',platform:'win32',install:v=>calls.push(v),probe:()=>{throw Error('must not probe another runtime');}}),/missing/);assert.deepEqual(calls,['3.13.15']);
  const actual=ensurePinnedPython({root,version:'3.13.15',platform:'win32',install:v=>{assert.equal(v,'3.13.15');mkdirSync(join(root,'cpython-'+v+'-windows-x86_64-none'));writeFileSync(join(root,'cpython-'+v+'-windows-x86_64-none','python.exe'),'runtime');},probe:()=>'3.13.15'});assert.ok(actual.endsWith('python.exe'));
 }finally{assert.ok(root.startsWith(join(tmpdir(),'ruyin-pin-')));rmSync(root,{recursive:true,force:true});}
});
