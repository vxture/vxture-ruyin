import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync,existsSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,relative,sep} from 'node:path';
import {verifyDocumentReader} from './verify-document-reader.mjs';

test('offline reader creates and reads real DOCX with only the runtime template archive, refusing a missing archive',t=>{
 const source=resolve('resources/document-reader'),python=resolve('resources/uv/python/cpython-3.13.15-windows-x86_64-none/python.exe');
 if(!existsSync(join(source,'lib/ruyin-reader-build.json'))||!existsSync(python))return t.skip('Prepare the pinned document reader and Windows Python runtime');
 const root=mkdtempSync(join(tmpdir(),'ruyin-reader-payload-'));
 try{
  const target=join(root,'document-reader');
  cpSync(source,target,{recursive:true,filter:path=>!relative(source,path).replaceAll('\\','/').startsWith('lib/docx/templates/default-docx-template')&&!relative(source,path).replaceAll('\\','/').includes('__pycache__')});
  assert.ok(!existsSync(join(target,'lib/docx/templates/default-docx-template')));
  const result=verifyDocumentReader(root,python);assert.equal(result.engine['python-docx'],'1.2.0');assert.equal(result.dependencies,11);
  const runtimeTemplate=resolve(target,'lib/docx/templates/default.docx');assert.ok(runtimeTemplate.startsWith(resolve(root)+sep));
  rmSync(runtimeTemplate);assert.throws(()=>verifyDocumentReader(root,python),/default DOCX template is missing/);
 }finally{assert.ok(relative(tmpdir(),root).startsWith('ruyin-reader-payload-'));rmSync(root,{recursive:true,force:true});}
});
