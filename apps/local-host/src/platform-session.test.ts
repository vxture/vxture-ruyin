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
  PLATFORM_PATHS,
  PLATFORM_READS,
  PlatformReadError,
  projectAtlasModels,
  projectIdentity,
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

  /*
   * 这一条查的是**性质**，不是字面。
   *
   * 原来这里写的是 `assert.equal(url.pathname, "/api/auth/login")`——和实现里那个
   * 写错的常量一模一样，于是两边一样地错，测试永远绿。比对型断言抓不到这种错：
   * 它只能证明两份一致，证明不了它们对。
   *
   * 真正的不变式来自平台侧：console-bff 的 `AuthMiddleware` 挂在 `api/*` 上，而会话
   * 端点必须在它之外——它们是**用来拿会话的**，不可能自带会话。落进 `api/` 的后果不是
   * 404 而是 **401**，而 401 会被读成「凭据错了」：登录起不来，轮询当场放弃，症状指向
   * 认证而病因在路由前缀。
   */
  it("所有平台端点都在 api/ 之外——落进去会被中间件挡成 401", () => {
    const s = new PlatformSession(CONFIG, fakeKeys(), makeDir());
    const paths = [new URL(s.beginLogin()).pathname];
    /* claim 与 logout 不经 beginLogin 暴露，从源码常量表取，避免在这里再抄一遍。 */
    for (const p of Object.values(PLATFORM_PATHS)) paths.push(p);

    for (const p of paths) {
      assert.ok(p.startsWith("/"), `${p} 不是绝对路径`);
      assert.equal(
        p.startsWith("/api/"),
        false,
        `${p} 落在 AuthMiddleware 覆盖的 /api/ 下，线上会永远回 401`,
      );
    }
  });

  it("登录地址里只有哈希，没有 deviceSecret", () => {
    const s = new PlatformSession(CONFIG, fakeKeys(), makeDir());
    const url = new URL(s.beginLogin());

    assert.equal(url.origin, CONSOLE);
    assert.equal(url.pathname, "/auth/login");
    assert.equal(url.searchParams.get("surface"), "native");

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
    assert.match(f.calls.at(-1)!.url, /\/auth\/logout$/);
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

  it("带会话的读全在 /api/ 下——与会话端点相反，它们要鉴权中间件解出工作区", () => {
    for (const p of Object.values(PLATFORM_READS)) {
      assert.ok(p.startsWith("/api/"), `${p} 不在 /api/ 下，拿不到会话里的租户上下文`);
    }
  });

  it("projectIdentity：用户、租户、工作区各取各的，平台合成的邮箱不当真", () => {
    const id = projectIdentity(
      {
        id: "u1",
        name: "zhang",
        displayName: "张三",
        email: "zhang@local.vxture",
        username: "zhang",
        phone: "138",
        picture: "https://x/p.png",
        roleLabel: "Owner",
      },
      { id: "t1", name: "某公司", mode: "tenant", workspace: "default", tenantType: "organization", workspaceName: "默认" },
      [
        { tenantId: "t0", workspaceId: "ws-other", workspaceName: "别的", isCurrent: false },
        { tenantId: "t1", workspaceId: "ws-1", workspaceName: "主工作区", isCurrent: true },
      ],
    );
    assert.deepEqual(id, {
      profile: {
        sub: "u1",
        name: "张三",
        username: "zhang",
        phone: "138",
        picture: "https://x/p.png",
        roles: ["Owner"],
      },
      org: { id: "t1", name: "某公司", type: "organization" },
      workspace: { id: "ws-1", name: "主工作区" },
    });
  });

  /*
   * 这一条钉的是一次会串数据的错：`TenantContext.workspace` 解不出时是字面量
   * "default"。若把它当工作区 id，所有租户的项目都归到同一个 "default" 下。
   */
  it("projectIdentity：工作区 id 只认 /api/me/workspaces 的真实 id，占位值一律不算", () => {
    const ctx = { id: "t1", name: "T", mode: "tenant", workspace: "default", workspaceName: "默认工作区" };
    // 没有工作区列表：有名字、没有 id —— 宁可建不了项目，也不归到占位值下
    assert.deepEqual(projectIdentity(undefined, ctx, undefined).workspace, { name: "默认工作区" });
    // 列表里的 id 是占位值：同样不算
    assert.deepEqual(
      projectIdentity(undefined, ctx, [{ tenantId: "t1", workspaceId: "default", workspaceName: null }]).workspace,
      { name: "默认工作区" },
    );
    // 别的租户的行不能冒充当前租户的；没有 isCurrent 时取当前租户的第一行
    assert.deepEqual(
      projectIdentity(undefined, ctx, [
        { tenantId: "t9", workspaceId: "ws-9", isCurrent: true },
        { tenantId: "t1", workspaceId: "ws-1" },
      ]).workspace,
      { id: "ws-1", name: "默认工作区" },
    );
    // 平台态（没有任何组织）不投射租户，也就没有工作区
    assert.deepEqual(
      projectIdentity(undefined, { id: "platform:u1", mode: "platform", workspace: "PLATFORM" }, [
        { tenantId: "platform:u1", workspaceId: "ws-x" },
      ]),
      {},
    );
    // 形状不对的输入不抛，只是缺席
    assert.deepEqual(projectIdentity("oops", 42, { not: "an array" }), {});
    assert.deepEqual(projectIdentity({ name: "没有 id" }, null, []), {});
    assert.deepEqual(projectIdentity({ id: "u2", email: "a@b.c" }, { id: "t", mode: "tenant" }, []), {
      profile: { sub: "u2", email: "a@b.c" },
      org: { id: "t" },
    });
  });

  it("identity() 并发读三条；某一条失败只让那一块缺席，未登录直接空", async () => {
    const notSignedIn = new PlatformSession(CONFIG, fakeKeys(), makeDir());
    assert.deepEqual(await notSignedIn.identity(), {});
    assert.equal(await notSignedIn.activeWorkspaceId(), undefined);

    const replies: Record<string, { status: number; body?: unknown }> = {
      "/auth/native/claim": { status: 200, body: { rpsid: "sess-id", expiresInSec: 3600 } },
      "/api/me": { status: 200, body: { id: "u1", name: "张三" } },
      "/api/tenant-context": { status: 500 },
      "/api/me/workspaces": { status: 200, body: [{ tenantId: "t1", workspaceId: "ws-1" }] },
    };
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: URL | string) => {
      const path = new URL(String(input)).pathname;
      calls.push(path);
      const r = replies[path] ?? { status: 404 };
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        json: async () => r.body ?? {},
        headers: { get: () => null } as unknown as Headers,
      } as Response;
    }) as typeof fetch;
    restores.push(() => void (globalThis.fetch = original));

    const s = new PlatformSession(CONFIG, fakeKeys(), makeDir());
    s.beginLogin();
    await s.completeLogin();
    /* 租户上下文那条 500：没有租户，工作区也就无从对上 —— 但名字照样在。 */
    assert.deepEqual(await s.identity(), { profile: { sub: "u1", name: "张三" } });
    assert.equal(await s.activeWorkspaceId(), undefined);

    replies["/api/tenant-context"] = { status: 200, body: { id: "t1", mode: "tenant", name: "T" } };
    /* 失败的读没有进缓存，下一次会重新问；成功的读在缓存期内不再发。 */
    const before = calls.filter((c) => c === "/api/me").length;
    assert.equal(await s.activeWorkspaceId(), "ws-1");
    assert.equal(calls.filter((c) => c === "/api/me").length, before, "缓存期内重复请求了 /api/me");
    assert.ok(!calls.some((c) => c.includes("sess-id")), "rpsid 漏进了 URL");
  });

  it("identity()：读的过程中会话被平台拒（401），回空而不是半份身份", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: URL | string) => {
      const path = new URL(String(input)).pathname;
      const ok = path === "/auth/native/claim";
      return {
        ok,
        // **连身份那条也 401 才算会话真被拒**（任务 50）：一次 401 不再等于登出，
        // 守护进程会向 /api/me 再确认一次。
        status: ok ? 200 : 401,
        json: async () => (ok ? { rpsid: "sess-401", expiresInSec: 3600 } : { id: "u1" }),
        headers: { get: () => null } as unknown as Headers,
      } as Response;
    }) as typeof fetch;
    restores.push(() => void (globalThis.fetch = original));

    const s = new PlatformSession(CONFIG, fakeKeys(), makeDir());
    s.beginLogin();
    await s.completeLogin();
    assert.deepEqual(await s.identity(), {});
    assert.equal(s.signedIn(), false);
  });

  /**
   * bug 2（owner 2026-09-18 真机报的）：约十分钟后自己登出，回到登录页。
   *
   * 根因是这里原来一行代码 —— 平台**任何一个接口**回一次 401，就 signOutLocal()。
   * 而 syncEntitlements 每 5 分钟问一次，第二次那一下撞上就把人踢了。
   */
  it("一个接口回 401、而身份那条仍认 —— **不登出**，并且把这件事写进日志", async () => {
    const lines: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: URL | string) => {
      const path = new URL(String(input)).pathname;
      if (path === "/auth/native/claim") {
        return { ok: true, status: 200, json: async () => ({ rpsid: "sess-blip", expiresInSec: 3600 }), headers: { get: () => null } as unknown as Headers } as Response;
      }
      // 身份那条照常，权益那条抽风回 401 —— 真机上就是这个形状。
      const ok = path === "/api/me";
      return { ok, status: ok ? 200 : 401, json: async () => ({ id: "u1" }), headers: { get: () => null } as unknown as Headers } as Response;
    }) as typeof fetch;
    restores.push(() => void (globalThis.fetch = original));

    const s = new PlatformSession({ ...CONFIG, log: (l) => lines.push(l) }, fakeKeys(), makeDir());
    s.beginLogin();
    await s.completeLogin();
    const res = await s.fetch("/api/subscription/subscribed-products");
    assert.equal(res.status, 401, "那一个接口的 401 原样交回去，由调用方自己处理");
    assert.equal(s.signedIn(), true, "**不许因为一次 401 就把人登出**");
    assert.ok(lines.some((l) => /仍认这条会话/.test(l)), "这条判断要留下痕迹，否则下次又是零证据");
  });
  it("quotaUsage 走 console-bff 的配额读", async () => {
    const f = stubFetch([
      { status: 200, body: { rpsid: "sess-q", expiresInSec: 3600 } },
      { status: 200, body: { storage: { used: 1, limit: 2 }, aiCredit: { used: 3, limit: 4 } } },
    ]);
    restores.push(f.restore);
    const s = new PlatformSession(CONFIG, fakeKeys(), makeDir());
    s.beginLogin();
    await s.completeLogin();
    assert.deepEqual(await s.quotaUsage(), { storage: { used: 1, limit: 2 }, aiCredit: { used: 3, limit: 4 } });
    assert.match(f.calls.at(-1)!.url, /\/api\/subscription\/quota-usage$/);
  });

  /* orgLogo 不走 cachedGet（响应体是图片字节，不是 JSON），所以要自己搭一个
     带得动 arrayBuffer() 与真 content-type 的桩，stubFetch 那份是给 JSON 读用的。 */
  it("orgLogo 有自定义 logo 时把字节连同 content-type 一起交出来", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    let call = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      call += 1;
      if (call === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ rpsid: "sess-logo", expiresInSec: 3600 }),
          headers: { get: () => null } as unknown as Headers,
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => bytes.buffer,
        headers: {
          get: (k: string) => (k.toLowerCase() === "content-type" ? "image/png" : null),
        } as unknown as Headers,
      } as Response;
    }) as typeof fetch;
    restores.push(() => void (globalThis.fetch = original));

    const s = new PlatformSession(CONFIG, fakeKeys(), makeDir());
    s.beginLogin();
    await s.completeLogin();
    const logo = await s.orgLogo();
    assert.ok(logo);
    assert.equal(logo!.contentType, "image/png");
    assert.deepEqual([...logo!.data], [1, 2, 3, 4]);
  });

  it("orgLogo 没传过（404）回 null，不当错误抛", async () => {
    const f = stubFetch([
      { status: 200, body: { rpsid: "sess-nologo", expiresInSec: 3600 } },
      { status: 404 },
    ]);
    restores.push(f.restore);
    const s = new PlatformSession(CONFIG, fakeKeys(), makeDir());
    s.beginLogin();
    await s.completeLogin();
    assert.equal(await s.orgLogo(), null);
  });

  /* 模型平台（RY-001 #24）：读 console-bff 的 atlas 模型；平台非 2xx 要带着状态码抛，
     server 那一层才分得清「这个角色不能看」（403）与「这次没取到」。 */
  it("atlasModels 走 console-bff 的 /api/atlas/models；非 2xx 抛带状态码的 PlatformReadError", async () => {
    const f = stubFetch([
      { status: 200, body: { rpsid: "sess-m", expiresInSec: 3600 } },
      { status: 200, body: [{ modelCode: "qwen-max", modelName: "通义千问 Max" }] },
    ]);
    restores.push(f.restore);
    const s = new PlatformSession(CONFIG, fakeKeys(), makeDir());
    s.beginLogin();
    await s.completeLogin();
    assert.deepEqual(await s.atlasModels(), [{ modelCode: "qwen-max", modelName: "通义千问 Max" }]);
    assert.match(f.calls.at(-1)!.url, new RegExp(`${PLATFORM_READS.atlasModels}$`));

    const g = stubFetch([
      { status: 200, body: { rpsid: "sess-m2", expiresInSec: 3600 } },
      { status: 403, body: { code: "FORBIDDEN" } },
    ]);
    restores.push(g.restore);
    const t = new PlatformSession(CONFIG, fakeKeys(), makeDir());
    t.beginLogin();
    await t.completeLogin();
    await assert.rejects(t.atlasModels(), (e: unknown) => {
      assert.ok(e instanceof PlatformReadError);
      assert.equal(e.status, 403);
      assert.equal(e.path, "/api/atlas/models");
      assert.equal(e.message, "/api/atlas/models failed: HTTP 403");
      return true;
    });
  });

  it("projectAtlasModels：只留展示字段；不是数组就是空", () => {
    assert.deepEqual(projectAtlasModels({ items: [] }), []);
    assert.deepEqual(
      projectAtlasModels([
        { modelCode: "a", modelName: "A", provider: "p", capabilities: ["chat", 1], isActive: false, endpointUrl: "x", keyReference: { name: "K" } },
        { modelCode: "b", modelName: "B" },
        { modelName: "no code" },
        "junk",
      ]),
      [
        { modelCode: "a", modelName: "A", provider: "p", capabilities: ["chat"], isActive: false },
        { modelCode: "b", modelName: "B", provider: "", capabilities: [], isActive: true },
      ],
    );
  });

  /**
   * 0a 的核心断言，钉的是 TD-069 的真因（RY-103 §02）。
   *
   * 平台 `authorize()` 里 `forcesInteraction = prompt === "login" || prompt ===
   * "select_account"`，命中即 `hasUsableSession = false`——**带上它就是要求平台
   * 忽略浏览器里那份会话**。此前 `beginLogin()` 无条件带着它，于是「浏览器明明
   * 登着，Ruyin 还要重输账号密码」。
   *
   * 两条用例是一对，缺一不可：只测「普通登录不带」，哪天有人为了别的原因把它加
   * 回去、顺手也给「换个账号」留着，测试全绿；只测「换账号带」，则退回无条件带
   * 的老样子同样全绿。
   */
  it("普通登录不带 prompt——浏览器里登着就直接沿用（TD-069 的真因）", () => {
    const s = new PlatformSession(CONFIG, fakeKeys(), makeDir());

    assert.equal(new URL(s.beginLogin()).searchParams.get("prompt"), null);
    assert.equal(new URL(s.beginLogin({})).searchParams.get("prompt"), null);
    assert.equal(
      new URL(s.beginLogin({ switchAccount: false })).searchParams.get("prompt"),
      null,
    );
  });

  it("「换个账号」才带 prompt=select_account——平台据此把现有会话当作不可用", () => {
    const s = new PlatformSession(CONFIG, fakeKeys(), makeDir());
    const url = new URL(s.beginLogin({ switchAccount: true }));

    assert.equal(url.searchParams.get("prompt"), "select_account");
    // 换账号也还是同一条原生握手：秘密不穿过浏览器这一条不受影响。
    assert.equal(url.searchParams.get("surface"), "native");
    assert.match(url.searchParams.get("handle")!, /^[0-9a-f]{64}$/);
  });

  it("每次 beginLogin 生成新的 secret——重开登录不复用旧的", () => {
    const s = new PlatformSession(CONFIG, fakeKeys(), makeDir());
    const a = new URL(s.beginLogin()).searchParams.get("handle");
    const b = new URL(s.beginLogin()).searchParams.get("handle");
    assert.notEqual(a, b);
    assert.equal(randomBytes(1).length, 1); // 触及 import，避免未用告警
  });
});
