/**
 * 项目的**文件区**（TD-041；设计出处 `30-design/60-technical-architecture` §7.1、§7.3）。
 *
 * ## 它解决的问题
 *
 * 在此之前，参考资料由工具按目录授权从**用户自己的位置**读，抽出的内容进加密库，
 * 原件不进数据目录。这在大多数时候是对的（不复制就没有第二份要操心的数据），但它
 * 有一个说不过去的后果：**用户把那份文件挪走或删掉之后，成果的依据就断了**。
 *
 * 一份标书写完，三个月后有人问「第 17 条里这个数字是哪来的」，而引用指向的那个
 * 路径已经不存在了 —— 那时「可回溯」这句话就是假的。文件区是为这种情况准备的：
 * 用户**明确**把一份原件收进项目，它就一直在，与他自己那份怎么动无关。
 *
 * ## 为什么必须连加密一起做
 *
 * 「数据目录整体加密」是这个产品说给用户听的话（`project.db` 走 SQLCipher）。
 * 往 `files/` 里拷一份不加密的原件，那句话当场变成假的 —— 而且是最糟的那种假：
 * 用户以为自己的招标文件躺在一个加密的地方，实际上换个人开机就能读。
 *
 * 所以这里用**和库同一把钥匙**（§7.3「同密钥体系加密」）：项目密钥由主密钥封装，
 * 主密钥进 OS 凭据库（DPAPI）。文件区和库一起加密、一起解密、一起搬家。
 *
 * ## 磁盘格式，以及每一处的理由
 *
 * ```text
 * <projectDir>/files/<hash 前两位>/<hash>
 *
 *   "RYF1"            4 字节魔数 —— 格式将来要改时，读的人得认得出这是哪一版
 *   chunkSize         uint32 LE
 *   plaintextSize     uint64 LE
 *   然后重复：
 *     nonce           12 字节
 *     tag             16 字节
 *     ciphertext      至多 chunkSize 字节
 * ```
 *
 * **分块，不是整份加密**：一份 2 GB 的标书整份读进内存再加密，会让守护进程在
 * 用户点「收进项目」的那一刻吃掉 2 GB —— 而那是他自己的电脑（TD-046 同一条道理）。
 * 分块之后内存占用是常数。
 *
 * **每块自己的 nonce**：GCM 的 nonce 绝不能在同一把钥匙下重复，重复一次就把两块
 * 明文的异或泄露出去。这里每块随机取，不搞「基准 nonce + 计数器」那种省 8 字节
 * 的写法 —— 省下的那点空间不值得多一处能出错的地方。
 *
 * **块序号进 AAD**：只加密不绑序号的话，拿到文件的人可以把块**换个顺序**拼回去，
 * 每一块的 tag 都仍然对得上。绑了序号，换序就解不开。
 *
 * **文件名是明文的 sha256**，读回来重新算一遍并比对（内容寻址的应有之义）。它同时
 * 免费带来去重：同一份文件收两次，磁盘上只有一份。
 *
 * ## 去重与「同一份内容两个名字」
 *
 * 磁盘按内容寻址，**登记按条目**：同一份文件用两个名字收进来是真实存在的情况
 * （`招标文件.pdf` 和 `甲方发来的最终版.pdf` 字节一样）。所以一条登记一个 id，
 * 多条可以指向同一个 hash；删掉最后一条指向它的登记时，那份密文才真的删掉。
 * 少了这个引用计数，删掉一个名字会让另一个名字指向一个不存在的文件。
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";

/** 魔数：格式版本要能被认出来。 */
const MAGIC = "RYF1";
const MAGIC_BYTES = 4;
const HEADER_BYTES = MAGIC_BYTES + 4 + 8;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/**
 * 一块 4 MiB。
 *
 * 往大了取，每份文件的头部开销占比更低；往小了取，内存峰值更低。4 MiB 的意思是
 * 「一份 2 GB 的文件分成 512 块，而守护进程任何时刻只按住 4 MiB」。**这个数字是
 * 权衡出来的，不是量出来的** —— 但它写进了磁盘格式的头部，所以将来改它不会让已经
 * 写下的文件读不出来。
 */
export const CHUNK_BYTES = 4 * 1024 * 1024;

export class FileStoreError extends Error {}

/** 一条登记。磁盘上的密文按 `hash` 寻址，多条登记可以指向同一个 hash。 */
export interface StoredFile {
  id: string;
  /** 明文的 sha256（十六进制）。磁盘路径由它决定。 */
  hash: string;
  name: string;
  /** 明文字节数。 */
  bytes: number;
  mediaType: string;
  addedAt: string;
  /** 从哪儿收进来的（用户自己的那个路径）。**只作记录**，不保证它还在。 */
  sourceRef?: string;
}

/** 块序号绑进 AAD：不绑的话，换个顺序拼回去每块的 tag 都仍然对得上。 */
function aadFor(index: number): Buffer {
  const aad = Buffer.alloc(8);
  aad.writeBigUInt64LE(BigInt(index));
  return aad;
}

/**
 * 一个项目的文件区。
 *
 * 只管**字节与磁盘**：登记（名字、时间、来源）在库里，由调用方存。分开是因为
 * 登记要跟着项目库一起加密、一起导出，而密文块是一堆独立的文件。
 */
export class ProjectFileStore {
  private readonly root: string;

  constructor(
    projectDir: string,
    /** 项目密钥（64 位十六进制），与 `project.db` 用的是同一把（§7.3）。 */
    private readonly keyHex: string,
  ) {
    this.root = join(projectDir, "files");
    if (Buffer.from(keyHex, "hex").length !== 32) {
      throw new FileStoreError("项目密钥必须是 32 字节（64 位十六进制）");
    }
  }

  /** `<files>/<前两位>/<hash>`。分两级是为了不让一个目录堆上几万个文件。 */
  private pathFor(hash: string): string {
    return join(this.root, hash.slice(0, 2), hash);
  }

  has(hash: string): boolean {
    return existsSync(this.pathFor(hash));
  }

  /** 密文在磁盘上占多少（含头部与每块的 nonce/tag）。文件不在时返回 0。 */
  storedBytes(hash: string): number {
    try {
      return statSync(this.pathFor(hash)).size;
    } catch {
      return 0;
    }
  }

  /**
   * 把一份文件收进来：边读边算哈希、边加密边写。
   *
   * 返回明文的 hash 与字节数。**内容已经在了就不重复写**（内容寻址的去重）。
   *
   * 先写临时文件再改名：中途失败（磁盘满、进程被杀）留下的是一个临时文件，
   * 而不是一份**看起来像但读不出来**的半截密文 —— 后者会在几个月后用户去取原件时
   * 才暴露，那时他早就把自己那份删了。
   */
  async put(source: string): Promise<{ hash: string; bytes: number }> {
    if (!existsSync(source)) {
      throw new FileStoreError(`文件不存在：${source}`);
    }
    const key = Buffer.from(this.keyHex, "hex");
    const hasher = createHash("sha256");
    const temp = join(this.root, `.tmp-${randomBytes(8).toString("hex")}`);
    mkdirSync(this.root, { recursive: true });

    const header = Buffer.alloc(HEADER_BYTES);
    header.write(MAGIC, 0, "ascii");
    header.writeUInt32LE(CHUNK_BYTES, MAGIC_BYTES);
    // 明文长度这一刻还不知道，先占位，全部写完再回填。
    header.writeBigUInt64LE(0n, MAGIC_BYTES + 4);

    let plaintextBytes = 0;
    const out = await open(temp, "w");
    try {
      await out.write(header);
      let index = 0;
      for await (const chunk of createReadStream(source, { highWaterMark: CHUNK_BYTES })) {
        const buf = chunk as Buffer;
        hasher.update(buf);
        plaintextBytes += buf.byteLength;
        const nonce = randomBytes(NONCE_BYTES);
        const cipher = createCipheriv("aes-256-gcm", key, nonce);
        cipher.setAAD(aadFor(index));
        const body = Buffer.concat([cipher.update(buf), cipher.final()]);
        await out.write(Buffer.concat([nonce, cipher.getAuthTag(), body]));
        index += 1;
      }
      const size = Buffer.alloc(8);
      size.writeBigUInt64LE(BigInt(plaintextBytes));
      await out.write(size, 0, 8, MAGIC_BYTES + 4);
    } catch (cause) {
      await out.close();
      rmSync(temp, { force: true });
      throw cause;
    }
    await out.close();

    const hash = hasher.digest("hex");
    const dest = this.pathFor(hash);
    if (existsSync(dest)) {
      // 已经收过同样的内容：扔掉刚写的那份，磁盘上仍然只有一份。
      rmSync(temp, { force: true });
      return { hash, bytes: plaintextBytes };
    }
    mkdirSync(join(this.root, hash.slice(0, 2)), { recursive: true });
    renameSync(temp, dest);
    return { hash, bytes: plaintextBytes };
  }

  /**
   * 取回原件（整份读进内存）。
   *
   * **读回来要重算哈希并比对**：内容寻址的文件名说这份是什么，磁盘说它现在是
   * 什么，两者不一致就必须报错而不是把内容交出去。每块的 GCM tag 已经挡住了
   * 改块内容与换块顺序；这一道挡的是「整份文件被换成了另一份合法密文」。
   */
  async read(hash: string): Promise<Buffer> {
    const parts: Buffer[] = [];
    for await (const chunk of this.readChunks(hash)) parts.push(chunk);
    const plain = Buffer.concat(parts);
    const actual = createHash("sha256").update(plain).digest("hex");
    if (actual !== hash) {
      throw new FileStoreError(
        `文件区里 ${hash} 的内容对不上（读出来是 ${actual}）—— 这份原件已经不可信，不能交出去`,
      );
    }
    return plain;
  }

  /**
   * 按块解密。给下载那条路用 —— 一份 2 GB 的文件不该为了发出去先在内存里凑齐。
   *
   * **注意**：流式读**不做整份哈希比对**（那要读完才知道，而那时已经发出去一半
   * 了）。每块的 tag 仍然验，块序号仍然绑。要「保证是这一份」，用 `read()`。
   * 这一条差别写在这里，是因为它不写下来就会被当成一样的东西。
   */
  async *readChunks(hash: string): AsyncGenerator<Buffer> {
    const path = this.pathFor(hash);
    if (!existsSync(path)) throw new FileStoreError(`文件区里没有 ${hash}`);
    const key = Buffer.from(this.keyHex, "hex");
    const fh = await open(path, "r");
    try {
      const header = Buffer.alloc(HEADER_BYTES);
      await fh.read(header, 0, HEADER_BYTES, 0);
      if (header.subarray(0, MAGIC_BYTES).toString("ascii") !== MAGIC) {
        throw new FileStoreError(`${hash} 不是文件区的格式（魔数对不上）`);
      }
      const chunkSize = header.readUInt32LE(MAGIC_BYTES);
      if (chunkSize <= 0) throw new FileStoreError(`${hash} 的块大小无效`);
      const frame = NONCE_BYTES + TAG_BYTES + chunkSize;
      let offset = HEADER_BYTES;
      let index = 0;
      const total = statSync(path).size;
      while (offset < total) {
        const take = Math.min(frame, total - offset);
        if (take <= NONCE_BYTES + TAG_BYTES) {
          throw new FileStoreError(`${hash} 的第 ${index} 块被截断了`);
        }
        const buf = Buffer.alloc(take);
        await fh.read(buf, 0, take, offset);
        const nonce = buf.subarray(0, NONCE_BYTES);
        const tag = buf.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES);
        const body = buf.subarray(NONCE_BYTES + TAG_BYTES);
        const decipher = createDecipheriv("aes-256-gcm", key, nonce);
        decipher.setAAD(aadFor(index));
        decipher.setAuthTag(tag);
        yield Buffer.concat([decipher.update(body), decipher.final()]);
        offset += take;
        index += 1;
      }
    } finally {
      await fh.close();
    }
  }

  /**
   * 删掉一份密文。**调用方要先确认没有登记还指着它** —— 引用计数在库那一侧，
   * 这里只管磁盘。
   */
  remove(hash: string): void {
    rmSync(this.pathFor(hash), { force: true });
  }

  /** 清掉上次没写完留下的临时文件（启动时扫一次）。 */
  sweepTemp(): number {
    if (!existsSync(this.root)) return 0;
    let n = 0;
    for (const name of readdirSafe(this.root)) {
      if (!name.startsWith(".tmp-")) continue;
      rmSync(join(this.root, name), { force: true });
      n += 1;
    }
    return n;
  }
}

function readdirSafe(dir: string): string[] {
  try {
    // 只看第一层：临时文件写在 files/ 根下，密文在两位前缀的子目录里。
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** 从文件名猜一个媒体类型。**猜不到就说猜不到**，不编一个。 */
export function mediaTypeOf(name: string): string {
  const ext = name.toLowerCase().replace(/^.*\./, "");
  const known: Record<string, string> = {
    pdf: "application/pdf",
    md: "text/markdown",
    txt: "text/plain",
    csv: "text/csv",
    json: "application/json",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    zip: "application/zip",
  };
  return known[ext] ?? "application/octet-stream";
}

/** 读回一份密文的头部（诊断与测试用）。 */
export function readHeader(path: string): { magic: string; chunkSize: number; plaintextBytes: number } {
  const header = readFileSync(path).subarray(0, HEADER_BYTES);
  return {
    magic: header.subarray(0, MAGIC_BYTES).toString("ascii"),
    chunkSize: header.readUInt32LE(MAGIC_BYTES),
    plaintextBytes: Number(header.readBigUInt64LE(MAGIC_BYTES + 4)),
  };
}
