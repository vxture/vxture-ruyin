import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "./App";

// App hands a token off to SessionGate, which immediately calls
// api.session() on mount. Not this file's concern - stub it out so every
// test here is deterministic and silent regardless of what SessionGate does
// with the result.
beforeEach(() => {
  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ signedIn: false, issuer: "", consoleBase: "", entitlementsConfigured: false }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  localStorage.clear();
  window.history.pushState({}, "", "/");
});

afterEach(() => {
  vi.restoreAllMocks();
});

void test("App: no token anywhere shows the connect hint, not a blank or broken screen", () => {
  render(<App />);
  expect(screen.getByText("未连接到本地运行时")).toBeInTheDocument();
});

void test("App: a ?token= query param is used and moves past the connect hint", () => {
  window.history.pushState({}, "", "/?token=from-query");
  render(<App />);
  expect(screen.queryByText("未连接到本地运行时")).not.toBeInTheDocument();
});

void test("App: with no query param, a token remembered in localStorage is used instead", () => {
  localStorage.setItem("ruyin-token", "from-storage");
  render(<App />);
  expect(screen.queryByText("未连接到本地运行时")).not.toBeInTheDocument();
});

void test("App: the query param wins over whatever is already remembered in storage", () => {
  localStorage.setItem("ruyin-token", "stale-stored-token");
  window.history.pushState({}, "", "/?token=fresh-from-host");
  render(<App />);
  // 两者都能过 ConnectHint 这一关，这条用例真正钉的是优先级，所以直接查
  // localStorage 最终被覆盖成了查询串里那个 —— 这是 App 自己 useEffect 里
  // persist 的行为，断言它就是在断言"用的是哪一个"。
  expect(localStorage.getItem("ruyin-token")).toBe("fresh-from-host");
});

void test("App: a resolved token is persisted to localStorage for next time (e.g. a PWA's bare start_url)", () => {
  window.history.pushState({}, "", "/?token=host-injected");
  render(<App />);
  expect(localStorage.getItem("ruyin-token")).toBe("host-injected");
});
