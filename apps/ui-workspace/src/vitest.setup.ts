import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Unmount whatever the previous test rendered - without this, a component
// left mounted (and its effects/timers/subscriptions still running) leaks
// into the next test file's DOM and can make an unrelated assertion flaky.
afterEach(() => {
  cleanup();
});
