import { expect, test } from "vitest";
import { agentSubscriptions, compareVersions, packageFor, productHomeUrl, recommendedAgents, RUYIN_WEB_URL, tierAbbreviation } from "./agent-catalog";
import type { PublicProduct, RegistryCatalog, RegistryItem, SubscribedProduct } from "./api";

test("recommendations exclude owned/duplicate/non-agent/unavailable entries before filling three slots in platform order",()=>{
 const row=(productCode:string,productType="agent",releaseStage:string|null="stable")=>({productCode,productType,releaseStage}) as PublicProduct;
 const rows=[row("owned"),row("platform","general_platform"),row("preview","agent","preview"),row("sunset","agent","sunset"),row("unknown","agent",null),row("next","general_agent"),row("next"),row("third","industry_agent","beta"),row("fourth"),row("fifth")];
 expect(recommendedAgents(rows,["owned"]).map(r=>r.productCode)).toEqual(["next","third","fourth"]);
 expect(recommendedAgents(rows,["owned","next","third","fourth","fifth"])).toEqual([]);
});

test("tier abbreviations are short presentation labels, with a bounded fallback for new tiers", () => {
  for (const [value,label] of Object.entries({free:"FREE",starter:"STRT",pro:"PRO",biz:"BIZ",ent:"ENT",business:"BIZ",enterprise:"ENT",team:"BIZ"," Future ":"FUTU"})) {
    expect(tierAbbreviation(value)).toBe(label);
    expect(label.length).toBeGreaterThanOrEqual(3);expect(label.length).toBeLessThanOrEqual(4);
  }
});

test("online launch uses explicit HTTP addresses, never inferred hosts or executable URLs", () => {
  expect(RUYIN_WEB_URL).toBe("https://ruyin.work");
  expect(productHomeUrl("https://cospace.ruyin.work/build")).toBe("https://cospace.ruyin.work/build");
  expect(productHomeUrl("http://localhost:7420/")).toBe("http://localhost:7420/");
  for (const value of [undefined, null, "", "/relative", "invalid", "javascript:alert(1)", "file:///C:/secret", "https://name:password@example.com", "https://name@example.com"]) {
    expect(productHomeUrl(value)).toBeUndefined();
  }
});

test("subscription history produces one card per product, favoring active then pending then expired", () => {
  const row = (productCode: string | null, status: string, label: string) => ({ productCode, status, productName: label }) as SubscribedProduct;
  expect(agentSubscriptions([
    row(null,"active","missing"), row("a","expired","old"), row("a","pending","pending"),
    row("a","trialing","current"), row("a","active","same rank"), row("b","expired","other"),
    row("c","trial","trial"), row("d","active","active"),
  ]).map(r=>r.productName)).toEqual(["current","other","trial","active"]);
  expect(agentSubscriptions([])).toEqual([]);
});

test("latest matching published package determines local supply; web metadata cannot create a package", () => {
  const item=(id:string, version:string)=>({id,version}) as RegistryItem;
  const catalog={status:"ok",items:[item("a","1.2.0"),item("b","99.0.0"),item("a","1.10.0")]} as RegistryCatalog;
  expect(packageFor(catalog,"a")?.version).toBe("1.10.0");
  expect(packageFor(catalog,"missing")).toBeUndefined();
  expect(packageFor(null,"a")).toBeUndefined();
  expect(packageFor({status:"unreachable"} as RegistryCatalog,"a")).toBeUndefined();
  expect(compareVersions("1","1.0.0")).toBe(0);
  expect(compareVersions("1.0","1.0.1")).toBeLessThan(0);
  expect(compareVersions("1.x","1.0")).toBe(0);
  expect(compareVersions("1.0.1","1")).toBeGreaterThan(0);
});
