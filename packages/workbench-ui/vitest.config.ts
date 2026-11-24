/**
 * @package @vxture/ruyin-workbench-ui
 * @layer Presentation
 * @category Tests
 * @author AI-Generated
 * @date 2026-11-25
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./src/vitest.setup.ts"],
    css: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/vitest.setup.ts"],
      thresholds: { statements: 99, lines: 100, branches: 96, functions: 97 },
    },
  },
});
