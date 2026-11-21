import type { Api, CapabilityCatalogPage, CatalogItem, SkillLayer, SkillView, ToolView } from "./api";

export interface CapabilityRecord {
  key: string;
  cloud?: CatalogItem;
  skills: SkillView[];
  tool?: ToolView;
  title: string;
  kind: "skill" | "tool" | "connector" | "executor" | "asset";
  installed: boolean;
  ready: boolean;
}
export type InventoryLocation = "all" | "local" | "cloud" | "both" | "local-only";
export type InventoryState = "all" | "installed" | "not-installed" | "ready" | "restricted";
export type InventoryKind = "all" | CapabilityRecord["kind"];
export type SkillInstallation = "all" | "installed" | "not-installed";
export type SkillAvailability = "ready" | "disabled" | "attention" | "not-installed";
export type SkillAvailabilityFilter = "all" | Exclude<SkillAvailability,"not-installed">;
export type SkillSourceFilter = "all" | Exclude<SkillLayer,"project">;

export function skillAvailability(skills:SkillView[]):SkillAvailability {
  if(!skills.length)return "not-installed";
  if(skills.some(skill=>skill.enabled&&!skill.shadowedBy&&!skill.hasScripts))return "ready";
  return skills.some(skill=>skill.enabled) ? "attention" : "disabled";
}

/** Installation, local source and local availability are separate questions. */
export function filterSkills(rows:CapabilityRecord[],query:string,installation:SkillInstallation,source:SkillSourceFilter,state:SkillAvailabilityFilter):CapabilityRecord[] {
  return filterInventory(rows,query,"skill","all","all").flatMap(row=>{
    if(installation==="installed"&&!row.installed||installation==="not-installed"&&row.installed)return [];
    const skills=source==="all"?row.skills:row.skills.filter(skill=>skill.layer===source);
    if(source!=="all"&&!skills.length)return [];
    if(state!=="all"&&skillAvailability(skills)!==state)return [];
    return [source==="all"?row:{...row,skills,ready:skillAvailability(skills)==="ready"}];
  });
}

/** Legacy hosts already use this exact bundled owner/name mapping. No user-name heuristic. */
export function skillCatalogId(skill: SkillView): string | undefined {
  if (skill.layer === "user" || skill.layer === "project") return undefined;
  return skill.capabilityId ?? (skill.layer === "bundled" ? skill.source.split(".")[0]+"."+skill.name : undefined);
}

export function capabilityInventory(skills: SkillView[], tools: ToolView[], cloud: CatalogItem[], locale: string): CapabilityRecord[] {
  const records = new Map<string,CapabilityRecord>();
  for(const entry of cloud) records.set("cloud:"+entry.capabilityId,{
    key:"cloud:"+entry.capabilityId,cloud:entry,skills:[],title:entry.displayName?.[locale] ?? entry.title,
    kind:entry.primitiveType,installed:false,ready:false,
  });
  for(const skill of skills) {
    const id=skillCatalogId(skill);
    const cloudKey=id ? "cloud:"+id : undefined;
    const cloudRecord=cloudKey ? records.get(cloudKey) : undefined;
    const key=cloudKey ? (cloudRecord && cloudRecord.kind!=="skill" ? "skill:"+cloudKey : cloudKey) : "skill:"+JSON.stringify([skill.layer,skill.source,skill.name]);
    const candidate=records.get(key);
    // A connector with the same text identifier is not a skill.
    const record=candidate?.kind==="skill" ? candidate : {
      key,skills:[],title:skill.name,kind:"skill" as const,installed:true,ready:false,
    };
    record.skills.push(skill);record.installed=true;
    record.ready ||= skill.enabled && !skill.shadowedBy && !skill.hasScripts;
    records.set(record.key,record);
  }
  for(const tool of tools) {
    records.set("tool:"+JSON.stringify([tool.kind,tool.id]),{
      key:"tool:"+JSON.stringify([tool.kind,tool.id]),skills:[],tool,title:tool.id,
      kind:tool.kind==="connector" ? "connector" : "tool",
      installed:tool.component ? tool.component.state==="acquired" : tool.kind==="builtin" || tool.kind==="connector" || tool.launchable===true,
      ready:tool.status==="available",
    });
  }
  return [...records.values()].sort((a,b)=>Number(b.installed)-Number(a.installed)||a.title.localeCompare(b.title,locale)||a.key.localeCompare(b.key));
}

export function filterInventory(records: CapabilityRecord[], query: string, kind:InventoryKind, location:InventoryLocation, state:InventoryState): CapabilityRecord[] {
  const q=query.trim().toLocaleLowerCase();
  return records.filter(row=>{
    const local=!!row.tool||row.skills.length>0;
    if(kind!=="all"&&row.kind!==kind)return false;
    if(location==="local"&&!local||location==="cloud"&&!row.cloud||location==="both"&&(!local||!row.cloud)||location==="local-only"&&(!local||row.cloud))return false;
    if(state==="installed"&&!row.installed||state==="not-installed"&&row.installed||state==="ready"&&!row.ready||state==="restricted"&&(!local||row.ready))return false;
    const text=[row.title,row.cloud?.capabilityId,row.cloud?.summary,row.cloud?.category,...row.cloud?.tags??[],
      ...row.skills.flatMap(s=>[s.name,s.description,s.source]),row.tool?.source,...row.tool?.tools??[]].join(" ").toLocaleLowerCase();
    return !q||text.includes(q);
  });
}

/** The daemon already caches a complete cloud snapshot; read all its pages atomically. */
export async function readCapabilityInventory(api:Api,type?:CatalogItem["primitiveType"]):Promise<CapabilityCatalogPage> {
  const rows:CatalogItem[]=[],ids=new Set<string>(),cursors=new Set<string>();
  let cursor:string|undefined,first:CapabilityCatalogPage|undefined;
  for(let page=0;page<200;page++){
    const next=await api.capabilityCatalog({limit:1000,...(type?{type}:{}),...(cursor?{cursor}:{})});
    first??=next;
    if(next.total!==first.total||next.source.ref!==first.source.ref||next.source.state!==first.source.state)throw Error("CAPABILITY_SNAPSHOT_CHANGED");
    for(const row of next.items){if(ids.has(row.capabilityId))throw Error("CAPABILITY_DUPLICATE");ids.add(row.capabilityId);rows.push(row);}
    if(!next.nextCursor){
      if(rows.length!==next.total)throw Error("CAPABILITY_INCOMPLETE");
      return {...first,items:rows,nextCursor:undefined};
    }
    if(cursors.has(next.nextCursor))throw Error("CAPABILITY_CURSOR_REPEATED");
    cursors.add(next.nextCursor);cursor=next.nextCursor;
  }
  throw Error("CAPABILITY_PAGE_LIMIT");
}
