/** Product navigation is presentation metadata, never an authority or an external URL. */
export interface ProductNavItem {
  id: string; label: string;
  state?: "pending" | "active" | "complete" | "blocked";
  startedAt?: string; completedAt?: string;
}
export function productNavigation(value: unknown): ProductNavItem[] | null {
  if (!Array.isArray(value) || !value.length || value.length > 12) return null;
  const ids = new Set<string>();
  const result: ProductNavItem[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const { id, label } = item as Record<string, unknown>;
    if (typeof id !== "string" || !/^[a-z][a-z0-9-]{0,39}$/.test(id) || ids.has(id)) return null;
    if (typeof label !== "string" || !label.trim() || label.length > 60) return null;
    const { state, startedAt, completedAt } = item as Record<string, unknown>;
    if (state !== undefined && !["pending", "active", "complete", "blocked"].includes(String(state))) return null;
    for (const value of [startedAt, completedAt]) {
      if (value !== undefined && (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value)))) return null;
    }
    if (completedAt && (!startedAt || Date.parse(completedAt as string) < Date.parse(startedAt as string) || state !== "complete")) return null;
    ids.add(id); result.push({ id, label: label.trim(), ...(state ? {state:state as ProductNavItem["state"]} : {}), ...(startedAt ? {startedAt:startedAt as string} : {}), ...(completedAt ? {completedAt:completedAt as string} : {}) });
  }
  return result;
}
export const PRODUCT_NAV_EVENT = "ruyin-product-navigation";
export const PRODUCT_REVIEW_EVENT = "ruyin-product-review";
