/** Strict allowlist report. Never include account data, paths, names or logs. */
import {existsSync,readFileSync} from "node:fs";
import {join} from "node:path";
import {assetRefs} from "./ui-self-check.js";
export interface DiagnosticReport {
 schema:"ruyin-diagnostics/1";createdAt:string;version:string;platform:string;arch:string;
 checks:Array<{id:"runtime"|"encryption"|"agents"|"connectors"|"tools"|"components"|"ui";status:"ok"|"attention"|"unknown";total?:number;available?:number}>;
}
export async function collectDiagnostics(input:{version:string;platform:string;arch:string;startupState?:string;keyProtection:string;
 agents:number;invalidAgents:number;connectors?:()=>Promise<unknown[]>;tools?:()=>Promise<unknown[]>;components?:()=>unknown[];uiDir?:string;
}):Promise<DiagnosticReport>{
 const checks:DiagnosticReport["checks"]=[
  {id:"runtime",status:input.startupState==="failed"?"attention":input.startupState==="initializing"?"unknown":"ok"},
  {id:"encryption",status:input.keyProtection==="dpapi"?"ok":"attention"},
  {id:"agents",status:input.invalidAgents?"attention":"ok",total:input.agents+input.invalidAgents,available:input.agents},
 ];
 for(const id of ["connectors","tools","components"] as const){
  try{
   const provider=input[id];if(!provider){checks.push({id,status:"unknown"});continue;}
   const rows=await provider() as Array<{state?:string;status?:string;health?:{ok?:boolean;status?:string}}>;
   const failures=new Set(["error","failed","unreachable","gone","payload-missing","mismatch","no-space","too-large","license-missing","refused-origin","path-too-long"]);
   const bad=rows.filter(row=>failures.has(row.state??"")||row.status==="unavailable"||row.health?.status==="error"||row.state==="active"&&row.health?.ok===false).length;
   const available=rows.filter(row=>row.status==="available"||row.state==="acquired"||row.health?.ok===true).length;
   checks.push({id,status:bad?"attention":available?"ok":"unknown",total:rows.length,available});
  }catch{checks.push({id,status:"unknown"});}
 }
 try{
  if(!input.uiDir)checks.push({id:"ui",status:"unknown"});
  else{
   const refs=assetRefs(readFileSync(join(input.uiDir,"index.html"),"utf8"));
   const good=refs.filter(ref=>!ref.includes("..")&&existsSync(join(input.uiDir!,ref))).length;
   checks.push({id:"ui",status:refs.length>0&&good===refs.length?"ok":"attention",total:refs.length,available:good});
  }
 }catch{checks.push({id:"ui",status:"attention"});}
 return {schema:"ruyin-diagnostics/1",createdAt:new Date().toISOString(),version:input.version.slice(0,64),platform:input.platform.slice(0,20),arch:input.arch.slice(0,20),checks};
}
