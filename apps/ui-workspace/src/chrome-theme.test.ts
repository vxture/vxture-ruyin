/**
 * chrome-theme.ts: report the effective theme so the shell can tint the
 * Windows caption buttons. Reads the `dark` class off <html> - the result the
 * DS actually applied, which also covers the "system" mode changing.
 */

import { afterEach, expect, test, vi } from "vitest";
import { effectiveTheme, syncChromeTheme, watchChromeTheme } from "./chrome-theme";
import type { Api } from "./api";

afterEach(() => {
  document.documentElement.className = "";
  vi.restoreAllMocks();
});

test("effectiveTheme: the dark class decides, not the stored preference", () => {
  const root = document.createElement("div");
  expect(effectiveTheme(root)).toBe("light");
  root.classList.add("dark");
  expect(effectiveTheme(root)).toBe("dark");
});

test("watchChromeTheme: reports once up front, again on a real change, and never twice for the same value", async () => {
  const root = document.createElement("div");
  root.classList.add("dark");
  const seen: string[] = [];
  const stop = watchChromeTheme((t) => seen.push(t), root);
  expect(seen).toEqual(["dark"]);

  // 密度 / 字号也会改 class，而它们与窗口按钮无关：同一个值不重复上报，
  // 否则一条通知通道就被当成轮询用了。
  root.classList.add("density-comfortable");
  await new Promise((r) => setTimeout(r, 20));
  expect(seen).toEqual(["dark"]);

  root.classList.remove("dark");
  await new Promise((r) => setTimeout(r, 20));
  expect(seen).toEqual(["dark", "light"]);

  stop();
  root.classList.add("dark");
  await new Promise((r) => setTimeout(r, 20));
  expect(seen).toEqual(["dark", "light"]);
});

test("syncChromeTheme: posts the effective theme, and a refusal is swallowed - nobody asked for this", async () => {
  document.documentElement.classList.add("dark");
  const setChromeTheme = vi.fn().mockRejectedValue(new Error("daemon down"));
  const stop = syncChromeTheme({ setChromeTheme } as unknown as Api);
  expect(setChromeTheme).toHaveBeenCalledWith("dark");
  // 失败不能冒泡：这只是窗口按钮的颜色，用户没有提出任何请求。
  await new Promise((r) => setTimeout(r, 10));
  stop();
});
