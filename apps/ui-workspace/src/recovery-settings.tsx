import {useEffect,useRef,useState} from "react";
import {AlertDialog,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogHeader,AlertDialogTitle,Button,Input,NativeSelect,StatusBadge} from "@vxture/design-system";
import {ApiError,type Api,type MaintenanceRecord,type DiagnosticReport} from "./api";
import {useHostChrome} from "./host-chrome";
import {useT,type MessageKey} from "./i18n";

export function RecoverySettings({api}:{api:Api}){
 const t=useT(),inShell=useHostChrome()==="electron";
 const [operation,setOperation]=useState<MaintenanceRecord|null>(null),[failed,setFailed]=useState(false),[busy,setBusy]=useState(false);
 const [action,setAction]=useState<"backup"|"restore">("backup"),[source,setSource]=useState(""),[target,setTarget]=useState(""),[confirm,setConfirm]=useState(false),[error,setError]=useState<string>();
 const alive=useRef(true),lock=useRef(false);
 const load=async()=>{try{const value=await api.maintenance();if(alive.current){setOperation(value.operation);setFailed(false);}}catch{if(alive.current)setFailed(true);}};
 useEffect(()=>{alive.current=true;void load();return()=>{alive.current=false;};},[api]);
 const pick=async(kind:"source"|"target")=>{
  if(lock.current)return;lock.current=true;setBusy(true);setError(undefined);
  try{const value=await api.pickFolder();if(value.path){if(kind==="source")setSource(value.path);else setTarget(value.path.replace(/[\\/]$/,"" )+"/RUYIN-"+action+"-"+new Date().toISOString().replace(/[:.]/g,"-"));}}
  catch{setError(t("recovery.failed"));}finally{lock.current=false;setBusy(false);}
 };
 const queue=async()=>{
  if(lock.current)return;lock.current=true;setBusy(true);setError(undefined);
  try{const value=await api.queueMaintenance({action,target,...(action==="restore"?{source}:{})});setOperation(value.operation);setConfirm(false);}
  catch(cause){setError(t(cause instanceof ApiError&&cause.body.code==="MAINTENANCE_BUSY"?"recovery.busy":cause instanceof ApiError&&cause.body.code==="BACKUP_INVALID"?"recovery.invalid":"recovery.failed"));}
  finally{lock.current=false;setBusy(false);}
 };
 const pending=operation?.state==="queued"||operation?.state==="running";
 return <div className="recovery-settings">
  {failed?<p role="alert" className="set-note">{t("recovery.unavailable")} <Button variant="outline" size="sm" onClick={()=>void load()}>{t("set.window.retry")}</Button></p>:<>
  {operation&&<div className="recovery-operation" role="status"><StatusBadge tone={operation.state==="failed"?"warning":operation.state==="completed"?"success":"neutral"}>{t(("recovery.state."+operation.state) as MessageKey)}</StatusBadge><span>{t(operation.action==="backup"?"recovery.backup":"recovery.restore")}</span><span className="mono">{operation.target}</span></div>}
  {pending?<>
   <p className="set-note">{t("recovery.restartNote")}</p>
   <div className="recovery-actions">{inShell&&<Button disabled={busy||operation?.state!=="queued"} onClick={()=>{setBusy(true);void api.restartApp().catch(()=>setError(t("recovery.failed"))).finally(()=>setBusy(false));}}>{t("recovery.restart")}</Button>}
   <Button variant="outline" disabled={busy||operation?.state!=="queued"} onClick={()=>{setBusy(true);void api.cancelMaintenance().then(value=>setOperation(value.operation)).catch(()=>setError(t("recovery.failed"))).finally(()=>setBusy(false));}}>{t("home.install.cancel")}</Button></div>
  </>:<>
   <div className="set-row"><span className="set-row-label">{t("recovery.action")}</span><span className="set-row-control"><NativeSelect aria-label={t("recovery.action")} value={action} disabled={busy} onChange={event=>{setAction(event.target.value as "backup"|"restore");setError(undefined);}}><option value="backup">{t("recovery.backup")}</option><option value="restore">{t("recovery.restore")}</option></NativeSelect></span></div>
   {action==="restore"&&<div className="recovery-path"><label htmlFor="recovery-source">{t("recovery.source")}</label><Input id="recovery-source" value={source} disabled={busy} onChange={event=>setSource(event.target.value)}/>{inShell&&<Button variant="outline" disabled={busy} onClick={()=>void pick("source")}>{t("recovery.choose")}</Button>}</div>}
   <div className="recovery-path"><label htmlFor="recovery-target">{t("recovery.target")}</label><Input id="recovery-target" value={target} disabled={busy} onChange={event=>setTarget(event.target.value)}/>{inShell&&<Button variant="outline" disabled={busy} onClick={()=>void pick("target")}>{t("recovery.choose")}</Button>}</div>
   <div className="recovery-actions"><Button disabled={busy||!target.trim()||action==="restore"&&!source.trim()} onClick={()=>setConfirm(true)}>{t("recovery.prepare")}</Button></div>
  </>}
  </>}
  <p className="set-note">{t("recovery.scope")}</p>{error&&<p role="alert" className="set-note">{error}</p>}
  <AlertDialog open={confirm} onOpenChange={value=>{if(!lock.current)setConfirm(value);}}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t(action==="backup"?"recovery.confirmBackup":"recovery.confirmRestore")}</AlertDialogTitle><AlertDialogDescription>{t(action==="backup"?"recovery.backupHint":"recovery.restoreHint")}</AlertDialogDescription></AlertDialogHeader><p className="text-body-sm break-all">{target}</p>{error&&<p role="alert" className="text-body-sm">{error}</p>}<AlertDialogFooter><AlertDialogCancel disabled={busy}>{t("home.install.cancel")}</AlertDialogCancel><Button disabled={busy} onClick={()=>void queue()}>{t(busy?"agents.manage.working":"agents.manage.confirm")}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
 </div>;
}

export function DiagnosticsSettings({api}:{api:Api}){
 const t=useT(),[report,setReport]=useState<DiagnosticReport>(),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false);
 const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const check=async()=>{setBusy(true);setFailed(false);try{const next=await api.diagnostics();if(alive.current)setReport(next);}catch{if(alive.current)setFailed(true);}finally{if(alive.current)setBusy(false);}};
 const download=()=>{if(!report)return;const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:"application/json"}));const link=document.createElement("a");link.href=url;link.download="ruyin-diagnostics.json";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 return <div><div className="recovery-actions"><Button disabled={busy} onClick={()=>void check()}>{t(busy?"diagnostics.checking":"diagnostics.check")}</Button><Button variant="outline" disabled={!report||busy} onClick={download}>{t("diagnostics.export")}</Button></div>
  {report&&<ul className="diagnostic-results">{report.checks.map(item=><li key={item.id}><span>{t(("diagnostics."+item.id) as MessageKey)}</span><StatusBadge tone={item.status==="ok"?"success":"neutral"}>{t(("diagnostics."+item.status) as MessageKey)}</StatusBadge>{item.status!=="ok"&&<p>{t(("diagnostics.help."+item.id) as MessageKey)}</p>}</li>)}</ul>}
  {failed&&<p role="alert" className="set-note">{t("diagnostics.failed")}</p>}<p className="set-note">{t("diagnostics.note")}</p>
 </div>;
}
