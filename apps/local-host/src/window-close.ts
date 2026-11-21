import {mkdirSync,readFileSync,renameSync,writeFileSync} from "node:fs";
import {dirname,join} from "node:path";

export type WindowCloseAction = "background" | "exit";
export function readWindowClose(dataDir:string):WindowCloseAction {
  try{return JSON.parse(readFileSync(join(dataDir,"desktop.json"),"utf8")).closeAction==="exit"?"exit":"background";}
  catch{return "background";}
}
export function writeWindowClose(dataDir:string,action:WindowCloseAction):void {
  if(action!=="background"&&action!=="exit")throw Error("Invalid window close action");
  const file=join(dataDir,"desktop.json"),staging=file+".tmp";
  mkdirSync(dirname(file),{recursive:true});
  writeFileSync(staging,JSON.stringify({closeAction:action},null,2)+"\n");renameSync(staging,file);
}
