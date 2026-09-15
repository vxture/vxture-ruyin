/**
 * capability-catalog.ts（RY-204）的测试。
 *
 * 钉的是设计稿里写成规则的那几句：拿不到就说拿不到（四种状态各自成立）、五步缺一步
 * 不落盘（条数对不上、条目不合格、分页不前进都不能留下半份）、焦点回来要节流、「本机
 * 可运行」只按能核对的规则标。
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CapabilityCatalog,
  FOCUS_REFRESH_MIN_MS,
  MAX_PAGES,
  catalogPath,
  contentRef,
  diffCatalog,
  localRunnableIndex,
  normalizeEntry,
  parsePlatformPage,
  platformCatalogSource,
  shouldRefresh,
  skillCapabilityId,
  type CatalogEntry,
  type CatalogPage,
  type CatalogSource,
} from "./capability-catalog.js";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "ruyin-catalog-"));
}

const raw = (id: string, extra: Record<string, unknown> = {}) => ({
  capability_id: id,
  primitive_type: "skill",
  title: id,
  ...extra,
});

/** 按给定的页序列回答的数据源；`available` 可切换。 */
function pagedSource(pages: CatalogPage[], available = true): CatalogSource & { calls: Array<string | undefined> } {
  const calls: Array<string | undefined> = [];
  return {
    calls,
    available: () => available,
    unavailableReason: "测试：没有来源",
    fetchPage(cursor) {
      calls.push(cursor);
      const i = cursor === undefined ? 0 : Number(cursor);
      const page = pages[i];
      if (!page) return Promise.reject(new Error(`no page ${cursor}`));
      return Promise.resolve(page);
    },
  };
}

// ---------------------------------------------------------------------------
// 纯函数
// ---------------------------------------------------------------------------

void test("normalizeEntry：snake 与 camel 都认；缺身份键、类型不认识、缺 title 各说各的", () => {
  const snake = normalizeEntry({
    capability_id: "addyosmani.api-design",
    primitive_type: "skill",
    title: "API Design",
    display_name: { "zh-CN": "接口设计", en: "API Design", ja: "" },
    category: "development",
    tags: ["preset", 3, "api"],
    summary: "Guides API design.",
  });
  assert.deepEqual(snake, {
    capabilityId: "addyosmani.api-design",
    primitiveType: "skill",
    title: "API Design",
    displayName: { "zh-CN": "接口设计", en: "API Design" },
    category: "development",
    tags: ["preset", "api"],
    summary: "Guides API design.",
  });
  const camel = normalizeEntry({ capabilityId: "markitdown.document-to-markdown", primitiveType: "connector", title: "MarkItDown" });
  assert.deepEqual(camel, { capabilityId: "markitdown.document-to-markdown", primitiveType: "connector", title: "MarkItDown", tags: [] });

  assert.equal(normalizeEntry(null), "条目不是对象");
  assert.equal(normalizeEntry([]), "条目不是对象");
  assert.equal(normalizeEntry({ title: "x" }), "条目缺 capability_id");
  assert.match(String(normalizeEntry({ capability_id: "a", primitive_type: "widget", title: "a" })), /primitive_type 不认识（widget）/);
  assert.match(String(normalizeEntry({ capability_id: "a", title: "a" })), /primitive_type 不认识（缺）/);
  assert.equal(normalizeEntry({ capability_id: "a", primitive_type: "executor" }), "a: 缺 title");
  // 显示名全是空串 = 平台没给，不留一个空对象。
  assert.equal((normalizeEntry(raw("a", { display_name: { en: "" } })) as CatalogEntry).displayName, undefined);
  assert.equal((normalizeEntry(raw("a", { display_name: ["x"] })) as CatalogEntry).displayName, undefined);
});

void test("contentRef：与顺序无关，内容变了才变", () => {
  const a = normalizeEntry(raw("a")) as CatalogEntry;
  const b = normalizeEntry(raw("b")) as CatalogEntry;
  assert.equal(contentRef([a, b]), contentRef([b, a]));
  assert.match(contentRef([a]), /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(contentRef([a, b]), contentRef([a, { ...b, title: "B" }]));
});

void test("diffCatalog：新增、下线、变更分开数", () => {
  const e = (id: string, title = id): CatalogEntry => ({ capabilityId: id, primitiveType: "skill", title, tags: [] });
  assert.deepEqual(diffCatalog([e("a"), e("b"), e("c")], [e("a"), e("b", "B"), e("d")]), { added: 1, removed: 1, changed: 1 });
  assert.deepEqual(diffCatalog([], [e("a")]), { added: 1, removed: 0, changed: 0 });
});

void test("shouldRefresh（D3）：登录与手动总取；焦点回来不足 6 小时不取；时间读不懂就取", () => {
  const now = Date.parse("2026-09-15T12:00:00Z");
  const recent = new Date(now - FOCUS_REFRESH_MIN_MS + 1000).toISOString();
  const old = new Date(now - FOCUS_REFRESH_MIN_MS).toISOString();
  assert.equal(shouldRefresh("login", recent, now), true);
  assert.equal(shouldRefresh("manual", recent, now), true);
  assert.equal(shouldRefresh("focus", recent, now), false);
  assert.equal(shouldRefresh("focus", old, now), true);
  assert.equal(shouldRefresh("focus", undefined, now), true);
  assert.equal(shouldRefresh("focus", "not a date", now), true);
});

void test("本机可运行（D4）：技能只认预置层、启用、没被盖住的；连接器只认显式对照；执行器恒为否", () => {
  assert.equal(skillCapabilityId({ source: "opensensenova.sensenova-skills", name: "sn-deep-research" }), "opensensenova.sn-deep-research");
  const index = localRunnableIndex(
    {
      skills: [
        { name: "sn-deep-research", source: "opensensenova.sensenova-skills", layer: "bundled", enabled: true },
        { name: "pdf", source: "openai.skills", layer: "bundled", enabled: false },
        { name: "docx", source: "anthropics.skills", layer: "bundled", enabled: true, shadowedBy: "user" },
        { name: "slides", source: "my-dir", layer: "user", enabled: true },
      ],
      servers: [
        { id: "microsoft.markitdown", available: true },
        { id: "haris-musa.excel-mcp-server", available: false },
      ],
    },
    {
      "markitdown.document-to-markdown": "microsoft.markitdown",
      "excel.connector": "haris-musa.excel-mcp-server",
    },
  );
  const e = (capabilityId: string, primitiveType: CatalogEntry["primitiveType"]): CatalogEntry => ({ capabilityId, primitiveType, title: capabilityId, tags: [] });
  assert.deepEqual(index(e("opensensenova.sn-deep-research", "skill")), { runnable: true, via: "preset-skill" });
  assert.deepEqual(index(e("openai.pdf", "skill")), { runnable: false }, "停用的不算");
  assert.deepEqual(index(e("anthropics.docx", "skill")), { runnable: false }, "被盖住的不算");
  assert.deepEqual(index(e("my-dir.slides", "skill")), { runnable: false }, "用户层同名的不是 Runos 那一个");
  assert.deepEqual(index(e("markitdown.document-to-markdown", "connector")), { runnable: true, via: "bundled-server" });
  assert.deepEqual(index(e("excel.connector", "connector")), { runnable: false }, "对照到了但此刻起不来");
  assert.deepEqual(index(e("microsoft.markitdown", "connector")), { runnable: false }, "不按名字猜");
  assert.deepEqual(index(e("markitdown.document-to-markdown", "executor")), { runnable: false });

  // 缺省对照表为空：没有任何连接器被标成本机可运行。
  const plain = localRunnableIndex({ skills: [] });
  assert.deepEqual(plain(e("markitdown.document-to-markdown", "connector")), { runnable: false });
});

void test("parsePlatformPage：items / capabilities、nextCursor / next_cursor 都认；缺 total 或不是对象要拒", () => {
  assert.deepEqual(parsePlatformPage({ items: [1], total: 1, nextCursor: "c2", version: "v9" }), {
    items: [1],
    total: 1,
    nextCursor: "c2",
    version: "v9",
  });
  assert.deepEqual(parsePlatformPage({ capabilities: [], total: 0, next_cursor: "" }, '"etag-1"'), {
    items: [],
    total: 0,
    version: '"etag-1"',
  });
  assert.throws(() => parsePlatformPage([]), /不是对象/);
  assert.throws(() => parsePlatformPage({ total: 1 }), /缺 items/);
  assert.throws(() => parsePlatformPage({ items: [], total: -1 }), /缺 total/);
  assert.throws(() => parsePlatformPage({ items: [], total: "3" }), /缺 total/);
});

void test("platformCatalogSource：没配地址就是不可用，不去打一个不存在的地址", async () => {
  let reads = 0;
  const none = platformCatalogSource({ path: undefined, signedIn: () => true, read: () => { reads++; return Promise.resolve({ body: {} }); } });
  assert.equal(none.available(), false);
  assert.match(none.unavailableReason, /vxture-platform#339/);
  await assert.rejects(none.fetchPage(undefined), /vxture-platform#339/);
  assert.equal(reads, 0);

  const seen: string[] = [];
  let signedIn = false;
  const src = platformCatalogSource({
    path: "/api/runos/capabilities",
    signedIn: () => signedIn,
    pageSize: 2,
    read: (p) => {
      seen.push(p);
      return Promise.resolve({ body: { items: [raw("a")], total: 1 }, etag: "W/1" });
    },
  });
  assert.equal(src.available(), true);
  await assert.rejects(src.fetchPage(undefined), /未登录/);
  signedIn = true;
  assert.deepEqual(await src.fetchPage(undefined), { items: [raw("a")], total: 1, version: "W/1" });
  await src.fetchPage("next token");
  assert.deepEqual(seen, ["/api/runos/capabilities?limit=2", "/api/runos/capabilities?limit=2&cursor=next+token"]);

  const withQuery = platformCatalogSource({ path: "/api/x?scope=all", signedIn: () => true, read: (p) => { seen.push(p); return Promise.resolve({ body: { items: [], total: 0 } }); } });
  await withQuery.fetchPage(undefined);
  assert.equal(seen.at(-1), "/api/x?scope=all&limit=500");
});

// ---------------------------------------------------------------------------
// 清单本体
// ---------------------------------------------------------------------------

void test("状态：没有来源且盘上没有 → unavailable；有来源没取过 → never；数据源没了但盘上有 → stale", async () => {
  const dir = tmp();
  try {
    const none = new CapabilityCatalog(dir, pagedSource([], false));
    assert.deepEqual(none.status(), { kind: "platform", state: "unavailable", reason: "测试：没有来源" });
    assert.deepEqual(await none.sync("manual"), { status: "unavailable", reason: "测试：没有来源" });
    assert.deepEqual(none.list(), { items: [], total: 0 }, "从未取到时列表是空的，不是错误");

    const src = pagedSource([{ items: [raw("a")], total: 1 }]);
    const catalog = new CapabilityCatalog(dir, src, () => Date.parse("2026-09-15T08:00:00Z"));
    assert.deepEqual(catalog.status(), { kind: "platform", state: "never" });
    const out = await catalog.sync("login");
    assert.equal(out.status, "synced");
    const synced = catalog.status();
    assert.equal(synced.state, "synced");
    assert.equal(synced.total, 1);
    assert.equal(synced.fetchedAt, "2026-09-15T08:00:00.000Z");
    assert.match(String(synced.ref), /^sha256:/);
    assert.deepEqual(synced.diff, { added: 1, removed: 0, changed: 0 });

    // 同一份盘，换一个没有来源的装配：旧条目照样可读，但要说它是旧的、为什么。
    const orphan = new CapabilityCatalog(dir, pagedSource([], false));
    assert.equal(orphan.status().state, "stale");
    assert.equal(orphan.status().reason, "测试：没有来源");
    assert.equal(orphan.list().total, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("同步：分页取到底、平台给了版本就用版本、整份原子落盘", async () => {
  const dir = tmp();
  try {
    const src = pagedSource([
      { items: [raw("a"), raw("b")], total: 3, nextCursor: "1" },
      { items: [raw("c", { primitive_type: "connector" })], total: 3, version: "catalog-v7" },
    ]);
    const catalog = new CapabilityCatalog(dir, src);
    const out = await catalog.sync("manual");
    assert.deepEqual(out, { status: "synced", total: 3, ref: "catalog-v7", diff: { added: 3, removed: 0, changed: 0 } });
    assert.deepEqual(src.calls, [undefined, "1"]);
    const stored = JSON.parse(readFileSync(catalogPath(dir), "utf8")) as { version: number; items: unknown[] };
    assert.equal(stored.version, 1);
    assert.equal(stored.items.length, 3);
    assert.equal(existsSync(`${catalogPath(dir)}.tmp`), false, "临时文件改名后不留");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("同步失败不留半份：条数对不上、条目不合格、id 重复、分页不前进、页数超限、数据源抛错", async () => {
  const cases: Array<{ pages: CatalogPage[]; error: RegExp }> = [
    { pages: [{ items: [raw("a")], total: 2 }], error: /取到 1 条，平台说共 2 条/ },
    { pages: [{ items: [raw("a"), { title: "x" }, 7, raw("b", { primitive_type: "asset?" }), raw("c", { title: "" })], total: 5 }], error: /4 条不合格：条目缺 capability_id；条目不是对象；b: primitive_type 不认识.* …/ },
    { pages: [{ items: [raw("a"), raw("a")], total: 2 }], error: /a: id 重复/ },
    { pages: [{ items: [raw("a")], total: 2, nextCursor: "1" }, { items: [raw("b")], total: 2, nextCursor: "1" }], error: /分页游标没有前进/ },
    { pages: [{ items: [], total: 0, nextCursor: "9" }], error: /no page 9/ },
  ];
  for (const c of cases) {
    const dir = tmp();
    try {
      const catalog = new CapabilityCatalog(dir, pagedSource(c.pages));
      const out = await catalog.sync("manual");
      assert.equal(out.status, "failed");
      assert.match((out as { error: string }).error, c.error);
      assert.equal(existsSync(catalogPath(dir)), false, `失败后不该落盘：${c.error}`);
      assert.deepEqual(catalog.status(), { kind: "platform", state: "never", reason: (out as { error: string }).error });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // 页数上限：一直给新游标的服务端。
  const dir = tmp();
  try {
    const endless: CatalogSource = {
      available: () => true,
      unavailableReason: "",
      fetchPage: (cursor) => Promise.resolve({ items: [], total: 0, nextCursor: String(Number(cursor ?? 0) + 1) }),
    };
    const out = await new CapabilityCatalog(dir, endless).sync("manual");
    assert.deepEqual(out, { status: "failed", error: `分页超过 ${MAX_PAGES} 页仍没有取完` });

    const throwsString: CatalogSource = { available: () => true, unavailableReason: "", fetchPage: () => Promise.reject("boom") };
    assert.deepEqual(await new CapabilityCatalog(dir, throwsString).sync("manual"), { status: "failed", error: "boom" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("刷新失败保留上一份并标 stale；再成功一次回到 synced，差异按上一份算", async () => {
  const dir = tmp();
  try {
    let pages: CatalogPage[] = [{ items: [raw("a"), raw("b")], total: 2 }];
    const source: CatalogSource = {
      available: () => true,
      unavailableReason: "",
      fetchPage: () => (pages.length ? Promise.resolve(pages[0]!) : Promise.reject(new Error("网络到不了"))),
    };
    const catalog = new CapabilityCatalog(dir, source);
    await catalog.sync("manual");
    pages = [];
    assert.deepEqual(await catalog.sync("manual"), { status: "failed", error: "网络到不了" });
    const stale = catalog.status();
    assert.equal(stale.state, "stale");
    assert.equal(stale.reason, "网络到不了");
    assert.equal(catalog.list().total, 2, "旧的一份还在");

    pages = [{ items: [raw("a", { title: "A" }), raw("c")], total: 2 }];
    const out = await catalog.sync("manual");
    assert.deepEqual((out as { diff: unknown }).diff, { added: 1, removed: 1, changed: 1 });
    assert.equal(catalog.status().state, "synced");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("焦点回来 6 小时内不重取；同时来的刷新合成一次", async () => {
  const dir = tmp();
  try {
    let now = Date.parse("2026-09-15T08:00:00Z");
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let fetches = 0;
    const source: CatalogSource = {
      available: () => true,
      unavailableReason: "",
      fetchPage: async () => {
        fetches++;
        await gate;
        return { items: [raw("a")], total: 1 };
      },
    };
    const catalog = new CapabilityCatalog(dir, source, () => now);
    const first = catalog.sync("login");
    const second = catalog.sync("manual");
    release();
    assert.deepEqual(await first, await second);
    assert.equal(fetches, 1);

    now += 60 * 60 * 1000;
    assert.deepEqual(await catalog.sync("focus"), { status: "skipped" });
    assert.equal(fetches, 1);
    now += FOCUS_REFRESH_MIN_MS;
    assert.equal((await catalog.sync("focus")).status, "synced");
    assert.equal(fetches, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("盘上那份读坏了按从未取到处理，不抛", () => {
  const dir = tmp();
  try {
    mkdirSync(join(dir, "capabilities"), { recursive: true });
    const catalog = new CapabilityCatalog(dir, pagedSource([]));
    for (const content of ["{not json", JSON.stringify({ version: 2, items: [] }), JSON.stringify({ version: 1, items: [], fetchedAt: 1, ref: "x" })]) {
      writeFileSync(catalogPath(dir), content);
      assert.equal(catalog.status().state, "never");
      assert.deepEqual(catalog.list(), { items: [], total: 0 });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("list：按原语、分类、关键词筛；按偏移量分页，limit 钳在 1..1000", async () => {
  const dir = tmp();
  try {
    const items = [
      raw("anthropics.docx", { title: "Word 文档", category: "office", tags: ["document"] }),
      raw("anthropics.pdf", { title: "PDF", category: "office", summary: "Read and fill PDF forms" }),
      raw("markitdown.document-to-markdown", { primitive_type: "connector", title: "MarkItDown", category: "document", display_name: { "zh-CN": "转成 Markdown" } }),
      raw("sandbox.python", { primitive_type: "executor", title: "Python", category: "development" }),
    ];
    await new CapabilityCatalog(dir, pagedSource([{ items, total: 4 }])).sync("manual");
    const catalog = new CapabilityCatalog(dir, pagedSource([]));

    assert.deepEqual(catalog.list({ type: "connector" }).items.map((e) => e.capabilityId), ["markitdown.document-to-markdown"]);
    assert.equal(catalog.list({ category: "office" }).total, 2);
    assert.deepEqual(catalog.list({ q: "  forms " }).items.map((e) => e.capabilityId), ["anthropics.pdf"]);
    assert.deepEqual(catalog.list({ q: "markdown" }).items.map((e) => e.capabilityId), ["markitdown.document-to-markdown"]);
    assert.deepEqual(catalog.list({ q: "DOCUMENT" }).total, 2, "标签与 id 都算");

    const p1 = catalog.list({ limit: 3 });
    assert.equal(p1.items.length, 3);
    assert.equal(p1.nextCursor, "3");
    const p2 = catalog.list({ limit: 3, cursor: p1.nextCursor });
    assert.deepEqual(p2.items.map((e) => e.capabilityId), ["sandbox.python"]);
    assert.equal(p2.nextCursor, undefined);
    assert.equal(catalog.list({ limit: 0 }).items.length, 1, "limit 至少 1");
    assert.equal(catalog.list({ limit: 5000 }).items.length, 4);
    assert.equal(catalog.list({ cursor: "garbage" }).items.length, 4, "读不懂的游标从头开始");
    assert.equal(catalog.list({ cursor: "-5" }).items.length, 4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
