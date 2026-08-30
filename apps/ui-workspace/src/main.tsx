import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@vxture/design-system";
import App from "./App";
// DS foundation first (globals wires token layers + Tailwind sources), then
// exactly ONE brand entry (platform-level vxture; the ruyin product brand
// entry does not exist in DS 10.0.0 yet), then the app's own assembly CSS.
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
