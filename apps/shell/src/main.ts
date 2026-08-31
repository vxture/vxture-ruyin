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

import {
  app,
  BrowserWindow,
  Notification,
  shell,
  utilityProcess,
} from "electron";
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
let stopping = false;

function stopDaemon(): void {
  stopping = true;
  daemon?.kill();
  daemon = undefined;
}

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
    daemon = undefined;
    if (stopping) return; // we asked for it (smoke done / quitting)
    console.error(`[shell] runtime daemon exited unexpectedly (code ${code})`);
    // A crashed daemon must surface as a non-zero shell exit - the smoke
    // check (and anyone scripting the shell) relies on it (TD-010).
    if (code !== 0) app.exit(1);
    else if (!app.isPackaged) app.quit();
  });
  return child;
}

async function waitForHealth(timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (res.ok) {
        // `/health` is open, so a healthy answer only proves *a* daemon is on
        // this port - not that it is the one we just forked. Someone running
        // the daemon by hand takes the port, our child dies on EADDRINUSE, and
        // the window would load against a stranger with a token it will not
        // accept: a blank "未连接" screen with nothing pointing at the cause.
        // An authed endpoint settles ownership.
        const mine = await fetch(`http://127.0.0.1:${PORT}/system`, {
          headers: { authorization: `Bearer ${TOKEN}` },
        });
        if (mine.ok) return;
        throw new Error(
          `port ${PORT} is already held by another Ruyin runtime that this app ` +
            `did not start. Stop it (or close the window that owns it) and try again.`,
        );
      }
    } catch (cause) {
      // Rethrow our own diagnosis; a fetch failure just means "not up yet".
      if (cause instanceof Error && cause.message.startsWith("port ")) throw cause;
    }
    await new Promise((ok) => setTimeout(ok, 200));
  }
  throw new Error(`runtime daemon did not become healthy on port ${PORT}`);
}

/**
 * System notifications for tasks parked on a person (10-workspace-runtime:
 * 系统通知 is the shell's job, not the runtime's).
 *
 * Polls the daemon's own HTTP surface rather than receiving a push from the
 * page. That keeps the window a pure web client with no preload and no Node
 * access - the contract boundary stays at HTTP (60 section 4.2) - and it means
 * the notification still fires when the renderer is busy, backgrounded, or
 * showing a different view.
 *
 * Only newly-raised confirmations notify. Re-announcing the same checkpoint on
 * every poll would train the user to dismiss the one that mattered.
 */
const KIND_LABEL: Record<string, string> = {
  context_confirm: "需要确认要送出的资料",
  tool_ask: "需要批准一次工具调用",
  verification_review: "需要人工复核",
};

interface PendingRow {
  projectId: string;
  projectName: string;
  taskId: string;
  checkpointId: string;
  kind: string;
}

function watchPending(win: BrowserWindow): void {
  // Seeded on the first poll rather than empty: everything already waiting
  // when the app starts is a backlog the user is about to see on screen, not
  // news. Announcing it as new would make every launch a burst of alerts.
  let announced: Set<string> | undefined;

  const poll = async (): Promise<void> => {
    let rows: PendingRow[];
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/pending`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      if (!res.ok) return;
      rows = (await res.json()) as PendingRow[];
    } catch {
      return; // daemon busy or restarting - nothing to say
    }

    const live = new Set(rows.map((r) => r.checkpointId));
    if (!announced) {
      announced = live;
    } else {
      for (const row of rows) {
        if (announced.has(row.checkpointId)) continue;
        if (Notification.isSupported()) {
          const n = new Notification({
            title: `${row.projectName} 在等你`,
            body: KIND_LABEL[row.kind] ?? "有一处需要你确认",
          });
          // The point of the notification is to get back to the decision, so
          // it is a way there rather than an announcement to acknowledge.
          n.on("click", () => {
            if (win.isDestroyed()) return;
            if (win.isMinimized()) win.restore();
            win.show();
            win.focus();
            void win.loadURL(
              `http://127.0.0.1:${PORT}/?token=${TOKEN}#ws/${row.projectId}`,
            );
          });
          n.show();
        }
        announced.add(row.checkpointId);
      }
      // Forget what is no longer pending, so a later confirmation with the
      // same id would announce again - and so this set cannot grow forever.
      for (const id of announced) if (!live.has(id)) announced.delete(id);
    }
  };

  const timer = setInterval(() => void poll(), 10_000);
  timer.unref?.();
  win.on("closed", () => clearInterval(timer));
  void poll();
}

function openWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 600,
    title: "Ruyin",
    // Modern chrome: hide the native frame, float the Windows caption
    // buttons over the app's own top bar (which declares a drag region).
    // Dark-first tech-console identity: colors match the DS dark background
    // (neutral-950); overlay height matches the ShellHeader "md" band (48).
    // The overlay is fixed at creation - after a light-theme switch the
    // caption buttons keep the dark tint until a shell-side sync lands.
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#0a0a0a",
      symbolColor: "#a3a3a3",
      height: 48,
    },
    backgroundColor: "#0a0a0a",
    webPreferences: {
      // The window is a pure web client of the Local API - no Node access,
      // no preload. The contract boundary stays at the HTTP surface.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // External targets (OIDC login, console deep links) go to the SYSTEM
  // browser - the shell never hosts third-party origins (60 section 4.2),
  // and the PKCE loopback flow requires a real browser session anyway.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !url.startsWith(`http://127.0.0.1:${PORT}`)) {
      void shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });
  void win.loadURL(`http://127.0.0.1:${PORT}/?token=${TOKEN}`);
  watchPending(win);
}

app.whenReady().then(async () => {
  try {
    daemon = startDaemon();
    await waitForHealth();
    if (SMOKE) {
      console.log("[shell-smoke] OK: daemon healthy, shell wiring verified");
      stopDaemon();
      app.exit(0);
      return;
    }
    openWindow();
  } catch (cause) {
    console.error(`[shell] startup failed: ${cause instanceof Error ? cause.message : cause}`);
    stopDaemon();
    app.exit(1);
  }
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("will-quit", () => {
  stopDaemon();
});
