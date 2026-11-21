// Exercise the exact offline payload after packaging, before running the shell.
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export function verifyDocumentReader(resources,python){
 const reader=join(resolve(resources),'document-reader'),lib=join(reader,'lib');
 if(!python){const root=join(resources,'uv','python');for(const name of readdirSync(root)){const candidate=join(root,name,process.platform==='win32'?'python.exe':'bin/python3');if(existsSync(candidate)){python=candidate;break;}}}
 if(!python)throw Error('Packaged reader has no bundled Python');
 const manifest=JSON.parse(readFileSync(join(lib,'ruyin-reader-build.json'),'utf8'));
 const digest=createHash('sha256').update(readFileSync(join(reader,'requirements.lock'))).digest('hex');
 if(manifest.lockSha256!==digest||!manifest.dependencies?.length)throw Error('Reader payload does not match its locked build');
 for(const dep of manifest.dependencies)for(const path of dep.notices)if(!existsSync(join(lib,path)))throw Error('Reader license missing: '+path);
 if(!existsSync(join(lib,'THIRD-PARTY-NOTICES.txt')))throw Error('Reader notices missing');
 const input=Buffer.from('# Offline reader\r\nAmount 8523700.00 >= 98%\r\n'),env={PYTHONIOENCODING:'utf-8'};
 for(const key of ['SystemRoot','WINDIR','TEMP','TMP','PATH'])if(process.env[key])env[key]=process.env[key];
 const r=spawnSync(python,['-I','-B',join(reader,'reader.py'),'md'],{input,env,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1024*1024});
 if(r.status!==0)throw Error('Packaged offline reader cannot start');
 const events=r.stdout.trim().split('\n').map(line=>JSON.parse(line));
 if(events[0]?.kind!=='start'||events.at(-1)?.sha256!==createHash('sha256').update(input).digest('hex')||events.filter(e=>e.kind==='unit').map(e=>e.unit.markdown).join('')!==input.toString())throw Error('Packaged reader failed exact text/hash check');
 // Exercise python-docx's real default archive with the unused unpacked
 // template scaffold excluded from AppX. Generate only synthetic in-memory data.
 if(!existsSync(join(lib,'docx/templates/default.docx')))throw Error('Packaged default DOCX template is missing');
 const sample='RUYIN offline DOCX 8523700.00 >= 98%';
 const made=spawnSync(python,['-I','-B','-c','import sys,io; sys.path.insert(0,sys.argv[1]); from docx import Document; d=Document(); d.add_paragraph(sys.argv[2]); b=io.BytesIO(); d.save(b); sys.stdout.buffer.write(b.getvalue())',lib,sample],{env,windowsHide:true,timeout:30000,maxBuffer:1024*1024});
 if(made.status!==0||!made.stdout?.length)throw Error('Packaged default DOCX template cannot create a document');
 const read=spawnSync(python,['-I','-B',join(reader,'reader.py'),'docx'],{input:made.stdout,env,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1024*1024});
 if(read.status!==0)throw Error('Packaged reader cannot read a DOCX document');
 const docxEvents=read.stdout.trim().split('\n').map(line=>JSON.parse(line));
 if(!docxEvents.filter(e=>e.kind==='unit').map(e=>e.unit.markdown).join('\n').includes(sample)||docxEvents.at(-1)?.sha256!==createHash('sha256').update(made.stdout).digest('hex'))throw Error('Packaged reader failed DOCX text/hash check');
 return {dependencies:manifest.dependencies.length,engine:events[0].engine};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 console.log(JSON.stringify(verifyDocumentReader(process.argv[2],process.argv[3])));
}
