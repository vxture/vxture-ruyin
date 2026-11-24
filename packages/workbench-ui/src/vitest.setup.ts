import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom has never implemented matchMedia - next-themes (behind
// @vxture/design-system's ThemeProvider, settings.tsx's GeneralSection and
// anything else that calls useTheme()) calls it on mount to read the system
// color-scheme preference, and without this the call throws
// "window.matchMedia is not a function" before the component even renders.
// Not real media-query behavior, just enough surface that the call succeeds.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// jsdom has never implemented ResizeObserver either - cmdk (behind
// @vxture/design-system's ShellSearchBox, used by workbench.tsx's header
// search) observes an element's size on mount. Without this the mount
// effect throws "ResizeObserver is not defined" before anything renders.
// No real size observation, just enough surface that construction succeeds
// and disconnect()/observe()/unobserve() are safe no-ops.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// **用例说中文。** 没存过语言偏好时，界面按系统/浏览器说的那门语言挑一个
// （`preferredLocale`），而 jsdom 报的是 `en-US` —— 于是每一个 `localStorage.clear()`
// 之后渲染出来的都是英文界面，几百条中文断言会一起红，而产品代码没有任何问题。
//
// 所以这里把测试环境的语言**声明成简体中文**：断言写的是哪门语言，环境就该说哪门。
// 要测英文界面，在那条用例里自己存 `ruyin-language: "en"` 或包一层指定语言的 Provider。
Object.defineProperty(navigator, "languages", {
  configurable: true,
  get: () => ["zh-CN"],
});
Object.defineProperty(navigator, "language", {
  configurable: true,
  get: () => "zh-CN",
});

// Unmount whatever the previous test rendered - without this, a component
// left mounted (and its effects/timers/subscriptions still running) leaks
// into the next test file's DOM and can make an unrelated assertion flaky.
afterEach(() => {
  cleanup();
});
