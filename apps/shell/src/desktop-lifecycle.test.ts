import assert from "node:assert/strict";
import test from "node:test";
import {DesktopLifecycle, type DesktopLifecyclePorts} from "./desktop-lifecycle.js";

function rig(over: Partial<DesktopLifecyclePorts> = {}) {
  const calls: string[] = [];
  const ports: DesktopLifecyclePorts = {
    canHide: () => true, hide: () => { calls.push("hide"); }, explainBackground: () => { calls.push("explain"); },
    activity: async () => ({busy:false}), confirmExit: async (restart, unknown) => { calls.push(`confirm:${restart}:${unknown}`); return false; },
    exit: restart => {calls.push(restart ? "restart" : "exit");}, ...over,
  };
  return {calls, lifecycle: new DesktopLifecycle(ports)};
}

test("closing repeatedly hides without querying, exiting, or destroying runtime; background explanation occurs once",()=>{
  const r=rig();assert.equal(r.lifecycle.closeWindow(),true);assert.equal(r.lifecycle.closeWindow(),true);
  assert.deepEqual(r.calls,["hide","explain","hide"]);assert.equal(r.lifecycle.quitting,false);
});
test("idle explicit exit proceeds; a confirmed quit allows native close without hiding again",async()=>{
  const r=rig();assert.equal(await r.lifecycle.requestExit(),true);assert.equal(r.lifecycle.quitting,true);
  assert.equal(r.lifecycle.closeWindow(),false);assert.equal(await r.lifecycle.requestExit(true),true);
  assert.deepEqual(r.calls,["exit"]);
});
test("busy/unknown exit defaults to continue; restart is not scheduled on cancellation",async()=>{
  for(const [activity,unknown] of [[async()=>({busy:true}),false],[async()=>undefined,true],[async()=>{throw Error("offline");},true]] as const){
    const r=rig({activity});assert.equal(await r.lifecycle.requestExit(true),false);assert.equal(r.lifecycle.quitting,false);
    assert.deepEqual(r.calls,[`confirm:true:${unknown}`]);
  }
});
test("repeated quit requests share one decision and accepted restart occurs once",async()=>{
  let release!:(approved:boolean)=>void;let confirmations=0;
  const r=rig({activity:async()=>({busy:true}),confirmExit:async()=>{confirmations++;return new Promise<boolean>(resolve=>{release=resolve;});}});
  const first=r.lifecycle.requestExit(true),second=r.lifecycle.requestExit();assert.equal(first,second);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(confirmations,1);release(true);
  assert.equal(await first,true);assert.deepEqual(r.calls,["restart"]);
});
test("tray failure keeps window reachable and uses guarded quit; failed confirmation can be retried",async()=>{
  let fail=true;const r=rig({canHide:()=>false,activity:async()=>({busy:true}),confirmExit:async()=>{if(fail)throw Error("dialog unavailable");return true;}});
  assert.equal(r.lifecycle.closeWindow(),true);await new Promise(resolve=>setImmediate(resolve));assert.equal(r.lifecycle.quitting,false);
  fail=false;assert.equal(await r.lifecycle.requestExit(),true);assert.deepEqual(r.calls,["exit"]);
});
test("system session end permits shutdown without hiding or prompting",()=>{
  const r=rig();r.lifecycle.endSession();assert.equal(r.lifecycle.closeWindow(),false);assert.equal(r.lifecycle.quitting,true);assert.deepEqual(r.calls,[]);
});

test("the saved close preference applies immediately, repeated closes share its lookup and failures keep background behavior",async()=>{
 let action:"background"|"exit"="background";let reads=0;
 const r=rig({closeAction:async()=>{reads++;return action;}});
 assert.equal(r.lifecycle.closeWindow(),true);assert.equal(r.lifecycle.closeWindow(),true);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(reads,1);assert.deepEqual(r.calls,["hide","explain"]);
 action="exit";r.lifecycle.closeWindow();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(r.calls,["hide","explain","exit"]);
 const fallback=rig({closeAction:async()=>{throw Error("offline");}});fallback.lifecycle.closeWindow();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(fallback.calls,["hide","explain"]);
});

test("OS session ending during preference read cannot later hide the shutting down window",async()=>{
 let release!:(action:"background")=>void;
 const r=rig({closeAction:()=>new Promise(resolve=>{release=resolve;})});r.lifecycle.closeWindow();r.lifecycle.endSession();release("background");
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(r.calls,[]);
});

test("notification failure does not interrupt background work; a failed hide uses guarded exit",async()=>{
 const notification=rig({explainBackground:()=>{throw Error("Notifications disabled");}});
 assert.equal(notification.lifecycle.closeWindow(),true);assert.equal(notification.lifecycle.closeWindow(),true);
 assert.deepEqual(notification.calls,["hide","hide"]);assert.equal(notification.lifecycle.quitting,false);
 const hidden=rig({closeAction:async()=>"background",hide:()=>{throw Error("Window unavailable");}});
 hidden.lifecycle.closeWindow();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(hidden.calls,["exit"]);
});

test("OS shutdown during an exit check cannot later prompt or schedule a relaunch",async()=>{
 let release!:(value:{busy:boolean})=>void;
 const r=rig({activity:()=>new Promise(resolve=>{release=resolve;})});
 const pending=r.lifecycle.requestExit(true);r.lifecycle.endSession();release({busy:true});
 assert.equal(await pending,true);assert.deepEqual(r.calls,[]);
 let confirm!:(approved:boolean)=>void;
 const dialog=rig({activity:async()=>({busy:true}),confirmExit:()=>new Promise(resolve=>{confirm=resolve;})});
 const choice=dialog.lifecycle.requestExit(true);await new Promise(resolve=>setImmediate(resolve));
 dialog.lifecycle.endSession();confirm(true);assert.equal(await choice,true);assert.deepEqual(dialog.calls,[]);
});
