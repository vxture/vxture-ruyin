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
    {/* Light default preserves the deliberate choice from PR #12; dark is
        driven by the DS .dark class contract (never prefers-color-scheme). */}
    <ThemeProvider defaultMode="light">
      <App />
    </ThemeProvider>
  </StrictMode>,
);
