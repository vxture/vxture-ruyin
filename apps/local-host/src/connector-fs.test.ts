/**
 * local-fs 连接器的承载行为（M3，40-context-architecture §4）。
 *
 * 这里钉死一条：**连接器绝不为读不了的文件编一个正文**。旧行为把
 * 「[binary or unsupported file type: X]」当内容送出去——那句话的形状和文件内容
 * 一模一样，模型分辨不出来，检索索引也会因此把这些词收进去。
 */

import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ContextItemMeta } from "@vxture/ruyin-core";
import { LocalFsConnector } from "./connector-fs.js";

function metaFor(path: string, name: string): ContextItemMeta {
  return {
    id: `itm_${name}`,
    type: "tender_document",
    source: "local",
    ref: path,
    name,
    bytes: statSync(path).size,
    modifiedAt: statSync(path).mtime.toISOString(),
  };
}

function inTmp(name: string, data: string | Uint8Array): ContextItemMeta {
  const dir = mkdtempSync(join(tmpdir(), "ruyin-fs-"));
  const path = join(dir, name);
  writeFileSync(path, data);
  return metaFor(path, name);
}

const connector = new LocalFsConnector();

void test("连接器：文本按文本读出", async () => {
  const item = await connector.read(inTmp("notes.md", "# 招标要点\n三条"));
  assert.equal(item.content.kind, "text");
  assert.equal(item.content.kind === "text" && item.content.text, "# 招标要点\n三条");
  assert.equal(item.content.kind === "text" && item.content.truncated, undefined);
});

void test("连接器：PDF 按字节 + 媒体类型读出，字节原样", async () => {
  // 前四字节是真实 PDF 魔数；后两个是非法 UTF-8，按文本读必然损坏。
  const raw = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0xff, 0xfe]);
  const item = await connector.read(inTmp("t.pdf", raw));

  assert.equal(item.content.kind, "binary");
  assert.equal(
    item.content.kind === "binary" && item.content.mediaType,
    "application/pdf",
  );
  assert.deepEqual(
    item.content.kind === "binary"
      ? new Uint8Array(item.content.bytes)
      : undefined,
    raw,
  );
});

void test("连接器：认不出的格式 → unavailable，不编正文", async () => {
  const item = await connector.read(inTmp("scan.tif", "irrelevant"));

  assert.equal(item.content.kind, "unavailable");
  assert.match(
    item.content.kind === "unavailable" ? item.content.reason : "",
    /unrecognized file type/,
  );
  // 关键：理由是理由，不是内容。它不能出现在任何被当作正文的位置。
  assert.notEqual(item.content.kind, "text");
});

void test("连接器：超限的二进制报 unavailable，绝不截断", async () => {
  const meta = inTmp("huge.pdf", new Uint8Array([1, 2, 3]));
  // 直接改 ref 指向一个真实超限文件代价太大；这里验证的是闸门读的是**读取时**
  // 的实际大小，所以把文件撑到超限即可（20MB 稍多一点）。
  writeFileSync(meta.ref, new Uint8Array(20_000_001));
  const item = await connector.read(meta);

  assert.equal(item.content.kind, "unavailable");
  assert.match(
    item.content.kind === "unavailable" ? item.content.reason : "",
    /exceeds the 20000000-byte limit/,
  );
  // 截断的二进制不是小一点的文档，是坏掉的文档，而读的人看不出来。
  assert.notEqual(item.content.kind, "binary");
});

void test("连接器：文本截断是一个标志位，不是塞进正文的一句话", async () => {
  const long = "甲".repeat(200_000); // UTF-8 三字节/字 => 远超 256000
  const item = await connector.read(inTmp("long.txt", long));

  assert.equal(item.content.kind, "text");
  assert.equal(item.content.kind === "text" && item.content.truncated, true);
  // 文档里的话都是文档说的；我们的注解混进去就分不清了。
  assert.ok(
    item.content.kind === "text" && !item.content.text.includes("truncated"),
  );
});

void test("连接器：文件读不了也是 unavailable，不是抛错也不是空内容", async () => {
  const meta = inTmp("gone.pdf", new Uint8Array([1]));
  // 保持 .pdf 后缀：要试的是「格式认得、文件没了」，换扩展名会先撞上另一条分支。
  const missing: ContextItemMeta = {
    ...meta,
    ref: meta.ref.replace("gone.pdf", "not-here.pdf"),
  };
  const item = await connector.read(missing);

  assert.equal(item.content.kind, "unavailable");
  assert.match(
    item.content.kind === "unavailable" ? item.content.reason : "",
    /unreadable/,
  );
});
