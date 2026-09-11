/**
 * 标题栏搜索（header-search.tsx）：平时一个图标，点开或 Ctrl+K 才展开。
 *
 * **最要紧的是 Ctrl+K 那一条。** DS 的 `ShellSearchBox` 把快捷键绑在它自己内部，
 * 组件不在就没人听 —— 收成图标之后如果不接管，Ctrl+K 就静默失效：按下去什么都
 * 不发生，也不报错，而界面看起来一切正常。
 */

import { afterEach, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { ShellSearchGroup } from "@vxture/design-system";
import { HeaderSearch } from "./header-search";

const PLACEHOLDER = "搜索项目、产品与动作…";

function groups(onSelect = vi.fn()): ShellSearchGroup[] {
  return [
    { key: "projects", heading: "项目", items: [{ key: "p1", label: "某储能电站投标", onSelect }] },
  ];
}

/** 真的受控：查询串由调用方持有，与 workbench 的用法一致。 */
async function renderSearch(onSelect = vi.fn()) {
  function Controlled() {
    const [q, setQ] = useState("");
    return <HeaderSearch query={q} onQueryChange={setQ} groups={groups(onSelect)} />;
  }
  return render(<Controlled />);
}

afterEach(() => vi.restoreAllMocks());

test("HeaderSearch: 平时只有一个图标，没有输入框", async () => {
  await renderSearch();
  expect(screen.getByRole("button", { name: "搜索（Ctrl K）" })).toBeInTheDocument();
  expect(screen.queryByPlaceholderText(PLACEHOLDER)).not.toBeInTheDocument();
});

test("HeaderSearch: 点图标展开，光标直接落进输入框", async () => {
  await renderSearch();
  await userEvent.setup().click(screen.getByRole("button", { name: "搜索（Ctrl K）" }));
  const input = await screen.findByPlaceholderText(PLACEHOLDER);
  expect(input).toHaveFocus();
});

/**
 * **收起时 Ctrl+K 照样能打开** —— 这一条是这个组件存在的一半理由。
 *
 * 不接管的话，DS 的快捷键跟着搜索框一起被卸掉，按 Ctrl+K 什么都不发生。
 * ⌘K 同理（macOS 与浏览器访问模式）。
 */
test("HeaderSearch: 收起时按 Ctrl+K / ⌘K 也能展开并聚焦（快捷键不跟着搜索框一起消失）", async () => {
  const { unmount } = await renderSearch();
  act(() => {
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  });
  expect(await screen.findByPlaceholderText(PLACEHOLDER)).toHaveFocus();
  unmount();

  await renderSearch();
  act(() => {
    fireEvent.keyDown(window, { key: "K", metaKey: true });
  });
  expect(await screen.findByPlaceholderText(PLACEHOLDER)).toBeInTheDocument();
});

test("HeaderSearch: Esc 收起", async () => {
  await renderSearch();
  await userEvent.setup().click(screen.getByRole("button", { name: "搜索（Ctrl K）" }));
  await screen.findByPlaceholderText(PLACEHOLDER);
  act(() => {
    fireEvent.keyDown(window, { key: "Escape" });
  });
  expect(screen.queryByPlaceholderText(PLACEHOLDER)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "搜索（Ctrl K）" })).toBeInTheDocument();
});

test("HeaderSearch: 点浮层外面收起", async () => {
  await renderSearch();
  await userEvent.setup().click(screen.getByRole("button", { name: "搜索（Ctrl K）" }));
  await screen.findByPlaceholderText(PLACEHOLDER);
  fireEvent.mouseDown(document.body);
  expect(screen.queryByPlaceholderText(PLACEHOLDER)).not.toBeInTheDocument();
});

/** 选中一条结果：照常执行它自己的动作，**并且**收起 —— 跳到别处后框还悬着就不对了。 */
test("HeaderSearch: 选中一条结果后收起，且原来的动作照常执行", async () => {
  const onSelect = vi.fn();
  await renderSearch(onSelect);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "搜索（Ctrl K）" }));
  await user.type(await screen.findByPlaceholderText(PLACEHOLDER), "储能");
  await user.click(await screen.findByText("某储能电站投标"));
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(screen.queryByPlaceholderText(PLACEHOLDER)).not.toBeInTheDocument();
});

/** 别的按键不该把它打开 —— 只认 Ctrl/⌘ + K。 */
test("HeaderSearch: 单按 k、或 Ctrl 加别的键，都不展开", async () => {
  await renderSearch();
  act(() => {
    fireEvent.keyDown(window, { key: "k" });
    fireEvent.keyDown(window, { key: "j", ctrlKey: true });
  });
  expect(screen.queryByPlaceholderText(PLACEHOLDER)).not.toBeInTheDocument();
});
