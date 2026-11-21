/** Manual encrypted runtime backup. Stop the runtime first; DPAPI remains user/machine scoped. */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { KeyManager } from "./keys.js";
import { resolveNativeBinding } from "./storage.js";
import { acquireRuntimeOwnership } from "./runtime-ownership.js";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3-multiple-ciphers");
const MANIFEST = ".ruyin-backup.json";
interface BackupTree {directories:string[];files:Array<{path:string;bytes:number;sha256:string}>}
export interface BackupResult {target:string;files:number;bytes?:number;databases:number;integrity?:string}
const contains = (a:string,b:string) => { const rel=relative(a,b);return rel===""||(!rel.startsWith("..")&&!isAbsolute(rel)); };
const canonical = async (dir:string) => {
  if((await lstat(dir)).isSymbolicLink())throw Error("Backup paths cannot be symbolic links");
  return realpath(dir);
};

async function snapshot(root:string,ignoreManifest=false):Promise<BackupTree> {
  const directories:string[]=[],files:BackupTree["files"]=[];
  const walk=async (rel:string)=>{
    for(const entry of (await readdir(join(root,rel),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
      if(!rel&&ignoreManifest&&entry.name===MANIFEST)continue;
      if(!rel&&entry.name==="chromium")continue;
      const path=rel?rel+"/"+entry.name:entry.name,full=join(root,path),before=await lstat(full);
      if(before.isSymbolicLink())throw Error(`Backup refuses symbolic links: ${path}`);
      if(before.isDirectory()){directories.push(path);await walk(path);continue;}
      if(!before.isFile())throw Error(`Backup refuses non-file entries: ${path}`);
      const hash=createHash("sha256");for await(const bytes of createReadStream(full))hash.update(bytes);
      const after=await lstat(full);
      if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw Error(`Source changed while reading: ${path}`);
      files.push({path,bytes:after.size,sha256:hash.digest("hex")});
    }
  };
  await walk("");return {directories,files};
}

function containers(tree:BackupTree) {
  return tree.files.filter(file=>/^(projects|libraries|workspaces)\/[^/]+\/(project|workspace)\.db$/.test(file.path)&&file.bytes>0);
}

function checkKeys(tree:BackupTree) {
  const paths=new Set(tree.files.map(file=>file.path));
  if(!paths.has("runtime/master.key.dpapi")&&!paths.has("runtime/master.key"))throw Error("Original runtime master key is missing");
  for(const db of containers(tree))if(!paths.has(db.path.replace(/[^/]+$/,"key.enc")))throw Error(`Original container key is missing: ${db.path}`);
}

/** Decryption happens only in disposable copies. The source/backup never opens in SQLite. */
async function checkDatabases(root:string,tree:BackupTree) {
  checkKeys(tree);
  const keys=await KeyManager.open(root), scratch=await mkdtemp(join(tmpdir(),"ruyin-backup-check-"));
  const results:Array<{path:string;integrity:string}>=[];
  try {
    for(const file of containers(tree)) {
      const dir=dirname(file.path),dbName=basename(file.path),copyDir=join(scratch,String(results.length));
      await mkdir(copyDir);
      for(const name of [dbName,dbName+"-wal",dbName+"-shm"]) {
        if(existsSync(join(root,dir,name)))await copyFile(join(root,dir,name),join(copyDir,name));
      }
      const key=keys.open(readFileSync(join(root,dir,"key.enc"))).toString("hex");
      const nativeBinding=resolveNativeBinding();
      const db=new Database(join(copyDir,dbName),{readonly:true,fileMustExist:true,...(nativeBinding?{nativeBinding}:{})});
      try {
        db.pragma("cipher='sqlcipher'");db.pragma(`key="x'${key}'"`);
        if(db.pragma("quick_check",{simple:true})!=="ok")throw Error(`Database integrity check failed: ${file.path}`);
        results.push({path:file.path,integrity:"ok"});
      } catch { throw Error(`Database or original key cannot be verified: ${file.path}`); }
      finally { db.close(); }
    }
  } finally {
    if(dirname(scratch)!==resolve(tmpdir()))throw Error("Unexpected verification directory");
    await rm(scratch,{recursive:true,force:true});
  }
  return results;
}

export async function createBackup(from:string,to:string,onCopied?:(path:string)=>void|Promise<void>):Promise<BackupResult> {
  const source=await canonical(resolve(from)), parent=await realpath(dirname(resolve(to))),target=join(parent,basename(resolve(to)));
  if(contains(source,target)||contains(target,source))throw Error("Backup source and target must be disjoint");
  if(existsSync(target))throw Error("Backup target already exists; choose a new directory");
  if(existsSync(join(source,MANIFEST)))throw Error("Source is already a backup; verify it instead");
  const release=await acquireRuntimeOwnership([source,target]);
  const stage=target+".partial-"+randomUUID();
  try {
    const before=await snapshot(source);checkKeys(before);
    await mkdir(stage);
    for(const path of before.directories)await mkdir(join(stage,path),{recursive:true});
    for(const file of before.files){await copyFile(join(source,file.path),join(stage,file.path));await onCopied?.(file.path);}
    if(JSON.stringify(await snapshot(source))!==JSON.stringify(before))throw Error(`Source changed during backup; incomplete copy retained at ${stage}`);
    if(JSON.stringify(await snapshot(stage))!==JSON.stringify(before))throw Error(`Backup hash mismatch; incomplete copy retained at ${stage}`);
    const databases=await checkDatabases(stage,before);
    const manifest={format:1,createdAt:new Date().toISOString(),source,protection:"original encrypted files; DPAPI requires the original Windows user and machine",...before,databases};
    await writeFile(join(stage,MANIFEST),JSON.stringify(manifest,null,2),{flag:"wx"});
    if(existsSync(target))throw Error("Backup target appeared during copy; refusing to replace it");
    await rename(stage,target);
    return {target,files:before.files.length,bytes:before.files.reduce((n,file)=>n+file.bytes,0),databases:databases.length};
  } finally { await release(); }
}

export async function verifyBackup(path:string):Promise<BackupResult> {
  const root=await canonical(resolve(path)),release=await acquireRuntimeOwnership([root]);
  try {
    const manifest=JSON.parse(readFileSync(join(root,MANIFEST),"utf8"));
    if(manifest.format!==1||!Array.isArray(manifest.files)||!Array.isArray(manifest.directories))throw Error("Invalid backup manifest");
    const tree=await snapshot(root,true);
    if(JSON.stringify(tree)!==JSON.stringify({directories:manifest.directories,files:manifest.files}))throw Error("Backup manifest does not match its files");
    const databases=await checkDatabases(root,tree);
    return {target:root,files:tree.files.length,bytes:tree.files.reduce((n,file)=>n+file.bytes,0),databases:databases.length,integrity:"ok"};
  } finally { await release(); }
}

/** Restore into a fresh root; the immutable backup and current data are untouched. */
export async function restoreBackup(from:string,to:string):Promise<BackupResult> {
 const root=await canonical(resolve(from)),parent=await realpath(dirname(resolve(to))),target=join(parent,basename(resolve(to)));
 if(contains(root,target)||contains(target,root))throw Error("Backup source and target must be disjoint");
 if(existsSync(target))throw Error("Restore target already exists; choose a new directory");
 const release=await acquireRuntimeOwnership([root,target]),stage=target+".partial-"+randomUUID();
 try{
  const manifest=JSON.parse(readFileSync(join(root,MANIFEST),"utf8"));
  if(manifest.format!==1||!Array.isArray(manifest.files)||!Array.isArray(manifest.directories))throw Error("Invalid backup manifest");
  const tree=await snapshot(root,true);
  if(JSON.stringify(tree)!==JSON.stringify({directories:manifest.directories,files:manifest.files}))throw Error("Backup manifest does not match its files");
  await checkDatabases(root,tree);await mkdir(stage);
  for(const dir of tree.directories)await mkdir(join(stage,dir),{recursive:true});
  for(const file of tree.files)await copyFile(join(root,file.path),join(stage,file.path));
  if(JSON.stringify(await snapshot(stage))!==JSON.stringify(tree)||JSON.stringify(await snapshot(root,true))!==JSON.stringify(tree))throw Error("Restore hash mismatch; original data remains unchanged");
  const databases=await checkDatabases(stage,tree);
  if(existsSync(target))throw Error("Restore target appeared during copy");
  await rename(stage,target);
  return {target,files:tree.files.length,bytes:tree.files.reduce((n,file)=>n+file.bytes,0),databases:databases.length,integrity:"ok"};
 }finally{await release();}
}
