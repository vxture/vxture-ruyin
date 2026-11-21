/** Platform launch metadata and independent local-package supply. */
import type { PublicProduct, RegistryCatalog, RegistryItem, SubscribedProduct } from "./api";

/** Filter before limiting: a subscribed candidate must not consume a recommendation slot. */
export function recommendedAgents(rows:PublicProduct[],excluded:Iterable<string>):PublicProduct[]{
  const seen=new Set(excluded),result:PublicProduct[]=[];
  for(const row of rows){
    if(seen.has(row.productCode)||!(row.productType==="agent"||row.productType.endsWith("_agent"))||!['stable','beta'].includes(row.releaseStage??''))continue;
    seen.add(row.productCode);result.push(row);if(result.length===3)break;
  }
  return result;
}

export const RUYIN_WEB_URL = "https://ruyin.work";

/** Compact presentation only; never replace the platform's commercial tier value. */
export function tierAbbreviation(value: string): string {
  const tier = value.trim().toLowerCase();
  const labels: Record<string, string> = {
    free: "FREE", starter: "STRT", pro: "PRO", biz: "BIZ", ent: "ENT",
    business: "BIZ", team: "BIZ", enterprise: "ENT",
  };
  return labels[tier] ?? value.trim().toUpperCase().slice(0, 4);
}

/** Addresses belong to the product registry, never to a product-code template. */
export function productHomeUrl(value?: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return undefined;
    return url.href;
  } catch { return undefined; }
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split("."), pb = b.split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = Number.parseInt(pa[i] ?? "0", 10) || 0;
    const nb = Number.parseInt(pb[i] ?? "0", 10) || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

/** A subscription history is not a list of distinct applications. */
export function agentSubscriptions(rows: SubscribedProduct[]): Array<SubscribedProduct & {productCode: string}> {
  const byCode = new Map<string, SubscribedProduct & {productCode: string}>();
  const rank = (status: string) => ["active", "trial", "trialing"].includes(status) ? 2 : status === "expired" ? 0 : 1;
  for (const row of rows) {
    if (!row.productCode) continue;
    const old = byCode.get(row.productCode);
    if (!old || rank(row.status) > rank(old.status)) byCode.set(row.productCode, {...row,productCode:row.productCode});
  }
  return [...byCode.values()];
}

/** A published package is evidence of local supply, independent of a web URL. */
export function packageFor(catalog: RegistryCatalog | null, id: string): RegistryItem | undefined {
  if (catalog?.status !== "ok") return undefined;
  return catalog.items.filter(item => item.id === id).sort((a,b) => compareVersions(a.version,b.version)).pop();
}
