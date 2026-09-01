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
      // TD-031 的六个大组件（login/user/settings/home/workbench/workspace）
      // 全到了 90–100%；api.ts（HTTP 客户端外壳，此前 21% 语句）/ chain.ts /
      // sse.ts 三个当时点名"不在这份清单里"的文件后续也补测到 100%——
      // api.ts 用真的 fetch mock 而不是像别处一样把整个 Api 类打桩掉（每个
      // 薄封装方法都表驱动断言真实的 method/path/body，防的是路径拼错这类
      // 真会发生的错字），chain.ts 走真实 WebCrypto 哈希链（不 mock），
      // sse.ts 照搬 apps/shell/src/daemon-events.ts 已验证过的用例（两份是
      // 同一段解析逻辑的两份拷贝，见该文件头注释）。全量基线 98.33%/
      // 94.58%/97.26%/99.7%（语句/分支/函数/行），阈值留个小余量。
      //
      // main.tsx 排除在外：纯挂载代码，同 local-host/main.ts 的先例，不为它
      // 硬凑一个假覆盖率。
      thresholds: {
        statements: 97,
        lines: 98,
        branches: 93,
        functions: 96,
      },
    },
  },
});
