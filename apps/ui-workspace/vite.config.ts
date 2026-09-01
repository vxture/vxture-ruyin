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
      // 这是引入这套工具链的第一批：App.tsx / chain.ts / sse.ts / pending.tsx
      // 到了 90%+，api.ts 部分覆盖，五个大组件（home/login/settings/user/
      // workbench/workspace）还没动。阈值照实按这批实测的全量基线（约
      // 16%/7%/12%）留个小余量，不是压在一个虚高的目标上假装做完了——见提交
      // 信息里的具体数字。后续每批把某个大组件测完，阈值跟着抬。
      //
      // main.tsx 排除在外：纯挂载代码，同 local-host/main.ts 的先例，不为它
      // 硬凑一个假覆盖率。
      thresholds: {
        statements: 15,
        lines: 15,
        branches: 6,
        functions: 10,
      },
    },
  },
});
