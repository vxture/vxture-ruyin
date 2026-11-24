/** Device admission integration and stale desktop-session response regressions. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { PlatformSession, NotSignedInError, projectIdentity } from "./platform-session.js";
import { desktopDeviceList, DesktopDevicesError } from "./desktop-devices.js";
import type { KeyManager } from "./keys.js";

const devices = Array.from({length: 3}, (_, i) => ({id: `desktop_${i}`, name: `Computer ${i}`, platform: "win32", lastActiveAt: "2026-11-21T04:00:00.000Z", current: false}));
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {status, headers: {"content-type":"application/json"}});
const claim = (rpsid: string) => json({rpsid, expiresInSec: 3600});

test("organization display uses canonical full name and explicit short name only for the same tenant", () => {
  const context={id:"tenant_a",name:"Studio",mode:"tenant",tenantType:"organization"};
  assert.deepEqual(projectIdentity(null,context,[],{tenantId:"tenant_a",tenantName:"Ruyin Technology Studio",displayName:"RUYIN"}).org,
    {id:"tenant_a",name:"Ruyin Technology Studio",shortName:"RUYIN",type:"organization"});
  for(const profile of [{tenantId:"other",tenantName:"Other private name"},null,"invalid"]){
    assert.deepEqual(projectIdentity(null,context,[],profile).org,{id:"tenant_a",name:"Studio",type:"organization"});
  }
  assert.deepEqual(projectIdentity(null,context,[],{tenantId:"tenant_a"}).org,{id:"tenant_a",name:"Studio",shortName:"Studio",type:"organization"});
  assert.deepEqual(projectIdentity(null,{id:"tenant_a",mode:"tenant"},[],{tenantId:"tenant_a"}).org,{id:"tenant_a"});
});

test("subscription launch metadata can explicitly bypass cache without changing desktop login", async t => {
  let reads=0;
  const {session:s}=rig(t,async url=>url.endsWith("/claim")?claim("current"):json([{homeUrl:++reads===1?"https://old.test":"https://cospace.ruyin.work"}]));
  s.beginLogin();await s.completeLogin();
  assert.deepEqual(await s.subscribedProducts(),[{homeUrl:"https://old.test"}]);
  assert.deepEqual(await s.subscribedProducts(),[{homeUrl:"https://old.test"}]);
  assert.equal(reads,1);
  assert.deepEqual(await s.subscribedProducts(true),[{homeUrl:"https://cospace.ruyin.work"}]);
  assert.deepEqual(await s.subscribedProducts(),[{homeUrl:"https://cospace.ruyin.work"}]);
  assert.equal(reads,2);assert.equal(s.signedIn(),true);
});
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return {promise, resolve}; }
function rig(t: TestContext, handle: (url: string, init?: RequestInit) => Promise<Response>) {
  const dir = mkdtempSync(join(tmpdir(), "ruyin-desktop-"));
  const original = globalThis.fetch;
  globalThis.fetch = ((url, init) => handle(String(url), init)) as typeof fetch;
  t.after(() => { globalThis.fetch = original; rmSync(dir, {recursive:true,force:true}); });
  const session = new PlatformSession({consoleBase:"https://console.test", desktopDevice:{id:"stable_install",name:"Work PC",platform:"win32"}},
    {seal:(b:Buffer)=>b,open:(b:Buffer)=>b} as KeyManager, dir);
  return {session, dir};
}

test("device-limit response stays signed out until explicit selection; server policy and public fields only", async t => {
  const calls: Array<{url:string;body:Record<string,unknown>}> = [];
  const {session:s, dir} = rig(t, async (url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string,unknown>;
    calls.push({url,body});
    return body["releaseDeviceId"] ? claim("approved") : json({code:"DESKTOP_DEVICE_LIMIT", limit:3,
      devices:devices.map(d=>({...d,rpsid:"hidden",token:"hidden"})), deviceSecret:"hidden"},409);
  });
  const url=s.beginLogin(); await s.completeLogin();
  assert.equal(s.signedIn(), false);
  assert.equal(existsSync(join(dir,"platform","session.bin")),false);
  assert.equal(calls.length,1, "no automatic release or repeated claim after limit");
  assert.deepEqual(s.status().desktopLogin,{state:"device_limit",limit:3,devices});
  assert.equal(JSON.stringify(s.status()).includes("hidden"), false);
  assert.deepEqual(calls[0]!.body["device"],{id:"stable_install",name:"Work PC",platform:"win32"});
  assert.equal(url.includes(String(calls[0]!.body["deviceSecret"])),false);
  await assert.rejects(s.releaseDesktopDevice("foreign"),DesktopDevicesError);
  assert.equal(calls.length,1);
  await s.releaseDesktopDevice("desktop_1");
  assert.equal(calls[1]!.body["releaseDeviceId"],"desktop_1");
  assert.equal(calls[0]!.body["deviceSecret"],calls[1]!.body["deviceSecret"]);
  assert.equal(s.rpsid(),"approved"); assert.equal(s.status().desktopLogin,undefined);
});

test("legacy successful claim and unsupported device list preserve existing login", async t => {
  let claims=0;
  const {session:s}=rig(t,async url=>url.endsWith("/claim")?(claims++,claim("legacy")):json({},404));
  s.beginLogin(); await s.completeLogin();
  assert.deepEqual(await s.desktopDevices(),{supported:false});
  assert.equal(s.rpsid(),"legacy"); assert.equal(claims,1);
  assert.throws(()=>s.beginLogin(),e=>e instanceof DesktopDevicesError && e.status===409);
});

test("policy is server supplied; remote release is explicit and current device is protected", async t => {
  const deleted: string[]=[];
  const list=devices.map((d,i)=>({...d,current:i===0}));
  const {session:s}=rig(t,async (url,init)=>{
    if(url.endsWith("/claim"))return claim("signed");
    if(init?.method==="DELETE"){deleted.push(url);return new Response(null,{status:204});}
    return json({limit:8,devices:list,access_token:"hidden"});
  });
  s.beginLogin(); await s.completeLogin();
  assert.deepEqual(await s.desktopDevices(),{supported:true,limit:8,devices:list});
  for(const id of ["../foreign","desktop_0","foreign"])await assert.rejects(s.releaseDesktopDevice(id),DesktopDevicesError);
  assert.deepEqual(deleted,[]);
  await s.releaseDesktopDevice("desktop_2");
  assert.deepEqual(deleted,["https://console.test/api/desktop/devices/desktop_2"]);
  assert.equal(s.rpsid(),"signed");
});

test("malformed or unrelated conflict cannot be mistaken for a device limit", async t => {
  const {session:s}=rig(t,async()=>json({code:"OTHER_CONFLICT",limit:3,devices},409));
  s.beginLogin(); await assert.rejects(s.completeLogin(),NotSignedInError);
  assert.deepEqual(s.status().desktopLogin,{state:"failed"});
  for (const value of [null, {limit:0,devices}, {limit:3,devices:[devices[0],devices[0]]},
    {limit:3,devices:[{...devices[0],lastActiveAt:"invalid"}]}, {limit:3,devices:[{...devices[0],id:"../path"}]},
    {limit:3,devices:devices.map(d=>({...d,current:true}))}]) assert.throws(()=>desktopDeviceList(value),DesktopDevicesError);
});

test("expired pending approval cannot release a device",async t=>{
  let calls=0;const now=Date.now();let clock=now;t.mock.method(Date,"now",()=>clock);
  const {session:s}=rig(t,async()=>{calls++;return json({code:"DESKTOP_DEVICE_LIMIT",limit:3,devices},409);});
  s.beginLogin();await s.completeLogin();clock=now+300001;
  await assert.rejects(s.releaseDesktopDevice("desktop_1"),DesktopDevicesError);
  assert.equal(calls,1);assert.deepEqual(s.status().desktopLogin,{state:"timed_out"});
});

test("ambiguous replacement is never automatically repeated",async t=>{
  let calls=0;
  const {session:s}=rig(t,async()=>{
    if(++calls===1)return json({code:"DESKTOP_DEVICE_LIMIT",limit:3,devices},409);
    throw Error("response lost");
  });
  s.beginLogin();await s.completeLogin();
  await assert.rejects(s.releaseDesktopDevice("desktop_1"),e=>e instanceof DesktopDevicesError&&e.code==="DESKTOP_RELEASE_UNCONFIRMED");
  assert.equal(calls,2);assert.equal(s.signedIn(),false);assert.deepEqual(s.status().desktopLogin,{state:"failed"});
});

test("device-limit state expires on status read without an expiry timer",async t=>{
  const now=Date.now();let clock=now;t.mock.method(Date,"now",()=>clock);
  const {session:s}=rig(t,async()=>json({code:"DESKTOP_DEVICE_LIMIT",limit:3,devices},409));
  s.beginLogin();await s.completeLogin();clock=now+300001;
  assert.deepEqual(s.status().desktopLogin,{state:"timed_out"});
  await assert.rejects(s.releaseDesktopDevice("desktop_1"),DesktopDevicesError);
});

test("late claim after cancel cannot resurrect a logged-out desktop",async t=>{
  const response=deferred<Response>();const {session:s}=rig(t,async()=>response.promise);
  s.beginLogin();const run=s.completeLogin();const rejected=assert.rejects(run,NotSignedInError);
  await s.logout();response.resolve(claim("late"));await rejected;
  assert.equal(s.signedIn(),false);assert.equal(s.status().desktopLogin,undefined);
});

test("new login wins over old claim, and duplicate completion does not double claim",async t=>{
  const old=deferred<Response>();let count=0;
  const {session:s}=rig(t,async()=>++count===1?old.promise:claim("new"));
  s.beginLogin();const first=s.completeLogin();assert.equal(first,s.completeLogin());
  const rejected=assert.rejects(first,NotSignedInError);
  s.beginLogin();await s.completeLogin();old.resolve(claim("old"));await rejected;
  assert.equal(count,2);assert.equal(s.rpsid(),"new");
});

test("late rejection confirmation from old session cannot sign out the new user",async t=>{
  const confirmation=deferred<Response>(),started=deferred<void>();let current="old";
  const {session:s}=rig(t,async(url,init)=>{
    if(url.endsWith("/claim"))return claim(current);
    if(url.endsWith("/logout"))return new Response(null,{status:204});
    if(url.endsWith("/api/me")){started.resolve();return confirmation.promise;}
    assert.equal((init?.headers as Record<string,string>)["x-vxture-session"],"old");return json({},401);
  });
  s.beginLogin();await s.completeLogin();const request=s.fetch("/api/other");const rejected=assert.rejects(request,NotSignedInError);
  await started.promise;await s.logout();current="new";s.beginLogin();await s.completeLogin();
  confirmation.resolve(json({},401));await rejected;assert.equal(s.rpsid(),"new");
});

test("late old-account body cannot repopulate the new account cache",async t=>{
  const old=deferred<unknown>(),reading=deferred<void>();let current="old";
  const {session:s}=rig(t,async(url)=>{
    if(url.endsWith("/claim"))return claim(current);
    if(url.endsWith("/logout"))return new Response(null,{status:204});
    return current==="old"?{ok:true,status:200,headers:new Headers(),json:async()=>{reading.resolve();return old.promise;}} as Response:json(["new-account-products"]);
  });
  s.beginLogin();await s.completeLogin();const request=s.subscribedProducts();const rejected=assert.rejects(request,NotSignedInError);
  await reading.promise;
  await s.logout();current="new";s.beginLogin();await s.completeLogin();
  old.resolve(["old-account-products"]);await rejected;
  assert.deepEqual(await s.subscribedProducts(),["new-account-products"]);
  assert.deepEqual(await s.subscribedProducts(),["new-account-products"]);
});

test("device service outage does not erase a valid session or report a completed release",async t=>{
  let fail=false;
  const {session:s}=rig(t,async(url,init)=>{
    if(url.endsWith("/claim"))return claim("kept");
    if(fail||init?.method==="DELETE")throw new Error("offline");
    return json({limit:3,devices});
  });
  s.beginLogin();await s.completeLogin();await assert.rejects(s.releaseDesktopDevice("desktop_1"),/offline/);
  fail=true;await assert.rejects(s.desktopDevices(),/offline/);assert.equal(s.rpsid(),"kept");
});
