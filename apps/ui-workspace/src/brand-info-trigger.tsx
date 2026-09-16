/**
 * 标题栏 RUYIN 字标的信息面板（owner 2026-09-16）：字标本身在首页态点了
 * 是去 `#home`——但首页态本来就在首页，那一次点击等于什么都不做。把这个
 * 空转的点击改造成有用的东西：弹出一份「关于」页那份软件信息（品牌 / 版本 /
 * 条款 / 三方许可），不含本机信息——那是「关于」页自己「本机配置」板块的事，
 * 这里不重复。
 *
 * 形状照 `runtime-menu.tsx`：自己拉一次 `system`（面板打开时才拉，不是首屏
 * 常驻就问——这份信息只在点开时才用得上）。
 *
 * 视觉上要长得跟原来的 `ShellBrand`一模一样（同一套 `vx-brand-*` 类），但
 * `ShellBrand` 自己只会渲成 `<a href>`，没有把点击行为交给调用方的口子——所以
 * 这里手写同样的标记，套一层 `all: unset` 的 `<button>`（`.app-brand-trigger`），
 * 而不是继续用 `ShellBrand` 再想办法拦它的默认导航。
 */

import { useEffect, useState } from "react";
import { Popover, PopoverTrigger, ShellPanelContent, ShellPanelSection } from "@vxture/design-system";
import type { Api, SessionInfo, SystemInfo } from "./api";
import { BrandInfoBlock } from "./brand-info";

export function BrandInfoTrigger({
  api,
  session,
}: {
  api: Api;
  session?: SessionInfo | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [system, setSystem] = useState<SystemInfo | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    api
      .system()
      .then((s) => alive && setSystem(s))
      .catch(() => {
        /* 拿不到就显示省略号——见 BrandInfoBlock 里 Runtime 那一行的兜底。 */
      });
    return () => {
      alive = false;
    };
  }, [api, open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="vx-brand-lockup app-brand app-brand-trigger" aria-label="RUYIN">
          <img className="vx-brand-mark" src="/logo.svg" alt="" aria-hidden width={24} height={24} draggable={false} />
          <span className="vx-brand-name">RUYIN</span>
          <span className="vx-brand-local-name">Intelligent Workbench</span>
        </button>
      </PopoverTrigger>
      <ShellPanelContent side="bottom" align="start" sideOffset={8} className="app-brand-panel">
        <ShellPanelSection divided={false}>
          <BrandInfoBlock system={system} session={session ?? null} />
        </ShellPanelSection>
      </ShellPanelContent>
    </Popover>
  );
}
