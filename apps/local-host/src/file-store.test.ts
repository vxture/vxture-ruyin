/**
 * 项目文件区（TD-041）。
 *
 * 这组用例问四类事：
 *
 * ① **磁盘上是不是真的加密了**。这一条最要紧 —— 「数据目录整体加密」是说给用户
 *    听的话，往 `files/` 里拷一份明文会让那句话当场变成假的，而且它是**看不出来
 *    的假**：目录在、文件在、大小差不多，只有把字节拿出来看才知道。
 * ② **改过的密文一定读不出来**：改一块的内容、把两块换个顺序、换一把钥匙。
 * ③ **内容寻址与去重**：同样的字节收两次，磁盘上只有一份。
 * ④ **分块真的分了**：跨块的文件读回来要一字节不差 —— 边界那一块最容易写错。
 */

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CHUNK_BYTES, FileStoreError, ProjectFileStore, mediaTypeOf, readHeader } from "./file-store.js";

const KEY = "a".repeat(64);
const OTHER_KEY = "b".repeat(64);

function fixture(): { dir: string; store: ProjectFileStore; write: (name: string, bytes: Buffer) => string; clean: () => void } {
  const dir = mkdtemp();
  const work = join(dir, "work");
  mkdirSync(work, { recursive: true });
  return {
    dir,
    store: new ProjectFileStore(dir, KEY),
    write: (name: string, bytes: Buffer) => {
      const path = join(work, name);
      writeFileSync(path, bytes);
      return path;
    },
    clean: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function mkdtemp(): string {
  const dir = join(tmpdir(), `ruyin-files-${randomBytes(6).toString("hex")}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 密文那份文件在磁盘上的完整路径。 */
function blobPath(dir: string, hash: string): string {
  return join(dir, "files", hash.slice(0, 2), hash);
}

void test("收进来 → 取回去：字节一模一样，路径由内容的 sha256 决定", async () => {
  const f = fixture();
  const bytes = Buffer.from("智慧水务项目招标：技术要求 37 条。", "utf8");
  const source = f.write("招标文件.md", bytes);

  const { hash, bytes: size } = await f.store.put(source);
  assert.equal(hash, createHash("sha256").update(bytes).digest("hex"), "文件名就是内容的哈希");
  assert.equal(size, bytes.byteLength);
  assert.ok(f.store.has(hash));
  assert.deepEqual(await f.store.read(hash), bytes);
  f.clean();
});

void test("**磁盘上是密文**：明文一个片段都不该出现在那份文件里", async () => {
  const f = fixture();
  const secret = "投标报价 1234567 元，此数不得外泄";
  const bytes = Buffer.from(secret.repeat(50), "utf8");
  const { hash } = await f.store.put(f.write("报价.txt", bytes));

  const onDisk = readFileSync(blobPath(f.dir, hash));
  assert.equal(onDisk.includes(Buffer.from(secret, "utf8")), false, "明文出现在磁盘上了");
  // 头部之后的每一个字节都不该等于原文的对应位置（GCM 是流式的，相同必属巧合）。
  assert.notDeepEqual(onDisk.subarray(32, 64), bytes.subarray(0, 32));
  // 头部本身是明文的，这是有意的：读的人得先认得出格式与块大小。
  const header = readHeader(blobPath(f.dir, hash));
  assert.equal(header.magic, "RYF1");
  assert.equal(header.chunkSize, CHUNK_BYTES);
  assert.equal(header.plaintextBytes, bytes.byteLength);
  f.clean();
});

void test("换一把钥匙就读不出来 —— 加密不是摆设", async () => {
  const f = fixture();
  const { hash } = await f.store.put(f.write("a.txt", Buffer.from("秘密")));
  const wrong = new ProjectFileStore(f.dir, OTHER_KEY);
  await assert.rejects(wrong.read(hash));
  f.clean();
});

void test("改一个字节就读不出来（GCM tag）—— 不是「读出一份改过的内容」", async () => {
  const f = fixture();
  const { hash } = await f.store.put(f.write("a.txt", Buffer.from("原始内容".repeat(20))));
  const path = blobPath(f.dir, hash);
  const blob = readFileSync(path);
  // 动密文里的一个字节（跳过头部与 nonce/tag）。
  blob[blob.length - 1] = blob[blob.length - 1]! ^ 0x01;
  writeFileSync(path, blob);
  await assert.rejects(f.store.read(hash));
  f.clean();
});

void test("**把两块换个顺序也读不出来** —— 块序号绑进了 AAD", async () => {
  const f = fixture();
  // 两块多一点，这样才有「顺序」可言。
  const bytes = Buffer.concat([
    Buffer.alloc(CHUNK_BYTES, 0x41),
    Buffer.alloc(CHUNK_BYTES, 0x42),
  ]);
  const { hash } = await f.store.put(f.write("big.bin", bytes));
  const path = blobPath(f.dir, hash);
  const blob = readFileSync(path);

  const HEADER = 16;
  const FRAME = 12 + 16 + CHUNK_BYTES;
  const first = blob.subarray(HEADER, HEADER + FRAME);
  const second = blob.subarray(HEADER + FRAME, HEADER + FRAME * 2);
  // 不改任何一块的内容，只把两块对调：每块的 tag 仍然是对的。
  writeFileSync(path, Buffer.concat([blob.subarray(0, HEADER), second, first]));
  await assert.rejects(
    f.store.read(hash),
    "换序没被挡住 —— 说明块序号没有绑进 AAD",
  );
  f.clean();
});

void test("整份被换成另一份合法密文：哈希比对挡下来", async () => {
  const f = fixture();
  const a = await f.store.put(f.write("a.txt", Buffer.from("甲方的版本")));
  const b = await f.store.put(f.write("b.txt", Buffer.from("另一个版本")));
  // 用 b 的密文覆盖 a 的位置 —— 密钥对、每块 tag 都对，只是内容不是 a。
  writeFileSync(blobPath(f.dir, a.hash), readFileSync(blobPath(f.dir, b.hash)));
  await assert.rejects(f.store.read(a.hash), /内容对不上/);
  f.clean();
});

void test("去重：同样的字节收两次，磁盘上只有一份", async () => {
  const f = fixture();
  const bytes = Buffer.from("一模一样的内容");
  const first = await f.store.put(f.write("招标文件.pdf", bytes));
  const second = await f.store.put(f.write("甲方发来的最终版.pdf", bytes));
  assert.equal(first.hash, second.hash);
  const bucket = join(f.dir, "files", first.hash.slice(0, 2));
  assert.deepEqual(readdirSync(bucket), [first.hash], "同一份内容不该在磁盘上有两份");
  f.clean();
});

void test("分块：跨两块的文件读回来一字节不差，块数对得上", async () => {
  const f = fixture();
  // 刻意不是整数块：边界那一块最容易写错。
  const bytes = randomBytes(CHUNK_BYTES + 1234);
  const { hash, bytes: size } = await f.store.put(f.write("big.bin", bytes));
  assert.equal(size, bytes.byteLength);
  assert.deepEqual(await f.store.read(hash), bytes);

  let chunks = 0;
  let total = 0;
  for await (const c of f.store.readChunks(hash)) {
    chunks += 1;
    total += c.byteLength;
  }
  assert.equal(chunks, 2);
  assert.equal(total, bytes.byteLength);
  f.clean();
});

void test("空文件也收得进、取得回 —— 零字节是合法内容，不是错误", async () => {
  const f = fixture();
  const { hash, bytes } = await f.store.put(f.write("empty.txt", Buffer.alloc(0)));
  assert.equal(bytes, 0);
  assert.deepEqual(await f.store.read(hash), Buffer.alloc(0));
  f.clean();
});

void test("不在的东西说不在，不返回空内容", async () => {
  const f = fixture();
  await assert.rejects(f.store.put(join(f.dir, "没有这个文件")), /文件不存在/);
  await assert.rejects(f.store.read("0".repeat(64)), /文件区里没有/);
  assert.equal(f.store.has("0".repeat(64)), false);
  assert.equal(f.store.storedBytes("0".repeat(64)), 0);
  f.clean();
});

void test("删掉密文之后就真的没了", async () => {
  const f = fixture();
  const { hash } = await f.store.put(f.write("a.txt", Buffer.from("x")));
  assert.ok(f.store.storedBytes(hash) > 0);
  f.store.remove(hash);
  assert.equal(f.store.has(hash), false);
  // 删第二次不该抛。
  f.store.remove(hash);
  f.clean();
});

void test("钥匙不对长度当场拒绝 —— 不要等到写了一半才发现", () => {
  const dir = mkdtemp();
  assert.throws(() => new ProjectFileStore(dir, "abcd"), FileStoreError);
  rmSync(dir, { recursive: true, force: true });
});

void test("上次没写完留下的临时文件，启动时扫掉", async () => {
  const f = fixture();
  await f.store.put(f.write("a.txt", Buffer.from("x")));
  const stray = join(f.dir, "files", ".tmp-deadbeef");
  writeFileSync(stray, "半截");
  assert.equal(f.store.sweepTemp(), 1);
  assert.equal(existsSync(stray), false);
  // 正经的密文一份都不能被扫掉。
  assert.equal(readdirSync(join(f.dir, "files")).filter((n) => !n.startsWith(".")).length, 1);
  f.clean();
});

void test("媒体类型：认得的就说，认不得的说认不得，不编一个", () => {
  assert.equal(mediaTypeOf("招标文件.pdf"), "application/pdf");
  assert.equal(mediaTypeOf("A.DOCX"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(mediaTypeOf("说明.md"), "text/markdown");
  assert.equal(mediaTypeOf("没有扩展名"), "application/octet-stream");
  assert.equal(mediaTypeOf("a.unknownext"), "application/octet-stream");
});
