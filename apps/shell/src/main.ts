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

import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderPdf } from "./pdf.js";
import { isRenderPdfRequest, parsePdfSelfCheck, type RenderPdfReply } from "./pdf-protocol.js";
import { captionOverlay, themeFromReply } from "./caption-overlay.js";
import { extractDaemonEvents, type DaemonEventKind } from "./daemon-events.js";
import { diffPending } from "./pending-notify.js";

// userData 路径由它决定，而不是 productName。**这里的 "Ruyin" 是路径键，不是
// 展示名**：展示名是 RUYIN（productName / 窗口标题 / 界面字标）。改了这一行，
// 已装机器的 %APPDATA%\Ruyin 会整个换目录，登录态与 Chromium 配置全部丢失。
app.setName("Ruyin");

/**
 * 开发态把**整个 Chromium 配置**也分出去（TD-032）。
 *
 * `setName` 是无条件的，所以在这一行之前，两种形态的 userData 都是
 * `%APPDATA%\Ruyin`。下面的 dataDir 只分了业务数据那一层 —— cookie、
 * Local/Session Storage、Preferences 仍是同一份，**也就是登录会话互相串**。
 *
 * 那不只是「省得重新登录」：开发态可能指着另一套平台环境，那份 token 会和正式
 * 环境的躺在同一个 cookie jar 里；而项目归属是按会话里的工作区判定的
 * （ADR-015），两边互相继承会话意味着**项目可能被记到另一个工作区名下**。
 *
 * 放在 `~/.ruyin/dev/chromium`，和业务数据同一个根：删掉 `~/.ruyin` 就等于把
 * 开发态清干净，不必再记住「还有一份在 AppData 里」。
 *
 * 必须在 app ready 之前调用 —— 会话一旦建起来，路径就定了。
 */
if (!app.isPackaged) {
  app.setPath("userData", join(homedir(), ".ruyin", "dev", "chromium"));
}

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
/**
 * 数据目录搬家（TD-039）：**指针文件是权威，壳只是把它读出来交给守护进程。**
 *
 * 指针放在 userData 根下（装机态）——它必须待在一个不跟着数据搬走的地方，否则
 * 搬完就找不到「搬到哪儿了」。真正的搬移由守护进程在开库之前做，壳不碰数据。
 */
const locationFile = app.isPackaged
  ? join(app.getPath("userData"), "location.json")
  : join(homedir(), ".ruyin", "location.json");
/**
 * 数据目录的默认位置：**本地** `%LOCALAPPDATA%\Ruyin\data`（owner 2026-09-05 定）。
 *
 * 为什么不是别处 —— 四个候选都掂过：
 *
 * - `%APPDATA%`（漫游，也就是 Electron 的 userData 默认值，本仓此前的位置）：
 *   域环境开了漫游配置文件时，登录/注销会把整份数据经网络同步一遍。项目库是
 *   GB 级的东西，那意味着登录要等、撞配置文件限额、两台机器之间还可能冲突。
 * - `Documents\RUYIN`：看得见、好找，但 Documents 正是 OneDrive / 坚果云 /
 *   百度网盘要同步的目录（OneDrive 的「已知文件夹移动」在很多企业租户里默认就
 *   开着）。把一个正在被打开的 SQLite 库交给云盘同步，是这几个选项里最坏的一个。
 * - `%USERPROFILE%\RUYIN`：不被已知文件夹移动覆盖，但企业备份工具常常整份备份
 *   用户配置文件 —— 同一个「GB 走网络」的问题，只是频率低些；还会在用户主目录
 *   里多出一个文件夹。
 * - `D:\RUYIN`：很多人确实希望数据在 D:，但不能当默认 —— D: 可能不存在、可能
 *   是光驱或移动盘。这恰恰是「设置里能改目录」要服务的那种人。
 *
 * 所以选本地 AppData：不同步、不漫游、按用户隔离、不需要管理员。它不显眼，但
 * 设置页把完整路径摆出来了，旁边还有「打开目录」。
 */
// `app.getPath` 没有 localAppData 这一项（它是 Windows 专有的），所以走环境变量；
// 拿不到时按 Windows 的固定布局兜底。装机形态只出 win32-x64。
const localAppData = process.env["LOCALAPPDATA"] ?? join(homedir(), "AppData", "Local");
const defaultDataDir = app.isPackaged
  ? join(localAppData, "Ruyin", "data")
  : join(homedir(), ".ruyin", "dev");
/**
 * 老的默认位置（漫游 userData 下的 data）。传给守护进程：那儿有数据就钉在那儿，
 * **不搬**。这条兼容线不能删 —— 删掉它，所有老用户升级之后会对着一个空应用，
 * 而他们的项目库还在原处。
 */
const legacyDataDir = app.isPackaged ? join(app.getPath("userData"), "data") : undefined;
/**
 * **壳不解析目录。** 它只报出两个候选（默认位置、老位置）和指针文件在哪儿；
 * 「这一轮到底用哪个」由守护进程的 `resolveDataDir` 定 —— 那件事必须在开库之前
 * 发生，而且它有测试。此前两边各读一遍指针、各做一次可写探测，是同一个决定有
 * 两个主人：两处的规则一旦有一天不一致，谁对都说不清。
 *
 * 显式的环境变量仍然最高优先（开发与 CI 靠它把目录钉住）。
 */
const dataDir = process.env["RUYIN_DATA_DIR"] ?? defaultDataDir;

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
      ...(legacyDataDir ? { RUYIN_LEGACY_DATA_DIR: legacyDataDir } : {}),
      RUYIN_LOCATION_FILE: locationFile,
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
        const chunk = decoder.decode(value, { stream: true });
        const parsed = extractDaemonEvents(buffer, chunk);
        buffer = parsed.buffer;
        for (const event of parsed.events) {
          for (const listener of [...eventListeners]) listener(event.kind);
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
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = parsePdfSelfCheck(daemonOutput);
    if (result.status === "ok") return;
    if (result.status === "failed") {
      throw new Error(`pdf self-check did not pass: ${result.detail}`);
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
          `port ${PORT} is already held by another RUYIN runtime that this app ` +
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

    const diff = diffPending(announced, rows);
    announced = diff.announced;
    for (const row of diff.toNotify) {
      if (!Notification.isSupported()) continue;
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


function openWindow(): void {
  userWindowOpened = true;
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 600,
    title: "RUYIN",
    // Modern chrome: hide the native frame, float the Windows caption
    // buttons over the app's own top bar (which declares a drag region).
    // Dark-first tech-console identity: colors match the DS dark background
    // (neutral-950); overlay height matches the ShellHeader "md" band (48).
    // The overlay opens dark and is re-tinted whenever the page reports a
    // theme change (syncCaptionOverlay below) - the sync the previous version
    // of this comment said had not landed yet.
    titleBarStyle: "hidden",
    titleBarOverlay: captionOverlay("dark"),
    backgroundColor: "#0a0a0a",
    webPreferences: {
      // The window is a pure web client of the Local API - no Node access,
      // no preload. The contract boundary stays at the HTTP surface.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // 窗口按钮的颜色跟着页面主题走（owner 2026-09-04）。壳看不见页面，通路是
  // 界面 → 守护进程 → 事件流 → 这里；收到事件后自己去取值（events.ts 的规矩：
  // 事件只说什么变了）。取不到就不动 —— 一个读不出来的答复不是重画的理由。
  const syncCaptionOverlay = async (): Promise<void> => {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/ui/theme`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      if (!res.ok || win.isDestroyed()) return;
      win.setTitleBarOverlay(captionOverlay(themeFromReply(await res.json())));
    } catch {
      // 守护进程还没起来，或这一版没有这个端点。窗口按钮保持深色。
    }
  };
  const stopThemeSync = onDaemonEvent((kind) => {
    if (kind === "ui-theme") void syncCaptionOverlay();
    // 数据目录搬家只能在开库之前做，所以「生效」= 重启一次。界面按下确认之后
    // 由守护进程发这条事件，壳来真的重开 —— 界面是纯 Web 客户端，做不到。
    if (kind === "app-restart") {
      app.relaunch();
      app.quit();
    }
  });
  win.on("closed", stopThemeSync);
  // 启动时问一次：界面渲染第一帧就会上报，但那一次可能发生在壳订阅之前。
  win.webContents.on("did-finish-load", () => void syncCaptionOverlay());

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
