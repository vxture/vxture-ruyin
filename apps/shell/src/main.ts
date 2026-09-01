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
  dialog,
  shell,
  utilityProcess,
} from "electron";
import electronUpdater from "electron-updater";

// 顶层导入是刻意的：打包后的依赖树若解析不到它，**打包冒烟关会立刻发现**——
// 惰性导入会把这个失败推迟到用户点安装的那一刻，那是最糟的暴露位置。
const { autoUpdater } = electronUpdater;
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isRenderPdfRequest, renderPdf, type RenderPdfReply } from "./pdf.js";

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
/** 守护进程说过的话。冒烟要等它的自检标记（ADR-017）。 */
let daemonOutput = "";
/**
 * 有没有开过给人看的窗口。
 *
 * 离屏 PDF 渲染窗（ADR-017）也是 BrowserWindow：它一销毁就会触发
 * window-all-closed。冒烟里没有主窗口，于是第一份 PDF 排完、渲染窗一关，应用
 * 就把自己关掉了——守护进程被 will-quit 顺手杀掉，自检结果永远等不到。
 *
 * 产品形态下同样成立：用户关掉主窗口之后再导出，应用会在导出完成的那一刻退出。
 */
let userWindowOpened = false;

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
      // 冒烟时守护进程会真的排一份 PDF，走完整条 IPC + Chromium 链路。
      ...(SMOKE ? { RUYIN_SMOKE: "1" } : {}),
      // Packaged: built Workspace UI travels in resources/ui. Dev: unset -
      // the daemon falls back to apps/ui-workspace/dist when built.
      ...(app.isPackaged
        ? { RUYIN_UI_DIR: join(process.resourcesPath, "ui") }
        : {}),
    },
  });
  child.stdout?.on("data", (d: Buffer) => {
    daemonOutput += d.toString();
    process.stdout.write(d);
  });
  child.stderr?.on("data", (d: Buffer) => process.stderr.write(d));
  // 守护进程 -> 壳的请求/应答（ADR-017）。此前只有壳轮询守护进程的 HTTP，
  // 而 PDF 是反方向的：Chromium 在这一侧，落盘的护栏在那一侧。
  child.on("message", (message: unknown) => {
    if (!isRenderPdfRequest(message)) return;
    const { id, html } = message;
    void renderPdf(html).then(
      (bytes) => {
        try {
          child.postMessage({
            kind: "render-pdf-result",
            id,
            ok: true,
            bytes,
          } satisfies RenderPdfReply);
        } catch (cause) {
          // 序列化不了就没人会来告诉守护进程 —— 它会一直等到超时。把原因留在
          // 这里，否则那次超时是一条没有线索的超时。
          console.error("[shell] could not hand the PDF back to the daemon:", cause);
        }
      },
      (cause: unknown) => {
        console.error("[shell] pdf render failed:", cause);
        child.postMessage({
          kind: "render-pdf-result",
          id,
          ok: false,
          error: cause instanceof Error ? cause.message : String(cause),
        } satisfies RenderPdfReply);
      },
    );
  });
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

/**
 * 订阅守护进程的事件流（TD-029）。
 *
 * 壳没有「页面刷新」这种天然重连 —— 界面那边流断了，用户刷一下就回来了，壳
 * 不会。所以这里显式重连，而且**轮询一条都没删，只是降速**：断流期间必须还
 * 有人在问，否则壳会安静地不再通知，而「没有通知」和「没有事情」在用户那里
 * 是同一件事。
 *
 * 一条连接，多个消费者：待确认与更新意图看的是同一条流。
 */
type DaemonEventKind = "task" | "pending" | "update-intent";
const eventListeners = new Set<(kind: DaemonEventKind) => void>();

function onDaemonEvent(listener: (kind: DaemonEventKind) => void): () => void {
  eventListeners.add(listener);
  return () => eventListeners.delete(listener);
}

async function streamDaemonEvents(): Promise<void> {
  // 重连退避：守护进程重启期间不要每毫秒敲一次门。上限 10 秒 —— 再久，用户
  // 会先注意到通知停了。
  let backoff = 500;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/events`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      if (!res.ok || !res.body) throw new Error(`events: HTTP ${res.status}`);
      backoff = 500;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut = buffer.indexOf("\n\n");
        while (cut >= 0) {
          const frame = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data:")) continue; // 心跳是注释行
            try {
              const event = JSON.parse(line.slice(5).trim()) as {
                kind: DaemonEventKind;
              };
              for (const listener of [...eventListeners]) listener(event.kind);
            } catch {
              // 半截或异常的帧：丢这一帧，别让它带走整条流。
            }
          }
          cut = buffer.indexOf("\n\n");
        }
      }
    } catch {
      // 守护进程还没起来、或者刚被换掉。下面退避重试。
    }
    await new Promise((ok) => setTimeout(ok, backoff));
    backoff = Math.min(backoff * 2, 10_000);
  }
}

/**
 * 等守护进程报出 PDF 自检结果（ADR-017）。
 *
 * 只在冒烟里用。等的是标记而不是固定时长：一条「等两秒然后宣布通过」的检查，
 * 在机器慢的时候会通过，在链路断掉的时候也会通过。
 */
async function waitForPdfSelfCheck(timeoutMs = 60_000): Promise<void> {
  const marker = /\[ruyin\] pdf self-check: (.+)/;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = marker.exec(daemonOutput);
    if (hit) {
      if (hit[1]?.startsWith("ok")) return;
      throw new Error(`pdf self-check did not pass: ${hit[1]}`);
    }
    await new Promise((ok) => setTimeout(ok, 200));
  }
  throw new Error("the daemon never reported a pdf self-check result");
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

  // 事件到了立刻查；轮询降为兜底（TD-029）。
  const stop = onDaemonEvent((kind) => {
    if (kind === "pending" || kind === "task") void poll();
  });
  const timer = setInterval(() => void poll(), 60_000);
  timer.unref?.();
  win.on("closed", () => {
    stop();
    clearInterval(timer);
  });
  void poll();
}

/**
 * 更新的下载与安装（TD-021，策略由 owner 定于 2026-09-01）。
 *
 *   1. **有任务在跑就不装** —— 安装要重启，重启会打断正在跑的回合。
 *   2. **操作权与时机都归用户** —— 运行时只提示；下载与安装都由用户点了才做，
 *      下载完成后**再问一次**才重启。
 *   3. 渠道不允许降级 —— 检查侧已保证（feed 版本不高于当前一律报「已是最新」）。
 *
 * 意图从守护进程轮询取得，不走 IPC：窗口是纯 Web 客户端（无 preload、无 Node），
 * 契约边界留在 HTTP（60 §4.2）。这与系统通知用的是同一条路子。
 *
 * **闸门在守护进程那边判，这里在真正重启前再问一次** —— 用户点下去到下载完成
 * 之间可能过了几分钟，任务完全可能已经起来了。
 */
function watchUpdateIntent(win: BrowserWindow): void {
  autoUpdater.autoDownload = false;
  // 退出时静默安装不是用户选的时机（策略 2）。
  autoUpdater.autoInstallOnAppQuit = false;
  // 策略 3：渠道不允许降级。**显式写，不吃默认值。**
  //
  // 库的默认确实是 false，但它的 `channel` setter 会把这个字段翻成 true
  // （文档原话：设 channel 后 allowDowngrade 会自动变 true，不合适就自己再设
  // 回来）。而 channel 正是 beta/stable 切换要用的那个东西 —— 也就是说，未来
  // 谁加渠道切换，这条策略会在没人察觉的情况下自己反过来。
  autoUpdater.allowDowngrade = false;
  autoUpdater.logger = null;
  const feed = process.env["RUYIN_UPDATE_FEED"];
  if (feed) autoUpdater.setFeedURL({ provider: "generic", url: feed });

  let busy = false;

  const askDaemon = async <T>(path: string, init?: RequestInit): Promise<T | null> => {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${TOKEN}`, ...(init?.headers ?? {}) },
      });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  };

  const run = async (version: string): Promise<void> => {
    try {
      // **先 checkForUpdates 再 downloadUpdate。** 少了这一步，库直接 reject
      // 「Please check update first」—— downloadUpdate 用的是上一次检查留下的
      // updateInfo，没检查过就没有那个东西。整条安装路径原本在第一步就断，
      // 而用户看到的是「更新下载失败」，一句指不向任何地方的话。
      const found = await autoUpdater.checkForUpdates();
      const offered = found?.updateInfo.version;
      if (!offered) {
        await dialog.showMessageBox(win, {
          type: "info",
          title: "没有可安装的更新",
          message: `渠道里现在没有 ${version}`,
          detail: "稍后在设置里再检查一次。",
        });
        return;
      }
      // 用户点的是某一个版本。下载前 feed 可能已经动了 —— 装另一个版本不是
      // 「顺手更新到更新的那个」，是装了一个他没有同意过的东西（策略 2）。
      if (offered !== version) {
        await dialog.showMessageBox(win, {
          type: "info",
          title: "版本已变化",
          message: `你要装的是 ${version}，而渠道现在提供的是 ${offered}`,
          detail: "没有安装。请在设置里重新检查更新，再决定装哪一个。",
        });
        return;
      }
      await autoUpdater.downloadUpdate();
    } catch (cause) {
      await dialog.showMessageBox(win, {
        type: "error",
        title: "更新下载失败",
        message: `无法下载 ${version}`,
        detail: cause instanceof Error ? cause.message : String(cause),
      });
      return;
    }

    // 下载可能跑了几分钟：重问一次，别在任务中途重启。
    const gate = await askDaemon<{ installable: boolean; reason?: string }>(
      "/updates/intent",
    );
    if (gate && !gate.installable) {
      await dialog.showMessageBox(win, {
        type: "info",
        title: "更新已就绪，暂不安装",
        message: `${version} 已下载完成，但现在不能安装`,
        detail: `${gate.reason ?? "有任务正在运行"}。任务结束后再在设置里点一次安装。`,
      });
      return;
    }

    // 时机也归用户：下载完成不等于现在就该重启。
    const { response } = await dialog.showMessageBox(win, {
      type: "question",
      buttons: ["现在重启并安装", "稍后"],
      defaultId: 0,
      cancelId: 1,
      title: "更新已就绪",
      message: `${version} 已下载完成`,
      detail: "安装需要重启如影。未完成的任务会在重启后恢复，但正在等待你确认的步骤会被打断。",
    });
    if (response !== 0) return;
    autoUpdater.quitAndInstall(false, true);
  };

  const poll = async (): Promise<void> => {
    if (busy) return;
    const body = await askDaemon<{ intent: { version: string } | null }>(
      "/updates/intent",
    );
    const version = body?.intent?.version;
    if (!version) return;
    busy = true;
    try {
      await run(version);
    } finally {
      busy = false;
    }
  };

  const stop = onDaemonEvent((kind) => {
    if (kind === "update-intent") void poll();
  });
  const timer = setInterval(() => void poll(), 60_000);
  timer.unref?.();
  win.on("closed", () => {
    stop();
    clearInterval(timer);
  });
}

function openWindow(): void {
  userWindowOpened = true;
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
      height: 40,
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
  void streamDaemonEvents();
  watchPending(win);
  watchUpdateIntent(win);
}

app.whenReady().then(async () => {
  try {
    daemon = startDaemon();
    await waitForHealth();
    if (SMOKE) {
      // PDF 那条链（守护进程 -> 壳 -> Chromium -> 字节回去）只有在真的跑一遍
      // 时才算验过（ADR-017）。守护进程在 RUYIN_SMOKE=1 下会排一份，标记打在
      // 它的 stdout 上 —— 等它，别在它之前就宣布通过。
      await waitForPdfSelfCheck();
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
  // 只有开过用户窗口、而且它们都关了，才是「没事可做了」。离屏渲染窗关掉不算
  // —— 它本来就不该把应用带走。
  if (!userWindowOpened) return;
  app.quit();
});

app.on("will-quit", () => {
  stopDaemon();
});
