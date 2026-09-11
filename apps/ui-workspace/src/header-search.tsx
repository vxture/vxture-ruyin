/**
 * 标题栏的搜索：**平时只是一个图标，点开或按 Ctrl+K 才展开**（owner 2026-09-11 定）。
 *
 * 为什么收起来：
 *   - 给 header 让出地方。1024 宽时常驻的搜索框已经被挤到 257px，项目页左边那串
 *     「产品名 · 项目名」一长就跟它抢；
 *   - **桌面壳是无边框窗口，header 就是拖动窗口的把手**。常驻的搜索框正好占着
 *     header 正中间、而且是 no-drag —— 最顺手去抓的那块地方恰好拖不动窗口。收起后
 *     中间整块变回可拖拽区。
 *
 * **最要紧的一条：收起之后 Ctrl+K 不能悄悄失效。** DS 的 `ShellSearchBox` 把快捷键
 * 绑在**它自己内部**（组件不在就没人听）。直接把它换成图标，Ctrl+K 就静默地不灵了
 * —— 按下去什么都不发生，也不报错，而界面看起来一切正常。所以这里用
 * `shortcutKey={null}` 关掉它自己的绑定，由这个组件在窗口上接管：Ctrl+K → 展开 →
 * 聚焦。DS 为这种用法留了口子（「嵌在已有全局快捷键体系里的产品可以自己接管」）。
 *
 * 展开的框是**浮层**、从图标处向左展开、宽度收窄 —— 不推挤标题栏上别的东西。
 */

import { useEffect, useRef, useState } from "react";
import { ShellIconButton, ShellSearchBox, type ShellSearchGroup } from "@vxture/design-system";

const LABELS = {
  placeholder: "搜索项目、产品与动作…",
  empty: "没有匹配的结果",
  resultsLabel: "搜索结果",
};

export function HeaderSearch({
  query,
  onQueryChange,
  groups,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  groups: ReadonlyArray<ShellSearchGroup>;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // 接管 Ctrl/⌘+K（见文件头）。挂在 window 上，所以收起时照样听得见。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 展开后把光标放进输入框 —— 按了 Ctrl+K 却还得再点一下框，快捷键就白给了。
  useEffect(() => {
    if (open) box.current?.querySelector("input")?.focus();
  }, [open]);

  // 点浮层外面收起。
  //
  // 「外面」不能按 DOM 判断：DS 的结果列表是 Radix Popover，**传送到 body 下**，
  // 不在 box 里。只认 box 的话，点一条结果的那次 mousedown 先把整个搜索卸掉，click
  // 落空，选了等于没选 —— 看上去只是「框收起了」，不像坏了。
  // 所以按 **React 树**判断：React 的合成事件顺着组件树冒泡、穿过 portal，结果列表
  // 上的 mousedown 也会先经过 box 的 onMouseDown。在那里记下这次事件，document 上
  // 的监听（更晚触发）看到是同一次就不收。
  const insideDown = useRef<Event | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (insideDown.current === e) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // 选中一条结果之后收起 —— 跳到了别处，搜索框还悬在那里挡着就不对了。
  const closing: ShellSearchGroup[] = groups.map((g) => ({
    ...g,
    items: g.items.map((it) => ({
      ...it,
      onSelect: () => {
        setOpen(false);
        it.onSelect();
      },
    })),
  }));

  return (
    <span className="header-search">
      {open ? (
        <div
          ref={box}
          className="header-search-box no-drag"
          onMouseDown={(e) => {
            insideDown.current = e.nativeEvent;
          }}
        >
          <ShellSearchBox
            query={query}
            onQueryChange={onQueryChange}
            groups={closing}
            labels={LABELS}
            shortcutKey={null}
          />
        </div>
      ) : (
        <ShellIconButton icon="search" label="搜索（Ctrl K）" onClick={() => setOpen(true)} />
      )}
    </span>
  );
}
