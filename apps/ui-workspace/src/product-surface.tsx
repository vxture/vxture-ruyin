/**
 * 产品界面的沙箱宿主（ADR-022 片三 a）—— 把产品自己的界面装进一个隔离的 iframe，
 * 并把片二的桥接上。
 *
 * **这个组件里最要紧的是两个属性怎么配合着给**，写错了不会报错，只会悄悄失守：
 *
 * 1. **origin 必须与工作台不同。** 工作台把会话令牌存在 `localStorage`（`App.tsx`）。
 *    同源的话，产品代码一行 `localStorage.getItem("ruyin-token")` 就拿到整台守护
 *    进程的钥匙。所以产品界面由另一台服务器、按产品各给一个子域名出（`<产品>.
 *    localhost:<端口>`，product-ui-server.ts）。
 *
 * 2. **sandbox 要带 `allow-same-origin`。** 这一句听起来危险，但只写
 *    `sandbox="allow-scripts"` 的话，浏览器会把 iframe 强制降成**不透明 origin**
 *    （不管它从哪个地址来）—— 片二的桥用 `targetOrigin` 往回发消息，而浏览器不许按
 *    字符串 `"null"` 投递，**消息被静默丢弃**，产品界面怎么都等不到回音。
 *    `allow-same-origin` 只是让 iframe 保住**它自己的**真 origin；它**只在那个
 *    origin 与工作台不同时才安全** —— 同源时再加这一句，产品代码就能拆掉自己的沙箱。
 *
 * 所以第 2 条依赖第 1 条，而第 1 条由下面的 `sameOrigin` 拦截兜底：**产品 origin
 * 若与工作台同源，拒绝渲染**。这道拦截今天不会触发（两台服务器端口不同），它防的
 * 是将来有人把产品界面挪到工作台同一个端口上 —— 那时它是唯一挡在前面的东西。
 *
 * **没有界面是缺省。** 守护进程说 `available: false` 时这里什么都不装，工作台照常
 * 通用地渲染任务、检查点、上下文与成果；而不是装一个会 404 的 iframe。
 */

import { useEffect, useRef, useState } from "react";
import type { Api } from "./api";
import { ProductBridge } from "./product-bridge";

/**
 * 沙箱允许的能力，**逐项写死**。多给一项就多一条出路：
 * - 不给 `allow-top-navigation*`：产品界面不能把整个工作台导走；
 * - 不给 `allow-popups-to-escape-sandbox`：弹出的窗口不能甩掉沙箱；
 * - 不给 `allow-modals`：不能用浏览器原生弹框冒充工作台的确认框 —— 控制权界面
 *   一律归 Runtime（接入指南 §6.3），「防的就是产品自绘一个假的确认框」。
 */
export const PRODUCT_SANDBOX = "allow-scripts allow-same-origin allow-forms";

export function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    // 解析不了就当同源 —— 拿不准的时候宁可不装。
    return true;
  }
}

type Surface =
  | { state: "loading" }
  | { state: "none" }
  | { state: "refused"; origin: string }
  | { state: "ready"; origin: string };

export function ProductSurface({ api, projectId }: { api: Api; projectId: string }) {
  const [surface, setSurface] = useState<Surface>({ state: "loading" });
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let alive = true;
    api
      .productSurface(projectId)
      .then((s) => {
        if (!alive) return;
        if (!s.available || !s.origin) {
          setSurface({ state: "none" });
          return;
        }
        // 兜底拦截：同源就不装（见文件头第 1、2 条的依赖关系）。
        if (sameOrigin(s.origin, window.location.origin)) {
          setSurface({ state: "refused", origin: s.origin });
          return;
        }
        setSurface({ state: "ready", origin: s.origin });
      })
      .catch(() => alive && setSurface({ state: "none" }));
    return () => {
      alive = false;
    };
  }, [api, projectId]);

  // iframe 装好之后才接桥：`source` 必须是**这一扇**窗口，片二的桥只认它。
  useEffect(() => {
    if (surface.state !== "ready") return;
    const win = frame.current?.contentWindow;
    if (!win) return;
    const bridge = new ProductBridge({
      getBridgeToken: () => api.bridgeToken(projectId),
      source: win,
      targetOrigin: surface.origin,
    });
    // **构造不等于在听。** 桥的监听器挂在 attach() 里，不在构造函数里 —— 第一版
    // 这里只构造、卸载时 detach()，唯独没 attach()：桥对象在、看起来接好了，却一个
    // 字都没在听，产品界面发出的每一条消息都掉进虚空。是那条「从 iframe 的窗口真发
    // 一条」的用例抓住的；只断言「iframe 装上了」的话，它会一路全绿。
    bridge.attach();
    return () => bridge.detach();
  }, [surface, api, projectId]);

  if (surface.state === "loading" || surface.state === "none") return null;
  if (surface.state === "refused") {
    return (
      <p className="error-box" role="alert">
        产品界面的来源与工作台同源，出于安全原因没有加载（{surface.origin}）。
      </p>
    );
  }
  return (
    <iframe
      ref={frame}
      className="product-surface"
      title="产品界面"
      src={`${surface.origin}/`}
      sandbox={PRODUCT_SANDBOX}
      referrerPolicy="no-referrer"
    />
  );
}
