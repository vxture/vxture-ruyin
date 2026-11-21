import type { SkillListing } from "./skill-registry.js";
import { skillCapabilityId } from "./capability-catalog.js";
import { verifiedSkillCapability } from "./skill-distribution.js";

/** Match catalog identities without making local overrides impersonate a provider. */
export function withSkillCatalogIdentity(listing: SkillListing): SkillListing {
  return {...listing, items:listing.items.map(skill => {
    const capabilityId = skill.layer === "bundled" ? skillCapabilityId(skill) :
      skill.layer === "distributed" ? verifiedSkillCapability(skill.dir, skill.name) : undefined;
    const {capabilityId: _ignored, ...local} = skill;
    return {...local,...(capabilityId ? {capabilityId} : {})};
  })};
}
