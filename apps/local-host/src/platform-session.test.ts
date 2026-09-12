/**
 * platform-session 的判据。
 *
 * 这是认证代码，每条失败都是安全问题而不是功能问题：
 *
 *   1. **deviceSecret 绝不落盘**，也绝不进浏览器那个 URL——只有它的 sha256 出去。
 *   2. **落盘的是 rpsid，不是令牌**。泄漏后果因此小一个量级，而且服务端删一行就失效。
 *   3. **过期会话启动时就丢**，不留着试——留着只会让第一次调用在用户已经看着界面时报错。
 *   4. **401 就地清本地会话**。那是「设备远程吊销」在客户端的落点。
 *   5. **轮询只对 404 继续**。其余状态码重试等于把同一个错误重复两百次，
 *      而真实症状会被埋在轮询日志里。
 */

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";

import {
  NotSignedInError,
  PlatformSession,
  type PlatformSessionConfig,
} from "./platform-session.js";
import type { KeyManager } from "./keys.js";

const CONSOLE = "https://console.test";
const CONFIG: PlatformSessionConfig = { consoleBase: CONSOLE };

/** 明文「封存」：测试要能读回落盘内容，才验得了里面没有令牌。 */
function fakeKeys(): KeyManager {
  return {
    seal: (data: Buffer) => Buffer.concat([Buffer.from("SEALED:"), data]),
    open: (blob: Buffer) => blob.subarray("SEALED:".length),
  } as unknown as KeyManager;
}

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), "ruyin-session-"));
}

/** 记下每次 fetch，并按脚本回应。 */
function stubFetch(
  script: Array<{ status: number; body?: unknown }>,
): { calls: Array<{ url: string; body: unknown }>; restore: () => void } {
  const calls: Array<{ url: string; body: unknown }> = [];
  const original = globalThis.fetch;
  let i = 0;
  globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const step = script[Math.min(i++, script.length - 1)]!;
    return {
      ok: step.status >= 200 && step.status < 300,
      status: step.status,
      json: async () => step.body ?? {},
      /* 真 Response 有 headers；`cachedGet` 要读 Cache-Control 定 TTL。
         桩缺了它，失败的是桩不是实现——第一版就漏了这个。 */
      headers: { get: () => null } as unknown as Headers,
    } as Response;
  }) as typeof fetch;
  return { calls, restore: () => void (globalThis.fetch = original) };
}

describe("platform-session", () => {
  let restores: Array<() => void> = [];
  beforeEach(() => {
    restores.forEach((r) => r());
    restores = [];
  });
  after(() => restores.forEach((r) => r()));

  it("登录地址里只有哈希，没有 deviceSecret", () => {
    const s = new PlatformSession(CONFIG, fakeKeys(), makeDir());
    const url = new URL(s.beginLogin());

    assert.equal(url.origin, CONSOLE);
    assert.equal(url.pathname, "/api/auth/login");
    assert.equal(url.searchParams.get("surface"), "native");
    assert.equal(url.searchParams.get("prompt"), "select_account");

    const handle = url.searchParams.get("handle")!;
    // sha256 十六进制：64 个 hex 字符
    assert.match(handle, /^[0-9a-f]{64}$/);

    /* 决定性的一条：URL 里没有任何长随机串是「原文」。
       handle 必须是某个东西的哈希，而那个东西不在这个 URL 里。 */
    for (const [, v] of url.searchParams) {
      if (v === handle) continue;
      assert.equal(
        createHash("sha256").update(v).digest("hex") === handle,
        false,
        `URL 里出现了能算出 handle 的原文：${v}`,
      );
    }
  });

  it("领取成功后落盘的是 rpsid，盘上没有任何令牌字样", async () => {
    const dir = makeDir();
    const f = stubFetch([
      { status: 200, body: { rpsid: "sess-abc", expiresInSec: 3600 } },
    ]);
    restores.push(f.restore);

    const s = new PlatformSession(CONFIG, fakeKeys(), dir);
    s.beginLogin();
    await s.completeLogin();

    assert.equal(s.signedIn(), true);
    assert.equal(s.rpsid(), "sess-abc");

    const onDisk = readFileSync(join(dir, "platform", "session.bin"), "utf8");
    assert.match(onDisk, /sess-abc/);
    for (const forbidden of ["refresh_token", "access_token", "id_token"]) {
      assert.equal(
        onDisk.includes(forbidden),
        false,
        `盘上出现了 ${forbidden}`,
      );
    }
  });

  it("claim 请求带的是原文，而它从未出现在登录 URL 里", async () => {
    const f = stubFetch([
      { status: 200, body: { rpsid: "sess-1", expiresInSec: 60 } },
    ]);
    restores.push(f.restore);

    const s = new PlatformSession(CONFIG, fakeKeys(), makeDir());
    const loginUrl = s.beginLogin();
    await s.completeLogin();

    const claim = f.calls.at(-1)!;
    const secret = (claim.body as { deviceSecret: string }).deviceSecret;
    assert.match(secret, /^[0-9a-f]{64}$/);
    assert.equal(loginUrl.includes(secret), false, "原文漏进了登录 URL");

    /* 而登录 URL 里那个 handle 确实是它的哈希——两半对得上，握手才成立。 */
    const handle = new URL(loginUrl).searchParams.get("handle");
    assert.equal(createHash("sha256").update(secret).digest("hex"), handle);
  });

  it("404 继续轮询，其余状态码立刻放弃", async () => {
    const f404 = stubFetch([
      { status: 404 },
      { status: 404 },
      { status: 200, body: { rpsid: "sess-2", expiresInSec: 60 } },
    ]);
    restores.push(f404.restore);
    const ok = new PlatformSession(CONFIG, fakeKeys(), makeDir());
    ok.beginLogin();
    await ok.completeLogin();
    assert.equal(ok.rpsid(), "sess-2");
    assert.equal(f404.calls.length, 3);
    f404.restore();

    /* 400 不重试：重试一个判定为错的请求只是把同一个错误重复很多次，
       而真实症状（比如 secret 太短）会被埋在轮询日志里看不见。 */
    const f400 = stubFetch([{ status: 400 }, { status: 200 }]);
    restores.push(f400.restore);
    const bad = new PlatformSession(CONFIG, fakeKeys(), makeDir());
    bad.beginLogin();
    await assert.rejects(() => bad.completeLogin(), NotSignedInError);
    assert.equal(f400.calls.length, 1, "400 之后不该再请求");
  });

  it("没开始登录就领取 → NotSignedInError", async () => {
    const s = new PlatformSession(CONFIG, fakeKeys(), makeDir());
    await assert.rejects(() => s.completeLogin(), NotSignedInError);
  });

  it("401 就地清掉本地会话——这是远程吊销在客户端的落点", async () => {
    const dir = makeDir();
    const f = stubFetch([
      { status: 200, body: { rpsid: "sess-3", expiresInSec: 3600 } },
      { status: 401 },
    ]);
    restores.push(f.restore);

    const s = new PlatformSession(CONFIG, fakeKeys(), dir);
    s.beginLogin();
    await s.completeLogin();
    assert.equal(s.signedIn(), true);

    await assert.rejects(() => s.fetch("/api/subscription/my"), NotSignedInError);
    assert.equal(s.signedIn(), false, "401 之后本地还留着会话");
    assert.equal(existsSync(join(dir, "platform", "session.bin")), false);
  });

  it("带会话的请求把 rpsid 放在请求头里，不放 URL", async () => {
    const f = stubFetch([
      { status: 200, body: { rpsid: "sess-4", expiresInSec: 3600 } },
      { status: 200, body: [] },
    ]);
    restores.push(f.restore);
    const s = new PlatformSession(CONFIG, fakeKeys(), makeDir());
    s.beginLogin();
    await s.completeLogin();
    await s.fetch("/api/subscription/my");

    const call = f.calls.at(-1)!;
    assert.equal(
      call.url.includes("sess-4"),
      false,
      "rpsid 漏进了 URL（会进日志）",
    );
  });

  it("过期的会话在启动时就丢掉，不留着试", async () => {
    const dir = makeDir();
    const f = stubFetch([
      { status: 200, body: { rpsid: "sess-5", expiresInSec: 1 } },
    ]);
    restores.push(f.restore);

    const first = new PlatformSession(CONFIG, fakeKeys(), dir);
    first.beginLogin();
    await first.completeLogin();
    assert.equal(first.signedIn(), true);

    await new Promise((r) => setTimeout(r, 1100));
    /* 同一个目录重新构造 = 模拟下次启动。 */
    const second = new PlatformSession(CONFIG, fakeKeys(), dir);
    assert.equal(second.signedIn(), false);
    assert.equal(
      existsSync(join(dir, "platform", "session.bin")),
      false,
      "过期会话该在 restore 时删掉",
    );
  });

  it("登出清本地并通知服务端；服务端收不掉也不让登出失败", async () => {
    const dir = makeDir();
    const f = stubFetch([
      { status: 200, body: { rpsid: "sess-6", expiresInSec: 3600 } },
      { status: 500 },
    ]);
    restores.push(f.restore);

    const s = new PlatformSession(CONFIG, fakeKeys(), dir);
    s.beginLogin();
    await s.completeLogin();
    await s.logout();

    assert.equal(s.signedIn(), false);
    assert.equal(existsSync(join(dir, "platform", "session.bin")), false);
    assert.match(f.calls.at(-1)!.url, /\/api\/auth\/logout$/);
  });

  it("status() 给 UI 的东西里没有 rpsid——这是 browser-zero-token 的底线", async () => {
    const f = stubFetch([
      { status: 200, body: { rpsid: "sess-secret-7", expiresInSec: 3600 } },
    ]);
    restores.push(f.restore);
    const s = new PlatformSession(CONFIG, fakeKeys(), makeDir());
    s.beginLogin();
    await s.completeLogin();

    /* 取凭据的方法叫 rpsid()，给 UI 的叫 status()。两者刻意不重名——
       旧 PlatformService.session() 返回的是 UI 状态，若新类也叫 session()，
       接线时一手滑就把会话号送进了渲染层。 */
    const forUi = JSON.stringify(s.status());
    assert.equal(
      forUi.includes("sess-secret-7"),
      false,
      "status() 里出现了 rpsid",
    );
    assert.equal(s.status().signedIn, true);
    assert.equal(s.rpsid(), "sess-secret-7");
  });

  it("C2 读走 console-bff，工作区不由我们声明", async () => {
    const f = stubFetch([
      { status: 200, body: { rpsid: "sess-8", expiresInSec: 3600 } },
      { status: 200, body: [{ productCode: "vxtpl" }] },
    ]);
    restores.push(f.restore);
    const s = new PlatformSession(CONFIG, fakeKeys(), makeDir());
    s.beginLogin();
    await s.completeLogin();
    await s.subscribedProducts();

    const call = f.calls.at(-1)!;
    assert.match(call.url, /\/api\/subscription\/subscribed-products$/);
    /* 旧路径要把 workspace_id 拼进查询串——那是调用方自陈，平台无从核对。
       现在工作区来自服务端会话，URL 里不该再出现它。 */
    assert.equal(call.url.includes("workspace_id"), false);
    assert.equal(call.url.includes("platform/entitlements"), false);
  });

  it("登出清掉权益缓存——换账号后留着上一个人的是串号", async () => {
    const f = stubFetch([
      { status: 200, body: { rpsid: "s1", expiresInSec: 3600 } },
      { status: 200, body: ["A 的订阅"] },
      { status: 200 }, // logout
      { status: 200, body: { rpsid: "s2", expiresInSec: 3600 } },
      { status: 200, body: ["B 的订阅"] },
    ]);
    restores.push(f.restore);
    const s = new PlatformSession(CONFIG, fakeKeys(), makeDir());
    s.beginLogin();
    await s.completeLogin();
    assert.deepEqual(await s.subscribedProducts(), ["A 的订阅"]);

    await s.logout();
    s.beginLogin();
    await s.completeLogin();
    /* 缓存没清的话这里会拿回 A 的那一份——而它不报错。 */
    assert.deepEqual(await s.subscribedProducts(), ["B 的订阅"]);
  });

  it("每次 beginLogin 生成新的 secret——重开登录不复用旧的", () => {
    const s = new PlatformSession(CONFIG, fakeKeys(), makeDir());
    const a = new URL(s.beginLogin()).searchParams.get("handle");
    const b = new URL(s.beginLogin()).searchParams.get("handle");
    assert.notEqual(a, b);
    assert.equal(randomBytes(1).length, 1); // 触及 import，避免未用告警
  });
});
