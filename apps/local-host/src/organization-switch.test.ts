import test,{type TestContext} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {PlatformSession,PlatformReadError,CLAIM_TIMEOUT_MS} from "./platform-session.js";
import {organizationOptions,switchableOrganizationOptions,OrganizationSwitchError} from "./organization-switch.js";
import type {KeyManager} from "./keys.js";

const personal="11111111-1111-4111-8111-111111111111",org="22222222-2222-4222-8222-222222222222";
const ws1="33333333-3333-4333-8333-333333333333",ws2="44444444-4444-4444-8444-444444444444";
const rows=(candidate=false)=>[{tenantId:personal,tenantName:"个人空间",tenantType:"personal",workspaceId:ws1,workspaceName:"默认工作区",isCurrent:!candidate},
 {tenantId:org,tenantName:"测试组织全名",tenantType:"organization",workspaceId:ws2,workspaceName:"组织工作区",isCurrent:candidate}];
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json","cache-control":"max-age=60"}});
function pending<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(ok=>{resolve=ok;});return {promise,resolve};}
function rig(t:TestContext,over?:(path:string,init:RequestInit)=>Promise<Response>|Response|undefined){
 const dir=mkdtempSync(join(tmpdir(),"ruyin-org-switch-")),file=join(dir,"platform/session.bin"),seal=(b:Buffer)=>Buffer.concat([Buffer.from("sealed:"),b]);
 mkdirSync(join(dir,"platform"));writeFileSync(file,seal(Buffer.from(JSON.stringify({rpsid:"old",expiresAt:Date.now()+3600000}))));
 const keys={seal,open:(b:Buffer)=>b.subarray(7)} as KeyManager;
 const calls:{path:string;init:RequestInit}[]=[];
 t.mock.method(globalThis,"fetch",async(input:string|URL|Request,init:RequestInit={})=>{
  const path=new URL(String(input)).pathname;calls.push({path,init});const custom=over?.(path,init);if(custom)return custom;
  const candidate=(init.headers as Record<string,string>)?.["x-vxture-session"]==="new";
  if(path.endsWith("/claim"))return json({rpsid:"new",expiresInSec:3600});
  if(path==="/api/me")return json({id:"same-user",name:"Synthetic user"});
  if(path==="/api/me/workspaces")return json(rows(candidate));
  if(path==="/api/iam/workspaces/mine")return json([{id:candidate?ws2:ws1,name:candidate?"组织工作区":"默认工作区",isDefault:true}]);
  if(path==="/api/tenant-context")return json({mode:"tenant",id:candidate?org:personal,workspace:candidate?ws2:ws1});
  return json(null,404);
 });
 const session=new PlatformSession({consoleBase:"https://console.test",desktopDevice:{id:"same-installation",name:"SYNTHETIC-PC",platform:"win32"}},keys,dir);
 t.after(()=>rmSync(dir,{recursive:true,force:true}));return {session,keys,file,calls};
}

test("authorized options are projected without roles/secrets; scoped switch persists and replaces only after candidate verification",async t=>{
 const r=rig(t),before=readFileSync(r.file),options=await r.session.organizations();assert.equal(options.length,2);
 assert.deepEqual(Object.keys(options[0]!).sort(),["current","tenantId","tenantName","tenantType","workspaceId","workspaceName"]);
 const started=await r.session.beginOrganizationSwitch(org,ws2),url=new URL(started.authorizeUrl);
 assert.equal(url.searchParams.get("tenantId"),org);assert.equal(url.searchParams.get("workspaceId"),ws2);assert.equal(url.searchParams.get("surface"),"native");
 assert.equal(url.searchParams.has("prompt"),false);assert.equal(r.session.rpsid(),"old");assert.deepEqual(readFileSync(r.file),before);
 assert.equal(JSON.stringify(r.session.organizationSwitchStatus()).includes("secret"),false);
 await r.session.completeOrganizationSwitch(started.requestId);assert.equal(r.session.rpsid(),"new");
 assert.equal(r.session.organizationSwitchStatus()?.state,"completed");assert.notDeepEqual(readFileSync(r.file),before);
 assert.equal(new PlatformSession({consoleBase:"https://console.test"},r.keys,join(r.file,"../..")).rpsid(),"new");
 const claim=r.calls.find(call=>call.path.endsWith("/claim"))!;const body=JSON.parse(String(claim.init.body));
 assert.equal(body.device.id,"same-installation");assert.equal(started.authorizeUrl.includes(body.deviceSecret),false);
 assert.equal(r.session.cancelOrganizationSwitch(started.requestId)?.state,"completed");
});

test("unavailable, foreign or current targets cannot initiate authorization",async t=>{
 const r=rig(t);
 await assert.rejects(r.session.beginOrganizationSwitch("../unsafe",ws2),OrganizationSwitchError);
 await assert.rejects(r.session.beginOrganizationSwitch(org,ws1),e=>e instanceof OrganizationSwitchError&&e.code==="ORG_SWITCH_NOT_ALLOWED");
 await assert.rejects(r.session.beginOrganizationSwitch(personal,ws1),e=>e instanceof OrganizationSwitchError&&e.code==="ORG_SWITCH_CURRENT");
 assert.equal(r.calls.some(call=>call.path.endsWith("/claim")),false);assert.equal(r.session.rpsid(),"old");
 assert.deepEqual(organizationOptions([{...rows()[0],tenantId:"invalid"},{...rows()[0],workspaceId:null},{...rows()[0],tenantType:"unknown"},null]),[]);
 assert.equal(organizationOptions([...rows(),...rows()]).length,2);assert.throws(()=>organizationOptions({}),OrganizationSwitchError);
 assert.throws(()=>r.session.cancelOrganizationSwitch("none"),OrganizationSwitchError);
});

for(const scenario of ["account","tenant","workspace","membership","organizationMembership","deleting","unavailable","claim","malformed"]){
 test(`candidate ${scenario} failure preserves the exact previous sealed session`,async t=>{
  const r=rig(t,(path,init)=>{
   const candidate=(init.headers as Record<string,string>)?.["x-vxture-session"]==="new";
   if(path.endsWith("/claim")&&scenario==="claim")return json({},409);
   if(path.endsWith("/claim")&&scenario==="malformed")return json({rpsid:"new",expiresInSec:-1});
   if(!candidate)return;
   if(path==="/api/me"&&scenario==="account")return json({id:"another-user"});
   if(path==="/api/me"&&scenario==="deleting")return json({id:"same-user",accountStatus:"deleting"});
   if(path==="/api/me"&&scenario==="unavailable")return json({},503);
   if(path==="/api/tenant-context"&&scenario==="tenant")return json({mode:"tenant",id:personal,workspace:ws2});
   if(path==="/api/tenant-context"&&scenario==="workspace")return json({mode:"tenant",id:org,workspace:ws1});
   if(path==="/api/iam/workspaces/mine"&&scenario==="membership")return json([]);
   if(path==="/api/me/workspaces"&&scenario==="organizationMembership")return json(rows(false).filter(row=>row.tenantId!==org));
  });
  const before=readFileSync(r.file),started=await r.session.beginOrganizationSwitch(org,ws2);
  await assert.rejects(r.session.completeOrganizationSwitch(started.requestId));assert.equal(r.session.rpsid(),"old");
  assert.deepEqual(readFileSync(r.file),before);assert.equal(r.session.organizationSwitchStatus()?.state,"failed");
 });
}

test("cancellation fences a late candidate and a new switch can start",async t=>{
 const late=pending<Response>();const r=rig(t,path=>path.endsWith("/claim")?late.promise:undefined);
 const started=await r.session.beginOrganizationSwitch(org,ws2),run=r.session.completeOrganizationSwitch(started.requestId),failure=assert.rejects(run);
 await assert.rejects(r.session.beginOrganizationSwitch(org,ws2),e=>e instanceof OrganizationSwitchError&&e.code==="ORG_SWITCH_BUSY");
 assert.equal(r.session.cancelOrganizationSwitch(started.requestId)?.state,"cancelled");late.resolve(json({rpsid:"new",expiresInSec:3600}));await failure;
 assert.equal(r.session.rpsid(),"old");assert.equal(r.session.organizationSwitchStatus()?.state,"cancelled");
 const next=await r.session.beginOrganizationSwitch(org,ws2);assert.notEqual(next.requestId,started.requestId);
 assert.throws(()=>r.session.organizationSwitchStatus(started.requestId),OrganizationSwitchError);
});

test("same-organization non-default workspace switching uses exact membership instead of the tenant current flag",async t=>{
 const ws3="55555555-5555-4555-8555-555555555555";
 const r=rig(t,(path,init)=>{
  const candidate=(init.headers as Record<string,string>)?.["x-vxture-session"]==="new";
  if(path==="/api/me/workspaces")return json(rows(false));
  if(path==="/api/tenant-context")return json({mode:"tenant",id:personal,workspace:candidate?ws3:ws1,workspaceName:candidate?"投标业务工作区":"默认工作区"});
  if(path==="/api/iam/workspaces/mine")return json([{id:ws1,name:"默认工作区"},{id:ws3,name:"投标业务工作区"},{id:"bad",name:"无效"}]);
 });
 const options=await r.session.organizations();assert.equal(options.length,3);
 assert.equal(options.find(row=>row.workspaceId===ws1)?.current,true);
 assert.equal(options.find(row=>row.workspaceId===ws3)?.current,false);
 const start=await r.session.beginOrganizationSwitch(personal,ws3);await r.session.completeOrganizationSwitch(start.requestId);
 assert.equal(r.session.organizationSwitchStatus()?.state,"completed");
 const next=await r.session.organizations();assert.equal(next.find(row=>row.workspaceId===ws1)?.current,false);
 assert.equal(next.find(row=>row.workspaceId===ws3)?.current,true);
 assert.deepEqual((await r.session.identity()).workspace,{id:ws3,name:"投标业务工作区"});
});

test("workspace enumeration rejects unavailable membership and never substitutes an inaccessible default",()=>{
 const scope={mode:"tenant",id:personal,workspace:ws1};
 for(const bad of [null,{...scope,id:"bad"},{...scope,workspace:null}])assert.throws(()=>switchableOrganizationOptions(rows(),bad,[]),OrganizationSwitchError);
 assert.throws(()=>switchableOrganizationOptions(rows(),scope,{}),OrganizationSwitchError);
 assert.throws(()=>switchableOrganizationOptions(rows().slice(1),scope,[]),OrganizationSwitchError);
 assert.deepEqual(switchableOrganizationOptions(rows(),scope,[]).map(row=>row.workspaceId),[ws2]);
});

test("failed persistence, expiry and logout cannot replace or resurrect a session",async t=>{
 const r=rig(t),before=readFileSync(r.file),started=await r.session.beginOrganizationSwitch(org,ws2);
 t.mock.method(r.keys,"seal",()=>{throw Error("synthetic write failure");});
 await assert.rejects(r.session.completeOrganizationSwitch(started.requestId));assert.equal(r.session.rpsid(),"old");assert.deepEqual(readFileSync(r.file),before);
 const next=await r.session.beginOrganizationSwitch(org,ws2),now=Date.now();t.mock.method(Date,"now",()=>now+CLAIM_TIMEOUT_MS+1);
 assert.equal(r.session.organizationSwitchStatus(next.requestId)?.state,"expired");await r.session.completeOrganizationSwitch(next.requestId);
 assert.equal(r.session.rpsid(),"old");
 await r.session.logout();assert.equal(r.session.organizationSwitchStatus(),null);await assert.rejects(r.session.completeOrganizationSwitch(next.requestId));
});

test("an old cached read cannot populate the new organization's cache",async t=>{
 const late=pending<Response>();let oldReads=0;
 const r=rig(t,(path,init)=>{if(path==="/api/subscription/quota-usage"){
  if((init.headers as Record<string,string>)["x-vxture-session"]==="old"){oldReads++;return late.promise;}
  return json({scope:"new"});
 }});
 const old=r.session.quotaUsage(),rejected=assert.rejects(old);
 const started=await r.session.beginOrganizationSwitch(org,ws2);await r.session.completeOrganizationSwitch(started.requestId);
 late.resolve(json({scope:"old"}));await rejected;
 assert.deepEqual(await r.session.quotaUsage(),{scope:"new"});assert.equal(oldReads,1);
});

test("logout while a candidate claim is in flight fences the returned session",async t=>{
 const late=pending<Response>(),r=rig(t,path=>path.endsWith("/claim")?late.promise:undefined);
 const started=await r.session.beginOrganizationSwitch(org,ws2),run=r.session.completeOrganizationSwitch(started.requestId),rejected=assert.rejects(run);
 await r.session.logout();late.resolve(json({rpsid:"new",expiresInSec:3600}));await rejected;
 assert.equal(r.session.signedIn(),false);assert.equal(r.session.organizationSwitchStatus(),null);
});

test("product icon reads use the authenticated Console session and reject unsafe or oversized images",async t=>{
 let response=()=>new Response(new Uint8Array([1,2,3]),{headers:{"content-type":"image/png"}});
 const r=rig(t,path=>path.startsWith("/api/applications/")?response():undefined);
 assert.deepEqual(await r.session.productIcon("agent","v1"),{data:Buffer.from([1,2,3]),contentType:"image/png"});
 const call=r.calls.at(-1)!;assert.equal(call.path,"/api/applications/agent/icon");
 assert.equal((call.init.headers as Record<string,string>)["x-vxture-session"],"old");
 response=()=>new Response(null,{status:404});assert.equal(await r.session.productIcon("agent","v1"),null);
 for(const headers of [{"content-type":"image/svg+xml"},{"content-type":"image/png","content-length":"1048577"}]){
  response=()=>new Response("image",{headers:headers as Record<string,string>});await assert.rejects(r.session.productIcon("agent","v1"));
 }
 response=()=>new Response(new Uint8Array(1048577),{headers:{"content-type":"image/webp"}});await assert.rejects(r.session.productIcon("agent","v1"));
 response=()=>new Response(null,{status:503});await assert.rejects(r.session.productIcon("agent","v1"));
});

test("late public product descriptions cannot return subscriptions for a logged-out account",async t=>{
 const catalog=pending<Response>(),requested=pending<void>();
 const r=rig(t,path=>path==="/api/products/catalog"?(requested.resolve(),catalog.promise):path==="/api/subscription/subscribed-products"?json([{productCode:"agent"}]):undefined);
 const s=new PlatformSession({consoleBase:"https://console.test",websiteBase:"https://website.test"},r.keys,join(r.file,"../.."));
 const read=s.subscribedProducts(),rejected=assert.rejects(read);await requested.promise;await s.logout();
 catalog.resolve(json([{productCode:"agent",description:"display only"}]));await rejected;assert.equal(s.signedIn(),false);
});

test("public catalog is independent of account scope and reports configuration or upstream failure",async t=>{
 let offline=false;const r=rig(t,path=>path==="/api/products/catalog"?json(offline?{}:[{productCode:"a",productName:"Agent",productType:"agent"}],offline?503:200):undefined);
 await assert.rejects(r.session.productCatalog(),e=>e instanceof PlatformReadError&&e.status===503);
 const session=new PlatformSession({consoleBase:"https://console.test",websiteBase:"https://website.test"},r.keys,join(r.file,"../.."));
 const rows=await session.productCatalog();assert.equal(rows[0]!.productCode,"a");
 const call=r.calls.at(-1)!;assert.deepEqual(call.init.headers,{accept:"application/json"});assert.equal(call.init.credentials,"omit");
 offline=true;const unavailable=new PlatformSession({consoleBase:"https://console.test",websiteBase:"https://website.test"},r.keys,join(r.file,"../.."));
 await assert.rejects(unavailable.productCatalog(),e=>e instanceof PlatformReadError&&e.status===502);
});

test("tenant recommendations preserve upstream order and scope, exposing display fields only",async t=>{
 let response:unknown=[{productCode:"b",productName:"Scoped B",description:"Scoped description",iconUrl:"https://cdn.test/b.png",iconVersion:"v2",privateField:"hidden"},{productCode:"a"},{productCode:"missing"},null];
 const r=rig(t,path=>path==="/api/subscription/recommended-products"?json(response):path==="/api/products/catalog"?json([
  {productCode:"a",productName:"A",productType:"agent",releaseStage:"stable"},
  {productCode:"b",productName:"B",productType:"industry_agent",releaseStage:"beta"},
 ]):undefined);
 const session=new PlatformSession({consoleBase:"https://console.test",websiteBase:"https://website.test"},r.keys,join(r.file,"../.."));
 const rows=await session.recommendedProducts();assert.deepEqual(rows.map(row=>row.productCode),["b","a"]);
 assert.equal(rows[0]!.productName,"Scoped B");assert.equal(rows[0]!.description,"Scoped description");assert.equal(rows[0]!.iconUrl,"https://cdn.test/b.png");assert.equal(rows[0]!.iconVersion,"v2");assert.equal(JSON.stringify(rows).includes("hidden"),false);
 const call=r.calls.find(call=>call.path==="/api/subscription/recommended-products")!;assert.equal((call.init.headers as Record<string,string>)["x-vxture-session"],"old");
 response={invalid:true};await assert.rejects(session.recommendedProducts(),e=>e instanceof PlatformReadError&&e.status===502);
});

test("a recommendation enrichment completing after logout cannot return prior tenant candidates",async t=>{
 const catalog=pending<Response>(),requested=pending<void>();
 const r=rig(t,path=>path==="/api/subscription/recommended-products"?json([{productCode:"a"}]):path==="/api/products/catalog"?(requested.resolve(),catalog.promise):undefined);
 const session=new PlatformSession({consoleBase:"https://console.test",websiteBase:"https://website.test"},r.keys,join(r.file,"../.."));
 const read=session.recommendedProducts(),rejected=assert.rejects(read);await requested.promise;await session.logout();
 catalog.resolve(json([{productCode:"a",productName:"A",productType:"agent",releaseStage:"stable"}]));await rejected;
});
