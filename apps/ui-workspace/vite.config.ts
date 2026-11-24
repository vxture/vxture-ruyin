// `vitest/config` re-exports Vite's defineConfig plus the `test` field's
// types - one config file for build and test, not two that can drift.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Pure relocation shims contain no implementation; any added code restores coverage.
const source = fileURLToPath(new URL("./src/", import.meta.url));
const shims = readdirSync(source, { recursive: true }).filter((name): name is string =>
  typeof name === "string" && /\.tsx?$/.test(name) &&
  /^\s*export \* from "@vxture\/ruyin-workbench-ui\/[^"\n]+";\s*$/.test(readFileSync(source + name, "utf8")),
).map(name => "src/" + name.replaceAll("\\", "/"));

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
    root: fileURLToPath(new URL("../../", import.meta.url)),
    // Exercise the moved implementation, rather than its emitted declaration/source map.
    alias: [
      { find: /^react(\/.*)?$/, replacement: fileURLToPath(new URL("./node_modules/react", import.meta.url)) + "$1" },
      { find: /^react-dom(\/.*)?$/, replacement: fileURLToPath(new URL("./node_modules/react-dom", import.meta.url)) + "$1" },
      { find: /^@vxture\/ruyin-workbench-ui$/, replacement: fileURLToPath(new URL("../../packages/workbench-ui/src/index.ts", import.meta.url)) },
      { find: /^@vxture\/ruyin-workbench-ui\/(.+)$/, replacement: fileURLToPath(new URL("../../packages/workbench-ui/src/", import.meta.url)) + "$1" },
    ],
    include: ["apps/ui-workspace/src/**/*.test.{ts,tsx}", "packages/workbench-ui/src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: [fileURLToPath(new URL("./src/vitest.setup.ts", import.meta.url))],
    css: false,
    coverage: {
      provider: "v8",
      include: ["apps/ui-workspace/src/**/*.{ts,tsx}", "packages/workbench-ui/src/**/*.{ts,tsx}"],
      exclude: ["**/*.test.{ts,tsx}", "**/vitest.setup.ts", "packages/workbench-ui/src/index.ts", "apps/ui-workspace/src/main.tsx", ...shims.map(name => "apps/ui-workspace/" + name)],
      // TD-031 的六个大组件、api.ts/chain.ts/sse.ts 都到了 100% 或接近
      // 100%（细节见前几批提交信息）。这批把剩下几个真能测的分支也补上了：
      // pending.tsx 的 waitedFor() 时间分档（刚刚/分钟/小时/天，此前一次都
      // 没断言过实际输出）、user.tsx/login.tsx"再点一次登录"会不会叠出两个
      // 轮询 interval、user.tsx 的空 productIds 早退/无 tier 的捆绑订阅/
      // 工作区名展示/system 未就绪时的运行中文案/非 DPAPI 的开发态文案、
      // App.tsx 的 localStorage 读取抛异常兜底。全量基线 99.48%/97.02%/
      // 97.61%/100%（语句/分支/函数/行）——行覆盖率到顶了。
      //
      // 剩下的分支缺口是同一类东西：组件在异步请求落地前就卸载了的判空
      // （React 18 不再为此发警告，测它只是断言恒真式）、以及两处字面死码
      // （ProductIdent 的 inset=false 无调用点会传、window.open 被弹窗拦截
      // 时的 opener 兜底）——本批逐一核对过，跟之前几批的判断一致，不强测。
      //
      // main.tsx 排除在外：纯挂载代码，同 local-host/main.ts 的先例，不为它
      // 硬凑一个假覆盖率。
      thresholds: {
        statements: 99,
        lines: 100,
        branches: 96,
        functions: 97,
      },
    },
  },
});
