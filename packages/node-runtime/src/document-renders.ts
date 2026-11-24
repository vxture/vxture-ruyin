/**
 * Original Node runtime adapter shared by native and product server hosts.
 * @package @vxture/ruyin-node-runtime
 * @layer Infrastructure
 * @category Runtime
 * @author AI-Generated
 * @date 2026-11-25
 */
/** Durable deterministic document work; product data is pinned before dispatch. */
import {createHash} from "node:crypto";
import type {ProjectRuntime} from "@vxture/ruyin-core";
import {parseDocument,renderDocx} from "@vxture/ruyin-document";
import type {JobDocuments} from "./background-jobs.js";
import {wordLayout,type LayoutOutput,type LayoutFields} from "./word-layout.js";
type Source={id:string;revision:number};
export interface RenderInput {id:string;title:string;source:Source;template?:{fileId:string;hash:string};fields?:LayoutFields}
export interface RenderJob extends RenderInput {state:"queued"|"running"|"completed"|"failed";createdAt:string;updatedAt:string;error?:string;pages?:number;engine?:string;formats:string[];requestHash:string}
export interface RenderFiles {get(pid:string,id:string):{name:string;hash:string}|undefined;read(pid:string,id:string):Promise<Buffer>}
const digest=(data:string|Uint8Array)=>createHash("sha256").update(data).digest("hex");
export class DocumentRenders {
 private queue:{pid:string;product:string;id:string}[]=[];private busy=false;private closed=false;
 get activeCount(){return this.queue.length+(this.busy?1:0);}
 constructor(private runtime:ProjectRuntime,private docs:JobDocuments,private files:RenderFiles,private layout:(bytes:Uint8Array,template?:Buffer,fields?:LayoutFields)=>Promise<LayoutOutput>=wordLayout){}
 get(pid:string,product:string,id:string):RenderJob|undefined{const d=this.docs.get(pid,product,"runtime_render_"+id);return d?JSON.parse(d.markdown):undefined;}
 list(pid:string,product:string):RenderJob[]{return this.docs.list(pid,product,"runtime_render_").map(d=>JSON.parse(d.markdown) as RenderJob).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
 private put(pid:string,product:string,id:string,value:unknown){const old=this.docs.get(pid,product,id);if(!this.docs.put(pid,product,id,JSON.stringify(value),old?.revision??0))throw Error("Render storage conflict");}
 private save(pid:string,product:string,job:RenderJob){job.updatedAt=new Date().toISOString();this.put(pid,product,"runtime_render_"+job.id,job);}
 async create(pid:string,product:string,raw:unknown):Promise<RenderJob>{
  const v=raw as RenderInput;
  if(!v||typeof v!=="object"||!/^[-a-f0-9]{36}$/.test(v.id)||typeof v.title!=="string"||!v.title.trim()||v.title.length>120||!v.source||!/^[A-Za-z0-9_-]{1,80}$/.test(v.source.id)||v.source.id.startsWith("runtime_")||!Number.isSafeInteger(v.source.revision)||v.source.revision<1||v.template&&(!/^[A-Za-z0-9_-]{1,100}$/.test(v.template.fileId)||!/^[a-f0-9]{64}$/.test(v.template.hash)))throw Error("Invalid document render request");
  if(v.fields!==undefined&&(!v.fields||typeof v.fields!=="object"||Array.isArray(v.fields)||Object.keys(v.fields).some(k=>!["projectName","documentName","documentNumber"].includes(k))||Object.entries({projectName:120,documentName:80,documentNumber:80}).some(([k,max])=>{const text=v.fields![k as keyof LayoutFields];return typeof text!=="string"||text.length>max||/[\x00-\x1f\x7f]/.test(text)||k!=="documentNumber"&&!text.trim();})))throw Error("Invalid document header fields");
  const view=await this.runtime.openProject(pid);if(view.meta.productId!==product||view.meta.archivedAt)throw Error("Project unavailable");
  const input:RenderInput={id:v.id,title:v.title,source:v.source,...(v.template?{template:v.template}:{}),...(v.fields?{fields:{projectName:v.fields.projectName.trim(),documentName:v.fields.documentName.trim(),documentNumber:v.fields.documentNumber.trim()}}:{})};const requestHash=digest(JSON.stringify(input)),old=this.get(pid,product,v.id);
  if(old){if(old.requestHash!==requestHash)throw Error("Render ID belongs to another request");return old;}
  if(this.list(pid,product).some(j=>j.state==="queued"||j.state==="running"))throw Error("A document render is already active in this project");
  const source=this.docs.get(pid,product,v.source.id);if(source?.revision!==v.source.revision||Buffer.byteLength(source.markdown)>1024*1024)throw Error("Markdown source revision changed or exceeds limits");
  let template:Buffer|undefined;
  if(v.template){const file=this.files.get(pid,v.template.fileId);if(!file||file.hash!==v.template.hash||!file.name.toLowerCase().endsWith(".docx"))throw Error("Template file revision is unavailable");template=await this.files.read(pid,v.template.fileId);if(template.length>20*1024*1024||digest(template)!==v.template.hash)throw Error("Template bytes do not match the selected revision");}
  // Re-check after async file reads: competing requests must not queue twice.
  const raced=this.get(pid,product,v.id);if(raced){if(raced.requestHash!==requestHash)throw Error("Render ID belongs to another request");return raced;}
  if(this.list(pid,product).some(j=>j.state==="queued"||j.state==="running"))throw Error("A document render is already active in this project");
  const at=new Date().toISOString(),job:RenderJob={...input,state:"queued",createdAt:at,updatedAt:at,formats:["md"],requestHash};
  this.put(pid,product,"runtime_input_"+v.id,{markdown:source.markdown,...(template?{template:template.toString("base64")}:{})});
  this.save(pid,product,job);this.queue.push({pid,product,id:v.id});void this.pump();return this.get(pid,product,v.id)!;
 }
 file(pid:string,product:string,id:string,format:string){const job=this.get(pid,product,id);if(!job)throw Error("Render not found");if(format==="md"){const input=this.docs.get(pid,product,"runtime_input_"+id);if(!input)throw Error("Render source unavailable");return this.payload(Buffer.from(JSON.parse(input.markdown).markdown),"text/markdown;charset=utf-8");}if(!["docx","pdf"].includes(format)||!job.formats.includes(format))throw Error("Rendered format unavailable");const out=this.docs.get(pid,product,"runtime_output_"+id);if(!out)throw Error("Render output unavailable");const value=JSON.parse(out.markdown);return this.payload(Buffer.from(value[format],"base64"),format==="pdf"?"application/pdf":"application/vnd.openxmlformats-officedocument.wordprocessingml.document");}
 private payload(bytes:Buffer,mediaType:string){return{base64:bytes.toString("base64"),sha256:digest(bytes),size:bytes.length,mediaType};}
 private async pump(){if(this.busy||this.closed)return;this.busy=true;try{while(this.queue.length&&!this.closed){const item=this.queue.shift()!;await this.run(item.pid,item.product,item.id);}}finally{this.busy=false;}}
 private async run(pid:string,product:string,id:string){const job=this.get(pid,product,id);if(!job)return;try{
  job.state="running";this.save(pid,product,job);const input=JSON.parse(this.docs.get(pid,product,"runtime_input_"+id)!.markdown);
  const generated=await renderDocx(parseDocument(input.markdown),{title:job.title});
  const output=await this.layout(generated,input.template?Buffer.from(input.template,"base64"):undefined,job.fields);
  this.put(pid,product,"runtime_output_"+id,{docx:output.docx.toString("base64"),pdf:output.pdf.toString("base64")});
  job.state="completed";job.pages=output.pages;job.engine=output.engine;job.formats=["md","docx","pdf"];
 }catch(e){job.state="failed";job.error=e instanceof Error?e.message:"Document layout failed";}this.save(pid,product,job);}
 async recoverAll(){for(const p of await this.runtime.listProjects())for(const job of this.list(p.id,p.productId))if(job.state==="queued"||job.state==="running"){job.state="failed";job.error="Runtime restarted during layout; submit a new version to retry. Saved Markdown is preserved.";this.save(p.id,p.productId,job);}}
 close(){this.closed=true;}
}
