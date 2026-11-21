/** Generic workspace/product resources. Business categories remain opaque product fields. */
import {randomBytes,randomUUID} from "node:crypto";
import type {ProjectRuntime} from "@vxture/ruyin-core";
import type {SqliteStoragePort} from "./storage.js";
import {DocumentReadings} from "./document-readings.js";
import type {SourceReader} from "./document-reader.js";
import {mediaTypeOf} from "./file-store.js";

interface Scope{workspaceId:string;productId:string;scopeId:string}
export interface ResourceVersion{version:number;fileId:string;name:string;hash:string;bytes:number;mediaType:string;addedAt:string;readingId:string;previousReadings?:string[]}
export interface ResourceItem{id:string;name:string;category:string;versions:ResourceVersion[];updatedAt:string}
export interface ResourcePin{id:string;version:number;name:string;category:string;hash:string;fileId:string;readingId:string;selectedAt:string}
export class LibraryTokens{
 private tokens=new Map<string,Scope&{expiresAt:number}>();
 mint(scope:Scope){const token=randomBytes(32).toString("hex"),expiresAt=Date.now()+10*60*1000;this.tokens.set(token,{...scope,expiresAt});for(const [key,value]of this.tokens)if(value.expiresAt<Date.now())this.tokens.delete(key);return {token,expiresAt};}
 verify(token:string|undefined){const scope=token&&this.tokens.get(token);if(!scope||scope.expiresAt<=Date.now())return;return scope;}
 clear(){this.tokens.clear();}
}
export class ProductLibrary{
 readonly readings:DocumentReadings;private scopes=new Map<string,Scope>();private locks=new Set<string>();
 constructor(private storage:SqliteStoragePort,reader:SourceReader){
  const area=(id:string)=>this.area(id);
  this.readings=new DocumentReadings({checkScope:async(id,product)=>{if(area(id).scope.productId!==product)throw Error("Library unavailable");},listScopes:async()=>this.storage.listLibraryScopes().map(scope=>{this.scopes.set(scope.scopeId,scope);return {id:scope.scopeId,productId:scope.productId};})},{get:(id,product,key)=>area(id).store.getProductDocument(product,key),put:(id,product,key,text,revision)=>area(id).store.putProductDocument(product,key,text,revision),list:(id,product,prefix)=>area(id).store.listProductDocuments(product,prefix)},{get:(id,file)=>area(id).store.getFile(file),read:async(id,file)=>{const a=area(id),record=a.store.getFile(file);if(!record)throw Error("Source unavailable");return a.files.read(record.hash);}},reader,{multiple:true});
 }
 scope(workspaceId:string,productId:string){const a=this.storage.openLibraryStore(workspaceId,productId),scope={workspaceId,productId,scopeId:a.scopeId};this.scopes.set(scope.scopeId,scope);return scope;}
 private area(id:string){const scope=this.scopes.get(id)||this.storage.listLibraryScopes().find(s=>s.scopeId===id);if(!scope)throw Error("Library unavailable");this.scopes.set(id,scope);return {...this.storage.openLibraryStore(scope.workspaceId,scope.productId),scope};}
 private item(scope:Scope,id:string):ResourceItem|undefined{const doc=this.area(scope.scopeId).store.getProductDocument(scope.productId,"library_item_"+id);return doc?JSON.parse(doc.markdown):undefined;}
 private put(scope:Scope,item:ResourceItem){const store=this.area(scope.scopeId).store,id="library_item_"+item.id,old=store.getProductDocument(scope.productId,id);if(!store.putProductDocument(scope.productId,id,JSON.stringify(item),old?.revision||0))throw Error("Library changed; reload");}
 list(scope:Scope){return this.area(scope.scopeId).store.listProductDocuments(scope.productId,"library_item_").map(doc=>this.describe(scope,JSON.parse(doc.markdown))).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));}
 describe(scope:Scope,item:ResourceItem){return {...item,versions:item.versions.map(v=>({...v,reading:this.readings.get(scope.scopeId,scope.productId,v.readingId)}))};}
 get(scope:Scope,id:string){const item=this.item(scope,id);return item&&this.describe(scope,item);}
 async import(scope:Scope,input:unknown){
  const v=input as {name:string;category:string;base64:string;id?:string;expectedVersion?:number};if(!v||typeof v.name!=="string"||!v.name.trim()||v.name.length>200||/[\\/\x00-\x1f]/.test(v.name)||!/^.+\.(pdf|docx|md)$/i.test(v.name)||typeof v.category!=="string"||!/^[a-z][a-z0-9_-]{0,39}$/.test(v.category)||typeof v.base64!=="string"||v.base64.length>28*1024*1024||v.id&&!/^[a-f0-9-]{36}$/.test(v.id))throw Error("Invalid library import");
  const bytes=Buffer.from(v.base64,"base64");if(!bytes.length||bytes.length>20*1024*1024||bytes.toString("base64")!==v.base64)throw Error("Invalid or oversized file bytes");
  if(this.locks.has(scope.scopeId))throw Error("Library import is busy; retry");this.locks.add(scope.scopeId);
  try{const old=v.id?this.item(scope,v.id):undefined;if(v.id&&!old)throw Error("Resource not found");if(old&&v.expectedVersion!==old.versions.length)throw Error("Resource version changed; reload");const area=this.area(scope.scopeId),stored=await area.files.putBytes(bytes),latest=old?.versions.at(-1);if(latest?.hash===stored.hash&&old?.category===v.category)return this.describe(scope,old);
   const fileId="file_"+randomUUID().replaceAll("-",""),readingId=randomUUID(),at=new Date().toISOString(),version:ResourceVersion={...stored,fileId,readingId,name:v.name,mediaType:mediaTypeOf(v.name),addedAt:at,version:(old?.versions.length||0)+1};area.store.addFile({id:fileId,hash:stored.hash,bytes:stored.bytes,name:v.name,mediaType:version.mediaType,addedAt:at});const item:ResourceItem={id:old?.id||randomUUID(),name:v.name,category:v.category,versions:[...(old?.versions||[]),version],updatedAt:at};this.put(scope,item);await this.readings.create(scope.scopeId,scope.productId,{id:readingId,fileId,hash:stored.hash});return this.describe(scope,item);
  }finally{this.locks.delete(scope.scopeId);}
 }
 unit(scope:Scope,id:string,version:number,index:number){const source=this.item(scope,id)?.versions.find(v=>v.version===version);return source&&this.readings.unit(scope.scopeId,scope.productId,source.readingId,index);}
 async retry(scope:Scope,id:string,version:number){const item=this.item(scope,id),v=item?.versions.find(v=>v.version===version);if(!item||!v)throw Error("Resource version not found");const old=this.readings.get(scope.scopeId,scope.productId,v.readingId);if(old&&["queued","running"].includes(old.state))return this.describe(scope,item);const idNext=randomUUID();await this.readings.create(scope.scopeId,scope.productId,{id:idNext,fileId:v.fileId,hash:v.hash});v.previousReadings=[...(v.previousReadings||[]),v.readingId];v.readingId=idNext;this.put(scope,item);return this.describe(scope,item);}
 selections(pid:string,product:string){const doc=this.storage.openHostStore(pid)?.getProductDocument(product,"runtime_library_selection");return {revision:doc?.revision||0,items:doc?JSON.parse(doc.markdown) as ResourcePin[]:[]};}
 async pin(runtime:ProjectRuntime,scope:Scope,pid:string,input:unknown){
  const v=input as {id:string;version:number;revision:number};if(!v||typeof v.id!=="string"||!Number.isSafeInteger(v.version)||!Number.isSafeInteger(v.revision))throw Error("Invalid resource selection");const view=await runtime.openProject(pid);if(view.meta.workspaceId!==scope.workspaceId||view.meta.productId!==scope.productId||view.meta.archivedAt)throw Error("Project unavailable");const lock="pin:"+pid;if(this.locks.has(lock))throw Error("Selection is busy; retry");this.locks.add(lock);
  try{const selected=this.selections(pid,scope.productId);if(selected.items.some(r=>r.id===v.id&&r.version===v.version))return selected;if(v.revision!==selected.revision)throw Error("Selection changed; reload");const item=this.item(scope,v.id),version=item?.versions.find(x=>x.version===v.version);if(!item||!version)throw Error("Resource version unavailable");const reading=this.readings.get(scope.scopeId,scope.productId,version.readingId);if(reading?.state!=="completed")throw Error("Complete source reading before selecting it");const store=this.storage.openHostStore(pid)!,files=this.storage.openFileStore(pid)!,source=await this.area(scope.scopeId).files.read(version.hash),stored=await files.putBytes(source),fileId="file_"+randomUUID().replaceAll("-",""),readingId=randomUUID(),at=new Date().toISOString();
   // A project-owned immutable copy avoids a permanent cross-project read grant.
   store.addFile({id:fileId,name:version.name,hash:stored.hash,bytes:stored.bytes,mediaType:version.mediaType,addedAt:at});for(let i=0;i<reading.units;i++){const unit=this.readings.unit(scope.scopeId,scope.productId,reading.id,i);if(!unit)throw Error("Reading block unavailable");store.putProductDocument(scope.productId,"runtime_readunit_"+readingId+"_"+i,JSON.stringify({...unit,source:{fileId,hash:version.hash}}),0);}store.putProductDocument(scope.productId,"runtime_reading_"+readingId,JSON.stringify({...reading,id:readingId,fileId,createdAt:at,updatedAt:at,libraryOrigin:{id:item.id,version:version.version}}),0);const next:ResourcePin={id:item.id,version:version.version,name:version.name,category:item.category,hash:version.hash,fileId,readingId,selectedAt:at},items=[...selected.items.filter(x=>x.id!==item.id),next];if(!store.putProductDocument(scope.productId,"runtime_library_selection",JSON.stringify(items),selected.revision))throw Error("Selection changed; reload");return this.selections(pid,scope.productId);
  }finally{this.locks.delete(lock);}
 }
 unpin(scope:Scope,pid:string,id:string,revision:number){const selected=this.selections(pid,scope.productId);if(selected.revision!==revision)throw Error("Selection changed; reload");if(!selected.items.some(x=>x.id===id))return selected;const store=this.storage.openHostStore(pid)!;if(!store.putProductDocument(scope.productId,"runtime_library_selection",JSON.stringify(selected.items.filter(x=>x.id!==id)),revision))throw Error("Selection changed; reload");return this.selections(pid,scope.productId);}
 close(){this.readings.close();}
}
