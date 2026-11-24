import {existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';

/** Reuse an exact runtime without asking uv to replace materialized aliases. */
export function ensurePinnedPython({root,version,install,probe,platform=process.platform}){
 const find=()=>readdirSync(root,{withFileTypes:true}).filter(entry=>entry.isDirectory()&&entry.name.startsWith('cpython-'+version+'-')).map(entry=>join(root,entry.name,platform==='win32'?'python.exe':'bin/python3')).find(existsSync);
 let executable=find();
 if(!executable){install(version);executable=find();}
 if(!executable)throw Error('Pinned CPython '+version+' is missing after installation');
 const actual=probe(executable);
 if(actual!==version)throw Error('Pinned CPython mismatch: expected '+version+', got '+actual);
 return executable;
}
