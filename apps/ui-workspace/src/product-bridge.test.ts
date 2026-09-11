/**
 * ProductBridge（product-bridge.ts，ADR-022 §5 片二）。
 *
 * 没有真实的沙箱 iframe（片三还没做），也没有真实产品——这里用一个假窗口对象
 * 当「产品界面」：只要它能收发 postMessage、`event.source` 认得出它，桥就分不出
 * 它跟真的沙箱 iframe 有什么区别。片二的判据就是「用测试页当假产品能把协议验完」。
 */

import { afterEach, expect, test, vi } from "vitest";
import { ProductBridge, type BridgeOutboundMessage, type ProductBridgeOptions } from "./product-bridge";

const ORIGIN = "https://product.local";

/** 假窗口：只需要 `postMessage` 能被断言到，`source` 恒等比较能过。 */
function fakeSource(): Window {
  return { postMessage: vi.fn() } as unknown as Window;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * 直接派发到 `window`——桥的监听器挂在 `window` 上，不是挂在某个 iframe 元素上。
 * `source` 是必填的：忘了带上就等于在测「source 不匹配会被丢弃」，而不是想测的
 * 那件事——这个坑已经踩过一次（第一版全部 13 条断言失败，原因就是这个）。
 */
function post(source: Window, data: unknown, origin: string = ORIGIN): void {
  window.dispatchEvent(new MessageEvent("message", { data, origin, source }));
}

function outboxOf(source: Window): BridgeOutboundMessage[] {
  const mock = (source as unknown as { postMessage: ReturnType<typeof vi.fn> }).postMessage;
  return mock.mock.calls.map((c) => c[0] as BridgeOutboundMessage);
}

/** 等挂在 `handle()` 里的那条 async 链跑完——测试断言之前得先让微任务队列走一轮。 */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

let attached: ProductBridge[] = [];
function bridge(options: Partial<ProductBridgeOptions> & { source: Window }): ProductBridge {
  const b = new ProductBridge({
    getBridgeToken: vi.fn().mockResolvedValue({ token: "tok_1", expiresAt: Date.now() + 600_000 }),
    targetOrigin: ORIGIN,
    fetchImpl: vi.fn().mockResolvedValue(jsonResponse({ ok: true })),
    ...options,
  });
  b.attach();
  attached.push(b);
  return b;
}

afterEach(() => {
  for (const b of attached) b.detach();
  attached = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/* ---------------- 请求 / 响应配对 ---------------- */

void test("ProductBridge: 一次 GET 转发到 /bridge<path>，不带 content-type，答复原样带回请求 id", async () => {
  const source = fakeSource();
  const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ bindings: [] }));
  bridge({ source, fetchImpl });

  post(source, { ns: "ruyin.bridge", kind: "request", id: "req_1", method: "GET", path: "/context" });
  await flush();

  expect(fetchImpl).toHaveBeenCalledWith("/bridge/context", {
    method: "GET",
    headers: { authorization: "Bearer tok_1" },
    body: undefined,
  });
  expect(outboxOf(source)).toEqual([
    { ns: "ruyin.bridge", kind: "response", id: "req_1", ok: true, status: 200, body: { bindings: [] } },
  ]);
});

void test("ProductBridge: 带 body 的 POST 会加 content-type 并把 body 序列化", async () => {
  const source = fakeSource();
  const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "t1" }, 201));
  bridge({ source, fetchImpl });

  post(source, { ns: "ruyin.bridge", kind: "request", id: "req_2", method: "POST", path: "/tasks", body: { task: "x" } });
  await flush();

  expect(fetchImpl).toHaveBeenCalledWith("/bridge/tasks", {
    method: "POST",
    headers: { authorization: "Bearer tok_1", "content-type": "application/json" },
    body: JSON.stringify({ task: "x" }),
  });
  expect(outboxOf(source)[0]).toEqual({
    ns: "ruyin.bridge",
    kind: "response",
    id: "req_2",
    ok: true,
    status: 201,
    body: { id: "t1" },
  });
});

void test("ProductBridge: 两个并发请求各自配对，不会串到对方的 id 上", async () => {
  const source = fakeSource();
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse({ n: 1 }))
    .mockResolvedValueOnce(jsonResponse({ n: 2 }));
  bridge({ source, fetchImpl });

  post(source, { ns: "ruyin.bridge", kind: "request", id: "a", method: "GET", path: "/x" });
  post(source, { ns: "ruyin.bridge", kind: "request", id: "b", method: "GET", path: "/y" });
  await flush();

  const ids = outboxOf(source).map((m) => (m as { id: string }).id);
  expect(ids.sort()).toEqual(["a", "b"]);
});

/* ---------------- 不认的消息，原样丢弃 ---------------- */

void test.each([
  ["不是对象", "just a string"],
  ["null", null],
  ["ns 不对", { ns: "someone.else", kind: "request", id: "1", method: "GET", path: "/x" }],
  ["kind 不是 request", { ns: "ruyin.bridge", kind: "response", id: "1", method: "GET", path: "/x" }],
  ["id 不是字符串", { ns: "ruyin.bridge", kind: "request", id: 1, method: "GET", path: "/x" }],
  ["method 不在四种之内", { ns: "ruyin.bridge", kind: "request", id: "1", method: "PATCH", path: "/x" }],
  ["path 不是字符串", { ns: "ruyin.bridge", kind: "request", id: "1", method: "GET", path: 1 }],
  ["path 不以 / 开头", { ns: "ruyin.bridge", kind: "request", id: "1", method: "GET", path: "x" }],
])("ProductBridge: 形状不对的消息不当请求处理（%s）", async (_label, payload) => {
  const source = fakeSource();
  const fetchImpl = vi.fn();
  bridge({ source, fetchImpl });

  post(source, payload);
  await flush();

  expect(fetchImpl).not.toHaveBeenCalled();
  expect(outboxOf(source)).toEqual([]);
});

void test("ProductBridge: 只认 targetOrigin，来源 origin 不对就当没收到", async () => {
  const source = fakeSource();
  const fetchImpl = vi.fn();
  bridge({ source, fetchImpl });

  post(
    source,
    { ns: "ruyin.bridge", kind: "request", id: "req_1", method: "GET", path: "/context" },
    "https://someone-else.example",
  );
  await flush();

  expect(fetchImpl).not.toHaveBeenCalled();
});

void test("ProductBridge: 只认 source 那扇窗口，另一扇窗口发来的同样忽略", async () => {
  const source = fakeSource();
  const other = fakeSource();
  const fetchImpl = vi.fn();
  bridge({ source, fetchImpl });

  post(other, { ns: "ruyin.bridge", kind: "request", id: "req_1", method: "GET", path: "/context" });
  await flush();

  expect(fetchImpl).not.toHaveBeenCalled();
  expect(outboxOf(other)).toEqual([]);
});

void test("ProductBridge: detach 之后不再处理任何消息", async () => {
  const source = fakeSource();
  const fetchImpl = vi.fn();
  const b = bridge({ source, fetchImpl });
  b.detach();

  post(source, { ns: "ruyin.bridge", kind: "request", id: "req_1", method: "GET", path: "/context" });
  await flush();

  expect(fetchImpl).not.toHaveBeenCalled();
});

/* ---------------- 令牌：换取与缓存 ---------------- */

void test("ProductBridge: 同一张凭据在有效期内复用，不逐请求重新换", async () => {
  const source = fakeSource();
  const getBridgeToken = vi.fn().mockResolvedValue({ token: "tok_1", expiresAt: Date.now() + 600_000 });
  const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
  bridge({ source, getBridgeToken, fetchImpl });

  post(source, { ns: "ruyin.bridge", kind: "request", id: "a", method: "GET", path: "/x" });
  await flush();
  post(source, { ns: "ruyin.bridge", kind: "request", id: "b", method: "GET", path: "/x" });
  await flush();

  expect(getBridgeToken).toHaveBeenCalledTimes(1);
});

void test("ProductBridge: 快到期（< 30s）时提前换一张新的，不等真过期", async () => {
  const source = fakeSource();
  const getBridgeToken = vi
    .fn()
    .mockResolvedValueOnce({ token: "tok_old", expiresAt: Date.now() + 10_000 })
    .mockResolvedValueOnce({ token: "tok_new", expiresAt: Date.now() + 600_000 });
  const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
  bridge({ source, getBridgeToken, fetchImpl });

  post(source, { ns: "ruyin.bridge", kind: "request", id: "a", method: "GET", path: "/x" });
  await flush();
  post(source, { ns: "ruyin.bridge", kind: "request", id: "b", method: "GET", path: "/x" });
  await flush();

  expect(getBridgeToken).toHaveBeenCalledTimes(2);
  expect(fetchImpl).toHaveBeenLastCalledWith(
    "/bridge/x",
    expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer tok_new" }) }),
  );
});

/* ---------------- 错误还原 ---------------- */

void test("ProductBridge: 换凭据本身失败 —— BRIDGE_TOKEN_UNAVAILABLE，不发 fetch", async () => {
  const source = fakeSource();
  const getBridgeToken = vi.fn().mockRejectedValue(new Error("会话已过期"));
  const fetchImpl = vi.fn();
  bridge({ source, getBridgeToken, fetchImpl });

  post(source, { ns: "ruyin.bridge", kind: "request", id: "req_1", method: "GET", path: "/context" });
  await flush();

  expect(fetchImpl).not.toHaveBeenCalled();
  expect(outboxOf(source)).toEqual([
    {
      ns: "ruyin.bridge",
      kind: "response",
      id: "req_1",
      ok: false,
      status: 0,
      error: { code: "BRIDGE_TOKEN_UNAVAILABLE", message: "会话已过期", retryable: true },
    },
  ]);
});

void test("ProductBridge: 换凭据拒绝的不是 Error 实例时，message 退化为字符串", async () => {
  const source = fakeSource();
  const getBridgeToken = vi.fn().mockRejectedValue("boom");
  bridge({ source, getBridgeToken, fetchImpl: vi.fn() });

  post(source, { ns: "ruyin.bridge", kind: "request", id: "req_1", method: "GET", path: "/x" });
  await flush();

  expect((outboxOf(source)[0] as { error: { message: string } }).error.message).toBe("boom");
});

void test("ProductBridge: 请求根本没发出去（网络层失败）—— BRIDGE_NETWORK_ERROR，retryable", async () => {
  const source = fakeSource();
  const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
  bridge({ source, fetchImpl });

  post(source, { ns: "ruyin.bridge", kind: "request", id: "req_1", method: "GET", path: "/context" });
  await flush();

  expect(outboxOf(source)).toEqual([
    {
      ns: "ruyin.bridge",
      kind: "response",
      id: "req_1",
      ok: false,
      status: 0,
      error: { code: "BRIDGE_NETWORK_ERROR", message: "Failed to fetch", retryable: true },
    },
  ]);
});

void test("ProductBridge: 网络层失败且拒绝的不是 Error 实例时，message 退化为字符串", async () => {
  const source = fakeSource();
  const fetchImpl = vi.fn().mockRejectedValue("offline");
  bridge({ source, fetchImpl });

  post(source, { ns: "ruyin.bridge", kind: "request", id: "req_1", method: "GET", path: "/x" });
  await flush();

  expect((outboxOf(source)[0] as { error: { message: string } }).error.message).toBe("offline");
});

void test("ProductBridge: 守护进程回了标准错误封套（X-1）—— 原样带回，不改写", async () => {
  const source = fakeSource();
  const fetchImpl = vi
    .fn()
    .mockResolvedValue(jsonResponse({ code: "POLICY_DENIED", message: "越界了", retryable: false, field: "path" }, 403));
  bridge({ source, fetchImpl });

  post(source, { ns: "ruyin.bridge", kind: "request", id: "req_1", method: "GET", path: "/context" });
  await flush();

  expect(outboxOf(source)).toEqual([
    {
      ns: "ruyin.bridge",
      kind: "response",
      id: "req_1",
      ok: false,
      status: 403,
      error: { code: "POLICY_DENIED", message: "越界了", retryable: false, field: "path" },
    },
  ]);
});

void test("ProductBridge: 错误响应没有 field 时，回复里也不带 field 这个键", async () => {
  const source = fakeSource();
  const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ code: "AUTH_REQUIRED", message: "缺凭据", retryable: false }, 401));
  bridge({ source, fetchImpl });

  post(source, { ns: "ruyin.bridge", kind: "request", id: "req_1", method: "GET", path: "/x" });
  await flush();

  const msg = outboxOf(source)[0] as unknown as { error: Record<string, unknown> };
  expect("field" in msg.error).toBe(false);
});

void test("ProductBridge: 错误响应体读不出标准形状时，回退到通用错误与 HTTP 状态文案", async () => {
  const source = fakeSource();
  // 500 但响应体不是 JSON——res.json() 会拒绝，走 `.catch(() => undefined)`。
  const fetchImpl = vi.fn().mockResolvedValue(
    new Response("<html>502 Bad Gateway</html>", { status: 502, headers: { "content-type": "text/html" } }),
  );
  bridge({ source, fetchImpl });

  post(source, { ns: "ruyin.bridge", kind: "request", id: "req_1", method: "GET", path: "/x" });
  await flush();

  expect(outboxOf(source)).toEqual([
    {
      ns: "ruyin.bridge",
      kind: "response",
      id: "req_1",
      ok: false,
      status: 502,
      error: { code: "BRIDGE_UNKNOWN_ERROR", message: "HTTP 502", retryable: false },
    },
  ]);
});

void test("ProductBridge: 成功响应没有 body（204 之类）时，body 为 undefined", async () => {
  const source = fakeSource();
  const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  bridge({ source, fetchImpl });

  post(source, { ns: "ruyin.bridge", kind: "request", id: "req_1", method: "DELETE", path: "/files/f1" });
  await flush();

  expect(outboxOf(source)).toEqual([
    { ns: "ruyin.bridge", kind: "response", id: "req_1", ok: true, status: 204, body: undefined },
  ]);
});

void test("ProductBridge: 不传 fetchImpl 时落到全局 fetch，不是必须显式传一个", async () => {
  const source = fakeSource();
  const globalFetch = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
  vi.stubGlobal("fetch", globalFetch);
  const b = new ProductBridge({
    getBridgeToken: vi.fn().mockResolvedValue({ token: "tok_1", expiresAt: Date.now() + 600_000 }),
    targetOrigin: ORIGIN,
    source,
  });
  b.attach();
  attached.push(b);

  post(source, { ns: "ruyin.bridge", kind: "request", id: "req_1", method: "GET", path: "/x" });
  await flush();

  expect(globalFetch).toHaveBeenCalledWith("/bridge/x", expect.objectContaining({ method: "GET" }));
});

/* ---------------- 事件投影 ---------------- */

void test("ProductBridge: emit() 主动向产品界面投一个事件，不经过 message 监听那条路", () => {
  const source = fakeSource();
  const b = bridge({ source });

  b.emit("task.state", { taskInstance: "ti_1", state: "running" });

  expect((source as unknown as { postMessage: ReturnType<typeof vi.fn> }).postMessage).toHaveBeenCalledWith(
    { ns: "ruyin.bridge", kind: "event", topic: "task.state", payload: { taskInstance: "ti_1", state: "running" } },
    ORIGIN,
  );
});

/**
 * **不注入 fetchImpl 时，桥要用得了真的 `fetch`。**
 *
 * 片二第一版把 `fetch` 直接存进字段、再以 `this.fetchImpl(...)` 调用 —— `fetch` 的
 * `this` 于是是桥实例，真浏览器直接抛「Illegal invocation」，**一个请求都发不出去**。
 * 本文件其余用例全部注入了 mock 的 fetchImpl，所以默认那条路从来没被走过；jsdom 的
 * fetch 也不查 `this`，同样测不出来。片三 a 在真 Chromium 里才抓到。
 *
 * 这里用一个**会像 Chromium 一样查 `this`** 的替身，并且不注入 fetchImpl —— 走的
 * 正是生产上那条路。
 */
test("ProductBridge: 不注入 fetchImpl 时照样发得出请求（fetch 不能被错的 this 调用）", async () => {
  const strictFetch = vi.fn(function (this: unknown) {
    if (this !== undefined && this !== globalThis && this !== window) {
      throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    }
    return Promise.resolve(jsonResponse({ ok: true }));
  });
  vi.stubGlobal("fetch", strictFetch);
  const source = { postMessage: vi.fn() } as unknown as Window;
  const b = new ProductBridge({
    getBridgeToken: vi.fn().mockResolvedValue({ token: "tok_1", expiresAt: Date.now() + 600_000 }),
    source,
    targetOrigin: ORIGIN,
    // 故意不给 fetchImpl —— 那才是生产上的样子。
  });
  b.attach();
  attached.push(b);

  post(source, { ns: "ruyin.bridge", kind: "request", id: "r1", method: "GET", path: "/context" });
  await vi.waitFor(() => expect(outboxOf(source)).toHaveLength(1));
  const [reply] = outboxOf(source) as Array<{ ok: boolean; error?: { code: string } }>;
  expect(reply?.error?.code).not.toBe("BRIDGE_NETWORK_ERROR");
  expect(reply?.ok).toBe(true);
  expect(strictFetch).toHaveBeenCalledTimes(1);
  vi.unstubAllGlobals();
});
