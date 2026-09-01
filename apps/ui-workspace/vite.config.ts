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
      // TD-031 第四批：login.tsx / user.tsx / settings.tsx / home.tsx 到了
      // 90–100%。还剩 workbench.tsx / workspace.tsx 两个最大的组件没动。阈值
      // 照实按这批的全量基线（约 46%/49%/39%）留个小余量——见提交信息里的
      // 具体数字。后续每批把某个大组件测完，阈值跟着抬。
      //
      // main.tsx 排除在外：纯挂载代码，同 local-host/main.ts 的先例，不为它
      // 硬凑一个假覆盖率。
      thresholds: {
        statements: 44,
        lines: 44,
        branches: 46,
        functions: 36,
      },
    },
  },
});
