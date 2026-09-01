/**
 * 窗口 chrome 由谁提供。**两种，不是三种：**
 *  - electron：桌面应用。无边框壳，header 就是标题栏（拖拽区 + Windows
 *    按钮避让）。**这是唯一的应用入口**——它自己拉起运行时。
 *  - browser：浏览器访问。窗口自带标题栏，header 退化为应用工具条，不假装
 *    标题栏（无拖拽、无避让），避免双标题栏。
 *
 * 曾有第三种 `wco`：装成 PWA 后 Window Controls Overlay 生效，外观与 electron
 * 同构。已随 PWA 一并去掉——**它长得像桌面应用，却不启动运行时**，守护进程没跑
 * 时点开就是「未连接」。一个永远不会出现的分支只会让读代码的人以为它被处理了。
 *
 * 单独一个文件：login.tsx 与 workbench.tsx 都要用它，而 workbench.tsx 本身
 * 现在是懒加载的（TD-011②）——从 workbench.tsx 里导入这一个钩子会把它整个
 * 拖进登录页的初始包。
 */

/** Caption-overlay clearance only applies inside the Electron shell. */
const IS_ELECTRON = navigator.userAgent.includes("Electron");

export type HostChrome = "electron" | "browser";

export function useHostChrome(): HostChrome {
  return IS_ELECTRON ? "electron" : "browser";
}
