/**
 * .ruyinpkg 容器与完整性校验的用例（30-contract-schema §18.1/§18.2）。
 * 重点不在"好包能装上"，在**坏包必须被挡**：路径穿越、夹带未列出文件、
 * 摘要不符、重名条目、加密条目、未知压缩方法。这是安装未知来源内容的入口。
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import {
  CHECKSUMS_ENTRY,
  MANIFEST_ENTRY,
  PackageError,
  parseChecksums,
  readPackage,
  sha256,
  verifyIntegrity,
} from "./pkg.js";
import { makeTestZip as makeZip } from "./pkg-testkit.js";

const MANIFEST = Buffer.from("contract: \"0.1\"\n", "utf8");
const RESOURCE = Buffer.from("template body\n", "utf8");

function checksumsFor(files: Array<[string, Buffer]>): Buffer {
  return Buffer.from(
    files.map(([n, d]) => `${sha256(d)}  ${n}`).join("\n") + "\n",
    "utf8",
  );
}

function goodPackage(deflate = false): Buffer {
  const files: Array<[string, Buffer]> = [
    [MANIFEST_ENTRY, MANIFEST],
    ["resources/tpl.txt", RESOURCE],
  ];
  return makeZip([
    ...files.map(([name, data]) => ({ name, data, deflate })),
    { name: CHECKSUMS_ENTRY, data: checksumsFor(files) },
  ]);
}

/* ── 正面 ─────────────────────────────────────────────────────────────── */

void test("读取 STORED 包并通过完整性校验", () => {
  const contents = readPackage(goodPackage(false));
  assert.equal(contents.get(MANIFEST_ENTRY)?.toString(), MANIFEST.toString());
  assert.equal(contents.get("resources/tpl.txt")?.toString(), RESOURCE.toString());
  verifyIntegrity(contents); // 不抛即通过
});

void test("读取 DEFLATE 包并通过完整性校验", () => {
  const contents = readPackage(goodPackage(true));
  assert.equal(contents.get("resources/tpl.txt")?.toString(), RESOURCE.toString());
  verifyIntegrity(contents);
});

/* ── 负面：容器层护栏 ─────────────────────────────────────────────────── */

void test("拒绝路径穿越条目", () => {
  const zip = makeZip([{ name: "../evil.txt", data: RESOURCE }]);
  assert.throws(() => readPackage(zip), /path traversal/);
});

void test("拒绝绝对路径与反斜杠条目", () => {
  assert.throws(
    () => readPackage(makeZip([{ name: "/etc/passwd", data: RESOURCE }])),
    /absolute entry path/,
  );
  assert.throws(
    () => readPackage(makeZip([{ name: "a\\b.txt", data: RESOURCE }])),
    /backslash/,
  );
});

void test("拒绝重名条目（校验一个、安装另一个）", () => {
  const zip = makeZip([
    { name: "dup.txt", data: Buffer.from("first") },
    { name: "dup.txt", data: Buffer.from("second") },
  ]);
  assert.throws(() => readPackage(zip), /duplicate entry/);
});

void test("拒绝加密条目与未知压缩方法", () => {
  assert.throws(
    () => readPackage(makeZip([{ name: "a.txt", data: RESOURCE, encrypted: true }])),
    /encrypted/,
  );
  assert.throws(
    () => readPackage(makeZip([{ name: "a.txt", data: RESOURCE, method: 99 }])),
    /unsupported compression method/,
  );
});

void test("拒绝非 zip 输入", () => {
  assert.throws(() => readPackage(Buffer.from("not a zip at all")), PackageError);
});

/* ── 负面：完整性护栏 ─────────────────────────────────────────────────── */

void test("拒绝摘要不符（内容被篡改）", () => {
  const files: Array<[string, Buffer]> = [[MANIFEST_ENTRY, MANIFEST]];
  const zip = makeZip([
    { name: MANIFEST_ENTRY, data: Buffer.from("contract: \"9.9\"\n") }, // 换了内容
    { name: CHECKSUMS_ENTRY, data: checksumsFor(files) }, // 清单仍是旧摘要
  ]);
  assert.throws(() => verifyIntegrity(readPackage(zip)), /checksum mismatch/);
});

void test("拒绝夹带未列入 CHECKSUMS 的文件", () => {
  const listed: Array<[string, Buffer]> = [[MANIFEST_ENTRY, MANIFEST]];
  const zip = makeZip([
    { name: MANIFEST_ENTRY, data: MANIFEST },
    { name: "stowaway.js", data: Buffer.from("payload") }, // 未列入
    { name: CHECKSUMS_ENTRY, data: checksumsFor(listed) },
  ]);
  assert.throws(() => verifyIntegrity(readPackage(zip)), /not listed in CHECKSUMS/);
});

void test("拒绝 CHECKSUMS 列了但包里没有的文件", () => {
  const claimed: Array<[string, Buffer]> = [
    [MANIFEST_ENTRY, MANIFEST],
    ["resources/missing.txt", RESOURCE],
  ];
  const zip = makeZip([
    { name: MANIFEST_ENTRY, data: MANIFEST },
    { name: CHECKSUMS_ENTRY, data: checksumsFor(claimed) },
  ]);
  assert.throws(() => verifyIntegrity(readPackage(zip)), /missing entry/);
});

void test("拒绝缺 CHECKSUMS 或缺 manifest 的包", () => {
  assert.throws(
    () => verifyIntegrity(readPackage(makeZip([{ name: MANIFEST_ENTRY, data: MANIFEST }]))),
    /missing CHECKSUMS/,
  );
  const noManifest: Array<[string, Buffer]> = [["resources/tpl.txt", RESOURCE]];
  const zip = makeZip([
    { name: "resources/tpl.txt", data: RESOURCE },
    { name: CHECKSUMS_ENTRY, data: checksumsFor(noManifest) },
  ]);
  assert.throws(() => verifyIntegrity(readPackage(zip)), /missing ruyin\.product\.yaml/);
});

void test("CHECKSUMS 解析：拒绝畸形行与穿越路径", () => {
  assert.throws(() => parseChecksums("not-a-checksum-line"), /malformed/);
  assert.throws(
    () => parseChecksums(`${"0".repeat(64)}  ../escape.txt`),
    /path traversal/,
  );
  assert.throws(() => parseChecksums(""), /empty/);
});
