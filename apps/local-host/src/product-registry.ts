/**
 * Product registry - the runtime's managed view of installed business products
 * (design authority: docs/30-design/30-contract-schema.md section 18).
 *
 * ruyin 是客户端工作 runtime：产品**属于 Vxture SaaS**，运行环境属于 ruyin。
 * 因此「本地装了」与「现在能不能打开」是两件事：
 *
 *   installed  契约在本地且校验通过
 *   enabled    用户在本机启用（可停用而不卸载）
 *   entitled   平台订阅允许 —— true / false / null(未知)
 *   available  = installed ∧ enabled ∧ entitled ≠ false
 *
 * §18.5 的硬规则：退订 / 宽限期外 → 产品不可打开，**但本地数据始终可访问、
 * 可导出**（数据主权底线，与 40-context §9.2 一致）。所以「不可用」只挡打开与
 * 新建，不挡读取与导出。
 *
 * entitled 为 null（未登录，或订阅数据面尚未接通 —— liaison L3-b）时按可用处理：
 * §18.5 锁死的前提是**明确知道**已退订；不能因为 runtime 自己查不到就锁住用户的
 * 产品。UI 侧据此如实标注状态，不虚构订阅。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { RuyinContract } from "@vxture/ruyin-contract-schema";
import { loadProducts, type LoadedProduct, type ProductScan } from "./products.js";

/** 平台订阅对某产品的判定；null = 未知（未登录 / 订阅面未接通）。 */
export type Entitled = boolean | null;

export type Availability = "available" | "disabled" | "not_entitled";

export interface ProductView {
  id: string;
  name: string;
  version: string;
  installed: true;
  enabled: boolean;
  entitled: Entitled;
  availability: Availability;
  /** 不可用时的人可读原因；可用时缺省。 */
  reason?: string;
}

/** 解析某产品的订阅状态。抛错或返回 null 一律按「未知」处理。 */
export type EntitlementResolver = (
  productIds: string[],
) =>
  | Promise<Record<string, boolean> | null>
  | Record<string, boolean>
  | null;

interface PersistedState {
  /** productId -> enabled；缺省视为 true（装了就启用）。 */
  disabled?: string[];
}

const STATE_FILE = "products.state.json";

export function availabilityOf(
  enabled: boolean,
  entitled: Entitled,
): { availability: Availability; reason?: string } {
  if (!enabled) {
    return { availability: "disabled", reason: "已在本机停用" };
  }
  if (entitled === false) {
    // §18.5：退订 / 宽限期外 —— 不可打开，数据仍可访问可导出。
    return {
      availability: "not_entitled",
      reason: "平台订阅未覆盖此产品；本地数据仍可访问与导出",
    };
  }
  return { availability: "available" };
}

export class ProductRegistry {
  private scan: ProductScan;
  private disabled: Set<string>;
  private entitlements = new Map<string, boolean>();
  private readonly statePath: string;

  constructor(
    private readonly productsDir: string,
    dataDir: string,
  ) {
    const dir = join(dataDir, "runtime");
    mkdirSync(dir, { recursive: true });
    this.statePath = join(dir, STATE_FILE);
    this.scan = loadProducts(productsDir);
    this.disabled = new Set(this.restore().disabled ?? []);
  }

  private restore(): PersistedState {
    if (!existsSync(this.statePath)) return {};
    try {
      return JSON.parse(readFileSync(this.statePath, "utf8")) as PersistedState;
    } catch {
      return {};
    }
  }

  private persist(): void {
    writeFileSync(
      this.statePath,
      JSON.stringify({ disabled: [...this.disabled] }, null, 2),
    );
  }

  /** 重新扫描本地产品目录（安装/卸载后调用）。 */
  rescan(): void {
    this.scan = loadProducts(this.productsDir);
  }

  /** 契约校验失败的产品（启动日志与运维面用）。 */
  get failures() {
    return this.scan.failed;
  }

  /** 刷新订阅判定；resolver 返回 null 或抛错 => 保持「未知」。 */
  async refreshEntitlements(resolve: EntitlementResolver): Promise<void> {
    const ids = this.scan.loaded.map((p) => p.id);
    if (ids.length === 0) return;
    try {
      const result = await resolve(ids);
      if (!result) return;
      this.entitlements.clear();
      for (const [id, ok] of Object.entries(result)) {
        this.entitlements.set(id, ok);
      }
    } catch {
      // 未知即未知：不写入判定，不锁死用户。
    }
  }

  private entitledOf(id: string): Entitled {
    return this.entitlements.has(id) ? this.entitlements.get(id)! : null;
  }

  list(): ProductView[] {
    return this.scan.loaded.map((p) => {
      const enabled = !this.disabled.has(p.id);
      const entitled = this.entitledOf(p.id);
      const { availability, reason } = availabilityOf(enabled, entitled);
      return {
        id: p.id,
        name: p.name,
        version: p.version,
        installed: true as const,
        enabled,
        entitled,
        availability,
        ...(reason ? { reason } : {}),
      };
    });
  }

  /** 已安装的产品记录（含契约），不含可用性判定。 */
  installed(): LoadedProduct[] {
    return this.scan.loaded;
  }

  find(id: string): LoadedProduct | undefined {
    return this.scan.loaded.find((p) => p.id === id);
  }

  /** 打开/新建工作空间前的准入判定；不可用时返回原因，可用返回 null。 */
  blockedReason(id: string): string | null {
    const p = this.find(id);
    if (!p) return "产品未安装";
    const enabled = !this.disabled.has(id);
    const { availability, reason } = availabilityOf(enabled, this.entitledOf(id));
    return availability === "available" ? null : (reason ?? "产品当前不可用");
  }

  setEnabled(id: string, enabled: boolean): void {
    if (!this.find(id)) throw new Error(`product not installed: ${id}`);
    if (enabled) this.disabled.delete(id);
    else this.disabled.add(id);
    this.persist();
  }

  contractOf(id: string): RuyinContract | undefined {
    return this.find(id)?.contract;
  }
}
