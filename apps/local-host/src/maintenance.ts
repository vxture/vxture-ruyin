/** Offline operations run at startup before the runtime opens encrypted stores. */
import {randomUUID} from "node:crypto";
import {existsSync,lstatSync,readFileSync,realpathSync,renameSync,writeFileSync} from "node:fs";
import {basename,dirname,isAbsolute,join,resolve} from "node:path";
import {readLocation,treeSize,type LocationFile} from "./data-location.js";
import {isInside} from "./path-guard.js";
import {cloudSyncRefusal} from "./cloud-sync.js";
import {currentHost,systemDirRefusal,type HostEnvironment} from "./system-dirs.js";
import {createBackup,restoreBackup,verifyBackup} from "./runtime-backup.js";

export interface MaintenanceRecord {
 id:string;action:"backup"|"restore";state:"queued"|"running"|"completed"|"failed";
 source:string;target:string;createdAt:string;updatedAt:string;bytes?:number;
 result?:{target:string;files:number;bytes?:number;databases:number;integrity?:string};failure?:"interrupted"|"verification";
}
type Location=LocationFile&{maintenance?:MaintenanceRecord};
function location(file:string):Location{return readLocation(file) as Location;}
function save(file:string,value:Location):void{const staging=file+".maintenance.tmp";writeFileSync(staging,JSON.stringify(value,null,2)+"\n");renameSync(staging,file);}
export class MaintenanceError extends Error{constructor(readonly code:string,message:string){super(message);}}
function targetPath(target:unknown,source:string,host:HostEnvironment):string {
 if(typeof target!=="string"||!target.trim()||!isAbsolute(target)||target.length>2048)throw new MaintenanceError("MAINTENANCE_TARGET","Choose a new absolute destination path");
 const full=resolve(target),parent=realpathSync(dirname(full)),canonical=join(parent,basename(full));
 if(existsSync(full)||isInside(source,canonical)||isInside(canonical,source))throw new MaintenanceError("MAINTENANCE_TARGET","Choose a new destination outside the current data directory");
 if(systemDirRefusal(canonical,host)||cloudSyncRefusal(canonical,host))throw new MaintenanceError("MAINTENANCE_TARGET","Choose a local folder outside system, temporary and cloud-synced directories");
 return canonical;
}
export class MaintenanceService {
 private preparing=false;
 constructor(private file:string,private dataDir:string,private host=currentHost()){}
 view():{operation:MaintenanceRecord|null}{return {operation:location(this.file).maintenance??null};}
 async queue(input:unknown):Promise<{operation:MaintenanceRecord}> {
  if(this.preparing)throw new MaintenanceError("MAINTENANCE_PENDING","A maintenance request is already being prepared");
  this.preparing=true;
  try{
   const state=location(this.file);
   if(state.pending||state.maintenance?.state==="queued"||state.maintenance?.state==="running")throw new MaintenanceError("MAINTENANCE_PENDING","Finish or cancel the existing maintenance request first");
   const value=input as {action?:unknown;source?:unknown;target?:unknown};
   if(!value||(value.action!=="backup"&&value.action!=="restore"))throw new MaintenanceError("REQUEST_MALFORMED","Choose backup or restore");
   const current=realpathSync(this.dataDir),target=targetPath(value.target,current,this.host);
   let source=current,bytes:number;
   if(value.action==="restore"){
    if(typeof value.source!=="string"||!isAbsolute(value.source)||value.source.length>2048||lstatSync(value.source).isSymbolicLink())throw new MaintenanceError("BACKUP_INVALID","Choose a verified backup directory");
    source=realpathSync(value.source);
    if(isInside(source,target)||isInside(target,source))throw new MaintenanceError("MAINTENANCE_TARGET","Restore source and target must be separate");
    try{bytes=(await verifyBackup(source)).bytes??0;}catch{throw new MaintenanceError("BACKUP_INVALID","Backup hashes, original keys or database integrity could not be verified");}
   }else bytes=treeSize(current);
   // Re-read so asynchronous verification cannot overwrite a language/location change.
   const latest=location(this.file);
   if(latest.pending||latest.maintenance?.state==="queued"||latest.maintenance?.state==="running")throw new MaintenanceError("MAINTENANCE_PENDING","Another maintenance request is pending");
   const at=new Date().toISOString(),operation:MaintenanceRecord={id:randomUUID(),action:value.action,state:"queued",source,target,bytes,createdAt:at,updatedAt:at};
   save(this.file,{...latest,maintenance:operation});return {operation};
  }finally{this.preparing=false;}
 }
 cancel():{operation:MaintenanceRecord|null}{
  const state=location(this.file);
  if(this.preparing||state.maintenance?.state==="running")throw new MaintenanceError("MAINTENANCE_PENDING","An operation already in progress cannot be cancelled here");
  if(state.maintenance?.state==="queued"){delete state.maintenance;save(this.file,state);}
  return this.view();
 }
}

/** Caller owns the location-file lock, but must not yet own/open data stores. */
export async function applyPendingMaintenance(file:string,host=currentHost()):Promise<void>{
 const state=location(file),operation=state.maintenance;if(!operation)return;
 if(operation.state==="running"){
  save(file,{...state,maintenance:{...operation,state:"failed",updatedAt:new Date().toISOString(),failure:"interrupted"}});return;
 }
 if(operation.state!=="queued")return;
 const running:MaintenanceRecord={...operation,state:"running",updatedAt:new Date().toISOString()};
 save(file,{...state,maintenance:running});
 try{
  const source=realpathSync(operation.source),target=targetPath(operation.target,source,host);
  const result=operation.action==="backup"?await createBackup(source,target):await restoreBackup(source,target);
  const current=location(file);
  save(file,{...current,...(operation.action==="restore"?{dataDir:result.target}:{}),maintenance:{...running,state:"completed",updatedAt:new Date().toISOString(),result}});
 }catch{
  save(file,{...location(file),maintenance:{...running,state:"failed",updatedAt:new Date().toISOString(),failure:"verification"}});
 }
}
