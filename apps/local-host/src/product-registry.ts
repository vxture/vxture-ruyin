/**
 * Product registry - the runtime's managed view of installed business products
 * (design authority: docs/30-design/30-contract-schema.md section 18).
 *
 * ruyin 是客户端工作 runtime：产品**属于 Vxture SaaS**，运行环境属于 ruyin。
 * 因此「本地装了」与「现在能不能打开」是两件事：
 *
 *   installed  契约在本地且校验通过
 *   state      本机生效态 active / inactive（可停用而不卸载）
 *   entitled   平台订阅允许 —— true / false / null(未知)
 *   available  = installed ∧ state=active ∧ entitled ≠ false
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
import { compareVersions, listStored } from "./installer.js";
import { sourceOf } from "./contract-fetch.js";

/** 平台订阅对某产品的判定；null = 未知（未登录 / 订阅面未接通）。 */
export type Entitled = boolean | null;

/**
 * C2 信封里与订阅有关的事实，原样保留（TD-014 D4）。
 *
 * **压成布尔会丢掉四种互不相同的处境**，而它们各自对应不同的行动入口：
 *
 *   status: null                      从未订阅   → 首购  intent=subscribe
 *   expired / cancelled / suspended   曾有已失效 → 续费  intent=renew
 *   trialing                          试用中     → 显示 trial_ends_at
 *   active + cancelAtPeriodEnd        已计划失效 → 提示到期日
 *
 * 压扁之后这四种全变成「否」，界面**永远显示同一个错的入口**——该引导首购的
 * 地方显示续费，或者反过来。
 *
 * **不含 limits / quota_pools**：配额归 SaaS，Ruyin 不读、不执行、不展示
 * （ADR-006）。把它们放进来，下一个人就会想去用。
 */
export interface SubscriptionFacts {
  status: string | null;
  tier: string | null;
  bundled: boolean;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

/** 曾经有过、现在失效了的状态——这些该引导续费，不是首购。 */
const LAPSED = new Set(["expired", "cancelled", "canceled", "suspended"]);

/**
 * 该给用户哪个商业入口，或者不给。
 *
 * **界面门控与数据面门控是两个公式**，这是 D4 的另一半：
 *
 *   数据面（能不能打开）  tier != null || bundled
 *   界面（显不显示入口）  tier != null
 *
 * 混用后果落在**被捆绑组件覆盖的产品**上：它没有独立 tier，本不该显示商业
 * 入口，却因为数据面公式为真而按「有权益」渲染——用户看到一个不该给他的
 * 订阅动作。
 */
export function commercialIntent(
  facts: SubscriptionFacts | null,
): "subscribe" | "renew" | null {
  // 未知不是「没有」：未登录 / 订阅面未接通时不猜，也就不显示任何入口。
  if (!facts) return null;
  // 捆绑覆盖且无独立 tier —— 有权益，但没有属于他的商业动作。
  if (facts.tier === null && facts.bundled) return null;
  if (facts.status && LAPSED.has(facts.status)) return "renew";
  if (facts.tier !== null) return null; // 已订阅且在有效期内
  return "subscribe";
}

export type Availability = "available" | "disabled" | "not_entitled";

/**
 * 为什么打不开。not_installed 不进 Availability —— 那是产品资产视图的取值，
 * 而没装的产品根本不在那份列表里。
 */
export interface BlockedReason {
  availability: "not_installed" | "disabled" | "not_entitled";
  reason: string;
}

export interface ProductView {
  id: string;
  name: string;
  version: string;
  installed: true;
  /**
   * 是否在本机生效（通则 B-3：单一字段名 state，字符串枚举）。
   *
   * **不用布尔**，理由通则写得很直白：布尔装不下真实存在的中间态——
   * 比如 deprecated（仍可解析、不再推荐）不是 true/false 能表达的。
   * 最小词表 active / inactive，需要时往里加，不必改字段类型。
   */
  state: "active" | "inactive";
  entitled: Entitled;
  /** C2 信封的订阅事实；null = 未知。界面据此选行动入口。 */
  subscription: SubscriptionFacts | null;
  /** 该显示哪个商业入口，或 null = 不显示。见 commercialIntent。 */
  commercialIntent: "subscribe" | "renew" | null;
  availability: Availability;
  /** 不可用时的人可读原因；可用时缺省。 */
  reason?: string;
  /** 库中并存的全部版本（§18.4 保留旧版本用于回滚）；内置产品为单版本。 */
  versions: string[];
  /** true = 来自受管产品库（拉取或安装）；false = 内置/开发目录。 */
  managed: boolean;
  /**
   * 当前生效版本是怎么来的（ADR-012 两级供给）。两级都落在同一个库里，但
   * 「拉了一份契约」与「装了一个含本地技能的包」在信任上不是一回事，界面与
   * 审计都需要分得开。
   */
  supply: "contract_fetch" | "package" | "builtin";
}

/**
 * 解析某产品的订阅事实。抛错或返回 null 一律按「未知」处理。
 *
 * **交回信封而不是布尔**（D4）：由这一层压扁，界面就再也拿不到它需要的事实。
 */
export type EntitlementResolver = (
  productIds: string[],
) =>
  | Promise<Record<string, SubscriptionFacts> | null>
  | Record<string, SubscriptionFacts>
  | null;

interface PersistedState {
  /** productId -> enabled；缺省视为 true（装了就启用）。 */
  disabled?: string[];
  /** productId -> 当前生效版本；缺省取库中最高版本（§18.4 切换 / 回滚）。 */
  active?: Record<string, string>;
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
    // §18.5：退订 / 宽限期外 —— 不可打开，数据仍可访问。
    return {
      availability: "not_entitled",
      // 导出已落地（TD-020），所以这句话可以说全了 —— 它恰好显示在用户最会
      // 去找导出的那一刻：订阅失效、产品锁住时。
      reason: "平台订阅未覆盖此产品；本地数据仍可访问、可导出",
    };
  }
  return { availability: "available" };
}

export class ProductRegistry {
  private scan: ProductScan;
  /** productId -> 库中全部已装版本（升序）。 */
  private storeVersions = new Map<string, string[]>();
  private disabled: Set<string>;
  private active: Record<string, string>;
  private entitlements = new Map<string, SubscriptionFacts>();
  private readonly statePath: string;
  /** 受管产品库根目录：<dataDir>/products。 */
  readonly storeDir: string;

  constructor(
    private readonly productsDir: string,
    dataDir: string,
  ) {
    const dir = join(dataDir, "runtime");
    mkdirSync(dir, { recursive: true });
    this.statePath = join(dir, STATE_FILE);
    this.storeDir = join(dataDir, "products");
    const state = this.restore();
    this.disabled = new Set(state.disabled ?? []);
    this.active = state.active ?? {};
    this.scan = { loaded: [], failed: [] };
    this.rescan();
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
      JSON.stringify(
        { disabled: [...this.disabled], active: this.active },
        null,
        2,
      ),
      "utf8",
    );
  }

  /**
   * 重新扫描：受管库（.ruyinpkg 安装，版本化）优先于内置/开发目录 —— 用户装的
   * 版本应当盖过随包内置的示例。安装/卸载/切版本后调用。
   */
  rescan(): void {
    const dev = loadProducts(this.productsDir);
    this.storeVersions.clear();

    const stored = listStored(this.storeDir);
    for (const s of stored) {
      const list = this.storeVersions.get(s.productId) ?? [];
      list.push(s.version);
      this.storeVersions.set(s.productId, list);
    }
    for (const list of this.storeVersions.values()) list.sort(compareVersions);

    const managed: LoadedProduct[] = [];
    const failed = [...dev.failed];
    for (const [productId, versions] of this.storeVersions) {
      const chosen = this.activeVersionOf(productId, versions);
      const dir = join(this.storeDir, productId, chosen);
      // 复用同一套解析 + R 系列校验：库里的产品与开发目录同等对待。
      const one = loadProducts(join(dir, ".."));
      const hit = one.loaded.find(
        (p) => p.id === productId && p.version === chosen,
      );
      if (hit) managed.push(hit);
      else failed.push(...one.failed);
    }

    const managedIds = new Set(managed.map((p) => p.id));
    this.scan = {
      loaded: [...managed, ...dev.loaded.filter((p) => !managedIds.has(p.id))],
      failed,
    };
  }

  private activeVersionOf(productId: string, versions: string[]): string {
    const pinned = this.active[productId];
    if (pinned && versions.includes(pinned)) return pinned;
    return versions[versions.length - 1]!; // 缺省取最高版本
  }

  /** 切换生效版本（§18.4：回滚 = 切回保留的旧版本）。 */
  activate(productId: string, version: string): void {
    const versions = this.storeVersions.get(productId);
    if (!versions?.includes(version)) {
      throw new Error(`${productId}@${version} is not installed`);
    }
    this.active[productId] = version;
    this.persist();
    this.rescan();
  }

  versionsOf(productId: string): string[] {
    return this.storeVersions.get(productId) ?? [];
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
      for (const [id, facts] of Object.entries(result)) {
        this.entitlements.set(id, facts);
      }
    } catch {
      // 未知即未知：不写入判定，不锁死用户。
    }
  }

  private factsOf(id: string): SubscriptionFacts | null {
    return this.entitlements.get(id) ?? null;
  }

  /**
   * 数据面门控：能不能打开、能不能新建。
   *
   * 公式是 `tier != null || bundled` —— **与界面门控不是同一个公式**
   * （见 commercialIntent）。未知返回 null，不猜。
   */
  private entitledOf(id: string): Entitled {
    const facts = this.factsOf(id);
    if (!facts) return null;
    return facts.tier !== null || facts.bundled;
  }

  /**
   * 生效版本的来源。拉取的版本目录里带 .source.json；库里没有这个标记的一律是
   * .ruyinpkg 装的——**没有标记就当成包**是刻意的保守方向：把包错报成「只是一份
   * 契约」会让人以为没有本地可执行内容，反过来错报不会造成这种误判。
   */
  private supplyOf(
    id: string,
    version: string,
    inStore: boolean,
  ): ProductView["supply"] {
    if (!inStore) return "builtin";
    const src = sourceOf(join(this.storeDir, id, version));
    return src?.origin === "contract_fetch" ? "contract_fetch" : "package";
  }

  list(): ProductView[] {
    return this.scan.loaded.map((p) => {
      const enabled = !this.disabled.has(p.id);
      const entitled = this.entitledOf(p.id);
      const facts = this.factsOf(p.id);
      const { availability, reason } = availabilityOf(enabled, entitled);
      const versions = this.storeVersions.get(p.id);
      return {
        id: p.id,
        name: p.name,
        version: p.version,
        installed: true as const,
        state: enabled ? "active" : "inactive",
        entitled,
        subscription: facts,
        commercialIntent: commercialIntent(facts),
        availability,
        ...(reason ? { reason } : {}),
        versions: versions ?? [p.version],
        managed: versions !== undefined,
        supply: this.supplyOf(p.id, p.version, versions !== undefined),
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

  /**
   * 打开/新建项目前的准入判定；可用返回 null。
   *
   * **返回结构而不是一句话**：「本机停用」与「平台未订阅」在通则 X-1 里是两个
   * 不同的拒绝码（POLICY_DENIED / NOT_ENTITLED），混成一个字符串，调用方就只能
   * 显示同一个行动入口 —— 该引导首购的地方显示续费，或者反过来。这是通则
   * 「十个坑」的第二条。
   */
  blockedReason(id: string): BlockedReason | null {
    const p = this.find(id);
    // 未安装也算「挡住」。返回 null 会让下一个忘了先 find 的调用方拿到「没挡」——
    // 一道只在某一个调用点成立的护栏，不是护栏。
    if (!p) return { availability: "not_installed", reason: "产品未安装" };
    const enabled = !this.disabled.has(id);
    const { availability, reason } = availabilityOf(enabled, this.entitledOf(id));
    if (availability === "available") return null;
    return { availability, reason: reason ?? "产品当前不可用" };
  }

  /**
   * 切换本机生效态（通则 B-3：二元开关必须提供 activate / deactivate）。
   */
  setActive(id: string, active: boolean): void {
    if (!this.find(id)) throw new Error(`product not installed: ${id}`);
    if (active) this.disabled.delete(id);
    else this.disabled.add(id);
    this.persist();
  }

  contractOf(id: string): RuyinContract | undefined {
    return this.find(id)?.contract;
  }
}
