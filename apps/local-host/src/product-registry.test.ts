/**
 * 产品可用性规则（30-contract-schema §18.5 + owner 口径）：
 *   平台订阅了 → 本地可用；0 订阅 → 本地无可用产品，但运行环境与本地数据仍在。
 * 这些用例把「已安装 ≠ 可用」钉死，防止回退成"装了就能开"。
 */

import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ProductRegistry,
  availabilityOf,
  commercialIntent,
  type SubscriptionFacts,
} from "./product-registry.js";

const CONTRACT = `contract: "0.1"
product:
  id: test.demo
  name: 演示产品
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

function makeDirs(): { productsDir: string; dataDir: string } {
  const productsDir = mkdtempSync(join(tmpdir(), "ruyin-prod-"));
  const dataDir = mkdtempSync(join(tmpdir(), "ruyin-data-"));
  mkdirSync(join(productsDir, "demo"), { recursive: true });
  writeFileSync(join(productsDir, "demo", "ruyin.product.yaml"), CONTRACT);
  return { productsDir, dataDir };
}

void test("availabilityOf: 订阅未知按可用（不因查不到而锁死用户）", () => {
  assert.equal(availabilityOf(true, null).availability, "available");
});

void test("availabilityOf: 明确未订阅 → 不可打开（§18.5）", () => {
  const r = availabilityOf(true, false);
  assert.equal(r.availability, "not_entitled");
  // 导出已落地（TD-020），这句话现在说得全了。
  assert.match(r.reason ?? "", /可访问、可导出/);
});

void test("availabilityOf: 本机停用 → 不可打开，与订阅无关", () => {
  assert.equal(availabilityOf(false, true).availability, "disabled");
});

void test("registry: 已安装且订阅未知 → 可用，可新建", () => {
  const { productsDir, dataDir } = makeDirs();
  try {
    const reg = new ProductRegistry(productsDir, dataDir);
    const [p] = reg.list();
    assert.equal(p?.id, "test.demo");
    assert.equal(p?.installed, true);
    assert.equal(p?.entitled, null);
    assert.equal(p?.availability, "available");
    assert.equal(reg.blockedReason("test.demo"), null);
  } finally {
    rmSync(productsDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  }
});

void test("registry: 平台判定未订阅 → 不可打开，但产品仍在列表（数据可达）", async () => {
  const { productsDir, dataDir } = makeDirs();
  try {
    const reg = new ProductRegistry(productsDir, dataDir);
    await reg.refreshEntitlements(() => ({
      "test.demo": {
        status: "expired",
        tier: null,
        bundled: false,
        trialEndsAt: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      },
    }));
    const [p] = reg.list();
    assert.equal(p?.entitled, false);
    assert.equal(p?.availability, "not_entitled");
    assert.ok(reg.blockedReason("test.demo"));
    // 关键：产品没有从列表里消失，契约仍可读 —— 数据主权底线。
    assert.equal(reg.list().length, 1);
    assert.ok(reg.contractOf("test.demo"));
  } finally {
    rmSync(productsDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  }
});

void test("registry: 订阅解析失败保持未知，不误判为未订阅", async () => {
  const { productsDir, dataDir } = makeDirs();
  try {
    const reg = new ProductRegistry(productsDir, dataDir);
    await reg.refreshEntitlements(() => {
      throw new Error("endpoint unreachable");
    });
    assert.equal(reg.list()[0]?.entitled, null);
    assert.equal(reg.blockedReason("test.demo"), null);
  } finally {
    rmSync(productsDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  }
});

void test("registry: 停用状态持久化，重启后仍停用", () => {
  const { productsDir, dataDir } = makeDirs();
  try {
    const first = new ProductRegistry(productsDir, dataDir);
    first.setActive("test.demo", false);
    assert.equal(first.list()[0]?.availability, "disabled");
    const reopened = new ProductRegistry(productsDir, dataDir);
    assert.equal(reopened.list()[0]?.state, "inactive");
    assert.equal(reopened.list()[0]?.availability, "disabled");
  } finally {
    rmSync(productsDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  }
});

void test("registry: 未安装的产品一律被挡", () => {
  const { productsDir, dataDir } = makeDirs();
  try {
    const reg = new ProductRegistry(productsDir, dataDir);
    assert.match(reg.blockedReason("nope.missing")?.reason ?? "", /未安装/);
    // 未装的产品必须也被挡住 —— 忘了先 find 的调用方不该拿到「没挡」。
    assert.equal(
      reg.blockedReason("nope.missing")?.availability,
      "not_installed",
    );
  } finally {
    rmSync(productsDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  }
});

/**
 * C2 信封保真（TD-014 D4）。这些用例钉的是同一件事：**压成布尔会让界面永远
 * 显示同一个错的行动入口** —— 该引导首购的地方显示续费，或者反过来。
 */
function facts(over: Partial<SubscriptionFacts> = {}): SubscriptionFacts {
  return {
    status: null,
    tier: null,
    bundled: false,
    trialEndsAt: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    ...over,
  };
}

void test("行动入口：从未订阅 → 首购", () => {
  assert.equal(commercialIntent(facts({ status: null })), "subscribe");
});

void test("行动入口：曾有已失效 → 续费，不是首购", () => {
  for (const status of ["expired", "cancelled", "canceled", "suspended"]) {
    assert.equal(commercialIntent(facts({ status })), "renew", status);
  }
});

void test("行动入口：已订阅且在有效期内 → 不显示商业入口", () => {
  assert.equal(commercialIntent(facts({ status: "active", tier: "pro" })), null);
});

void test("行动入口：被捆绑覆盖且无独立 tier → 不显示（界面公式 ≠ 数据面公式）", () => {
  const bundled = facts({ status: null, tier: null, bundled: true });
  // 数据面：能打开（tier != null || bundled）。
  // 界面：**不该给他一个订阅动作** —— 这正是两个公式混用时踩的坑。
  assert.equal(commercialIntent(bundled), null);
});

void test("行动入口：订阅未知 → 不猜，不显示", () => {
  assert.equal(commercialIntent(null), null);
});

void test("registry: 信封保真 —— status 与到期日不被压掉", async () => {
  const { productsDir, dataDir } = makeDirs();
  try {
    const reg = new ProductRegistry(productsDir, dataDir);
    await reg.refreshEntitlements(() => ({
      "test.demo": facts({
        status: "trialing",
        tier: "pro",
        trialEndsAt: "2026-10-01T00:00:00Z",
      }),
    }));
    const view = reg.list()[0];
    assert.equal(view?.subscription?.status, "trialing");
    assert.equal(view?.subscription?.trialEndsAt, "2026-10-01T00:00:00Z");
    // 试用中是有权益的，数据面放行。
    assert.equal(view?.entitled, true);
  } finally {
    rmSync(productsDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  }
});
