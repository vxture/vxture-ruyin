/**
 * 把界面的**生效主题**告诉宿主壳（owner 2026-09-04）。
 *
 * Windows 无边框窗口的三个窗口按钮由系统画，颜色是壳在创建窗口时定的
 * （`titleBarOverlay`）。切到浅色主题之后，那块仍是深色 —— 页面是白的，右上角
 * 三个按钮压在一块黑底上。壳自己看不见页面的主题：窗口是**纯 Web 客户端，
 * 没有 preload、没有 Node**（60 §4.2 的契约边界在 HTTP 上），所以通路只有一条：
 * 界面 → 守护进程 → 事件流 → 壳。
 *
 * 取的是 `<html>` 上有没有 `dark` 类，而不是偏好里的 mode：mode 有第三个取值
 * `system`，而「系统现在是什么」只有浏览器知道；类名是 DS 落下的**结果**，
 * 系统主题变了它也跟着变。
 */

import type { Api } from "./api";

export type ChromeTheme = "dark" | "light";

/** 当前生效主题。DS 在 `<html>` 上挂 `dark`；没有它就是浅色。 */
export function effectiveTheme(root: HTMLElement = document.documentElement): ChromeTheme {
  return root.classList.contains("dark") ? "dark" : "light";
}

/**
 * 盯住 `<html>` 的 class，变了就上报一次。返回停止函数。
 *
 * **同一个值不重复上报**：class 属性会因为密度 / 字号的切换反复变动，而那些
 * 与窗口按钮无关；每次都发一遍等于把一条通知通道当轮询用。
 */
export function watchChromeTheme(
  report: (theme: ChromeTheme) => void,
  root: HTMLElement = document.documentElement,
): () => void {
  let last: ChromeTheme | undefined;
  const tick = () => {
    const next = effectiveTheme(root);
    if (next === last) return;
    last = next;
    report(next);
  };
  tick();
  const observer = new MutationObserver(tick);
  observer.observe(root, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

/**
 * 接线：把生效主题 POST 给守护进程，由它广播给壳。
 *
 * 失败**静默**：这只是窗口按钮的颜色。守护进程没起来、或者这一版没有这个端点，
 * 都不该在用户面前弹一条错误 —— 他没有做任何要求。
 */
export function syncChromeTheme(api: Api): () => void {
  return watchChromeTheme((theme) => {
    void api.setChromeTheme(theme).catch(() => {});
  });
}
