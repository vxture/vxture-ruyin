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
      // TD-031 第六批，六个大组件全部测完：login.tsx / user.tsx /
      // settings.tsx / home.tsx / workbench.tsx / workspace.tsx 全到了
      // 90–100%（workspace.tsx，本仓最大的组件，99.43%/98.72%/98.76%/
      // 100%）。阈值照实按这批的全量基线（statements 88% / branches 92.3% /
      // functions 86.66% / lines 90.25%）留个小余量。
      //
      // 剩下拖累聚合数字的是 api.ts（HTTP 客户端外壳，21%）/ chain.ts /
      // sse.ts——都不在 TD-031 "六个大组件"这份原始清单里，是否值得单独立项
      // 留给以后判断，这里不代它们编个数。
      //
      // main.tsx 排除在外：纯挂载代码，同 local-host/main.ts 的先例，不为它
      // 硬凑一个假覆盖率。
      thresholds: {
        statements: 86,
        lines: 88,
        branches: 90,
        functions: 84,
      },
    },
  },
});
