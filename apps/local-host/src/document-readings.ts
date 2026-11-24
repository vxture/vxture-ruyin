/** Durable local reading snapshots. Uses the existing project document store. */
import {createHash} from "node:crypto";
import type {ProjectRuntime} from "@vxture/ruyin-core";
import type {JobDocuments} from "./background-jobs.js";
import type {SourceReader,ReadUnit} from "./document-reader.js";
export interface ReadingFiles {get(pid:string,id:string):{name:string;hash:string;bytes:number}|undefined;read(pid:string,id:string):Promise<Buffer>}
export interface ReadingInput {id:string;fileId:string;hash:string}
export interface ReadingJob extends ReadingInput {name:string;format:string;state:"queued"|"running"|"completed"|"failed";createdAt:string;updatedAt:string;units:number;total?:number;engine?:Record<string,string>;flags:string[];error?:string}
export interface ReadingScopes{checkScope(id:string,product:string):Promise<void>;listScopes():Promise<{id:string;productId:string}[]>}
const hash=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
export class DocumentReadings{
 private queue:{pid:string;product:string;id:string}[]=[];private busy=false;private closed=false;private active?:AbortController;
 get activeCount(){return this.queue.length+(this.busy?1:0);}
 constructor(private runtime:ProjectRuntime|ReadingScopes,private docs:JobDocuments,private files:ReadingFiles,private reader:SourceReader,private options:{multiple?:boolean}={}){}
 private put(pid:string,product:string,id:string,v:unknown){const old=this.docs.get(pid,product,id);if(!this.docs.put(pid,product,id,JSON.stringify(v),old?.revision??0))throw Error("Reading storage conflict");}
 private save(pid:string,product:string,j:ReadingJob){j.updatedAt=new Date().toISOString();this.put(pid,product,"runtime_reading_"+j.id,j);}
 get(pid:string,product:string,id:string):ReadingJob|undefined{const d=this.docs.get(pid,product,"runtime_reading_"+id);return d?JSON.parse(d.markdown):undefined;}
 list(pid:string,product:string):ReadingJob[]{return this.docs.list(pid,product,"runtime_reading_").map(d=>JSON.parse(d.markdown) as ReadingJob).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
 unit(pid:string,product:string,id:string,index:number):ReadUnit|undefined{const j=this.get(pid,product,id);if(!j||index<0||index>=j.units)return;const d=this.docs.get(pid,product,"runtime_readunit_"+id+"_"+index);return d?JSON.parse(d.markdown):undefined;}
 available(pid:string,j:ReadingJob){return this.files.get(pid,j.fileId)?.hash===j.hash;}
 async create(pid:string,product:string,raw:unknown){
  if(this.closed)throw Error("Runtime is stopping");
  const v=raw as ReadingInput;if(!v||typeof v!=="object"||Object.keys(v).sort().join(",")!=="fileId,hash,id"||typeof v.id!=="string"||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v.id)||typeof v.fileId!=="string"||!/^[A-Za-z0-9_-]{1,100}$/.test(v.fileId)||typeof v.hash!=="string"||!/^[a-f0-9]{64}$/.test(v.hash))throw Error("Invalid reading request");
  if("checkScope" in this.runtime)await this.runtime.checkScope(pid,product);else{const view=await this.runtime.openProject(pid);if(view.meta.productId!==product||view.meta.archivedAt)throw Error("Project unavailable");}
  const old=this.get(pid,product,v.id);if(old){if(old.fileId!==v.fileId||old.hash!==v.hash)throw Error("Reading ID belongs to another source");return old;}
  const file=this.files.get(pid,v.fileId);if(!file||file.hash!==v.hash)throw Error("Imported file revision unavailable");
  const format=file.name.toLowerCase().split(".").at(-1)!;if(!["pdf","docx","md"].includes(format))throw Error("Select a PDF, DOCX or UTF-8 Markdown file");if(file.bytes>20*1024*1024)throw Error("Source file exceeds 20 MiB");
  if(!this.options.multiple&&this.list(pid,product).some(j=>j.state==="queued"||j.state==="running"))throw Error("A reading is already active in this project");
  const at=new Date().toISOString(),job:ReadingJob={id:v.id,fileId:v.fileId,hash:v.hash,name:file.name,format,state:"queued",createdAt:at,updatedAt:at,units:0,flags:[]};
  this.save(pid,product,job);this.queue.push({pid,product,id:v.id});void this.pump();return this.get(pid,product,v.id)!;
 }
 private async pump(){if(this.busy||this.closed)return;this.busy=true;try{while(this.queue.length&&!this.closed){const q=this.queue.shift()!;await this.run(q.pid,q.product,q.id);}}finally{this.busy=false;}}
 private async run(pid:string,product:string,id:string){const j=this.get(pid,product,id);if(!j)return;const active=this.active=new AbortController();try{
  j.state="running";this.save(pid,product,j);const bytes=await this.files.read(pid,j.fileId);if(bytes.length>20*1024*1024||hash(bytes)!==j.hash)throw Error("Imported bytes differ from the pinned SHA256");
  active.signal.throwIfAborted();
  await this.reader(bytes,j.format,info=>{active.signal.throwIfAborted();j.engine=info.engine;j.total=info.total;j.flags=info.flags??[];this.save(pid,product,j);},unit=>{
   active.signal.throwIfAborted();if(unit.index!==j.units)throw Error("Reader block order changed");this.put(pid,product,"runtime_readunit_"+id+"_"+unit.index,{...unit,source:{fileId:j.fileId,hash:j.hash}});j.units++;j.flags=[...new Set([...j.flags,...unit.flags])];this.save(pid,product,j);
  },active.signal);
  if(j.total===undefined||j.units!==j.total)throw Error("Reader ended before all blocks were stored");j.state="completed";
 }catch(e){j.state="failed";j.error=e instanceof Error?e.message:"Source reading failed";}finally{this.active=undefined;}if(!this.closed)this.save(pid,product,j);}
 async recoverAll(){for(const p of await ("listScopes" in this.runtime?this.runtime.listScopes():this.runtime.listProjects()))for(const j of this.list(p.id,p.productId))if(j.state==="queued"||j.state==="running"){j.state="failed";j.error="Runtime restarted during reading; saved blocks remain available. Start a new snapshot to retry.";this.save(p.id,p.productId,j);}}
 close(){this.closed=true;this.active?.abort();}
}
