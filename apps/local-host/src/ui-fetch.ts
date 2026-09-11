/**
 * 产品界面包的取回与落盘（ADR-023 片 3b-2）。
 *
 * 契约只钉一个摘要（`product.ui.sha256`），不钉地址。界面包从产品自己的能力面
 * **按摘要**取回 —— 与契约拉取同一个主机、同一个凭据、同一个运行时设置，没有扩大
 * 信任面：
 *
 *   GET {能力面基址}/products/{productId}/ui/{sha256}
 *
 * 管线（**顺序即安全顺序**）：
 *
 *   取回 → 尺寸上限 → sha256 与契约一致 → zip 护栏解包 → 入口存在 → 按摘要原子落盘
 *
 * - **尺寸上限先于一切**：边收边计数，超了当场断开，不先收完再说；
 * - **摘要校验先于解包**：摘要对不上的字节一个都不解开。解包是这条线上最危险的
 *   一步，只对已经确认是契约所钉的那份字节做；
 * - **解包复用 `pkg.ts` 的护栏**，不写第二份（那边的注释：复制出来的护栏会各自
 *   漂移）。上限比产品包更紧；
 * - **先解到暂存目录、整体 rename**：半截的目录永远不会被当成可用。
 *
 * **按摘要寻址**意味着：目录在 = 当初校验过。同一个摘要永远是同一份字节，所以
 * 在就不再取、也不重算 —— §18.3 那条「同版本内容变了」的难题在这里不存在。
 *
 * **失败 = 这个产品暂时没有界面，不是错误状态**（ADR-023 §2）。这里的函数**从不
 * 抛错**，一律返回带原因的结果：界面是可选的，它出任何问题都不该连累契约拉取
 * 那条主线 —— 契约已经落盘了，产品照常可用。
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseContract, type RuyinContract } from "@vxture/ruyin-contract-schema";
import { MANIFEST_ENTRY, type FetchOutcome } from "./contract-fetch.js";
import { readPackage, type ZipLimits } from "./pkg.js";

/** 产品库里放界面包的那一层：`<storeDir>/<productId>/ui/<sha256>/`。 */
export const UI_DIR = "ui";
/** 入口固定，不开配置项（ADR-023 §3.1）。 */
export const UI_ENTRY = "index.html";

/**
 * 下载上限。界面包是静态网页资源，32 MiB 已经很宽 —— 远大于这个量级的，多半是把
 * 不该进界面包的东西（模型、数据集）塞了进去。
 */
export const MAX_UI_BUNDLE_BYTES = 32 * 1024 * 1024;

/** 解包上限，比产品包（`PACKAGE_LIMITS`）紧：压缩比再高也解不出 64 MiB 以上。 */
export const UI_ZIP_LIMITS: ZipLimits = {
  maxEntries: 2048,
  maxEntryBytes: 16 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
};

const DIGEST = /^[0-9a-f]{64}$/;
const PRODUCT_SEGMENT = /^[A-Za-z0-9._-]{1,128}$/;

export type UiUnavailableReason =
  /** 取不回（离线、超时、非 2xx）。等会儿再试可能就好。 */
  | "unreachable"
  /** 超过下载上限。再试一次还是这么大。 */
  | "too_large"
  /** 取回的字节与契约钉的摘要不符。再试一次还是同一串字节。 */
  | "digest_mismatch"
  /** 摘要对上了，但包本身不合规（护栏拒、没有 index.html）。 */
  | "invalid_bundle";

export type UiFetchOutcome =
  /** 契约没有声明界面 —— 缺省，不是缺陷。 */
  | { status: "none"; productId: string }
  /** 本地已有这份（按摘要寻址：在 = 校验过），没有发请求。 */
  | { status: "present"; productId: string; sha256: string; dir: string }
  /** 刚取回、校验、落盘。 */
  | { status: "fetched"; productId: string; sha256: string; dir: string }
  /** 这个产品暂时没有界面；契约不受影响。 */
  | { status: "unavailable"; productId: string; sha256: string; reason: UiUnavailableReason; detail: string };

export interface UiFetchOptions {
  /** 产品能力面基址，与契约拉取、能力调用同一个设置。 */
  baseUrl: string;
  token?: (() => Promise<string | undefined>) | undefined;
  /** 产品库根目录，通常 <dataDir>/products。 */
  storeDir: string;
  timeoutMs?: number;
  /** 注入以便测试；缺省用全局 fetch。 */
  fetchImpl?: typeof fetch;
  /** 注入以便测试；缺省 `MAX_UI_BUNDLE_BYTES`。 */
  maxBytes?: number;
}

/** 某份界面包落盘后的目录。调用方先确认过 productId 与摘要的形状。 */
export function uiBundleDir(storeDir: string, productId: string, sha256: string): string {
  return join(storeDir, productId, UI_DIR, sha256);
}

/** 这份界面包在不在本机。按摘要寻址：目录与入口都在 = 当初校验过。 */
export function hasUiBundle(storeDir: string, productId: string, sha256: string): boolean {
  if (!PRODUCT_SEGMENT.test(productId) || !DIGEST.test(sha256)) return false;
  return existsSync(join(uiBundleDir(storeDir, productId, sha256), UI_ENTRY));
}

/**
 * 按契约取回这个产品的界面包。**从不抛错**（见文件头）。
 */
export async function fetchUiBundle(contract: RuyinContract, opts: UiFetchOptions): Promise<UiFetchOutcome> {
  const productId = contract.product.id;
  const pinned = contract.product.ui?.sha256;
  if (pinned === undefined) return { status: "none", productId };

  const unavailable = (reason: UiUnavailableReason, detail: string): UiFetchOutcome => ({
    status: "unavailable",
    productId,
    sha256: pinned,
    reason,
    detail,
  });

  // 契约校验已经管过这两样；这里再查一遍，是因为它们马上要进文件路径与 URL ——
  // 不让「上游已经校验过」成为这一站不设防的理由。
  if (!PRODUCT_SEGMENT.test(productId) || productId === "." || productId === "..") {
    return unavailable("invalid_bundle", `illegal product id for filesystem use: ${productId}`);
  }
  if (!DIGEST.test(pinned)) {
    return unavailable("invalid_bundle", `pinned digest is not 64 lowercase hex: ${pinned}`);
  }

  const dir = uiBundleDir(opts.storeDir, productId, pinned);
  if (existsSync(join(dir, UI_ENTRY))) return { status: "present", productId, sha256: pinned, dir };

  // ---- 取回 + 尺寸上限 -------------------------------------------------------
  const maxBytes = opts.maxBytes ?? MAX_UI_BUNDLE_BYTES;
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/products/${encodeURIComponent(productId)}/ui/${pinned}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
  let bytes: Buffer;
  try {
    const token = await opts.token?.();
    const res = await (opts.fetchImpl ?? fetch)(url, {
      signal: controller.signal,
      headers: {
        accept: "application/zip",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return unavailable("unreachable", `ui endpoint returned HTTP ${res.status}`);
    }
    // 声明的长度已经超了就不必开始收。**只是提前量，不是依据** —— 头可以撒谎，
    // 真正的上限是下面边收边数的那一个。
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await res.body?.cancel().catch(() => {});
      return unavailable("too_large", `ui bundle declares ${declared} bytes, limit is ${maxBytes}`);
    }
    const read = await readCapped(res, maxBytes);
    if (read === "too_large") {
      controller.abort();
      return unavailable("too_large", `ui bundle exceeds ${maxBytes} bytes`);
    }
    bytes = read;
  } catch (cause) {
    return unavailable("unreachable", `ui endpoint unreachable: ${cause instanceof Error ? cause.message : String(cause)}`);
  } finally {
    clearTimeout(timer);
  }

  // ---- 摘要：对不上的字节一个都不解开 ---------------------------------------
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== pinned) {
    return unavailable("digest_mismatch", `fetched bytes hash to ${actual}, contract pins ${pinned}`);
  }

  // ---- 护栏解包 + 入口 -------------------------------------------------------
  let entries: Map<string, Buffer>;
  try {
    entries = readPackage(bytes, UI_ZIP_LIMITS);
  } catch (cause) {
    return unavailable("invalid_bundle", cause instanceof Error ? cause.message : String(cause));
  }
  if (!entries.has(UI_ENTRY)) {
    return unavailable("invalid_bundle", `ui bundle has no ${UI_ENTRY} at its root`);
  }

  // ---- 原子落盘 --------------------------------------------------------------
  const staging = `${dir}.staging-${pinned.slice(0, 8)}-${process.pid}`;
  try {
    rmSync(staging, { recursive: true, force: true });
    for (const [name, data] of entries) {
      const target = join(staging, ...name.split("/"));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, data);
    }
    mkdirSync(dirname(dir), { recursive: true });
    if (existsSync(join(dir, UI_ENTRY))) {
      // 同一个摘要被别的请求先落了盘 —— 按摘要寻址，那一份与这一份是同一串字节。
      rmSync(staging, { recursive: true, force: true });
      return { status: "present", productId, sha256: pinned, dir };
    }
    renameSync(staging, dir);
  } catch (cause) {
    rmSync(staging, { recursive: true, force: true });
    return unavailable("invalid_bundle", `could not store ui bundle: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  return { status: "fetched", productId, sha256: pinned, dir };
}

/**
 * 契约拉取之后**紧接着**取界面（ADR-023 §3.3：桌面必然离线，第一次打开时才发现
 * 取不回，就是在最需要的时候没有）。
 *
 * 契约没落到本地（`offline`）就无从知道钉的是哪一份，不取。`current` 也取：契约
 * 早就在了，界面可能是上次没取成。
 */
export async function fetchUiAfterContract(outcome: FetchOutcome, opts: UiFetchOptions): Promise<UiFetchOutcome | undefined> {
  if (outcome.status === "offline") return undefined;
  let contract: RuyinContract;
  try {
    contract = parseContract(readFileSync(join(outcome.dir, MANIFEST_ENTRY), "utf8")) as RuyinContract;
  } catch {
    // 刚刚才校验过落盘的那一份；读不回来说明盘上有别的事（被删、被锁），与界面无关。
    return undefined;
  }
  return fetchUiBundle(contract, opts);
}

/** 边收边数；超过上限立即停，不先收完再判断。 */
async function readCapped(res: Response, maxBytes: number): Promise<Buffer | "too_large"> {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return "too_large";
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}
