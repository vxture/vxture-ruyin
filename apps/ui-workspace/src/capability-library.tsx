import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Icon, Input, NativeSelect, StatusBadge } from "@vxture/design-system";
import type { Api, CapabilityCatalogPage, SkillListing, SkillView } from "./api";
import { capabilityInventory, filterSkills, skillAvailability, readCapabilityInventory, type SkillInstallation, type SkillSourceFilter, type SkillAvailabilityFilter } from "./capability-inventory";
import { useLocale, useT } from "./i18n";

const PAGE_SIZE=50;
export function CapabilityLibrary({api,listing,busy,onRefresh,renderSkill,renderSkillAction,localSummary,errors}:{
  api:Api;listing:SkillListing|null;busy:boolean;onRefresh:()=>Promise<void>;
  renderSkill:(skill:SkillView)=>ReactNode;
  renderSkillAction:(skill:SkillView)=>ReactNode;
  localSummary:ReactNode;errors:ReactNode;
}){
  const t=useT(),locale=useLocale();
  const [cloud,setCloud]=useState<CapabilityCatalogPage|null>(null),[cloudBusy,setCloudBusy]=useState(true),[cloudFailed,setCloudFailed]=useState(false);
  const generation=useRef(0);
  const [query,setQuery]=useState(""),[layer,setLayer]=useState<SkillSourceFilter>("all"),[installation,setInstallation]=useState<SkillInstallation>("all"),[state,setState]=useState<SkillAvailabilityFilter>("all"),[visible,setVisible]=useState(PAGE_SIZE);
  const load=async(refresh=false)=>{
    const request=++generation.current;setCloudBusy(true);setCloudFailed(false);
    let refreshFailed=false;
    if(refresh){
      try{await onRefresh();await api.refreshCapabilityCatalog("manual");}catch{refreshFailed=true;}
    }
    try{
      const page=await readCapabilityInventory(api,"skill");
      if(request!==generation.current)return;
      setCloud(page);setCloudFailed(refreshFailed);
    }catch{if(request===generation.current)setCloudFailed(true);}
    finally{if(request===generation.current)setCloudBusy(false);}
  };
  useEffect(()=>{setCloud(null);void load();return()=>{generation.current++;};},[api]);
  const rows=capabilityInventory(listing?.items??[],[],(cloud?.items??[]).filter(row=>row.primitiveType==="skill"),locale);
  const filtered=filterSkills(rows,query,installation,layer,state);
  const pending=listing===null||cloudBusy;
  const partial=cloudFailed||!cloud||cloud.source.state==="unavailable"||cloud.source.state==="never";
  const change=<T,>(set:(v:T)=>void,value:T)=>{set(value);setVisible(PAGE_SIZE);};
  return <section className="card capability-library" aria-label={t("inventory.title")}>
    <header className="capability-library-head">
      <div><h3 className="set-block-title">{t("inventory.title")}<span className="set-block-count">{pending?"…":rows.length}</span></h3>
        <p className="set-block-desc">{t("inventory.description")}</p></div>
      <Button variant="outline" size="sm" disabled={busy||cloudBusy} onClick={()=>void load(true)}>
        {t(busy||cloudBusy?"set.refreshing":"set.refresh")}
      </Button>
    </header>
    <div className="capability-library-filters">
      <span className="capability-filter-count" aria-live="polite" title={t("inventory.results",{n:filtered.length,total:rows.length})}>
        {pending?"…":t("inventory.count",{n:filtered.length})}
      </span>
      <Input aria-label={t("inventory.search")} placeholder={t("inventory.searchPlaceholder")} value={query} onChange={e=>change(setQuery,e.target.value)}/>
      <NativeSelect aria-label={t("inventory.installation")} value={installation} onChange={e=>{
        const value=e.target.value as SkillInstallation;change(setInstallation,value);
        if(value==="not-installed"){setLayer("all");setState("all");}
      }}>
        {(["all","installed","not-installed"] as const).map(v=><option key={v} value={v}>{t(`inventory.installation.${v}`)}</option>)}
      </NativeSelect>
      <NativeSelect aria-label={t("inventory.layer")} value={layer} disabled={installation==="not-installed"} onChange={e=>{
        const value=e.target.value as SkillSourceFilter;change(setLayer,value);if(value!=="all")setInstallation("installed");
      }}>
        <option value="all">{t("inventory.layer.all")}</option>
        {(["bundled","distributed","user"] as const).map(v=><option key={v} value={v}>{t(`set.cap.layer.${v}`)}</option>)}
      </NativeSelect>
      <NativeSelect aria-label={t("inventory.availability")} value={state} disabled={installation==="not-installed"} onChange={e=>{
        const value=e.target.value as SkillAvailabilityFilter;change(setState,value);if(value!=="all")setInstallation("installed");
      }}>
        {(["all","ready","disabled","attention"] as const).map(v=><option key={v} value={v}>{t(`inventory.availability.${v}`)}</option>)}
      </NativeSelect>
    </div>
    <div className="capability-library-status">
      {pending&&<span>{t("inventory.loading")}</span>}
      {!cloudBusy&&partial&&<span role="status">{t("inventory.cloudUnavailable")}</span>}
      {cloud?.source.state==="stale"&&<span role="status">{t("inventory.cloudStale")}</span>}
      {cloud?.source.fetchedAt&&<span className="capability-library-synced">{t("inventory.synced",{at:new Date(cloud.source.fetchedAt).toLocaleString(locale,{hour12:false})})}</span>}
    </div>
    {errors}
    {filtered.length===0 ? <p className="set-note">{t(pending?"inventory.loading":"inventory.empty")}</p> :
      <ul className="capability-inventory-list" aria-label={t("inventory.list")}>
        {filtered.slice(0,visible).map(row=>{
          const local=row.skills.length>0;
          const availability=skillAvailability(row.skills);
          const description=row.cloud?.summary??row.skills[0]?.description??row.cloud?.capabilityId;
          return <li key={row.key} className="capability-inventory-item">
            <details className="capability-record">
              <summary>
                <span className="capability-record-icon" aria-hidden><Icon name={row.kind==="skill"?"sparkles":"plugs-connected"} size="sm"/></span>
                <span className="capability-record-text"><span className="capability-record-name">{row.title}</span>
                  <span className="capability-record-description">{description}</span>
                </span>
                <span className="capability-record-badges">
                  <span className="capability-record-locations">
                    {local&&<span className="capability-record-location" role="img" aria-label={t("inventory.presence.local")} title={t("inventory.presence.local")}><Icon name="desktop" size="sm"/></span>}
                    {row.cloud&&<span className="capability-record-location" role="img" aria-label={t("inventory.presence.cloud")} title={t("inventory.presence.cloud")}><Icon name="cloud" size="sm"/></span>}
                  </span>
                  <span title={availability==="attention"?t("inventory.attentionHint"):undefined}><StatusBadge tone={availability==="ready"?"success":availability==="attention"?"warning":"neutral"}>{t(`inventory.availability.${availability}`)}</StatusBadge></span>
                </span>
                {row.skills.length===1&&<span className="capability-record-action" onClick={e=>{e.preventDefault();e.stopPropagation();}}>
                  {renderSkillAction(row.skills[0]!)}
                </span>}
                <Icon name="chevron-down" size="xs" className="capability-record-caret"/>
              </summary>
              <div className="capability-record-detail">
                {row.skills.length>1&&<div className="capability-copy-controls">{row.skills.map(skill=>
                  <div className="capability-copy-control" key={JSON.stringify([skill.layer,skill.source,skill.name])}>
                    <span><code>{skill.name}</code><span className="row-tag">{t(`set.cap.layer.${skill.layer}`)}</span></span>{renderSkillAction(skill)}
                  </div>)}</div>}
                {row.skills.filter(skill=>skill.hasScripts||skill.shadowedBy).map(skill=><div className="capability-skill-guidance" key={JSON.stringify([skill.layer,skill.source,skill.name])}>
                  <strong>{t("inventory.guidance.title")} · <code>{skill.name}</code></strong>
                  {skill.hasScripts&&<div>
                    <p>{t("inventory.guidance.scripts")}</p>
                    <Button variant="outline" size="sm" onClick={()=>{setQuery("");setLayer("all");setInstallation("installed");setState("ready");setVisible(PAGE_SIZE);}}>{t("inventory.guidance.alternatives")}</Button>
                  </div>}
                  {skill.shadowedBy&&<div>
                    <p>{t("inventory.guidance.shadowed",{layer:t(`set.cap.layer.${skill.shadowedBy}`)})}</p>
                    <Button variant="outline" size="sm" onClick={()=>{setQuery(skill.name);setLayer("all");setInstallation("installed");setState("all");setVisible(PAGE_SIZE);}}>{t("inventory.guidance.findCopy")}</Button>
                  </div>}
                </div>)}
                <p className="capability-full-description">{description}</p>
                {local&&<ul className="capability-skill-metadata" aria-label={t("set.skills.groupAria",{group:t("inventory.localCopies")})}>{row.skills.map(renderSkill)}</ul>}
                {row.cloud&&<div className="capability-cloud-meta">
                  <span className="capability-meta-label">{t("inventory.cloudRecord")}</span>
                  <code>{row.cloud.capabilityId}</code>
                  {row.cloud.category&&<span>{row.cloud.category}</span>}
                  {row.cloud.tags.length>0&&<span>{row.cloud.tags.join(" · ")}</span>}
                  <span className="capability-cloud-note">{t("inventory.cloudNote")}</span>
                </div>}
              </div>
            </details>
          </li>;
        })}
      </ul>}
    {filtered.length>visible&&<Button variant="ghost" size="sm" onClick={()=>setVisible(v=>v+PAGE_SIZE)}>{t("set.catalog.more")}</Button>}
    {listing&&<details className="capability-local-summary"><summary>{t("inventory.localDetails")}</summary>{localSummary}</details>}
  </section>;
}
