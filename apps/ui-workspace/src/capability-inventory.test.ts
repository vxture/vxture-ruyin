import {expect,test,vi} from "vitest";
import type {Api,CapabilityCatalogPage,CatalogItem,SkillView,ToolView} from "./api";
import {capabilityInventory,filterInventory,filterSkills,skillAvailability,readCapabilityInventory,skillCatalogId} from "./capability-inventory";
const skill=(over:Partial<SkillView>={}):SkillView=>({name:"report",description:"Build reports",source:"vendor.repo",layer:"bundled",enabled:true,hasScripts:false,dir:"local",...over});
const cloud=(id="vendor.report",over:Partial<CatalogItem>={}):CatalogItem=>({capabilityId:id,title:"Report",primitiveType:"skill",tags:["document"],local:{runnable:true},...over});
const tool=(over:Partial<ToolView>={}):ToolView=>({id:"read_file",kind:"builtin",source:"host",status:"available",...over});
const page=(over:Partial<CapabilityCatalogPage>={}):CapabilityCatalogPage=>({items:[cloud()],total:1,source:{kind:"platform",state:"synced",ref:"stable"},...over});
test("exact identities merge but names, overrides and unverified distribution cannot impersonate cloud providers",()=>{
 const local=[skill(),skill({layer:"user",source:"user",capabilityId:"vendor.report"}),skill({layer:"project",source:"project"}),skill({layer:"distributed",source:"agent"}),skill({name:"other",layer:"distributed",capabilityId:"vendor.other"}),skill({name:"report",source:"other.repo"})];
 const rows=capabilityInventory(local,[],[cloud(),cloud("vendor.other"),cloud("remote", {primitiveType:"connector"})],"en");
 expect(rows).toHaveLength(7);
 expect(rows.find(r=>r.cloud?.capabilityId==="vendor.report")?.skills).toHaveLength(1);
 expect(rows.filter(r=>!r.cloud)).toHaveLength(4);
 expect(skillCatalogId(skill({layer:"distributed",capabilityId:"verified.report"}))).toBe("verified.report");
 expect(skillCatalogId(skill({layer:"distributed"}))).toBeUndefined();
});
test("multiple verified copies share one identity; a different primitive with the same ID remains separate",()=>{
 const same=capabilityInventory([skill(),skill({layer:"distributed",source:"agent",capabilityId:"vendor.report"})],[],[cloud()],"en");
 expect(same).toHaveLength(1);expect(same[0]?.skills).toHaveLength(2);
 const conflict=capabilityInventory([skill(),skill({layer:"distributed",capabilityId:"vendor.report"})],[],[cloud("vendor.report",{primitiveType:"connector"})],"en");
 expect(conflict).toHaveLength(2);
 expect(conflict.find(r=>r.kind==="skill")?.skills).toHaveLength(2);
});
test("local readiness is derived from current local state, never from a catalog-only runnable flag",()=>{
 const rows=capabilityInventory([skill({enabled:false}),skill({name:"script",hasScripts:true}),skill({name:"shadow",shadowedBy:"user"}),skill({name:"ready"})],[
   tool(),tool({id:"stopped",kind:"connector",status:"unavailable"}),tool({id:"registered",kind:"mcp-server",status:"registered"}),
   tool({id:"acquire",kind:"mcp-server",status:"needs-acquisition",component:{id:"payload",state:"not-acquired",downloadBytes:1,diskBytes:2,license:"MIT",origin:"vendor"}}),
   tool({id:"acquired",kind:"mcp-server",status:"registered",component:{id:"payload",state:"acquired",downloadBytes:1,diskBytes:2,license:"MIT",origin:"vendor"}}),
   tool({id:"launchable",kind:"mcp-server",status:"registered",launchable:true}),
 ],[cloud(),cloud("remote")],"en");
 expect(rows.find(r=>r.cloud?.capabilityId==="remote")?.ready).toBe(false);
 expect(filterInventory(rows,"","all","all","ready").map(r=>r.title)).toEqual(["read_file","ready"]);
 expect(filterInventory(rows,"","all","all","restricted")).toHaveLength(8);
 expect(filterInventory(rows,"","all","all","installed")).toHaveLength(8);
 expect(filterInventory(rows,"","all","all","not-installed")).toHaveLength(3);
 expect(filterInventory(rows,"payload","all","all","all")).toHaveLength(0);
});
test("type, location, state and query intersect while cloud and local-only views conserve the union",()=>{
 const rows=capabilityInventory([skill(),skill({name:"private",layer:"user",description:"private knowledge"})],[tool({tools:["lookup"]})],[cloud(),cloud("remote",{title:"Remote",summary:"lookup online",category:"research",tags:["web"]}),cloud("asset",{primitiveType:"asset"})],"en");
 expect(rows).toHaveLength(5);
 for(const [location,n] of [["all",5],["local",3],["cloud",3],["both",1],["local-only",2]] as const)expect(filterInventory(rows,"","all",location,"all")).toHaveLength(n);
 expect(filterInventory(rows,"  KNOWLEDGE  ","skill","local-only","ready")).toHaveLength(1);
 expect(filterInventory(rows,"web","skill","cloud","not-installed")).toHaveLength(1);
 expect(filterInventory(rows,"lookup","all","all","all")).toHaveLength(2);
 expect(filterInventory(rows,"","executor","all","all")).toHaveLength(0);
 expect(filterInventory(rows,"","asset","cloud","all")).toHaveLength(1);
 expect(filterInventory(rows,"none","all","all","all")).toHaveLength(0);
});
test("localized names follow the current UI language; known ID sorting remains stable for duplicate titles",()=>{
 const rows=capabilityInventory([],[],[cloud("z",{displayName:{"zh-CN":"报告",en:"Report"}}),cloud("a",{title:"Report"})],"en");
 expect(rows.map(r=>r.key)).toEqual(["cloud:a","cloud:z"]);
 expect(capabilityInventory([],[],[cloud("z",{displayName:{"zh-CN":"报告"}})],"zh-CN")[0]?.title).toBe("报告");
});

test("skill availability partitions installed copies without treating cloud listings as executable",()=>{
 const rows=capabilityInventory([
  skill({name:"ready"}),skill({name:"disabled",enabled:false,hasScripts:true}),
  skill({name:"script",hasScripts:true}),skill({name:"shadow",shadowedBy:"user"}),
 ],[tool()],[cloud("remote")],"en");
 expect(skillAvailability([])).toBe("not-installed");
 expect(filterSkills(rows,"","all","all","all")).toHaveLength(5);
 expect(filterSkills(rows,"","installed","all","all")).toHaveLength(4);
 expect(filterSkills(rows,"","not-installed","all","all").map(r=>r.cloud?.capabilityId)).toEqual(["remote"]);
 expect(filterSkills(rows,"","all","all","ready").map(r=>r.title)).toEqual(["ready"]);
 expect(filterSkills(rows,"","all","all","disabled").map(r=>r.title)).toEqual(["disabled"]);
 expect(filterSkills(rows,"","all","all","attention").map(r=>r.title)).toEqual(["script","shadow"]);
 expect(filterSkills(rows,"","not-installed","bundled","all")).toEqual([]);
 expect(filterSkills(rows,"","not-installed","all","ready")).toEqual([]);
 expect(filterSkills(rows,"none","all","all","all")).toEqual([]);
});

test("source-scoped filtering checks that copy's status and leaves the original identity and copies intact",()=>{
 const rows=capabilityInventory([skill({enabled:false}),skill({layer:"distributed",source:"agent",capabilityId:"vendor.report"}),skill({layer:"user",source:"user"})],[],[cloud()],"en");
 const original=structuredClone(rows);
 const scoped=filterSkills(rows,"report","installed","bundled","disabled");
 expect(scoped).toHaveLength(1);expect(scoped[0]?.skills).toHaveLength(1);expect(scoped[0]?.ready).toBe(false);
 expect(filterSkills(rows,"","installed","bundled","ready")).toEqual([]);
 expect(filterSkills(rows,"","all","distributed","ready")[0]?.ready).toBe(true);
 expect(filterSkills(rows,"","all","user","ready")[0]?.cloud).toBeUndefined();
 expect(filterSkills(rows,"","all","all","ready")).toHaveLength(2);
 expect(rows).toEqual(original);
});
test("complete cloud catalog pages are read once with stable metadata and no per-search HTTP",async()=>{
 const capabilityCatalog=vi.fn().mockResolvedValueOnce(page({items:[cloud("one")],total:2,nextCursor:"next"})).mockResolvedValueOnce(page({items:[cloud("two")],total:2}));
 const result=await readCapabilityInventory({capabilityCatalog} as unknown as Api);
 expect(result.items).toHaveLength(2);expect(result.nextCursor).toBeUndefined();
 expect(capabilityCatalog.mock.calls).toEqual([[{limit:1000}],[{limit:1000,cursor:"next"}]]);
});
test("incomplete, duplicate, changed or looping snapshots fail atomically",async()=>{
 const cases=[
  [page({items:[],total:1})],
  [page({items:[cloud(),cloud()],total:2})],
  [page({total:2,nextCursor:"x"}),page({items:[cloud("next")],total:3})],
  [page({total:2,nextCursor:"x"}),page({items:[cloud("next")],total:2,source:{kind:"platform",state:"stale",ref:"stable"}})],
  [page({total:2,nextCursor:"x"}),page({items:[cloud("next")],total:2,source:{kind:"platform",state:"synced",ref:"changed"}})],
  [page({items:[],total:0,nextCursor:"x"}),page({items:[],total:0,nextCursor:"x"})],
 ];
 for(const pages of cases){
  const capabilityCatalog=vi.fn();for(const value of pages)capabilityCatalog.mockResolvedValueOnce(value);
  await expect(readCapabilityInventory({capabilityCatalog} as unknown as Api)).rejects.toThrow(/CAPABILITY_/);
 }
 let n=0;const endless=vi.fn().mockImplementation(async()=>page({items:[],total:0,nextCursor:String(++n)}));
 await expect(readCapabilityInventory({capabilityCatalog:endless} as unknown as Api)).rejects.toThrow("CAPABILITY_PAGE_LIMIT");
});
