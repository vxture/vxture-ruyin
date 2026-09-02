/**
 * PDF 渲染服务（ADR-017）。
 *
 * 守护进程把 HTML 发过来，这里用一个离屏 BrowserWindow 排版、`printToPDF`
 * 出字节、原路发回。**字节回到守护进程落盘**，不在这里写文件：`writeArtifact`
 * 是本宿主唯一的写入路径，授权护栏、大小上限、原子改名都在那一处，壳自己写
 * 就是开第二条路。
 *
 * 消息形状与自检标记解析在 pdf-protocol.ts——那一半没有 electron 依赖，能被
 * node:test 直接测；这一半必须在真 Electron 进程里跑，测不了。
 */

import { BrowserWindow } from "electron";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** 一次渲染的上限。排不完就是排不完，挂着不返回更糟。 */
const RENDER_TIMEOUT_MS = 60_000;

/**
 * 排版一份 HTML 为 PDF。
 *
 * HTML 从模型写的 Markdown 转来。`renderHtml` 逐节点构造并转义，正文里的原始
 * HTML 在 ADR-016 里已判为 lossy（拒渲），所以理论上进不来脚本 —— 但理论上
 * 不够：这个窗口 `javascript: false`，静态排版不需要脚本，关掉不损失任何东西。
 */
export async function renderPdf(html: string): Promise<Uint8Array> {
  // 临时文件而不是 data: URL —— data: 导航有长度上限，而一份标书正好是会撞
  // 上限的那种大小。目录随机命名，用完即删。
  const dir = mkdtempSync(join(tmpdir(), "ruyin-pdf-"));
  const file = join(dir, "document.html");
  writeFileSync(file, html, "utf8");

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      javascript: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // 页面自带 default-src 'none'；这里再断一次外发能力。
      images: true,
      webgl: false,
    },
  });
  const timer = setTimeout(() => {
    if (!win.isDestroyed()) win.destroy();
  }, RENDER_TIMEOUT_MS);
  try {
    await win.loadURL(pathToFileURL(file).toString());
    const buffer = await win.webContents.printToPDF({
      printBackground: true,
      // 页面大小与页边距已经写在 HTML 的 @page 里；这里让 Chromium 用它，
      // 两处各写一遍必然会有一处先过期。
      preferCSSPageSize: true,
    });
    return new Uint8Array(buffer);
  } finally {
    clearTimeout(timer);
    if (!win.isDestroyed()) win.destroy();
    rmSync(dir, { recursive: true, force: true });
  }
}
