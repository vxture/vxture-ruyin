/**
 * `ruyin pack` / `ruyin registry` and the zip writer under them.
 *
 * The CLI is driven as a subprocess (main.ts exits at module scope); the
 * writer and the packer are also exercised in-process for the branches a
 * happy CLI run never reaches. The container is checked with a tiny reader
 * here (EOCD -> central directory -> local headers) and the CRC against
 * node:zlib's own crc32 - the runtime's full reader gets its turn in
 * apps/local-host's end-to-end test.
 */

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { crc32 as zlibCrc32 } from "node:zlib";
import { buildRegistry, packProduct, PackError, CHECKSUMS, INDEX_SCHEMA } from "./pack.js";
import { crc32, writeZip } from "./zip.js";

const CLI = fileURLToPath(new URL("./main.js", import.meta.url));

function contract(id = "test.pack", version = "1.2.3"): string {
  return `contract: "0.1"
product:
  id: ${id}
  name: 打包测试
  version: ${version}
  publisher: vxture
  runtime:
    minimum: 0.1.0
project:
  type: project
  operations: [create, open]
objects:
  - id: root
    name: 根对象
    primary: true
states:
  object: root
  initial: draft
  items:
    - name: draft
      transitions: []
context:
  types:
    - id: doc
      name: 文档
      required: true
      sources: [local]
      class: source
      sensitivity: low
capabilities:
  - id: analyze
    kind: analysis
    description: 分析
tools:
  - id: read_file
    category: local_read
    risk: low
    default: allow
    input_schema:
      type: object
      properties:
        path: { type: string, x-ruyin-ref: path }
      required: [path]
tasks:
  - id: run
    objective: 跑一次
    input_types: [doc]
    output_types: []
    capabilities: [analyze]
    tools: [read_file]
    verification:
      - { id: check, kind: automated }
permissions:
  local_read: allow
  local_write: ask
  delete: ask
  external_send: ask
  sync_to_cloud: ask
sync:
  default: local_only
  classes:
    - { class: source, policy: local_only }
`;
}

function productDir(root: string, name: string, id?: string, version?: string): string {
  const dir = join(root, name);
  mkdirSync(join(dir, "resources"), { recursive: true });
  writeFileSync(join(dir, "ruyin.product.yaml"), contract(id, version), "utf8");
  writeFileSync(join(dir, "resources", "template.md"), "# 模板\n", "utf8");
  writeFileSync(join(dir, ".gitkeep"), "", "utf8");
  return dir;
}

/** Just enough zip reading to check what the writer wrote. */
function readStoredZip(buf: Buffer): Map<string, { data: Buffer; crc: number }> {
  const eocd = buf.length - 22;
  assert.equal(buf.readUInt32LE(eocd), 0x06054b50, "EOCD signature");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, { data: Buffer; crc: number }>();
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50, "central signature");
    assert.equal(buf.readUInt16LE(p + 10), 0, "stored");
    const crc = buf.readUInt32LE(p + 16);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    assert.equal(buf.readUInt32LE(local), 0x04034b50, "local signature");
    const lName = buf.readUInt16LE(local + 26);
    const lExtra = buf.readUInt16LE(local + 28);
    const start = local + 30 + lName + lExtra;
    out.set(name, { data: buf.subarray(start, start + size), crc });
    p += 46 + nameLen;
  }
  return out;
}

function run(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

test("zip: stored entries, correct CRCs, deterministic bytes, and the names the reader would refuse are refused here", () => {
  const entries = [
    { name: "ruyin.product.yaml", data: Buffer.from("a: 1\n") },
    { name: "resources/模板.md", data: Buffer.from("# 模板\n") },
    { name: "empty", data: Buffer.alloc(0) },
  ];
  const zip = writeZip(entries);
  const back = readStoredZip(zip);
  assert.deepEqual([...back.keys()], entries.map((e) => e.name));
  for (const e of entries) {
    assert.ok(back.get(e.name)!.data.equals(e.data));
    assert.equal(back.get(e.name)!.crc, zlibCrc32(e.data) >>> 0);
    assert.equal(crc32(e.data), zlibCrc32(e.data) >>> 0);
  }
  assert.ok(writeZip(entries).equals(zip), "same input, same bytes");

  for (const bad of ["", "/abs", "C:win", "a/../b", "./x", "a\\b"]) {
    assert.throws(() => writeZip([{ name: bad, data: Buffer.alloc(0) }]), /illegal zip entry name/);
  }
  assert.throws(
    () => writeZip([{ name: "x", data: Buffer.alloc(0) }, { name: "x", data: Buffer.alloc(0) }]),
    /duplicate zip entry/,
  );
});

test("packProduct: manifest + files + CHECKSUMS covering all of them, no SIGNATURE, .gitkeep left out, unsigned said out loud", () => {
  const root = mkdtempSync(join(tmpdir(), "ruyin-pack-"));
  try {
    const packed = packProduct(productDir(root, "bid"));
    assert.equal(packed.id, "test.pack");
    assert.equal(packed.version, "1.2.3");
    assert.equal(packed.fileName, "test.pack-1.2.3.ruyinpkg");
    assert.equal(packed.signed, false);
    assert.deepEqual(packed.entries, ["resources/template.md", "ruyin.product.yaml", CHECKSUMS]);
    const back = readStoredZip(packed.buffer);
    const sums = back.get(CHECKSUMS)!.data.toString("utf8").trim().split("\n");
    assert.equal(sums.length, 2);
    for (const line of sums) {
      const [hash, name] = line.split("  ");
      assert.equal(hash, createHash("sha256").update(back.get(name!)!.data).digest("hex"));
    }
    assert.equal(packed.sha256, createHash("sha256").update(packed.buffer).digest("hex"));
    assert.ok(!back.has("SIGNATURE"));
    assert.ok(!back.has(".gitkeep"));

    assert.throws(() => packProduct(join(root, "nope")), (e: unknown) => e instanceof PackError && /no ruyin.product.yaml/.test(e.message));
    writeFileSync(join(root, "bid", "ruyin.product.yaml"), "contract: [", "utf8");
    assert.throws(() => packProduct(join(root, "bid")), /manifest parse error/);
    writeFileSync(join(root, "bid", "ruyin.product.yaml"), contract().replace("risk: low", "risk: high").replace("category: local_read", "category: local_write"), "utf8");
    assert.throws(() => packProduct(join(root, "bid")), /contract invalid .* R7/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildRegistry: one package per product, index.json with url/sha256/size/signed, SHA256SUMS; empty dir, duplicate id and a non-http base are errors", () => {
  const root = mkdtempSync(join(tmpdir(), "ruyin-reg-"));
  try {
    productDir(root, "a", "test.a", "1.0.0");
    productDir(root, "b", "test.b", "2.0.0");
    mkdirSync(join(root, "not-a-product"));
    const out = join(root, "out");
    const index = buildRegistry({ productsDir: root, outDir: out, baseUrl: "https://dl.example.test/ruyin/products/", now: () => "t" });
    assert.equal(index.schema, INDEX_SCHEMA);
    assert.equal(index.generatedAt, "t");
    assert.equal(index.baseUrl, "https://dl.example.test/ruyin/products");
    assert.deepEqual(index.items.map((i) => [i.id, i.version, i.url, i.signed]), [
      ["test.a", "1.0.0", "https://dl.example.test/ruyin/products/test.a/test.a-1.0.0.ruyinpkg", false],
      ["test.b", "2.0.0", "https://dl.example.test/ruyin/products/test.b/test.b-2.0.0.ruyinpkg", false],
    ]);
    for (const item of index.items) {
      const file = join(out, item.file);
      assert.ok(existsSync(file));
      const bytes = readFileSync(file);
      assert.equal(bytes.length, item.size);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), item.sha256);
    }
    const written = JSON.parse(readFileSync(join(out, "index.json"), "utf8")) as { items: unknown[] };
    assert.equal(written.items.length, 2);
    assert.match(readFileSync(join(out, "SHA256SUMS"), "utf8"), /test\.a\/test\.a-1\.0\.0\.ruyinpkg/);

    assert.throws(() => buildRegistry({ productsDir: join(root, "not-a-product"), outDir: out, baseUrl: "https://x" }), /no product directories/);
    assert.throws(() => buildRegistry({ productsDir: root, outDir: out, baseUrl: "ftp://x" }), /must be http\(s\)/);
    productDir(root, "c", "test.a", "1.0.1");
    assert.throws(() => buildRegistry({ productsDir: root, outDir: out, baseUrl: "https://x" }), /two product directories declare id test.a/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ruyin pack: writes the package, reports it unsigned; bad input exits 1; bad flags exit 2", () => {
  const root = mkdtempSync(join(tmpdir(), "ruyin-cli-pack-"));
  try {
    const dir = productDir(root, "p");
    const ok = run("pack", dir, "--out", join(root, "dist"));
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /\[pack\] test.pack@1.2.3 -> /);
    assert.match(ok.stdout, /unsigned/);
    assert.ok(existsSync(join(root, "dist", "test.pack-1.2.3.ruyinpkg")));

    const missing = run("pack", join(root, "nope"));
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /ruyin pack: no ruyin.product.yaml/);

    assert.equal(run("pack").status, 2);
    assert.equal(run("pack", dir, "--bogus", "x").status, 2);
    assert.equal(run("pack", dir, "--out").status, 2);
    assert.match(run("pack").stderr, /usage: ruyin lint/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ruyin registry: builds the static registry and lists each package; missing flags exit 2; empty input exits 1", () => {
  const root = mkdtempSync(join(tmpdir(), "ruyin-cli-reg-"));
  try {
    productDir(root, "p", "test.p", "0.9.0");
    const out = join(root, "registry");
    const ok = run("registry", root, "--out", out, "--base-url", "https://dl.example.test/p");
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /\[registry\] test.p@0.9.0 \d+ bytes unsigned/);
    assert.match(ok.stdout, /1 package\(s\)/);
    assert.ok(existsSync(join(out, "index.json")));

    assert.equal(run("registry", root, "--out", out).status, 2);
    assert.equal(run("registry").status, 2);
    const empty = run("registry", join(root, "registry"), "--out", out, "--base-url", "https://x");
    assert.equal(empty.status, 1);
    assert.match(empty.stderr, /no product directories/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ruyin pack/registry: --out defaults to cwd; a positional where a flag belongs is a usage error; a filesystem error is not swallowed as a pack error", () => {
  const root = mkdtempSync(join(tmpdir(), "ruyin-cli-misc-"));
  try {
    const dir = productDir(root, "p");
    const here = spawnSync(process.execPath, [CLI, "pack", dir], { encoding: "utf8", cwd: root });
    assert.equal(here.status, 0, here.stderr);
    assert.ok(existsSync(join(root, "test.pack-1.2.3.ruyinpkg")));

    assert.equal(run("pack", dir, "out").status, 2);

    // --out pointing at an existing file: mkdirSync throws a real fs error, and
    // the CLI must not dress that up as "ruyin pack: ..." - it crashes loudly.
    const blocker = join(root, "blocker");
    writeFileSync(blocker, "x");
    const crash = run("pack", dir, "--out", join(blocker, "sub"));
    assert.notEqual(crash.status, 0);
    assert.doesNotMatch(crash.stderr, /ruyin pack:/);
    const crash2 = run("registry", root, "--out", join(blocker, "sub"), "--base-url", "https://x");
    assert.notEqual(crash2.status, 0);
    assert.doesNotMatch(crash2.stderr, /ruyin registry:/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
