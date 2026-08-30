/**
 * .ruyinpkg 容器读取与完整性校验（设计权威：docs/30-design/30-contract-schema.md
 * §18.1 / §18.2）。
 *
 *   bid-1.0.0.ruyinpkg（zip 容器）
 *   ├── ruyin.product.yaml   manifest，唯一事实源
 *   ├── ui/ resources/ i18n/ 业务资源
 *   ├── CHECKSUMS            包内文件摘要清单（sha256  path）
 *   └── SIGNATURE            对 CHECKSUMS 的签名
 *
 * 为什么自己解 zip 而不引依赖：这是**安装未知来源代码/资源**的入口，是本 runtime
 * 攻击面最集中的一处。这里只需要只读、单遍、格式受限的解析，自持实现让每一条
 * 护栏都可审、且供应链面为零。护栏是显式的：拒绝路径穿越 / 绝对路径 / 加密条目 /
 * 未知压缩方法 / zip64 / 超限尺寸与条目数。
 *
 * 完整性权威是 CHECKSUMS 里的 SHA-256（§18.2 的「摘要一致」），不是 zip 自带的
 * CRC —— 后者防传输损坏，不防篡改。
 */

import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";

/** 单个包的硬上限，防解压炸弹。业务产品包是契约 + 资源，不该接近这些量级。 */
const MAX_ENTRIES = 4096;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

export const MANIFEST_ENTRY = "ruyin.product.yaml";
export const CHECKSUMS_ENTRY = "CHECKSUMS";
export const SIGNATURE_ENTRY = "SIGNATURE";

export class PackageError extends Error {}

export interface PackageEntry {
  name: string;
  data: Buffer;
}

/** 解出的包内容：条目名 → 内容。名字一律为包内相对路径（正斜杠）。 */
export type PackageContents = Map<string, Buffer>;

/**
 * 条目名合法性：包内相对路径，禁止穿越与绝对路径。zip 规范用正斜杠；反斜杠在
 * Windows 上会被当作分隔符，因此一并拒绝，而不是"规范化后再看"——规范化是
 * 路径穿越漏洞最常见的藏身处。
 */
function assertSafeEntryName(name: string): void {
  if (name.length === 0 || name.length > 512) {
    throw new PackageError(`illegal entry name length: ${name.slice(0, 64)}`);
  }
  if (name.includes("\\")) {
    throw new PackageError(`backslash in entry name: ${name}`);
  }
  if (name.startsWith("/") || /^[a-zA-Z]:/.test(name)) {
    throw new PackageError(`absolute entry path: ${name}`);
  }
  if (name.split("/").some((seg) => seg === ".." || seg === ".")) {
    throw new PackageError(`path traversal in entry: ${name}`);
  }
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) {
      throw new PackageError("control character in entry name");
    }
  }
}

/** 从尾部定位 EOCD（允许有 comment）。 */
function findEocd(buf: Buffer): number {
  const min = 22;
  if (buf.length < min) throw new PackageError("not a zip container (too small)");
  const scanFrom = Math.max(0, buf.length - (min + 0xffff));
  for (let i = buf.length - min; i >= scanFrom; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  throw new PackageError("zip end-of-central-directory not found");
}

/**
 * 读取 .ruyinpkg 容器，返回全部条目。只做容器层解析与护栏；摘要/签名/契约校验
 * 由 verifyIntegrity 与安装管线负责。
 */
export function readPackage(buf: Buffer): PackageContents {
  const eocd = findEocd(buf);
  const entryCount = buf.readUInt16LE(eocd + 10);
  const centralSize = buf.readUInt32LE(eocd + 12);
  const centralOffset = buf.readUInt32LE(eocd + 16);

  if (entryCount === 0xffff || centralOffset === 0xffffffff) {
    throw new PackageError("zip64 containers are not supported");
  }
  if (entryCount > MAX_ENTRIES) {
    throw new PackageError(`too many entries: ${entryCount}`);
  }
  if (centralOffset + centralSize > buf.length) {
    throw new PackageError("central directory out of bounds");
  }

  const out: PackageContents = new Map();
  let total = 0;
  let p = centralOffset;

  for (let i = 0; i < entryCount; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CENTRAL) {
      throw new PackageError("malformed central directory header");
    }
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith("/")) continue; // 目录条目：无内容，跳过
    assertSafeEntryName(name);

    if ((flags & 0x0001) !== 0) {
      throw new PackageError(`encrypted entry not supported: ${name}`);
    }
    if (method !== 0 && method !== 8) {
      throw new PackageError(`unsupported compression method ${method}: ${name}`);
    }
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff
    ) {
      throw new PackageError(`zip64 sizes not supported: ${name}`);
    }
    if (uncompressedSize > MAX_ENTRY_BYTES) {
      throw new PackageError(`entry too large: ${name}`);
    }
    total += uncompressedSize;
    if (total > MAX_TOTAL_BYTES) {
      throw new PackageError("package exceeds total size limit");
    }
    if (out.has(name)) {
      // 重名条目是经典的"校验一个、安装另一个"手法，直接拒。
      throw new PackageError(`duplicate entry: ${name}`);
    }

    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== SIG_LOCAL) {
      throw new PackageError(`malformed local header: ${name}`);
    }
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buf.length) {
      throw new PackageError(`entry data out of bounds: ${name}`);
    }
    const raw = buf.subarray(dataStart, dataEnd);
    let data: Buffer;
    if (method === 0) {
      data = Buffer.from(raw);
    } else {
      data = inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES });
    }
    if (data.length !== uncompressedSize) {
      throw new PackageError(`entry size mismatch: ${name}`);
    }
    out.set(name, data);
  }
  return out;
}

export function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * CHECKSUMS 格式（每行）：`<sha256 hex>  <包内相对路径>`。
 * 解析时同样跑一遍条目名护栏 —— 清单本身也是不可信输入。
 */
export function parseChecksums(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const m = /^([0-9a-f]{64})\s+(.+)$/.exec(trimmed);
    if (!m) throw new PackageError(`malformed CHECKSUMS line: ${trimmed.slice(0, 80)}`);
    const name = m[2]!.trim();
    assertSafeEntryName(name);
    if (out.has(name)) throw new PackageError(`duplicate CHECKSUMS entry: ${name}`);
    out.set(name, m[1]!);
  }
  if (out.size === 0) throw new PackageError("CHECKSUMS is empty");
  return out;
}

/**
 * 完整性校验（§18.2「摘要一致」）：清单必须覆盖**除 CHECKSUMS / SIGNATURE 之外的
 * 每一个条目**，且逐一摘要相符。双向比对 —— 漏列文件与多列文件都是失败：
 * 只查"列了的对不对"，等于给未列出的夹带文件开了后门。
 */
export function verifyIntegrity(contents: PackageContents): void {
  const checksumsRaw = contents.get(CHECKSUMS_ENTRY);
  if (!checksumsRaw) throw new PackageError("package is missing CHECKSUMS");
  const declared = parseChecksums(checksumsRaw.toString("utf8"));

  const payload = [...contents.keys()].filter(
    (n) => n !== CHECKSUMS_ENTRY && n !== SIGNATURE_ENTRY,
  );
  for (const name of payload) {
    const want = declared.get(name);
    if (!want) throw new PackageError(`entry not listed in CHECKSUMS: ${name}`);
    const got = sha256(contents.get(name)!);
    if (got !== want) throw new PackageError(`checksum mismatch: ${name}`);
  }
  for (const name of declared.keys()) {
    if (!contents.has(name)) {
      throw new PackageError(`CHECKSUMS lists a missing entry: ${name}`);
    }
  }
  if (!contents.has(MANIFEST_ENTRY)) {
    throw new PackageError(`package is missing ${MANIFEST_ENTRY}`);
  }
}
