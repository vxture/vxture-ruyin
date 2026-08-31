/**
 * 一级供给：契约拉取（ADR-012、30-contract-schema §18.3）。
 *
 * 产品在本地需要的只是一份契约声明——产品的智能在它自己的能力面，模型在那一侧
 * 接，都不在本地。所以「把产品拿到本地」不必走包管理器那一套：拉一份 YAML，
 * 校验，按版本落盘。
 *
 * 管线（顺序即安全顺序）：
 *   取回 → 解析 → 契约校验(R1–R13) → id 相符 → 路径段合法 → 版本化落盘
 *
 * **比二级供给少的那几步不是省略，是没有对象。** 容器护栏与 CHECKSUMS 管的是
 * 压缩包里的多个条目，这里只有一份文档；签名管的是「在用户机器上跑第三方代码」
 * ——契约不可执行，它唯一的特权面是声明工具与工具默认权限，而工具闸的硬底线
 * （external_send ≥ 需确认）以 stricter() 合并且不可配置，契约放松不了它。
 * 一旦产品随附本地可执行技能，那就是二级供给，签名不再可选。
 *
 * 信任边界写清楚：拉取走的是 RUYIN_CAPABILITY_BASE 这一个运行时设置，与能力
 * 调用同一条通路、同一个主机。**没有扩大信任面**——那台主机本来就在替这些产品
 * 做推理编排。所以这里也不新增一处存主机名的地方。
 *
 * 落盘位置与 .ruyinpkg 安装的产品共用同一个库：
 *   <dataDir>/products/<productId>/<version>/ruyin.product.yaml
 * 于是版本并存、切换、回滚、离线沿用全部复用既有实现（ADR-012：「不安装」不等于
 * 「不留在本地」，区别在获取方式）。来源记在同目录的 .source.json 里，供审计与
 * 界面区分，从不用于发请求。
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  parseContract,
  validateContract,
  type RuyinContract,
} from "@vxture/ruyin-contract-schema";
import { isTransientStatus } from "./capability-client.js";

export const MANIFEST_ENTRY = "ruyin.product.yaml";
export const SOURCE_ENTRY = ".source.json";

/** 契约本身不可接受：校验不过、id 不符、版本名非法。重试不会变好。 */
export class ContractFetchError extends Error {}

export interface ContractFetchConfig {
  /** 产品能力面基址，与能力调用同一个设置。 */
  baseUrl: string;
  token?: (() => Promise<string | undefined>) | undefined;
  timeoutMs?: number;
}

export interface FetchOptions extends ContractFetchConfig {
  /** 产品库根目录，通常 <dataDir>/products。 */
  storeDir: string;
  /** 注入以便测试；缺省用全局 fetch。 */
  fetchImpl?: typeof fetch;
  now?: () => string;
}

export type FetchOutcome =
  /** 新版本已落盘。 */
  | { status: "fetched"; productId: string; version: string; dir: string }
  /**
   * 该版本本地已有，未写盘。remoteDiffers 为真表示远端同版本内容不同——产品违反了
   * §18.4 的版本兼容规则。此时**保留本地那份**：静默采纳会把这个错误藏起来。
   */
  | {
      status: "current";
      productId: string;
      version: string;
      dir: string;
      remoteDiffers: boolean;
    }
  /** 拉不到。缓存里有什么就还用什么（ADR-003：桌面必然离线）。 */
  | {
      status: "offline";
      productId: string;
      reason: string;
      cachedVersions: string[];
    };

/** 目录名安全：产品 id 与版本都会进路径，必须先约束再拼接。 */
function assertPathSegment(kind: string, value: string): void {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(value) || value === "." || value === "..") {
    throw new ContractFetchError(`illegal ${kind} for filesystem use: ${value}`);
  }
}

function cachedVersionsOf(storeDir: string, productId: string): string[] {
  const dir = join(storeDir, productId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter(
      (e) =>
        e.isDirectory() &&
        !e.name.includes(".staging-") &&
        existsSync(join(dir, e.name, MANIFEST_ENTRY)),
    )
    .map((e) => e.name);
}

/**
 * 拉取一个产品的契约。
 *
 * 网络类失败一律返回 offline 而不抛错：拿不到新契约不是错误状态，本地那份仍然
 * 有效（ADR-003）。抛错只留给「契约本身不可接受」——那是产品的问题，必须显式。
 */
export async function fetchContract(
  productId: string,
  opts: FetchOptions,
): Promise<FetchOutcome> {
  assertPathSegment("product id", productId);

  const doFetch = opts.fetchImpl ?? fetch;
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/products/${encodeURIComponent(
    productId,
  )}/contract`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  let text: string;
  try {
    const token = await opts.token?.();
    const res = await doFetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/yaml, application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (isTransientStatus(res.status) || res.status === 404) {
        // 404 也按 offline：产品可能尚未发布契约端点，这不该把本地已有的那份
        // 判成无效。
        return offline(
          `contract endpoint returned ${res.status}`,
          productId,
          opts.storeDir,
        );
      }
      // 401/403 是明确的拒绝，但拒绝的是「现在能不能取」，不是「本地那份坏了」。
      return offline(
        `contract endpoint refused: HTTP ${res.status} ${body.slice(0, 120)}`,
        productId,
        opts.storeDir,
      );
    }
    text = await res.text();
  } catch (cause) {
    return offline(
      `contract endpoint unreachable: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      productId,
      opts.storeDir,
    );
  } finally {
    clearTimeout(timer);
  }

  // 解析：YAML 是 JSON 的超集，两种响应体同一个解析器吃得下。
  let parsed: unknown;
  try {
    parsed = parseContract(text);
  } catch (cause) {
    throw new ContractFetchError(
      `contract parse error: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  const validation = validateContract(parsed);
  if (!validation.ok) {
    const first = validation.errors[0];
    throw new ContractFetchError(
      `contract invalid (${validation.errors.length} error(s)); first: ${first?.rule} ${first?.path}: ${first?.message}`,
    );
  }
  const contract = parsed as RuyinContract;

  // 要的是 A，回来的是 B —— 无论是配置错还是别的什么，都不能让它以 A 的身份落盘。
  if (contract.product.id !== productId) {
    throw new ContractFetchError(
      `contract identifies as "${contract.product.id}" but was fetched for "${productId}"`,
    );
  }
  const version = contract.product.version;
  assertPathSegment("version", version);

  const dir = join(opts.storeDir, productId, version);
  if (existsSync(join(dir, MANIFEST_ENTRY))) {
    const local = readFileSync(join(dir, MANIFEST_ENTRY), "utf8");
    return {
      status: "current",
      productId,
      version,
      dir,
      remoteDiffers: sha256(local) !== sha256(text),
    };
  }

  // 先写暂存目录再整体改名：同盘 rename 是原子的，不会在库里留下半个产品。
  const staging = `${dir}.staging-${sha256(`${productId}${version}${text.length}`).slice(0, 8)}`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  try {
    writeFileSync(join(staging, MANIFEST_ENTRY), text, "utf8");
    writeFileSync(
      join(staging, SOURCE_ENTRY),
      JSON.stringify(
        {
          origin: "contract_fetch",
          from: opts.baseUrl,
          fetchedAt: opts.now?.() ?? new Date().toISOString(),
          sha256: sha256(text),
        },
        null,
        2,
      ),
      "utf8",
    );
    mkdirSync(dirname(dir), { recursive: true });
    renameSync(staging, dir);
  } catch (cause) {
    rmSync(staging, { recursive: true, force: true });
    throw cause;
  }

  return { status: "fetched", productId, version, dir };
}

function offline(
  reason: string,
  productId: string,
  storeDir: string,
): FetchOutcome {
  return {
    status: "offline",
    productId,
    reason,
    cachedVersions: cachedVersionsOf(storeDir, productId),
  };
}

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** 某版本目录的来源记录；无记录 = .ruyinpkg 安装（拉取的一律写这个文件）。 */
export function sourceOf(
  versionDir: string,
): { origin: string; from?: string; fetchedAt?: string } | undefined {
  const p = join(versionDir, SOURCE_ENTRY);
  if (!existsSync(p)) return undefined;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as { origin: string };
  } catch {
    return undefined;
  }
}
