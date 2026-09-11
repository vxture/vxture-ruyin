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
 *
 * **装哪个地址由守护进程给**（`entry`，ADR-023：`<origin>/<sha256>/`，项目快照钉的
 * 那一份）。这里不自己拼。同源拦截与桥的 `targetOrigin` 都从**这个地址**算 ——
 * 真正装进 iframe 的是它，要核的也就是它，不是旁边另一个字段说的 origin。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@vxture/design-system";
import type { Api } from "./api";
import { ProductBridge } from "./product-bridge";
import { declaresUi, type SurfaceInfo } from "./product-surface-info";

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

type Frame =
  | { state: "none" }
  | { state: "refused"; origin: string }
  | { state: "ready"; origin: string; entry: string };

/** 入口地址的 origin；解析不了就是 undefined（当没有界面处理，不猜）。 */
function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/** 从守护进程的回答推出该装什么。纯函数：同一个回答永远是同一个结论。 */
function frameOf(s: SurfaceInfo): Frame {
  const origin = s.available && s.entry ? originOf(s.entry) : undefined;
  if (!s.entry || origin === undefined) return { state: "none" };
  // 兜底拦截：同源就不装（见文件头第 1、2 条的依赖关系）。
  if (sameOrigin(origin, window.location.origin)) return { state: "refused", origin };
  return { state: "ready", origin, entry: s.entry };
}

/**
 * 沙箱宿主本身：把守护进程给的入口装进 iframe、接上桥。**不自己去问**有没有界面
 * —— 那份回答侧栏也要用（列不列这一格、默认进哪），由上层问一次传下来。
 */
export function ProductSurface({ api, projectId, surface }: { api: Api; projectId: string; surface: SurfaceInfo }) {
  const frameState = useMemo(() => frameOf(surface), [surface]);
  const frame = useRef<HTMLIFrameElement>(null);

  // iframe 装好之后才接桥：`source` 必须是**这一扇**窗口，片二的桥只认它。
  useEffect(() => {
    if (frameState.state !== "ready") return;
    const win = frame.current?.contentWindow;
    if (!win) return;
    const bridge = new ProductBridge({
      getBridgeToken: () => api.bridgeToken(projectId),
      source: win,
      targetOrigin: frameState.origin,
      // 产品界面收得到它自己那个项目的「什么变了」（片四），不用反复轮询。
      events: true,
    });
    // **构造不等于在听。** 桥的监听器挂在 attach() 里，不在构造函数里 —— 第一版
    // 这里只构造、卸载时 detach()，唯独没 attach()：桥对象在、看起来接好了，却一个
    // 字都没在听，产品界面发出的每一条消息都掉进虚空。是那条「从 iframe 的窗口真发
    // 一条」的用例抓住的；只断言「iframe 装上了」的话，它会一路全绿。
    bridge.attach();
    return () => bridge.detach();
  }, [frameState, api, projectId]);

  if (frameState.state === "none") return null;
  if (frameState.state === "refused") {
    return (
      <p className="error-box" role="alert">
        产品界面的来源与工作台同源，出于安全原因没有加载（{frameState.origin}）。
      </p>
    );
  }
  return (
    <iframe
      ref={frame}
      className="product-surface"
      title="产品界面"
      src={frameState.entry}
      sandbox={PRODUCT_SANDBOX}
      referrerPolicy="no-referrer"
    />
  );
}

/**
 * 项目里「产品界面」那一格（owner 2026-09-11：侧栏单独一格，有界面时排第一、默认
 * 进它）。**这一格的内容区归产品，这一格的外框归 Runtime**：未决确认与项目摘要
 * 钉在所有分区之上，产品界面盖不住；界面不可用时，说明文字由 Runtime 写。
 *
 * 三种情况：
 * - 可用 → iframe 占满内容区（云端产品独占一整页，本地也给整块，不是一条缝）；
 * - 声明了但还没取回 → 如实说「暂时不可用，其余功能照常」，给一个重新获取；
 * - 没声明 → 侧栏本来不列这一格；直接敲地址进来的，说这个产品没有自己的界面。
 */
export function ProductTab({
  api,
  projectId,
  productId,
  surface,
  onReload,
}: {
  api: Api;
  projectId: string;
  productId: string;
  surface: SurfaceInfo | null | undefined;
  onReload: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  if (surface === undefined) {
    return <p className="text-body-md text-muted-foreground">加载中……</p>;
  }
  if (surface?.available) {
    return <ProductSurface api={api} projectId={projectId} surface={surface} />;
  }
  if (!declaresUi(surface)) {
    return (
      <p className="text-body-md text-muted-foreground">
        这个产品没有自己的界面。任务、上下文与成果在左侧各分区里。
      </p>
    );
  }

  const retry = async () => {
    setBusy(true);
    setFailure(null);
    try {
      // 取契约的同时会紧接着取它钉的界面包（ADR-023 §3.3）；取回之后再问一遍。
      await api.fetchProduct(productId);
      onReload();
    } catch (e) {
      setFailure(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="notice-box" role="status">
      <div className="flex flex-col gap-2xs">
        <strong>产品界面暂时不可用</strong>
        <span className="text-body-sm text-muted-foreground">
          这个产品的界面包不在本机：可能还没取回（离线时取不到），也可能取回的与契约
          钉的不符。产品的其余功能照常可用 —— 任务、上下文与成果在左侧各分区里。
        </span>
        {failure && <span className="text-body-sm text-destructive-text">{failure}</span>}
      </div>
      <Button onClick={() => void retry()} disabled={busy}>
        {busy ? "获取中…" : "重新获取"}
      </Button>
    </div>
  );
}
