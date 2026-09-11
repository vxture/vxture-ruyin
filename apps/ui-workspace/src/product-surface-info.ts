/**
 * 「这个项目的产品有没有自己的界面」—— 侧栏与项目面板共用的那一份答案。
 *
 * 单独一个文件、不放进 product-surface.tsx：侧栏（workbench.tsx，同步包）要知道
 * 该不该列出产品界面那一格、进项目时默认落在哪，而 product-surface.tsx 带着桥
 * （product-bridge.ts）。从那里导入这份数据，会把桥连同沙箱宿主一起拖进同步包
 * —— 与 workspace-tabs.ts 单独成文件是同一条道理。
 */

import { useCallback, useEffect, useState } from "react";
import type { Api } from "./api";

export type SurfaceInfo = Awaited<ReturnType<Api["productSurface"]>>;

/**
 * 契约声明了界面 —— **不论取没取回来**（owner 2026-09-11）。
 *
 * 声明了却还没取回（`not_fetched`）也算：那一格照样列出来，由 Runtime 在里面如实说
 * 「暂时不可用」。契约说有界面、侧栏上却悄悄不见，坏了和好了就长得一模一样。
 * 没声明（`not_declared`）才是真的没有 —— 缺省，不列、不放空壳。
 */
export function declaresUi(s: SurfaceInfo | null | undefined): boolean {
  return !!s && (s.available || s.reason === "not_fetched");
}

/**
 * 问一次守护进程。`undefined` = 还在问；`null` = 问不到（按没有界面处理，不猜）。
 * `reload` 给「重新获取」用：取回之后再问一遍，答案才会变。
 */
export function useProductSurface(
  api: Api,
  projectId: string | undefined,
): { surface: SurfaceInfo | null | undefined; reload: () => void } {
  const [answer, setAnswer] = useState<{ id: string; surface: SurfaceInfo | null } | undefined>();
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    // Promise.resolve().then：连 api 上没有这个方法（旧桩）这种同步抛出也收成「问不到」。
    Promise.resolve()
      .then(() => api.productSurface(projectId))
      .then(
        (s) => alive && setAnswer({ id: projectId, surface: s }),
        () => alive && setAnswer({ id: projectId, surface: null }),
      );
    return () => {
      alive = false;
    };
  }, [api, projectId, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  // 换了项目、新答案还没回来时，旧项目的答案不能拿来用 —— 那会让侧栏短暂地
  // 按上一个项目列出（或不列）产品界面。
  const surface = projectId && answer?.id === projectId ? answer.surface : undefined;
  return { surface, reload };
}
