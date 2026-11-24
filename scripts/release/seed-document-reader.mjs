// Build-only installation. Runtime uses this closed dependency tree without pip/network.
import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync,readdirSync,mkdtempSync,copyFileSync,renameSync,rmSync} from 'node:fs';
import {resolve,join,dirname,basename,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const args=process.argv.slice(2),value=k=>args.includes(k)?args[args.indexOf(k)+1]:undefined;
const resources=resolve(value('--resources')||join(root,'resources')),reader=join(resources,'document-reader');
const uv=value('--uv')||join(resources,'uv',process.platform==='win32'?'uv.exe':'uv');
let python=value('--python');
if(!python){const py=join(resources,'uv','python');if(existsSync(py))for(const name of readdirSync(py)){const file=join(py,name,process.platform==='win32'?'python.exe':'bin/python3');if(existsSync(file)){python=file;break;}}}
if(!python||!existsSync(python)||!existsSync(uv))throw Error('Prepare the bundled Python runtime before seeding the reader');
const run=argv=>{const r=spawnSync(uv,argv,{windowsHide:true,encoding:'utf8',maxBuffer:4*1024*1024,env:{...process.env,UV_PYTHON_DOWNLOADS:'never'},timeout:240000});if(r.status!==0)throw Error(r.stderr||'Reader dependency preparation failed');};
// Stage a complete tree: a removed dependency must not survive a lock update.
mkdirSync(reader,{recursive:true});const stage=mkdtempSync(join(reader,'.lib-stage-')),lib=join(reader,'lib'),backup=stage+'-previous';
const remove=p=>{const absolute=resolve(p);if(dirname(absolute)!==resolve(reader)||!basename(absolute).startsWith('.lib-stage-'))throw Error('Reader cleanup escaped its staging directory');rmSync(absolute,{recursive:true,force:true});};
try{
 mkdirSync(join(stage,'lib'));for(const name of ['reader.py','requirements.lock'])copyFileSync(join(reader,name),join(stage,name));
 run(['pip','install','--python',python,'--target',join(stage,'lib'),'--require-hashes','--only-binary',':all:','--no-deps',...(value('--wheels')?['--no-index','--find-links',value('--wheels')]:[]),'-r',join(reader,'requirements.lock')]);
 const check=spawnSync(python,['-I','-B',join(stage,'reader.py'),'--check'],{windowsHide:true,encoding:'utf8',timeout:30000});
 if(check.status!==0)throw Error(check.stderr||'Reader cannot start from its isolated payload');
 const payload=join(stage,'lib'),dependencies=[],notices=['RUYIN local document reader - third-party notices','Full upstream notices are retained below and in each .dist-info directory.'];
 const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]);
 for(const name of readdirSync(payload).filter(n=>n.endsWith('.dist-info')).sort()){
  const dir=join(payload,name),meta=readFileSync(join(dir,'METADATA'),'utf8'),field=key=>meta.match(new RegExp('^'+key+': (.+)$','m'))?.[1];
  const files=walk(dir).filter(p=>/(?:licenses?[\\/]|(?:LICENSE|COPYING|NOTICE)[^\\/]*$)/i.test(relative(dir,p)));
  if(!files.length)throw Error('Missing bundled license: '+name);
  const dep={name:field('Name'),version:field('Version'),license:field('License-Expression')||field('License')||(field('Name')==='pdfplumber'?'MIT':'see upstream notices'),notices:files.map(p=>relative(payload,p).replaceAll('\\','/'))};dependencies.push(dep);
  notices.push('\n===== '+dep.name+' '+dep.version+' ('+dep.license+') =====');
  for(const p of files)notices.push('\n--- '+relative(payload,p)+' ---\n'+readFileSync(p,'utf8'));
 }
 const lockSha256=createHash('sha256').update(readFileSync(join(reader,'requirements.lock'))).digest('hex');
 writeFileSync(join(payload,'THIRD-PARTY-NOTICES.txt'),notices.join('\n'));
 writeFileSync(join(payload,'ruyin-reader-build.json'),JSON.stringify({lockSha256,engine:JSON.parse(check.stdout),dependencies},null,2));
 if(existsSync(lib))renameSync(lib,backup);
 try{renameSync(payload,lib);}catch(e){if(existsSync(backup))renameSync(backup,lib);throw e;}
 if(existsSync(backup))remove(backup);
}finally{remove(stage);}
console.log('Local document reader prepared and isolated import check passed');
