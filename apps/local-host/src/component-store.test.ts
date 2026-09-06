/**
 * 获取通道的测试（ADR-018 §7.2）。
 *
 * 每一条都对着一种**会真的发生**的坏情况：上游换了字节、机器断网、盘不够、
 * 压缩包里藏着路径穿越、许可证文件没随包同行、用户中途取消。合起来要证明的
 * 是同一句话：**除了「字节等于清单说的那串摘要」，这里什么都不保证；而在那
 * 之前，一个字节都不会落到最终位置。**
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ComponentError, ComponentStore, type ComponentSpec, readComponentSpecs, scanOfflineDir } from "./component-store.js";
import { makeTestZip } from "./pkg-testkit.js";

const ORIGIN = "https://cdn.playwright.dev";

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** 一个最小的、合法的载荷 zip：一个有效载荷文件 + 一个许可证文件。 */
function payload(extra: Array<{ name: string; data: Buffer }> = []): Buffer {
  return makeTestZip([
    { name: "shell/headless.exe", data: Buffer.from("BINARY"), deflate: true },
    { name: "shell/LICENSE.headless_shell", data: Buffer.from("BSD-3-Clause"), deflate: true },
    ...extra,
  ]);
}

function spec(zip: Buffer, over: Partial<ComponentSpec> = {}): ComponentSpec {
  return {
    id: "browser.test-shell",
    kind: "browser",
    version: "1.2.3",
    unlocks: ["microsoft.playwright-mcp"],
    source: { url: `${ORIGIN}/builds/test-shell.zip` },
    sha256: sha256(zip),
    size: zip.length,
    unpackedBytes: 4096,
    install: { kind: "zip", into: "shell-1", expect: "shell/headless.exe", marker: "INSTALLATION_COMPLETE" },
    license: "BSD-3-Clause",
    licenseSource: "包内 LICENSE.headless_shell",
    licenseFile: ["shell/LICENSE.headless_shell"],
    redistribution: "download-only",
    ...over,
  };
}

interface Harness {
  dataDir: string;
  store: ComponentStore;
  events: string[];
}

function harness(s: ComponentSpec, serve: (url: URL) => Promise<Response> | Response, over: { freeBytes?: number } = {}): Harness {
  const dataDir = mkdtempSync(join(tmpdir(), "ruyin-components-"));
  const events: string[] = [];
  const store = new ComponentStore({
    dataDir,
    components: () => [s],
    allowedOrigins: () => [ORIGIN],
    fetchImpl: ((url: URL) => Promise.resolve(serve(url))) as unknown as typeof fetch,
    ...(over.freeBytes === undefined ? {} : { freeBytes: () => over.freeBytes! }),
    onChanged: (id) => events.push(id),
    now: () => "2026-09-06T00:00:00.000Z",
  });
  return { dataDir, store, events };
}

function ok(body: Buffer): Response {
  return new Response(new Uint8Array(body), { status: 200, headers: { "content-length": String(body.length) } });
}

test("HTTPS 一次成功的获取：校验、解压、许可证、回执、原子落地", async () => {
  const zip = payload();
  const s = spec(zip);
  const { store, dataDir, events } = harness(s, () => ok(zip));

  assert.equal(store.list()[0]!.state, "not-acquired");
  const status = await store.acquire(s.id);

  assert.equal(status.state, "acquired");
  assert.equal(status.transport, "https");
  assert.equal(status.downloadBytes, zip.length);
  assert.equal(status.origin, "cdn.playwright.dev");
  const root = join(dataDir, "c", s.id, s.version);
  assert.ok(existsSync(join(root, "shell-1", "shell", "headless.exe")));
  assert.ok(existsSync(join(root, "shell-1", "shell", "LICENSE.headless_shell")));
  // marker 是给 playwright 认「这棵浏览器树是完整的」的那一个。
  assert.ok(existsSync(join(root, "shell-1", "INSTALLATION_COMPLETE")));

  const receipt = JSON.parse(readFileSync(join(root, ".ruyin-component.json"), "utf8"));
  assert.equal(receipt.sha256, s.sha256);
  // **照实写**：这条通道不验签名，也没有可验的签名根（TD-012）。
  assert.equal(receipt.signed, false);
  assert.ok(readFileSync(join(dataDir, "c", "NOTICES.md"), "utf8").includes("BSD-3-Clause"));
  assert.ok(events.length > 0, "变化要发事件，否则界面不会去重取");
  // 暂存目录里不留任何东西。
  assert.deepEqual(readdirSync(join(dataDir, "c", ".staging")), []);
});

test("上游换了字节：摘要不符 —— 字节丢弃，什么都不落地", async () => {
  const zip = payload();
  const s = spec(zip);
  const tampered = payload([{ name: "shell/extra", data: Buffer.from("surprise") }]);
  const { store, dataDir } = harness({ ...s, size: tampered.length }, () => ok(tampered));

  await assert.rejects(
    () => store.acquire(s.id),
    (e: ComponentError) => e.state === "mismatch" && /sha256/.test(e.message),
  );
  assert.ok(!existsSync(join(dataDir, "c", s.id, s.version)));
  // 失败不折叠进「未获取」：下一次列出时说的还是「摘要不符」。
  assert.equal(store.list()[0]!.state, "mismatch");
});

test("长度不符也算不符 —— 不靠摘要一条腿站着", async () => {
  const zip = payload();
  const short = zip.subarray(0, zip.length - 10);
  const s = spec(zip);
  const { store } = harness(s, () => ok(short));
  await assert.rejects(
    () => store.acquire(s.id),
    (e: ComponentError) => e.state === "mismatch",
  );
});

test("对方发来的比声明的多：超一个字节就停，不等下完", async () => {
  const zip = payload();
  const s = spec(zip, { size: 32 });
  const { store } = harness(s, () => new Response(new Uint8Array(zip), { status: 200 }));
  await assert.rejects(
    () => store.acquire(s.id),
    (e: ComponentError) => e.state === "too-large",
  );
});

test("离线：网络到不了是独立状态，不是「未获取」", async () => {
  const zip = payload();
  const s = spec(zip);
  const { store } = harness(s, () => {
    throw new Error("getaddrinfo ENOTFOUND cdn.playwright.dev");
  });
  await assert.rejects(
    () => store.acquire(s.id),
    (e: ComponentError) => e.state === "unreachable",
  );
  const row = store.list()[0]!;
  assert.equal(row.state, "unreachable");
  // 离线时行照常在，体积 / 许可证 / 来源主机都还看得见 —— 点之前就知道要下多少。
  assert.equal(row.downloadBytes, zip.length);
  assert.equal(row.license, "BSD-3-Clause");
  assert.equal(row.origin, "cdn.playwright.dev");
});

test("404：上游删了这个构建 —— 永久，不是「等会儿再试」", async () => {
  const zip = payload();
  const s = spec(zip);
  const { store } = harness(s, () => new Response("nope", { status: 404 }));
  await assert.rejects(
    () => store.acquire(s.id),
    // 折叠进 unreachable 会让界面说「网络到不了，等会儿再试」—— 而重试一百次还是
    // 404：Chrome for Testing 会删旧构建，该动的是清单里那条 pin。
    (e: ComponentError) => e.state === "gone" && /pin 需要更新/.test(e.message),
  );
  assert.equal(store.list()[0]!.state, "gone");
});

test("410 同样是 gone", async () => {
  const zip = payload();
  const s = spec(zip);
  const { store } = harness(s, () => new Response(null, { status: 410 }));
  await assert.rejects(
    () => store.acquire(s.id),
    (e: ComponentError) => e.state === "gone",
  );
});

test("5xx / 408 / 429 才是「等会儿再试」的那一种", async () => {
  const zip = payload();
  for (const status of [500, 503, 408, 429]) {
    const s = spec(zip);
    const { store } = harness(s, () => new Response(null, { status }));
    await assert.rejects(
      () => store.acquire(s.id),
      (e: ComponentError) => e.state === "unreachable",
      `HTTP ${status} 应当是可重试的那一种`,
    );
  }
});

test("其余 4xx 照实报状态码，不谎称可以重试", async () => {
  const zip = payload();
  const s = spec(zip);
  const { store } = harness(s, () => new Response(null, { status: 403 }));
  await assert.rejects(
    () => store.acquire(s.id),
    (e: ComponentError) => e.state === "failed" && /403/.test(e.message),
  );
});

test("重定向一律不跟 —— 白名单是发请求之前查的，跟着跳等于让上游选目的地", async () => {
  const zip = payload();
  const s = spec(zip);
  const hits: string[] = [];
  const { store } = harness(s, (url) => {
    hits.push(url.href);
    // 上游 302 到一台白名单外的主机。缺省的 redirect: "follow" 会跟着跳过去，
    // 而那道 origin 检查已经在第一跳之前跑完了。
    return new Response(null, { status: 302, headers: { location: "https://evil.example.net/x.zip" } });
  });
  await assert.rejects(
    () => store.acquire(s.id),
    (e: ComponentError) => e.state === "refused-origin" && /evil\.example\.net/.test(e.message),
  );
  assert.deepEqual(hits, [`${ORIGIN}/builds/test-shell.zip`], "只该发出清单里那一条直链，跳转的那一跳不许发");
});

test("fetch 用的是 redirect: manual —— 不把跳转交给运行时去跟", async () => {
  const zip = payload();
  const s = spec(zip);
  const seen: Array<RequestInit | undefined> = [];
  const dataDir = mkdtempSync(join(tmpdir(), "ruyin-components-"));
  const store = new ComponentStore({
    dataDir,
    components: () => [s],
    allowedOrigins: () => [ORIGIN],
    fetchImpl: ((_url: URL, init?: RequestInit) => {
      seen.push(init);
      return Promise.resolve(ok(zip));
    }) as unknown as typeof fetch,
  });
  await store.acquire(s.id);
  assert.equal(seen[0]?.redirect, "manual");
});

test("url 不是 https：请求根本没发出去（哪怕白名单里写着同一个 origin）", async () => {
  const zip = payload();
  const s = spec(zip, { source: { url: "http://cdn.playwright.dev/builds/test-shell.zip" } });
  let called = false;
  const dataDir = mkdtempSync(join(tmpdir(), "ruyin-components-"));
  const store = new ComponentStore({
    dataDir,
    components: () => [s],
    // 白名单里那条也写成 http —— 光比 origin，这一对是能对上的。
    allowedOrigins: () => ["http://cdn.playwright.dev"],
    fetchImpl: (() => {
      called = true;
      return Promise.resolve(ok(zip));
    }) as unknown as typeof fetch,
  });
  await assert.rejects(
    () => store.acquire(s.id),
    (e: ComponentError) => e.state === "refused-origin" && /https/.test(e.message),
  );
  assert.equal(called, false, "明文那条路不该发出任何请求");
});

test("origin 不在白名单里：请求根本没发出去", async () => {
  const zip = payload();
  const s = spec(zip, { source: { url: "https://evil.example.net/x.zip" } });
  let called = false;
  const { store } = harness(s, () => {
    called = true;
    return ok(zip);
  });
  await assert.rejects(
    () => store.acquire(s.id),
    (e: ComponentError) => e.state === "refused-origin",
  );
  assert.equal(called, false, "白名单要在发请求之前查");
});

test("磁盘不够：开工前就拒，报出的是数字不是「失败了」", async () => {
  const zip = payload();
  const s = spec(zip);
  let called = false;
  const { store } = harness(
    s,
    () => {
      called = true;
      return ok(zip);
    },
    { freeBytes: 10 },
  );
  await assert.rejects(
    () => store.acquire(s.id),
    (e: ComponentError) => e.state === "no-space" && /MB/.test(e.message),
  );
  assert.equal(called, false, "不该下了 114 MB 再发现装不下");
});

test("许可证文件没随包同行：整棵树回滚，获取算失败", async () => {
  const zip = makeTestZip([{ name: "shell/headless.exe", data: Buffer.from("BINARY"), deflate: true }]);
  const s = spec(zip);
  const { store, dataDir } = harness(s, () => ok(zip));
  await assert.rejects(
    () => store.acquire(s.id),
    (e: ComponentError) => e.state === "license-missing",
  );
  assert.ok(!existsSync(join(dataDir, "c", s.id, s.version)), "半棵树不许留下");
  assert.deepEqual(readdirSync(join(dataDir, "c", ".staging")), []);
});

test("压缩包里的路径穿越：pkg.ts 那套护栏照样管用（同一份，不是复制的）", async () => {
  const zip = makeTestZip([
    { name: "../escape.exe", data: Buffer.from("BINARY") },
    { name: "shell/LICENSE.headless_shell", data: Buffer.from("BSD") },
  ]);
  const s = spec(zip);
  const { store, dataDir } = harness(s, () => ok(zip));
  await assert.rejects(
    () => store.acquire(s.id),
    (e: ComponentError) => e.state === "failed" && /traversal/.test(e.message),
  );
  assert.ok(!existsSync(join(dataDir, "c", "escape.exe")));
});

test("加密条目一律拒", async () => {
  const zip = makeTestZip([{ name: "a", data: Buffer.from("x"), encrypted: true }]);
  const s = spec(zip);
  const { store } = harness(s, () => ok(zip));
  await assert.rejects(
    () => store.acquire(s.id),
    (e: ComponentError) => /encrypted/.test(e.message),
  );
});

test("解压后没有清单说的那个入口文件", async () => {
  const zip = makeTestZip([
    { name: "shell/other.exe", data: Buffer.from("BINARY") },
    { name: "shell/LICENSE.headless_shell", data: Buffer.from("BSD") },
  ]);
  const s = spec(zip);
  const { store } = harness(s, () => ok(zip));
  await assert.rejects(
    () => store.acquire(s.id),
    (e: ComponentError) => /shell\/headless\.exe/.test(e.message),
  );
});

test("本地文件那条路：气隙机器上校验和还是随安装包同行的那一条", async () => {
  const zip = payload();
  const s = spec(zip);
  const { store, dataDir } = harness(s, () => {
    throw new Error("这台机器根本没有网络");
  });
  const offline = mkdtempSync(join(tmpdir(), "ruyin-offline-"));
  const file = join(offline, `${s.id}-${s.version}.zip`);
  writeFileSync(file, zip);

  const status = await store.acquire(s.id, { from: file });
  assert.equal(status.state, "acquired");
  assert.equal(status.transport, "local");
  assert.ok(existsSync(join(dataDir, "c", s.id, s.version, "shell-1", "shell", "headless.exe")));
});

test("本地文件也要过同一段校验 —— U 盘上那份被换了照样拒", async () => {
  const zip = payload();
  const s = spec(zip);
  const { store } = harness(s, () => ok(zip));
  const offline = mkdtempSync(join(tmpdir(), "ruyin-offline-"));
  const file = join(offline, "bad.zip");
  // 长度一样、内容被改过一个字节：长度那道闸放它过去，摘要那道拦住它。
  const tampered = Buffer.from(zip);
  const at = Math.floor(tampered.length / 2);
  tampered.writeUInt8(tampered.readUInt8(at) ^ 0xff, at);
  writeFileSync(file, tampered);
  await assert.rejects(
    () => store.acquire(s.id, { from: file }),
    (e: ComponentError) => e.state === "mismatch",
  );
});

test("整个离线目录按 <id>-<version>.zip 自动配对", async () => {
  const zip = payload();
  const s = spec(zip);
  const { store } = harness(s, () => ok(zip));
  const offline = mkdtempSync(join(tmpdir(), "ruyin-offline-"));
  writeFileSync(join(offline, `${s.id}-${s.version}.zip`), zip);

  assert.deepEqual(scanOfflineDir(offline, [s]).map((x) => x.id), [s.id]);
  const res = await store.acquireFromDir(offline);
  assert.deepEqual(res.acquired, [s.id]);
  assert.equal(store.isAcquired(s.id), true);

  // 再来一次：已获取的说「已获取」，不是默默重下一遍。
  const again = await store.acquireFromDir(offline);
  assert.deepEqual(again.acquired, []);
  assert.equal(again.skipped[0]!.reason, "已获取");
});

test("离线目录里没有配对的文件：说清是哪一个文件名，不是「失败」", async () => {
  const zip = payload();
  const s = spec(zip);
  const { store } = harness(s, () => ok(zip));
  const empty = mkdtempSync(join(tmpdir(), "ruyin-offline-"));
  const res = await store.acquireFromDir(empty);
  assert.match(res.skipped[0]!.reason, /browser\.test-shell-1\.2\.3\.zip/);
});

test("取消：v1 不做断点续传 —— 暂存删干净，下一次从零开始", async () => {
  const zip = payload();
  const s = spec(zip, { size: zip.length + 4096 });
  const dataDir = mkdtempSync(join(tmpdir(), "ruyin-components-"));
  let store!: ComponentStore;
  store = new ComponentStore({
    dataDir,
    components: () => [s],
    allowedOrigins: () => [ORIGIN],
    // 第一个 chunk 一到就取消 —— 模拟用户点了「取消」。
    fetchImpl: (() => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(zip.subarray(0, 8)));
          store.cancel(s.id);
          controller.enqueue(new Uint8Array(zip.subarray(8)));
          controller.close();
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    }) as unknown as typeof fetch,
  });

  await assert.rejects(
    () => store.acquire(s.id),
    (e: ComponentError) => e.state === "cancelled",
  );
  assert.deepEqual(readdirSync(join(dataDir, "c", ".staging")), [], "半个 .part 留下来，下一次就会有人想去「续上」");
  assert.equal(store.list()[0]!.state, "cancelled");
  assert.equal(store.cancel(s.id), false, "没在跑的取消不是错误");
});

test("清单说的尺寸越过硬天花板：不问文件系统就拒", async () => {
  const zip = payload();
  const s = spec(zip, { unpackedBytes: 8 * 1024 * 1024 * 1024 });
  const { store } = harness(s, () => ok(zip));
  await assert.rejects(
    () => store.acquire(s.id),
    (e: ComponentError) => e.state === "too-large",
  );
});

test("落盘路径太长：Windows 的 MAX_PATH 是实测会发生的失败", async () => {
  const zip = payload();
  const s = spec(zip);
  const deep = mkdtempSync(join(tmpdir(), "ruyin-deep-"));
  const nested = join(deep, "a".repeat(80), "b".repeat(80));
  mkdirSync(nested, { recursive: true });
  const store = new ComponentStore({
    dataDir: nested,
    components: () => [s],
    allowedOrigins: () => [ORIGIN],
    fetchImpl: (() => Promise.resolve(ok(zip))) as unknown as typeof fetch,
  });
  await assert.rejects(
    () => store.acquire(s.id),
    (e: ComponentError) => e.state === "path-too-long",
  );
});

test("已获取的再点一次不重下；移除之后回到「未获取」", async () => {
  const zip = payload();
  const s = spec(zip);
  let hits = 0;
  const { store } = harness(s, () => {
    hits++;
    return ok(zip);
  });
  await store.acquire(s.id);
  await store.acquire(s.id);
  assert.equal(hits, 1);
  assert.ok(store.pathOf(s.id));
  assert.equal(store.remove(s.id), true);
  assert.equal(store.list()[0]!.state, "not-acquired");
  assert.equal(store.remove(s.id), false);
});

test("回执坏了：这棵树不算数，不谎称装好了 —— 而且 pathOf 与 status 说的是同一句", async () => {
  const zip = payload();
  const s = spec(zip);
  const { store, dataDir } = harness(s, () => ok(zip));
  await store.acquire(s.id);
  writeFileSync(join(dataDir, "c", s.id, s.version, ".ruyin-component.json"), "{ not json");
  assert.equal(store.list()[0]!.state, "failed");
  // 上一版 pathOf 只看回执**在不在**，于是界面显示「失败」而启动路径照样把这棵树
  // 交给 playwright。判定只能有一处。
  assert.equal(store.pathOf(s.id), undefined, "界面说不算数，启动路径就不能还认它");
  assert.equal(store.isAcquired(s.id), false);
});

test("回执是按另一条摘要写的（清单更新过）：不算数，且说清是哪一种不算数", async () => {
  const zip = payload();
  const s = spec(zip);
  const { store, dataDir } = harness(s, () => ok(zip));
  await store.acquire(s.id);
  const file = join(dataDir, "c", s.id, s.version, ".ruyin-component.json");
  const receipt = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(file, JSON.stringify({ ...receipt, sha256: "f".repeat(64) }));
  const row = store.list()[0]!;
  assert.equal(row.state, "mismatch");
  assert.equal(store.pathOf(s.id), undefined);
});

test("载荷被杀毒隔离 / 清盘删了：回执还在，但这件不算装着 —— 用时才发现的那一种", async () => {
  const zip = payload();
  const s = spec(zip);
  const { store, dataDir } = harness(s, () => ok(zip));
  await store.acquire(s.id);
  assert.ok(store.pathOf(s.id), "先证明它确实装好了");

  // 只删可执行文件，回执与其余的树都留着 —— 这正是杀毒软件干的事。
  const exe = join(dataDir, "c", s.id, s.version, "shell-1", "shell", "headless.exe");
  rmSync(exe);
  const row = store.list()[0]!;
  assert.equal(row.state, "payload-missing", "回执在就说「已获取」，等于把一条指向空处的路径交给 playwright");
  assert.match(row.reason ?? "", /headless\.exe/);
  assert.equal(store.pathOf(s.id), undefined);
  assert.equal(store.isAcquired(s.id), false);

  // 而「不算装着」是可以自愈的：再点一次获取就把它补回来（不必先移除）。
  const again = await store.acquire(s.id);
  assert.equal(again.state, "acquired");
  assert.ok(existsSync(exe));
});

test("许可证正文被删掉：同样不算装着 —— 分发它的前提没了", async () => {
  const zip = payload();
  const s = spec(zip);
  const { store, dataDir } = harness(s, () => ok(zip));
  await store.acquire(s.id);
  rmSync(join(dataDir, "c", s.id, s.version, "shell-1", "shell", "LICENSE.headless_shell"));
  assert.equal(store.list()[0]!.state, "payload-missing");
  // NOTICES.md 里也不该再声称它装着（同一个判定函数）。
  await assert.doesNotReject(() => store.acquire(s.id));
});

test("回执记下了用时要查哪几个文件 —— 清单以后怎么改，这棵树当初有过什么是定的", async () => {
  const zip = payload();
  const s = spec(zip);
  const { store, dataDir } = harness(s, () => ok(zip));
  await store.acquire(s.id);
  const receipt = JSON.parse(readFileSync(join(dataDir, "c", s.id, s.version, ".ruyin-component.json"), "utf8"));
  assert.deepEqual(receipt.verify, ["shell/headless.exe", "INSTALLATION_COMPLETE", "shell/LICENSE.headless_shell"]);
  // **不重算整包 sha256**：那是每次列出 / 每次 plan() 都要读一遍 120 MB。
  assert.equal(receipt.transport, "https");
});

test("清单里没有这一件：说清，而不是静默什么都不做", async () => {
  const zip = payload();
  const { store } = harness(spec(zip), () => ok(zip));
  await assert.rejects(() => store.acquire("nope"), /不在预置清单的组件表里/);
  assert.equal(store.status("nope"), undefined);
});

test("readComponentSpecs：占位符 sha256 的条目一律丢掉，索引缺了就是没有获取通道", () => {
  const dir = mkdtempSync(join(tmpdir(), "ruyin-index-"));
  const file = join(dir, "index.json");
  writeFileSync(
    file,
    JSON.stringify({
      allowedOrigins: [ORIGIN],
      components: [
        { id: "good", version: "1", sha256: "a".repeat(64), install: { kind: "zip", into: "good" } },
        { id: "placeholder", version: "1", sha256: "<CI 造包时算出写回>", install: { kind: "zip", into: "x" } },
        // id / version / install.* 都是路径段：不安全的条目在读的时候就消失，
        // 不留到用的时候再查 —— 留下来它就会被界面列出来、被 acquire 找到。
        { id: "../escape", version: "1", sha256: "b".repeat(64), install: { kind: "zip", into: "x" } },
        { id: "ok-id", version: "../1", sha256: "c".repeat(64), install: { kind: "zip", into: "x" } },
        { id: "ok-id2", version: "1", sha256: "d".repeat(64), install: { kind: "zip", into: "../../etc" } },
        { id: "ok-id3", version: "1", sha256: "e".repeat(64), install: { kind: "zip", into: "x", marker: "../../m" } },
        { id: "ok-id4", version: "1", sha256: "f".repeat(64), install: { kind: "zip", into: "x", expect: "C:/w.exe" } },
        { id: "ok-id5", version: "1", sha256: "0".repeat(64), install: { kind: "zip", into: "x" }, licenseFile: ["../L"] },
      ],
    }),
  );
  const skipped: string[] = [];
  const read = readComponentSpecs(file, (line) => skipped.push(line));
  assert.deepEqual(read.components.map((c) => c.id), ["good"]);
  // 六条不安全的各自被点名（占位符 sha256 那条不经过路径护栏，所以不在这里）。
  assert.equal(skipped.length, 6);
  assert.ok(skipped.every((l) => /跳过条目/.test(l)));
  assert.deepEqual(read.allowedOrigins, [ORIGIN]);
  assert.deepEqual(readComponentSpecs(join(dir, "missing.json")), { components: [], allowedOrigins: [] });
  rmSync(dir, { recursive: true, force: true });
});

test("scanOfflineDir：目录不存在时是空，不抛", () => {
  assert.deepEqual(scanOfflineDir(join(tmpdir(), "no-such-dir-ruyin"), []), []);
});
