import {useEffect,useState} from "react";
import {Button,Icon,Popover,PopoverTrigger,ShellPanelContent,StatusBadge} from "@vxture/design-system";
import type {Api,OrganizationOption,OrganizationSwitchView} from "./api";
import {useT} from "./i18n";

export function OrganizationSelector({api,onChanged}:{api:Api;onChanged:()=>void}){
 const t=useT(),[open,setOpen]=useState(false),[rows,setRows]=useState<OrganizationOption[]|null>(null),[attempt,setAttempt]=useState<OrganizationSwitchView|null>(null);
 const [error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),[url,setUrl]=useState<string|null>(null),[reload,setReload]=useState(0);
 const pending=attempt?.state==="pending";
 useEffect(()=>{
  if(!open)return;let alive=true;setRows(null);setError(null);
  Promise.all([api.organizations(),api.organizationSwitchStatus()]).then(([result,status])=>{
   if(!alive)return;setRows(result.items);setAttempt(status);
  }).catch(()=>{if(alive)setError(t("orgSwitch.loadFailed"));});
  return()=>{alive=false;};
 },[open,api,reload,t]);
 useEffect(()=>{
  if(!pending||!attempt)return;let alive=true,reading=false;
  const read=async()=>{
   if(reading)return;reading=true;
   try{
    const next=await api.organizationSwitchStatus(attempt.requestId);if(!alive)return;
    setAttempt(next);setError(null);if(next?.state==="completed"){alive=false;onChanged();}
   }catch{if(alive)setError(t("orgSwitch.statusFailed"));}finally{reading=false;}
  };
  void read();const timer=setInterval(()=>void read(),1500);
  return()=>{alive=false;clearInterval(timer);};
 },[pending,attempt?.requestId,api,t,onChanged]);
 const begin=async(row:OrganizationOption)=>{
  setBusy(true);setError(null);
  try{
   const result=await api.switchOrganization(row.tenantId,row.workspaceId);
   setAttempt({requestId:result.requestId,state:"pending",target:row});setUrl(result.authorizeUrl);
   const win=window.open(result.authorizeUrl,"_blank");if(win)win.opener=null;
  }catch{setError(t("orgSwitch.startFailed"));}finally{setBusy(false);}
 };
 const cancel=async()=>{
  if(!attempt)return;setBusy(true);setError(null);
  try{const next=await api.cancelOrganizationSwitch(attempt.requestId);setAttempt(next);setUrl(null);if(next?.state==="completed")onChanged();}
  catch{setError(t("orgSwitch.cancelFailed"));}finally{setBusy(false);}
 };
 const scopeMismatch=attempt?.errorCode==="ORG_SWITCH_SCOPE_MISMATCH";
 const groups=new Map<string,{name:string;type:OrganizationOption["tenantType"];spaces:OrganizationOption[]}>();
 for(const row of rows??[]){
  const group=groups.get(row.tenantId);if(group)group.spaces.push(row);
  else groups.set(row.tenantId,{name:row.tenantName,type:row.tenantType,spaces:[row]});
 }
 return <div className="organization-selector">
  <Popover open={open} onOpenChange={setOpen}>
   <PopoverTrigger asChild>
    <Button variant={open?"secondary":"ghost"} className="user-panel-row flex w-full items-center justify-start px-sm gap-md">
     <span aria-hidden="true" className="inline-grid h-full shrink-0 place-items-center text-muted-foreground w-icon-sm"><Icon name="arrow-left-right" size="sm"/></span>
     <span className="min-w-0 flex-1 text-left text-label-md">{t("orgSwitch.trigger")}</span>
     <Icon name="chevron-right" size="xs" className="shrink-0 text-muted-foreground"/>
    </Button>
   </PopoverTrigger>
   <ShellPanelContent className="organization-options" side="right" align="end" sideOffset={24} aria-label={t("orgSwitch.options")}>
   {rows===null&&!error&&<p role="status">{t("orgSwitch.loading")}</p>}
   {error&&<p role="alert">{error}<Button variant="ghost" size="sm" onClick={()=>setReload(value=>value+1)}>{t("orgSwitch.retry")}</Button></p>}
   {pending?<div className="organization-switch-progress">
    <p role="status">{t("orgSwitch.pending",{name:attempt.target.workspaceName})}</p>
    <p>{t("orgSwitch.keepWorking")}</p>
    <div className="organization-switch-actions">{url&&<a href={url} target="_blank" rel="noopener noreferrer">{t("orgSwitch.openBrowser")}</a>}
     <Button variant="outline" size="sm" disabled={busy} onClick={()=>void cancel()}>{t("orgSwitch.cancel")}</Button></div>
   </div>:<>
    {attempt?.state==="failed"&&<p role="alert">{t(scopeMismatch?"orgSwitch.scopeMismatch":"orgSwitch.failed")}</p>}
    {attempt?.state==="expired"&&<p role="status">{t("orgSwitch.expired")}</p>}
    {attempt?.state==="cancelled"&&<p role="status">{t("orgSwitch.cancelled")}</p>}
    {rows&&<ul className="organization-groups" aria-label={t("orgSwitch.options")}>{[...groups].map(([id,group])=><li key={id}>
     <div className="organization-group-heading"><Icon name={group.type==="personal"?"user-circle":"buildings"} size="sm"/>
      <strong>{group.name}</strong><StatusBadge tone="neutral">{t(group.type==="personal"?"tenant.type.personal":"tenant.type.organization")}</StatusBadge></div>
     <ul aria-label={group.name}>{group.spaces.map(row=><li key={row.workspaceId}>
      <button type="button" className={"organization-option"+(row.current?" is-current":"")} aria-current={row.current?"true":undefined}
       disabled={busy||row.current} onClick={()=>void begin(row)}>
       <Icon name="folder" size="sm"/><span>{row.workspaceName}</span>{row.current&&<Icon name="check" size="sm"/>}
      </button>
     </li>)}</ul>
    </li>)}</ul>}
    {rows?.length===0&&<p>{t("orgSwitch.none")}</p>}
   </>}
   </ShellPanelContent>
  </Popover>
 </div>;
}
