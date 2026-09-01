/**
 * loadProducts (products.ts): dev-mode product directory scan. Had no test
 * file at all. It fails silently by design (a bad product is skipped into
 * `failed`, never thrown) - which is exactly why the skip conditions need
 * pinning down: get one wrong and a product silently stops appearing, with
 * nothing in the way of an error to explain why.
 */

import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadProducts } from "./products.js";

const VALID = `contract: "0.1"
product:
  id: test.products-scan
  name: 扫描测试
  version: 1.0.0
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

/** 结构合法但 R7 不过：高风险工具默认 allow。 */
const SEMANTICALLY_INVALID = VALID.replace("test.products-scan", "test.semantically-bad")
  .replace("risk: low", "risk: high")
  .replace("category: local_read", "category: local_write");

function makeProduct(dir: string, name: string, yaml: string | undefined): void {
  const productDir = join(dir, name);
  mkdirSync(productDir, { recursive: true });
  if (yaml !== undefined) {
    writeFileSync(join(productDir, "ruyin.product.yaml"), yaml, "utf8");
  }
}

void test("loadProducts: a directory that does not exist yields empty, not a throw", () => {
  const scan = loadProducts(join(tmpdir(), "ruyin-products-does-not-exist-anywhere"));
  assert.deepEqual(scan, { loaded: [], failed: [] });
});

void test("loadProducts: a valid product loads with id/name/version/path/contract", () => {
  const dir = mkdtempSync(join(tmpdir(), "ruyin-products-"));
  try {
    makeProduct(dir, "good", VALID);
    const scan = loadProducts(dir);
    assert.deepEqual(scan.failed, []);
    assert.equal(scan.loaded.length, 1);
    const p = scan.loaded[0]!;
    assert.equal(p.id, "test.products-scan");
    assert.equal(p.name, "扫描测试");
    assert.equal(p.version, "1.0.0");
    assert.equal(p.path, join(dir, "good", "ruyin.product.yaml"));
    assert.equal(p.contract.product.id, "test.products-scan");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("loadProducts: a directory without the manifest file is silently skipped", () => {
  const dir = mkdtempSync(join(tmpdir(), "ruyin-products-"));
  try {
    makeProduct(dir, "no-manifest", undefined);
    const scan = loadProducts(dir);
    assert.deepEqual(scan, { loaded: [], failed: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("loadProducts: a plain file next to the product dirs is not mistaken for one", () => {
  const dir = mkdtempSync(join(tmpdir(), "ruyin-products-"));
  try {
    writeFileSync(join(dir, "README.md"), "not a product dir", "utf8");
    const scan = loadProducts(dir);
    assert.deepEqual(scan, { loaded: [], failed: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("loadProducts: invalid YAML fails as L1 with a parse-error message, not a throw", () => {
  const dir = mkdtempSync(join(tmpdir(), "ruyin-products-"));
  try {
    makeProduct(dir, "bad-yaml", "product:\n  id: [unterminated\n");
    const scan = loadProducts(dir);
    assert.equal(scan.loaded.length, 0);
    assert.equal(scan.failed.length, 1);
    assert.equal(scan.failed[0]!.errors[0]!.rule, "L1");
    assert.match(scan.failed[0]!.errors[0]!.message, /YAML parse error/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("loadProducts: YAML that parses but fails the R-series rules is reported, not thrown", () => {
  const dir = mkdtempSync(join(tmpdir(), "ruyin-products-"));
  try {
    makeProduct(dir, "bad-semantics", SEMANTICALLY_INVALID);
    const scan = loadProducts(dir);
    assert.equal(scan.loaded.length, 0);
    assert.equal(scan.failed.length, 1);
    assert.ok(scan.failed[0]!.errors.length > 0);
    assert.notEqual(scan.failed[0]!.errors[0]!.rule, "L1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("loadProducts: a mixed directory reports each product independently", () => {
  const dir = mkdtempSync(join(tmpdir(), "ruyin-products-"));
  try {
    makeProduct(dir, "good", VALID);
    makeProduct(dir, "bad-yaml", "not: [valid\n");
    makeProduct(dir, "no-manifest", undefined);
    const scan = loadProducts(dir);
    assert.equal(scan.loaded.length, 1);
    assert.equal(scan.loaded[0]!.id, "test.products-scan");
    assert.equal(scan.failed.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
