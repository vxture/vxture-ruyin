/**
 * Ruyin Desktop Shell - Electron main process (dev mode, W2 scope).
 *
 * Responsibilities here are deliberately thin (60 section 4.2: the shell is a
 * host, not the product): spawn the Runtime daemon as a utility process with
 * a per-session token, wait for /health, then open a window on the daemon's
 * own web surface (http://127.0.0.1:<port>/?token=...). The same URL works in
 * any browser - Web access is free by construction.
 *
 * `--smoke` flag: start daemon, verify health, print a marker, exit. Used as
 * the shell's launch verification (no GUI interaction needed).
 */

import { app, BrowserWindow, utilityProcess } from "electron";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

app.setName("Ruyin"); // userData path derives from this, not productName

const SMOKE = process.argv.includes("--smoke");
const PORT = Number(process.env["RUYIN_PORT"] ?? (SMOKE ? 17420 : 7420));
const TOKEN = randomBytes(24).toString("hex");

// Packaged: daemon + products travel in resources/ (electron-builder
// extraResources) and data lives under userData. Dev: repo-relative paths
// (dist/main.js -> repo root is four levels up) and ~/.ruyin/dev.
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const daemonEntry = app.isPackaged
  ? join(process.resourcesPath, "daemon", "dist", "main.js")
  : join(repoRoot, "apps", "local-host", "dist", "main.js");
const productsDir = app.isPackaged
  ? join(process.resourcesPath, "products")
  : join(repoRoot, "products");
const dataDir =
  process.env["RUYIN_DATA_DIR"] ??
  (app.isPackaged
    ? join(app.getPath("userData"), "data")
    : join(homedir(), ".ruyin", "dev"));

let daemon: Electron.UtilityProcess | undefined;

function startDaemon(): Electron.UtilityProcess {
  const child = utilityProcess.fork(daemonEntry, [], {
    stdio: "pipe",
    env: {
      ...process.env,
      RUYIN_PORT: String(PORT),
      RUYIN_TOKEN: TOKEN,
      RUYIN_DATA_DIR: dataDir,
      RUYIN_PRODUCTS_DIR: productsDir,
      // Packaged: built Workspace UI travels in resources/ui. Dev: unset -
      // the daemon falls back to apps/ui-workspace/dist when built.
      ...(app.isPackaged
        ? { RUYIN_UI_DIR: join(process.resourcesPath, "ui") }
        : {}),
    },
  });
  child.stdout?.on("data", (d: Buffer) => process.stdout.write(d));
  child.stderr?.on("data", (d: Buffer) => process.stderr.write(d));
  child.on("exit", (code) => {
    console.error(`[shell] runtime daemon exited (code ${code})`);
    daemon = undefined;
    if (!app.isPackaged || code !== 0) app.quit();
  });
  return child;
}

async function waitForHealth(timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (res.ok) return;
    } catch {
      // daemon not up yet
    }
    await new Promise((ok) => setTimeout(ok, 200));
  }
  throw new Error(`runtime daemon did not become healthy on port ${PORT}`);
}

function openWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "Ruyin",
    webPreferences: {
      // The window is a pure web client of the Local API - no Node access,
      // no preload. The contract boundary stays at the HTTP surface.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  void win.loadURL(`http://127.0.0.1:${PORT}/?token=${TOKEN}`);
}

app.whenReady().then(async () => {
  try {
    daemon = startDaemon();
    await waitForHealth();
    if (SMOKE) {
      console.log("[shell-smoke] OK: daemon healthy, shell wiring verified");
      daemon.kill();
      app.exit(0);
      return;
    }
    openWindow();
  } catch (cause) {
    console.error(`[shell] startup failed: ${cause instanceof Error ? cause.message : cause}`);
    daemon?.kill();
    app.exit(1);
  }
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("will-quit", () => {
  daemon?.kill();
});
