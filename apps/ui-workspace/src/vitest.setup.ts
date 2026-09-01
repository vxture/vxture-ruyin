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

// Unmount whatever the previous test rendered - without this, a component
// left mounted (and its effects/timers/subscriptions still running) leaks
// into the next test file's DOM and can make an unrelated assertion flaky.
afterEach(() => {
  cleanup();
});
