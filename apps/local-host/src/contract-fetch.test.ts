/**
 * 一级供给：契约拉取（ADR-012 / 30-contract-schema §18.3）。
 *
 * 这些用例钉的是两件容易在后续改动里松掉的事：
 *   1. 拉不到 ≠ 本地那份坏了 —— 网络类失败一律 offline，缓存继续用（ADR-003）
 *   2. 契约本身不可接受要显式失败，且**绝不落盘** —— 半个产品比没有产品更糟
 */

import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ContractFetchError, fetchContract, sourceOf } from "./contract-fetch.js";
import { ProductRegistry } from "./product-registry.js";

const CONTRACT = `contract: "0.1"
product:
  id: test.demo
  name: 演示产品
  version: 1.2.0
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
    - id: report
      name: 报告
      required: false
      sources: [project]
      class: generated
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
    output_types: [report]
    capabilities: [analyze]
    tools: [read_file]
    verification:
      - { id: check, kind: automated }
      - { id: human_review, kind: human }
permissions:
  local_read: allow
  local_write: ask
  delete: ask
  external_send: ask
  sync_to_cloud: ask
sync:
  default: local_only
  classes:
    - { class: source,    policy: local_only }
    - { class: generated, policy: manual }
`;

function store(): string {
  return join(mkdtempSync(join(tmpdir(), "ruyin-fetch-")), "products");
}

/** 一个只回答契约端点的假 fetch。 */
function stub(
  body: string | (() => never),
  init: { status?: number } = {},
): typeof fetch {
  return (async () => {
    if (typeof body === "function") body();
    return new Response(body as string, {
      status: init.status ?? 200,
      headers: { "content-type": "application/yaml" },
    });
  }) as unknown as typeof fetch;
}

const BASE = { baseUrl: "https://caps.example.test", fetchImpl: stub(CONTRACT) };

void test("拉取：校验通过后按版本落盘，并记下来源", async () => {
  const storeDir = store();
  const r = await fetchContract("test.demo", { ...BASE, storeDir });

  assert.equal(r.status, "fetched");
  assert.equal(r.status === "fetched" && r.version, "1.2.0");
  const dir = join(storeDir, "test.demo", "1.2.0");
  assert.ok(existsSync(join(dir, "ruyin.product.yaml")));
  assert.equal(sourceOf(dir)?.origin, "contract_fetch");
});

void test("拉取：同版本重复拉不写盘，内容一致时不报差异", async () => {
  const storeDir = store();
  await fetchContract("test.demo", { ...BASE, storeDir });
  const again = await fetchContract("test.demo", { ...BASE, storeDir });

  assert.equal(again.status, "current");
  assert.equal(again.status === "current" && again.remoteDiffers, false);
});

void test("拉取：同版本内容变了 → 保留本地那份，并把差异报出来", async () => {
  const storeDir = store();
  await fetchContract("test.demo", { ...BASE, storeDir });

  // 同一个 version，换了内容 —— 产品违反了 §18.4 的版本兼容规则。
  const tampered = CONTRACT.replace("name: 演示产品", "name: 换了个名字");
  const again = await fetchContract("test.demo", {
    ...BASE,
    storeDir,
    fetchImpl: stub(tampered),
  });

  assert.equal(again.status, "current");
  assert.equal(again.status === "current" && again.remoteDiffers, true);
  // 关键：静默采纳会把产品这个错误藏起来，所以本地那份必须原样还在。
  const onDisk = readFileSync(
    join(storeDir, "test.demo", "1.2.0", "ruyin.product.yaml"),
    "utf8",
  );
  assert.ok(onDisk.includes("演示产品"));
});

void test("拉取：网络不通 → offline，并如实报出缓存里有哪些版本", async () => {
  const storeDir = store();
  await fetchContract("test.demo", { ...BASE, storeDir });

  const r = await fetchContract("test.demo", {
    ...BASE,
    storeDir,
    fetchImpl: stub(() => {
      throw new Error("ECONNREFUSED");
    }),
  });

  assert.equal(r.status, "offline");
  assert.deepEqual(r.status === "offline" && r.cachedVersions, ["1.2.0"]);
});

void test("拉取：503 / 404 / 403 一律 offline，不把本地那份判成无效", async () => {
  for (const status of [503, 404, 403]) {
    const storeDir = store();
    const r = await fetchContract("test.demo", {
      ...BASE,
      storeDir,
      fetchImpl: stub("nope", { status }),
    });
    assert.equal(r.status, "offline", `status ${status}`);
  }
});

void test("拉取：契约校验不过 → 抛错，且什么都不落盘", async () => {
  const storeDir = store();
  await assert.rejects(
    fetchContract("test.demo", {
      ...BASE,
      storeDir,
      // 任务引用一个没声明的工具 —— 悬空引用属 R 系规则，必须由校验挡住。
      fetchImpl: stub(CONTRACT.replace("tools: [read_file]", "tools: [no_such_tool]")),
    }),
    // 断言到「校验不过」这条路径上：解析失败抛的是同一个类型，只认类型的话
    // 这条用例在校验被绕过时仍会通过。
    (e: Error) =>
      e instanceof ContractFetchError && /contract invalid/.test(e.message),
  );
  assert.equal(existsSync(join(storeDir, "test.demo")), false);
});

void test("拉取：回来的契约自称是另一个产品 → 拒收", async () => {
  const storeDir = store();
  await assert.rejects(
    fetchContract("test.other", { ...BASE, storeDir }),
    (e: Error) =>
      e instanceof ContractFetchError && /identifies as "test\.demo"/.test(e.message),
  );
  assert.equal(existsSync(join(storeDir, "test.other")), false);
});

void test("拉取：非法产品 id 在发请求之前就被挡住", async () => {
  await assert.rejects(
    fetchContract("../../etc", { ...BASE, storeDir: store() }),
    ContractFetchError,
  );
});

void test("registry: 拉来的契约与装的包分得开（supply）", async () => {
  const root = mkdtempSync(join(tmpdir(), "ruyin-data-"));
  const productsDir = mkdtempSync(join(tmpdir(), "ruyin-prod-"));
  const storeDir = join(root, "products");
  await fetchContract("test.demo", { ...BASE, storeDir });

  const registry = new ProductRegistry(productsDir, root);
  const view = registry.list().find((p) => p.id === "test.demo");
  assert.equal(view?.supply, "contract_fetch");
  assert.equal(view?.managed, true);

  // 没有来源标记的版本目录 = .ruyinpkg 装的；保守方向不能反过来。
  const pkgDir = join(storeDir, "test.demo", "1.3.0");
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, "ruyin.product.yaml"),
    CONTRACT.replace("version: 1.2.0", "version: 1.3.0"),
  );
  const registry2 = new ProductRegistry(productsDir, root);
  assert.equal(
    registry2.list().find((p) => p.id === "test.demo")?.supply,
    "package",
  );
});
