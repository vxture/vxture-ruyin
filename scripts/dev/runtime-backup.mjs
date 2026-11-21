/** Developer CLI delegates to the shipped offline backup engine. */
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {createBackup,verifyBackup,restoreBackup} from "../../apps/local-host/dist/runtime-backup.js";
export {createBackup,verifyBackup,restoreBackup};
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 try{
  const [action,source,target,...extra]=process.argv.slice(2);
  if(extra.length||!source||!((action==="create"||action==="restore")&&target||action==="verify"&&!target))throw Error("Usage: runtime-backup.mjs create|restore <source> <new-target> | verify <backup-dir>");
  console.log(JSON.stringify(action==="create"?await createBackup(source,target):action==="restore"?await restoreBackup(source,target):await verifyBackup(source),null,2));
 }catch(error){console.error(`[runtime-backup] ${error.message}`);process.exitCode=1;}
}