/**
 * 产品界面包的取回与落盘（ADR-023 片 3b-2）。
 *
 * 钉的是 ADR 那条管线的**顺序**，因为顺序即安全顺序：
 *   - 摘要对不上的字节**一个都不解开**、一个文件都不落；
 *   - 超限当场停，不先收完；
 *   - 半截目录永远不可见；
 *   - 失败一律是「这个产品暂时没有界面」，从不抛错连累契约拉取。
 */

import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { RuyinContract } from "@vxture/ruyin-contract-schema";
import type { FetchOutcome } from "./contract-fetch.js";
import { makeTestZip, type TestZipEntry } from "./pkg-testkit.js";
import {
  UI_ENTRY,
  fetchUiAfterContract,
  fetchUiBundle,
  hasUiBundle,
  uiBundleDir,
  type UiFetchOutcome,
} from "./ui-fetch.js";

const BASE = "https://cap.example/v1/";

function digest(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function bundle(entries: TestZipEntry[] = [
  { name: "index.html", data: Buffer.from("<!doctype html><script src=app.js></script>") },
  { name: "assets/app.js", data: Buffer.from("console.log(1)"), deflate: true },
]): Buffer {
  return makeTestZip(entries);
}

/** fetchUiBundle 只读 product.id 与 product.ui —— 其余字段与这里无关。 */
function contract(sha256: string | undefined, id = "bidproposal"): RuyinContract {
  return { product: { id, ...(sha256 ? { ui: { sha256 } } : {}) } } as unknown as RuyinContract;
}

function store(): string {
  return mkdtempSync(join(tmpdir(), "ruyin-ui-"));
}

interface Seen {
  url?: string;
  auth?: string | null;
  calls: number;
}

function serve(body: Buffer, init: ResponseInit = {}, seen: Seen = { calls: 0 }): typeof fetch {
  return (async (url: string | URL | Request, reqInit?: RequestInit) => {
    seen.calls++;
    seen.url = String(url);
    seen.auth = new Headers(reqInit?.headers).get("authorization");
    return new Response(new Uint8Array(body), init);
  }) as typeof fetch;
}

/** 断言：产品库里这个产品的 ui 目录下什么都没有（包括暂存目录）。 */
function assertNothingStored(storeDir: string, productId = "bidproposal"): void {
  const uiRoot = join(storeDir, productId, "ui");
  assert.ok(!existsSync(uiRoot) || readdirSync(uiRoot).length === 0, `unexpected: ${existsSync(uiRoot) ? readdirSync(uiRoot).join(",") : ""}`);
}

function unavailable(o: UiFetchOutcome): Extract<UiFetchOutcome, { status: "unavailable" }> {
  assert.equal(o.status, "unavailable", JSON.stringify(o));
  return o as Extract<UiFetchOutcome, { status: "unavailable" }>;
}

test("ui-fetch: 契约没声明界面 → none，一个请求都不发", async () => {
  const seen: Seen = { calls: 0 };
  const o = await fetchUiBundle(contract(undefined), { baseUrl: BASE, storeDir: store(), fetchImpl: serve(bundle(), {}, seen) });
  assert.deepEqual(o, { status: "none", productId: "bidproposal" });
  assert.equal(seen.calls, 0);
});

test("ui-fetch: 按摘要取回、校验、落盘；地址只由摘要决定，凭据与契约拉取同一个", async () => {
  const zip = bundle();
  const sha = digest(zip);
  const storeDir = store();
  const seen: Seen = { calls: 0 };
  const o = await fetchUiBundle(contract(sha), {
    baseUrl: BASE,
    storeDir,
    token: async () => "tok",
    fetchImpl: serve(zip, {}, seen),
  });
  assert.deepEqual(o, { status: "fetched", productId: "bidproposal", sha256: sha, dir: uiBundleDir(storeDir, "bidproposal", sha) });
  assert.equal(seen.url, `https://cap.example/v1/products/bidproposal/ui/${sha}`);
  assert.equal(seen.auth, "Bearer tok");
  const dir = uiBundleDir(storeDir, "bidproposal", sha);
  assert.match(readFileSync(join(dir, UI_ENTRY), "utf8"), /<script/);
  assert.equal(readFileSync(join(dir, "assets", "app.js"), "utf8"), "console.log(1)");
  assert.ok(hasUiBundle(storeDir, "bidproposal", sha));
  // 暂存目录不留下来：ui/ 下只有那一个按摘要命名的目录。
  assert.deepEqual(readdirSync(join(storeDir, "bidproposal", "ui")), [sha]);
});

/** 按摘要寻址：在 = 当初校验过，不再取，也不重算。 */
test("ui-fetch: 本地已有这份 → present，不发请求", async () => {
  const zip = bundle();
  const sha = digest(zip);
  const storeDir = store();
  await fetchUiBundle(contract(sha), { baseUrl: BASE, storeDir, fetchImpl: serve(zip) });
  const seen: Seen = { calls: 0 };
  const o = await fetchUiBundle(contract(sha), { baseUrl: BASE, storeDir, fetchImpl: serve(zip, {}, seen) });
  assert.equal(o.status, "present");
  assert.equal(seen.calls, 0);
});

/** **这一条是整条管线的要害**：摘要不符，一个字节都不解开、一个文件都不落。 */
test("ui-fetch: 摘要不符 → digest_mismatch，什么都不落盘", async () => {
  const zip = bundle();
  const storeDir = store();
  const o = unavailable(
    await fetchUiBundle(contract("0".repeat(64)), { baseUrl: BASE, storeDir, fetchImpl: serve(zip) }),
  );
  assert.equal(o.reason, "digest_mismatch");
  assert.match(o.detail, new RegExp(digest(zip)));
  assertNothingStored(storeDir);
});

test("ui-fetch: 声明的长度已超上限 → too_large，不开始收", async () => {
  const zip = bundle();
  const o = unavailable(
    await fetchUiBundle(contract(digest(zip)), {
      baseUrl: BASE,
      storeDir: store(),
      maxBytes: 10,
      fetchImpl: serve(zip, { headers: { "content-length": String(zip.length) } }),
    }),
  );
  assert.equal(o.reason, "too_large");
  assert.match(o.detail, /declares/);
});

/** 头可以撒谎（或者不给）—— 真正的上限是边收边数的那一个。 */
test("ui-fetch: 不声明长度时边收边数，超了当场停 → too_large", async () => {
  const zip = bundle();
  const storeDir = store();
  const chunked = (async () =>
    new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array(zip.subarray(0, 8)));
          c.enqueue(new Uint8Array(zip.subarray(8)));
          c.close();
        },
      }),
    )) as typeof fetch;
  const o = unavailable(
    await fetchUiBundle(contract(digest(zip)), { baseUrl: BASE, storeDir, maxBytes: 12, fetchImpl: chunked }),
  );
  assert.equal(o.reason, "too_large");
  assert.match(o.detail, /exceeds 12 bytes/);
  assertNothingStored(storeDir);
});

test("ui-fetch: 非 2xx 与网络错误 → unreachable，不抛", async () => {
  const sha = digest(bundle());
  for (const status of [404, 500, 401]) {
    const o = unavailable(
      await fetchUiBundle(contract(sha), { baseUrl: BASE, storeDir: store(), fetchImpl: serve(Buffer.from("nope"), { status }) }),
    );
    assert.equal(o.reason, "unreachable");
    assert.match(o.detail, new RegExp(String(status)));
  }
  const refused = (async () => {
    throw new Error("ECONNREFUSED");
  }) as typeof fetch;
  const o = unavailable(await fetchUiBundle(contract(sha), { baseUrl: BASE, storeDir: store(), fetchImpl: refused }));
  assert.equal(o.reason, "unreachable");
  assert.match(o.detail, /ECONNREFUSED/);
});

test("ui-fetch: 空响应体按「包不合规」算，不当成一份空界面", async () => {
  const empty = (async () => new Response(null)) as typeof fetch;
  const sha = digest(Buffer.alloc(0));
  const o = unavailable(await fetchUiBundle(contract(sha), { baseUrl: BASE, storeDir: store(), fetchImpl: empty }));
  assert.equal(o.reason, "invalid_bundle");
});

/** 摘要对上了也要过护栏：产品作者自己打出来的包也可能带穿越路径。 */
test("ui-fetch: 摘要对上但条目穿越 → invalid_bundle，什么都不落盘", async () => {
  const zip = bundle([
    { name: "index.html", data: Buffer.from("x") },
    { name: "../escape.js", data: Buffer.from("x") },
  ]);
  const storeDir = store();
  const o = unavailable(await fetchUiBundle(contract(digest(zip)), { baseUrl: BASE, storeDir, fetchImpl: serve(zip) }));
  assert.equal(o.reason, "invalid_bundle");
  assert.match(o.detail, /traversal/);
  assertNothingStored(storeDir);
  assert.ok(!existsSync(join(storeDir, "bidproposal", "escape.js")));
});

test("ui-fetch: 包根没有 index.html → invalid_bundle", async () => {
  const zip = bundle([{ name: "app/index.html", data: Buffer.from("x") }]);
  const storeDir = store();
  const o = unavailable(await fetchUiBundle(contract(digest(zip)), { baseUrl: BASE, storeDir, fetchImpl: serve(zip) }));
  assert.equal(o.reason, "invalid_bundle");
  assert.match(o.detail, /no index\.html at its root/);
  assertNothingStored(storeDir);
});

/**
 * 解压炸弹：下载只有几十 KB，解开是 17 MiB 的一个条目 —— 界面包的单条目上限
 * （16 MiB）比产品包（64 MiB）紧，就是为了这种包。
 */
test("ui-fetch: 解开后超过界面包的单条目上限 → invalid_bundle", async () => {
  const zip = bundle([
    { name: "index.html", data: Buffer.from("x") },
    { name: "huge.bin", data: Buffer.alloc(17 * 1024 * 1024), deflate: true },
  ]);
  assert.ok(zip.length < 1024 * 1024, "the bomb itself must be small to be a bomb");
  const storeDir = store();
  const o = unavailable(await fetchUiBundle(contract(digest(zip)), { baseUrl: BASE, storeDir, fetchImpl: serve(zip) }));
  assert.equal(o.reason, "invalid_bundle");
  assert.match(o.detail, /entry too large/);
  assertNothingStored(storeDir);
});

/** 进路径与 URL 之前再查一遍：不让「上游校验过」成为这一站不设防的理由。 */
test("ui-fetch: 产品 id 或摘要形状不对 → invalid_bundle，不发请求", async () => {
  const seen: Seen = { calls: 0 };
  const opts = { baseUrl: BASE, storeDir: store(), fetchImpl: serve(bundle(), {}, seen) };
  for (const c of [contract("A".repeat(64)), contract("0".repeat(64), "../x"), contract("0".repeat(64), "..")]) {
    assert.equal(unavailable(await fetchUiBundle(c, opts)).reason, "invalid_bundle");
  }
  assert.equal(seen.calls, 0);
  assert.equal(hasUiBundle(opts.storeDir, "../x", "0".repeat(64)), false);
  assert.equal(hasUiBundle(opts.storeDir, "bidproposal", "nope"), false);
});

/** 两个请求同时取同一个摘要：后到的发现已经在了，就按「在」算，不覆盖。 */
test("ui-fetch: 落盘前别人先落了同一个摘要 → present，暂存目录清掉", async () => {
  const zip = bundle();
  const sha = digest(zip);
  const storeDir = store();
  const dir = uiBundleDir(storeDir, "bidproposal", sha);
  const racing = (async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, UI_ENTRY), "first");
    return new Response(new Uint8Array(zip));
  }) as typeof fetch;
  const o = await fetchUiBundle(contract(sha), { baseUrl: BASE, storeDir, fetchImpl: racing });
  assert.equal(o.status, "present");
  assert.equal(readFileSync(join(dir, UI_ENTRY), "utf8"), "first");
  assert.deepEqual(readdirSync(join(storeDir, "bidproposal", "ui")), [sha]);
});

test("ui-fetch: 落不了盘 → invalid_bundle，暂存目录清掉", async () => {
  const zip = bundle();
  const sha = digest(zip);
  const storeDir = store();
  // 让「ui」成为一个文件而不是目录：暂存目录建不起来。
  mkdirSync(join(storeDir, "bidproposal"), { recursive: true });
  writeFileSync(join(storeDir, "bidproposal", "ui"), "not a directory");
  const o = unavailable(await fetchUiBundle(contract(sha), { baseUrl: BASE, storeDir, fetchImpl: serve(zip) }));
  assert.equal(o.reason, "invalid_bundle");
  assert.match(o.detail, /could not store/);
});

// --- 接在契约拉取后面 ---------------------------------------------------------

function landedContract(storeDir: string, ui: string | undefined): FetchOutcome {
  const dir = join(storeDir, "bidproposal", "1.0.0");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "ruyin.product.yaml"),
    `contract: "0.2"\nproduct:\n  id: bidproposal\n  version: 1.0.0\n${ui ? `  ui:\n    sha256: ${ui}\n` : ""}`,
  );
  return { status: "fetched", productId: "bidproposal", version: "1.0.0", dir };
}

test("fetchUiAfterContract: 契约落了盘就紧接着取它钉的那份；current 也取（上次可能没取成）", async () => {
  const zip = bundle();
  const sha = digest(zip);
  const storeDir = store();
  const fetched = landedContract(storeDir, sha);
  const o = await fetchUiAfterContract(fetched, { baseUrl: BASE, storeDir, fetchImpl: serve(zip) });
  assert.equal(o?.status, "fetched");

  const again = await fetchUiAfterContract(
    { status: "current", productId: "bidproposal", version: "1.0.0", dir: fetched.status === "offline" ? "" : fetched.dir, remoteDiffers: false },
    { baseUrl: BASE, storeDir, fetchImpl: serve(zip) },
  );
  assert.equal(again?.status, "present");
});

test("fetchUiAfterContract: 契约没落到本地（offline）就不知道钉的是哪份 —— 不取", async () => {
  const seen: Seen = { calls: 0 };
  const o = await fetchUiAfterContract(
    { status: "offline", productId: "bidproposal", reason: "x", cachedVersions: [] },
    { baseUrl: BASE, storeDir: store(), fetchImpl: serve(bundle(), {}, seen) },
  );
  assert.equal(o, undefined);
  assert.equal(seen.calls, 0);
});

test("fetchUiAfterContract: 没声明界面 → none；契约读不回来 → 不取", async () => {
  const storeDir = store();
  const o = await fetchUiAfterContract(landedContract(storeDir, undefined), { baseUrl: BASE, storeDir, fetchImpl: serve(bundle()) });
  assert.equal(o?.status, "none");

  const gone = await fetchUiAfterContract(
    { status: "fetched", productId: "bidproposal", version: "9.9.9", dir: join(storeDir, "nope") },
    { baseUrl: BASE, storeDir, fetchImpl: serve(bundle()) },
  );
  assert.equal(gone, undefined);
});
