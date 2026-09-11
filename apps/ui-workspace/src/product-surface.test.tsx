/**
 * 产品界面的沙箱宿主（product-surface.tsx，ADR-022 片三 a；ADR-023 起装守护进程给的入口）。
 *
 * 这里钉的是**配置**，因为这个组件失守的方式都是「配错了，但照常能用」：
 * - sandbox 属性多一项就多一条出路，少了 `allow-same-origin` 桥就静默失效；
 * - 产品与工作台同源时它必须拒绝渲染 —— 那时 `allow-same-origin` 等于拆沙箱。
 *
 * 真正的隔离（产品 iframe 读不到 `ruyin-token`）是浏览器的同源策略给的，jsdom 模拟
 * 不了；那一条在真 Chromium 里验（观察台 + 测试包）。
 */

import { afterEach, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { Api } from "./api";
import { PRODUCT_SANDBOX, ProductSurface, sameOrigin } from "./product-surface";

const SHA = "a".repeat(64);
const ORIGIN = "http://bidproposal.localhost:7421";
const ENTRY = `${ORIGIN}/${SHA}/`;

function fakeApi(surface: { productId: string; available: boolean; origin?: string; entry?: string }): Api {
  return {
    productSurface: vi.fn().mockResolvedValue(surface),
    bridgeToken: vi.fn().mockResolvedValue({ token: "t", expiresAt: Date.now() + 60_000, productId: "p" }),
  } as unknown as Api;
}

afterEach(() => vi.restoreAllMocks());

/**
 * **逐项钉死 sandbox 的值。** 这一项多给一个就多一条出路：`allow-top-navigation`
 * 能把整个工作台导走，`allow-popups-to-escape-sandbox` 能甩掉沙箱，`allow-modals`
 * 能用原生弹框冒充工作台的确认框。少了 `allow-same-origin`，片二的桥静默失效。
 */
test("PRODUCT_SANDBOX: 恰好这三项，一项不多一项不少", () => {
  expect(PRODUCT_SANDBOX.split(/\s+/).sort()).toEqual(
    ["allow-forms", "allow-same-origin", "allow-scripts"].sort(),
  );
});

test("ProductSurface: 有界面时装一个 iframe，src 是守护进程给的入口（按摘要），sandbox 照常量给", async () => {
  const api = fakeApi({ productId: "bidproposal", available: true, origin: ORIGIN, entry: ENTRY });
  render(<ProductSurface api={api} projectId="prj_1" />);
  const frame = (await screen.findByTitle("产品界面")) as HTMLIFrameElement;
  expect(frame.getAttribute("src")).toBe(ENTRY);
  expect(frame.getAttribute("sandbox")).toBe(PRODUCT_SANDBOX);
  expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
});

/** 没有界面是缺省 —— 什么都不装，而不是装一个会 404 的 iframe。 */
test("ProductSurface: 守护进程说没有界面时什么都不渲染", async () => {
  const api = fakeApi({ productId: "bidproposal", available: false, origin: ORIGIN });
  const { container } = render(<ProductSurface api={api} projectId="prj_1" />);
  await waitFor(() => expect(api.productSurface).toHaveBeenCalled());
  expect(container.querySelector("iframe")).toBeNull();
});

/** 说可用却不给入口、或入口不是地址：不自己拼一个，按没有界面处理。 */
test("ProductSurface: 没有入口或入口解析不了时不装（不自己拼地址）", async () => {
  for (const surface of [
    { productId: "bidproposal", available: true, origin: ORIGIN },
    { productId: "bidproposal", available: true, origin: ORIGIN, entry: "not a url" },
  ]) {
    const api = fakeApi(surface);
    const { container, unmount } = render(<ProductSurface api={api} projectId="prj_1" />);
    await waitFor(() => expect(api.productSurface).toHaveBeenCalled());
    expect(container.querySelector("iframe")).toBeNull();
    unmount();
  }
});

/**
 * **同源就拒绝渲染 —— 这是 `allow-same-origin` 唯一的保险。**
 *
 * 那一项只在产品 origin 与工作台不同时才安全；同源时再加它，产品代码就能拆掉自己的
 * 沙箱，并且一行 `localStorage.getItem("ruyin-token")` 拿走整台守护进程的钥匙 ——
 * 而界面照常能用。这道拦截今天不会触发（两台服务器端口不同），它防的是将来有人把
 * 产品界面挪到工作台同一个端口上。
 */
test("ProductSurface: 产品 origin 与工作台同源时拒绝渲染 iframe", async () => {
  const api = fakeApi({
    productId: "bidproposal",
    available: true,
    origin: window.location.origin,
    entry: `${window.location.origin}/${SHA}/`,
  });
  const { container } = render(<ProductSurface api={api} projectId="prj_1" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("同源");
  expect(container.querySelector("iframe")).toBeNull();
});

/**
 * **核的是真正要装的那个地址，不是旁边的 origin 字段。** 两个字段说法不一时，按
 * 入口算 —— 否则 origin 字段写着一个子域、入口却指回工作台，拦截就被绕过去了。
 */
test("ProductSurface: 同源拦截看入口地址本身，不看 origin 字段", async () => {
  const api = fakeApi({
    productId: "bidproposal",
    available: true,
    origin: ORIGIN,
    entry: `${window.location.origin}/${SHA}/`,
  });
  const { container } = render(<ProductSurface api={api} projectId="prj_1" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("同源");
  expect(container.querySelector("iframe")).toBeNull();
});

test("sameOrigin: 只比 origin，路径不算；解析不了按同源处理（拿不准就不装）", () => {
  expect(sameOrigin("http://127.0.0.1:7420/a", "http://127.0.0.1:7420/b")).toBe(true);
  expect(sameOrigin("http://127.0.0.1:7420", "http://127.0.0.1:7421")).toBe(false);
  expect(sameOrigin("http://bidproposal.localhost:7421", "http://127.0.0.1:7421")).toBe(false);
  expect(sameOrigin("not a url", "http://127.0.0.1:7420")).toBe(true);
});

test("ProductSurface: 问不到守护进程时按没有界面处理，不炸", async () => {
  const api = {
    productSurface: vi.fn().mockRejectedValue(new Error("down")),
    bridgeToken: vi.fn(),
  } as unknown as Api;
  const { container } = render(<ProductSurface api={api} projectId="prj_1" />);
  await waitFor(() => expect(api.productSurface).toHaveBeenCalled());
  expect(container.querySelector("iframe")).toBeNull();
});

/**
 * **桥接上的是这个项目的凭据、这一扇窗口 —— 不只是「接上了」。**
 *
 * 只断言「装了 iframe」的话，桥可能根本没接、或者接的是别的窗口、别的项目，而
 * 界面照样能渲染。这里真的从 iframe 的窗口发一条桥请求，看凭据是不是为 `prj_1`
 * 换的；再从**另一扇**窗口发一条，桥必须不理 —— 那是片二 `source` 筛子的前提，
 * 由这里把正确的窗口喂进去。
 */
test("ProductSurface: 桥只认这扇 iframe 的消息，并为这个项目换凭据", async () => {
  const origin = ORIGIN;
  const api = fakeApi({ productId: "bidproposal", available: true, origin, entry: ENTRY });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })),
  );
  const frame = (await (async () => {
    render(<ProductSurface api={api} projectId="prj_1" />);
    return screen.findByTitle("产品界面");
  })()) as HTMLIFrameElement;
  const win = frame.contentWindow!;
  const request = { ns: "ruyin.bridge", kind: "request", id: "r1", method: "GET", path: "/context" };

  // 另一扇窗口冒充同一个 origin 发来 —— 桥不理，也就不会去换凭据。
  window.dispatchEvent(new MessageEvent("message", { data: request, origin, source: window }));
  await new Promise((r) => setTimeout(r, 20));
  expect(api.bridgeToken).not.toHaveBeenCalled();

  // 这扇 iframe 发来 —— 桥为 prj_1 换凭据。
  window.dispatchEvent(new MessageEvent("message", { data: request, origin, source: win }));
  await waitFor(() => expect(api.bridgeToken).toHaveBeenCalledWith("prj_1"));
  vi.unstubAllGlobals();
});
