import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

test('bundled bootstrap imports resources beyond legacy Windows path length without a system change',t=>{
 if(process.platform!=='win32')return t.skip('Windows integration check');
 const pythonRoot=resolve('resources/uv/python');
 const python=existsSync(join(pythonRoot,'cpython-3.13.15-windows-x86_64-none/python.exe'))?join(pythonRoot,'cpython-3.13.15-windows-x86_64-none/python.exe'):process.env.RUYIN_TEST_PYTHON;
 if(!python)return t.skip('Prepare the pinned bundled runtime or set RUYIN_TEST_PYTHON for this integration check');
 const root=mkdtempSync(join(tmpdir(),'ruyin-python-path-'));
 try{const site=join(root,'site'),deep=join(root,'nested-'.repeat(24),'lib'),module=join(deep,'synthetic_package');mkdirSync(site);mkdirSync(module,{recursive:true});writeFileSync(join(site,'sitecustomize.py'),readFileSync(resolve('resources/python-runtime/sitecustomize.py')));writeFileSync(join(module,'__init__.py'),'from pathlib import Path\nvalue = Path(__file__).with_name("synthetic.txt").read_text()\n');writeFileSync(join(module,'synthetic.txt'),'SYNTHETIC local resource');assert.ok(join(module,'synthetic.txt').length>260);
  const r=spawnSync(python,['-B','-c','import synthetic_package; print(synthetic_package.value)'],{env:{...process.env,PYTHONPATH:site+';'+deep},encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),'SYNTHETIC local resource');
 }finally{assert.ok(root.startsWith(join(tmpdir(),'ruyin-python-path-')));rmSync(root,{recursive:true,force:true});}
});

test('offline uv reads the exact constraints from spaced and Unicode paths as a file URL',t=>{
 if(process.platform!=='win32')return t.skip('Windows integration check');
 const uv=resolve('resources/uv/uv.exe');
 if(!existsSync(uv))return t.skip('Prepare the bundled uv runtime for this integration check');
 const root=mkdtempSync(join(tmpdir(),'ruyin uv constraints-'));
 try{
  const dir=join(root,'spaced \u4e2d\u6587 folder');mkdirSync(dir);
  const file=join(dir,'constraints.txt');writeFileSync(file,readFileSync(resolve('resources/python-runtime/requirements.txt')));
  const env={...process.env,UV_CACHE_DIR:resolve('resources/uv/cache'),UV_PYTHON_INSTALL_DIR:resolve('resources/uv/python'),UV_PYTHON_DOWNLOADS:'never',
   UV_TOOL_DIR:join(root,'tools'),UV_CONSTRAINT:pathToFileURL(file).href,PYTHONPATH:resolve('resources/uv/python-site')};
  assert.doesNotMatch(env.UV_CONSTRAINT,/\s/);
  const r=spawnSync(uv,['tool','run','--offline','--from','excel-mcp-server==0.1.8','excel-mcp-server','--help'],{env,encoding:'utf8',windowsHide:true,timeout:60000});
  assert.equal(r.error,undefined,r.error?.message);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/Excel MCP Server/);
 }finally{assert.ok(root.startsWith(join(tmpdir(),'ruyin uv constraints-')));rmSync(root,{recursive:true,force:true});}
});
