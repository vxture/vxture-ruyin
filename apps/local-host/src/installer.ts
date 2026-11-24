/**
 * 产品安装管线与版本化产品库（设计权威：docs/30-design/30-contract-schema.md
 * §18.2 信任链 / §18.4 更新与回滚）。
 *
 * 管线顺序是安全顺序，不可调换：
 *   容器护栏 → 摘要一致(CHECKSUMS) → 签名 → 契约校验(R 系列) → runtime.minimum(L3)
 *   → 版本化落盘（不覆盖旧版本）→ 切换 active
 * 先验证、后落盘：任何一步失败都不会在磁盘上留下半个产品。
 *
 * 库结构（§18.4「并行安装，不覆盖旧版本；旧版本保留一份用于回滚」）：
 *   <dataDir>/products/<productId>/<version>/…
 * active 版本记录在 registry 的状态文件里，回滚 = 切回旧版本目录。
 *
 * 签名（§18.2）：Runtime 使用宿主信任材料验证发布者与 Registry 副署。
 * 开发模式仅允许没有签名条目的包，并在结果里标记 unsigned。
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import {
  parseContract,
  validateContract,
  type RuyinContract,
} from "@vxture/ruyin-contract-schema";
import {
  MANIFEST_ENTRY,
  PackageError,
  SIGNATURE_ENTRY,
  readPackage,
  verifyIntegrity,
  type PackageContents,
} from "./pkg.js";
import { validateUiBundle, uiBundleDir, hasUiBundle } from "./ui-fetch.js";
import { verifiedPublisher, type PackageTrust } from "./package-signature.js";
import { assertAgentPayload } from "./agent-payload.js";

export interface InstallOptions {
  /** 产品库根目录，通常 <dataDir>/products。 */
  storeDir: string;
  /** 当前 runtime 版本，用于 L3 runtime.minimum 校验。 */
  runtimeVersion: string;
  /**
   * 生产必须为 true：未经 Registry 副署的包一律拒绝（§18.2）。开发模式传 false
   * 才允许安装无签名包，且结果里 signed=false，调用方必须留痕。
   */
  requireSignature: boolean;
  trust?: PackageTrust;
}

type PreflightOptions = Pick<InstallOptions, "runtimeVersion" | "requireSignature" | "trust">;

export interface InstallResult {
  productId: string;
  version: string;
  dir: string;
  /** 是否通过了签名验证；false 表示以开发模式放行的未签名包。 */
  signed: boolean;
  contract: RuyinContract;
}

export type InstallErrorCode =
  | "INVALID_CONTAINER"
  | "INTEGRITY_FAILED"
  | "SIGNATURE_UNVERIFIED"
  | "INVALID_CONTRACT"
  | "RUNTIME_INCOMPATIBLE"
  | "INVALID_IDENTITY"
  | "ALREADY_INSTALLED"
  | "INVALID_UI_BUNDLE"
  | "INVALID_AGENT_PAYLOAD";

export class InstallError extends Error {
  constructor(message: string, readonly code?: InstallErrorCode) {
    super(message);
  }
}

/** x.y.z 比较；返回 <0 / 0 / >0。非法段按 0 处理，长度不同按缺位补 0。 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".");
  const pb = b.split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = Number.parseInt(pa[i] ?? "0", 10) || 0;
    const nb = Number.parseInt(pb[i] ?? "0", 10) || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

/** 目录名安全：产品 id 与版本都会进路径，必须先约束再拼接。 */
function assertPathSegment(kind: string, value: string): void {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(value) || value === "." || value === "..") {
    throw new InstallError(`illegal ${kind} for filesystem use: ${value}`, "INVALID_IDENTITY");
  }
}

/** 把包内容写入目标目录；路径在写入前再次限定在目标目录内（纵深防御）。 */
function materialize(contents: PackageContents, dir: string): void {
  const root = resolve(dir);
  for (const [name, data] of contents) {
    const target = resolve(root, name);
    if (target !== root && !target.startsWith(root + sep)) {
      throw new InstallError(`entry escapes install dir: ${name}`);
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
  }
}

function inspectPackage(
  buf: Buffer,
  opts: PreflightOptions,
): PackagePreflight & { contents: PackageContents } {
  let contents: PackageContents;
  try {
    contents = readPackage(buf);
  } catch (cause) {
    if (cause instanceof PackageError) throw new InstallError(cause.message, "INVALID_CONTAINER");
    throw cause;
  }
  try {
    verifyIntegrity(contents);
  } catch (cause) {
    if (cause instanceof PackageError) throw new InstallError(cause.message, "INTEGRITY_FAILED");
    throw cause;
  }

  const publisher = verifiedPublisher(contents, opts.trust);
  const signed = publisher !== undefined;
  if (!signed && (opts.requireSignature || contents.has(SIGNATURE_ENTRY))) {
    throw new InstallError(
      "package is not countersigned by the Vxture Registry; refusing to install",
      "SIGNATURE_UNVERIFIED",
    );
  }

  try { assertAgentPayload(contents); }
  catch (cause) { throw new InstallError(String(cause), "INVALID_AGENT_PAYLOAD"); }

  const manifestRaw = contents.get(MANIFEST_ENTRY)!;
  let parsed: unknown;
  try {
    parsed = parseContract(manifestRaw.toString("utf8"));
  } catch (cause) {
    throw new InstallError(
      `manifest parse error: ${cause instanceof Error ? cause.message : String(cause)}`,
      "INVALID_CONTRACT",
    );
  }
  const validation = validateContract(parsed);
  if (!validation.ok) {
    const first = validation.errors[0];
    throw new InstallError(
      `contract invalid (${validation.errors.length} error(s)); first: ${first?.rule} ${first?.path}: ${first?.message}`,
      "INVALID_CONTRACT",
    );
  }
  const contract = parsed as RuyinContract;
  if (signed && contract.product.publisher !== publisher) {
    throw new InstallError("Manifest publisher does not match the verified signer", "SIGNATURE_UNVERIFIED");
  }

  // L3：runtime.minimum 兼容性（§18.4）。装不上要在落盘前说清楚。
  const minimum = contract.product.runtime?.minimum;
  if (minimum && compareVersions(opts.runtimeVersion, minimum) < 0) {
    throw new InstallError(
      `product requires runtime >= ${minimum}, current runtime is ${opts.runtimeVersion}`,
      "RUNTIME_INCOMPATIBLE",
    );
  }

  const productId = contract.product.id;
  const version = contract.product.version;
  assertPathSegment("product id", productId);
  assertPathSegment("version", version);
  const embeddedUi = contents.get("ui.zip");
  if (embeddedUi) {
    if (!contract.product.ui) throw new InstallError("embedded ui.zip requires product.ui.sha256", "INVALID_UI_BUNDLE");
    try { validateUiBundle(embeddedUi, contract.product.ui.sha256); }
    catch (cause) { throw new InstallError(String(cause), "INVALID_UI_BUNDLE"); }
  }
  return { productId, version, signed, contract, contents };
}

export type PackagePreflight = Omit<InstallResult, "dir">;

/** Validate the package without writing files or consulting the installed-product store. */
export function preflightPackage(
  buf: Buffer,
  opts: PreflightOptions,
): PackagePreflight {
  const { productId, version, signed, contract } = inspectPackage(buf, opts);
  return { productId, version, signed, contract };
}

/** Revalidate the supplied bytes at installation time before writing anything. */
export function installPackage(buf: Buffer, opts: InstallOptions): InstallResult {
  const { productId, version, signed, contract, contents } = inspectPackage(buf, opts);
  const dir = join(opts.storeDir, productId, version);
  if (existsSync(dir)) {
    throw new InstallError(`${productId}@${version} is already installed`, "ALREADY_INSTALLED");
  }

  // 先写到临时目录，成功后整体改名，避免半个产品留在库里。
  const staging = `${dir}.staging-${createHash("sha256")
    .update(`${productId}${version}${buf.length}`)
    .digest("hex")
    .slice(0, 8)}`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  try {
    materialize(contents, staging);
    mkdirSync(dirname(dir), { recursive: true });
    const embeddedUi = contents.get("ui.zip");
    if (embeddedUi && contract.product.ui && !hasUiBundle(opts.storeDir, productId, contract.product.ui.sha256)) {
      const uiDir = uiBundleDir(opts.storeDir, productId, contract.product.ui.sha256);
      const uiStaging = uiDir + ".staging-" + process.pid;
      try {
        rmSync(uiStaging, { recursive: true, force: true });
        materialize(validateUiBundle(embeddedUi, contract.product.ui.sha256), uiStaging);
        mkdirSync(dirname(uiDir), { recursive: true });
        renameSync(uiStaging, uiDir);
      } finally { rmSync(uiStaging, { recursive: true, force: true }); }
    }
    renameSync(staging, dir); // 同盘 rename 为原子操作

  } catch (cause) {
    rmSync(staging, { recursive: true, force: true });
    throw cause;
  }

  return { productId, version, dir, signed, contract };
}

export interface StoredVersion {
  productId: string;
  version: string;
  dir: string;
}

/** 枚举产品库里的全部已装版本（不判定 active，那属于 registry 状态）。 */
export function listStored(storeDir: string): StoredVersion[] {
  if (!existsSync(storeDir)) return [];
  const out: StoredVersion[] = [];
  for (const productEntry of readdirSync(storeDir, { withFileTypes: true })) {
    if (!productEntry.isDirectory()) continue;
    const productDir = join(storeDir, productEntry.name);
    for (const versionEntry of readdirSync(productDir, { withFileTypes: true })) {
      if (!versionEntry.isDirectory()) continue;
      if (versionEntry.name.includes(".staging-")) continue;
      const dir = join(productDir, versionEntry.name);
      if (!existsSync(join(dir, MANIFEST_ENTRY))) continue;
      out.push({
        productId: productEntry.name,
        version: versionEntry.name,
        dir,
      });
    }
  }
  return out;
}

/** 卸载一个版本目录。业务数据在 workspace 库里，不随产品卸载而删除。 */
export function uninstallVersion(
  storeDir: string,
  productId: string,
  version: string,
): void {
  assertPathSegment("product id", productId);
  assertPathSegment("version", version);
  const dir = join(storeDir, productId, version);
  if (!existsSync(dir)) {
    throw new InstallError(`${productId}@${version} is not installed`);
  }
  rmSync(dir, { recursive: true, force: true });
}
