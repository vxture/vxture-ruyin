// `vitest/config` re-exports Vite's defineConfig plus the `test` field's
// types - one config file for build and test, not two that can drift.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    // Vite dev server proxies API calls to a locally running daemon.
    proxy: {
      "/health": "http://127.0.0.1:7420",
      "/products": "http://127.0.0.1:7420",
      "/workspaces": "http://127.0.0.1:7420",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/vitest.setup.ts"],
    css: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/main.tsx", "src/vitest.setup.ts"],
      // TD-031 第五批：login.tsx / user.tsx / settings.tsx / home.tsx /
      // workbench.tsx 全到了 90–100%。只剩 workspace.tsx（本仓最大的组件，
      // ProjectPanel）没动。阈值照实按这批的全量基线（statements 65.75% /
      // branches 65.43% / functions 58.59% / lines 67.84%）留个小余量。
      // workspace.tsx 测完后这些数字会大幅跳一次，阈值跟着抬。
      //
      // main.tsx 排除在外：纯挂载代码，同 local-host/main.ts 的先例，不为它
      // 硬凑一个假覆盖率。
      thresholds: {
        statements: 64,
        lines: 66,
        branches: 64,
        functions: 57,
      },
    },
  },
});
