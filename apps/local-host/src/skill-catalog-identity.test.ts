import assert from "node:assert/strict";
import test from "node:test";
import {mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {withSkillCatalogIdentity} from "./skill-catalog-identity.js";
import type {SkillView} from "./skill-registry.js";
const skill=(over:Partial<SkillView>={}):SkillView=>({name:"report",source:"vendor.repo",layer:"bundled",description:"report",enabled:false,hasScripts:true,dir:"none",...over});
test("catalog identity is additive metadata, never inferred for user/project overrides or unverified deliveries",()=>{
 const listing={items:[skill(),skill({layer:"user",capabilityId:"forged.report"}),skill({layer:"project"}),skill({layer:"distributed"})],layers:[],scannedAt:"now"};
 const value=withSkillCatalogIdentity(listing);
 assert.equal(value.items[0]?.capabilityId,"vendor.report");
 assert.equal(value.items[0]?.enabled,false);assert.equal(value.items[0]?.hasScripts,true);
 assert.ok(value.items.slice(1).every(s=>s.capabilityId===undefined));
 assert.equal(listing.items[1]?.capabilityId,"forged.report","projection must not mutate input");
});
test("distributed catalog identity uses the already verified installation receipt",()=>{
 const dir=mkdtempSync(join(tmpdir(),"ruyin-skill-identity-"));
 try{
  const receipt={name:"report",capabilityId:"provider.report",version:"1.0.0",deliveryIntegrity:"verified",requiresScripts:false,deliveryDigest:"a".repeat(64)};
  writeFileSync(join(dir,".ruyin-skill.json"),JSON.stringify(receipt));
  const listing={items:[skill({layer:"distributed",dir,hasScripts:false})],layers:[],scannedAt:"now"};
  assert.equal(withSkillCatalogIdentity(listing).items[0]?.capabilityId,"provider.report");
  writeFileSync(join(dir,".ruyin-skill.json"),JSON.stringify({...receipt,deliveryIntegrity:"unverified"}));
  assert.equal(withSkillCatalogIdentity(listing).items[0]?.capabilityId,undefined);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
