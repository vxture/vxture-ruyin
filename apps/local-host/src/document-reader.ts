/** Fixed offline child process; never accepts executable or filesystem paths from a product. */
import {spawn} from "node:child_process";
import {existsSync} from "node:fs";
import {createHash} from "node:crypto";
export interface ReadUnit {index:number;markdown:string;text:string;location:Record<string,unknown>;tables:unknown[];images:unknown[];flags:string[];lines?:unknown[]}
export interface ReaderStart {engine:Record<string,string>;total:number;flags?:string[]}
export type SourceReader=(bytes:Buffer,format:string,onStart:(info:ReaderStart)=>void,onUnit:(unit:ReadUnit)=>void,signal?:AbortSignal)=>Promise<void>;
export function localSourceReader(python:string|undefined,script:string):SourceReader{
 return async(bytes,format,onStart,onUnit,signal)=>{
  signal?.throwIfAborted();
  if(!python||!existsSync(python)||!existsSync(script))throw Error("Local document reader is unavailable in this runtime; install a build with the reading dependencies.");
  if(!["pdf","docx","md"].includes(format))throw Error("Unsupported source format");
  await new Promise<void>((resolve,reject)=>{
   const env:NodeJS.ProcessEnv={PYTHONIOENCODING:"utf-8"};for(const k of ["SystemRoot","WINDIR","TEMP","TMP","PATH"])if(process.env[k])env[k]=process.env[k];
   const child=spawn(python,["-I","-B",script,format],{windowsHide:true,env,stdio:["pipe","pipe","pipe"]});
   let pending="",received=0,error:Error|undefined,done=false,started=false,units=0,total=0;
   const fail=(e:unknown)=>{error=e instanceof Error?e:Error("Reading failed");child.kill();};
   const abort=()=>fail(Error("Runtime stopped during reading"));signal?.addEventListener("abort",abort,{once:true});
   const timer=setTimeout(()=>fail(Error("Local document reading timed out; saved blocks are preserved.")),120000);timer.unref();
   child.on("error",fail);child.stdin.on("error",()=>{});
   child.stdout.setEncoding("utf8");child.stdout.on("data",(chunk:string)=>{
    received+=Buffer.byteLength(chunk);if(received>12*1024*1024||pending.length>1024*1024){fail(Error("Reading output exceeds limits"));return;}
    pending+=chunk;
    let end;while((end=pending.indexOf("\n"))>=0&&!error){const line=pending.slice(0,end);pending=pending.slice(end+1);if(!line)continue;
     try{const v=JSON.parse(line);if(v.kind==="error")throw Error(v.error);
      if(v.kind==="start"&&!started){if(!Number.isSafeInteger(v.total)||v.total<0||v.total>5000||!v.engine||typeof v.engine!=="object")throw Error("Invalid reader metadata");started=true;total=v.total;onStart(v);}
      else if(v.kind==="unit"&&started&&!done){const u=v.unit as ReadUnit;if(u.index!==units||units>=total||typeof u.markdown!=="string"||typeof u.text!=="string"||!u.location||!Array.isArray(u.flags)||!Array.isArray(u.tables)||!Array.isArray(u.images)||Buffer.byteLength(line)>1024*1024)throw Error("Invalid reading block");onUnit(u);units++;}
      else if(v.kind==="done"&&started&&units===total&&!done){if(v.sha256!==createHash("sha256").update(bytes).digest("hex"))throw Error("Reader input hash mismatch");done=true;}
      else throw Error("Incomplete or unordered reader output");
     }catch(e){fail(e);}
    }
   });
   // Library errors can contain local paths; expose only the fixed protocol's errors.
   child.stderr.resume();child.on("close",code=>{clearTimeout(timer);signal?.removeEventListener("abort",abort);if(error)reject(error);else if(code!==0||!done||pending.trim())reject(Error("Local reader failed; verify bundled dependencies and input format."));else resolve();});
   child.stdin.end(bytes);
  });
 };
}
