import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@vxture/design-system";
import App from "./App";
// DS 地基先行（globals 接好 token 层与 Tailwind 源），然后**恰好一个**品牌入口，
// 最后是本应用自己的组装 CSS。
//
// 品牌入口用平台级的 `vxture.css`，**不再等 DS 出一份 ruyin 专属的**（owner 定
// 2026-09-02）：ruyin 全局只有一个产品，那份文件将只服务一个消费者 —— 由共享
// 设计系统去发布一个单消费者的品牌文件，是把定制放错了地方。要改品牌就在下面
// 的 app.css 里覆盖 token，那本来就是这一层该干的事。
import "@vxture/design-system/styles/globals.css";
import "@vxture/design-system/styles/brands/vxture.css";
import "./app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* Dark-first tech-console identity (owner decision 2026-08-30,
        superseding #12's light default); the DS .dark class contract drives
        it - never prefers-color-scheme. Users can switch in 设置. */}
    <ThemeProvider defaultMode="dark">
      <App />
    </ThemeProvider>
  </StrictMode>,
);
