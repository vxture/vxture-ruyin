import test from "node:test";
import assert from "node:assert/strict";
import {ProductDisplayMetadata} from "./product-display-metadata.js";

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status});
test("public description and hosted logo enrichment retains entitlement fields and sends no session",async t=>{
 let reads=0;
 t.mock.method(globalThis,"fetch",async(url:URL,init:RequestInit)=>{
  reads++;assert.equal(url.href,"https://website.test/api/products/catalog");
  assert.deepEqual(init.headers,{accept:"application/json"});assert.equal(init.credentials,"omit");assert.equal(init.redirect,"error");
  return json([{productCode:"agent",description:"真实产品说明",iconUrl:"https://cdn.test/old.png"},null,{productCode:1}]);
 });
 const source={productCode:"agent",tier:"free",status:"expired",iconVersion:"new version",homeUrl:"https://agent.test/"};
 const display=new ProductDisplayMetadata("https://website.test","https://console.test");
 assert.deepEqual(await display.enrich([source,null,{},"bad"]),[{...source,description:"真实产品说明",iconUrl:"https://console.test/api/applications/agent/icon?v=new%20version"},null,{},"bad"]);
 assert.equal(source.status,"expired");await display.enrich([source]);assert.equal(reads,1);
});
test("safe catalog failure never removes subscriptions or hosted logo metadata",async t=>{
 const source={productCode:"agent",iconVersion:"version",status:"active"};
 for(const reply of [()=>json({},503),()=>json({not:"list"}),()=>new Response("invalid"),()=>new Response("x".repeat(1024*1024+1)),()=>{throw Error("offline");}]){
  t.mock.method(globalThis,"fetch",reply);
  assert.deepEqual(await new ProductDisplayMetadata("https://website.test","https://console.test").enrich([source]),[{...source,iconUrl:"https://console.test/api/applications/agent/icon?v=version"}]);
 }
});
test("external catalog logo is a fallback; subscription logo stays authoritative and catalog refreshes",async t=>{
 let reads=0,now=0;t.mock.method(Date,"now",()=>now);
 t.mock.method(globalThis,"fetch",async()=>{reads++;return json([{productCode:"a",iconUrl:"https://cdn.test/a.png"},{productCode:"b",description:"new"}]);});
 const display=new ProductDisplayMetadata("https://website.test","https://console.test");
 assert.deepEqual(await display.enrich([{productCode:"a"},{productCode:"b",iconUrl:"https://own.test/b.png"},{productCode:"c"}]),[
  {productCode:"a",iconUrl:"https://cdn.test/a.png"},{productCode:"b",iconUrl:"https://own.test/b.png",description:"new"},{productCode:"c"}]);
 now=60_001;await display.enrich([]);assert.equal(reads,2);
});

test("catalog projects only public display fields, shares the enrichment cache and refreshes after 60 seconds",async t=>{
 let now=0,reads=0;t.mock.method(Date,"now",()=>now);
 t.mock.method(globalThis,"fetch",async()=>{reads++;return json([
  {productCode:"a",productName:"Agent",productType:"general_agent",productNick:"A",description:"x".repeat(10001),iconUrl:"https://cdn.test/a.png",iconVersion:"1",releaseVersion:"2.0",releaseStage:"stable",privateField:"not projected"},
  {productCode:"b",productName:"Other",productType:"service",description:3},
  {productCode:"invalid",productName:1,productType:"agent"},null,
 ]);});
 const display=new ProductDisplayMetadata("https://website.test","https://console.test");
 const rows=await display.catalog();assert.equal(rows.length,2);
 assert.deepEqual(rows[0],{productCode:"a",productName:"Agent",productType:"general_agent",productNick:"A",description:"x".repeat(10000),iconUrl:"https://cdn.test/a.png",iconVersion:"1",releaseVersion:"2.0",releaseStage:"stable"});
 assert.deepEqual(rows[1],{productCode:"b",productName:"Other",productType:"service",productNick:null,description:null,iconUrl:null,iconVersion:null,releaseVersion:null,releaseStage:null});
 await display.enrich([{productCode:"a"}]);assert.equal(reads,1);
 now=60_001;await display.catalog();assert.equal(reads,2);
});

test("catalog failure is explicit while expired metadata can still enrich valid subscriptions",async t=>{
 let now=0,offline=false;t.mock.method(Date,"now",()=>now);
 t.mock.method(globalThis,"fetch",async()=>{if(offline)throw Error("offline");return json([{productCode:"a",productName:"Agent",productType:"agent",description:"saved display"}]);});
 const display=new ProductDisplayMetadata("https://website.test","https://console.test");
 await display.catalog();now=60_001;offline=true;await assert.rejects(display.catalog(),/offline/);
 assert.deepEqual(await display.enrich([{productCode:"a",status:"active"}]),[{productCode:"a",status:"active",description:"saved display"}]);
});
