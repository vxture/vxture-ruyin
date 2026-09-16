/**
 * UpdateToast（update-check.tsx）—— 启动时自动检查的右下角浮层。
 *
 * 共享状态本身（`useUpdateCheck`）与设置页顶部那条 `UpdateNotice` 已经在
 * settings.test.tsx 里逐档测过（四种结果、自动检查的持久化与 localStorage
 * 兜底）；这里只测 `UpdateToast` 自己的那条不对称规则——**只在「有新版本」
 * 时弹**，其余三档静默。
 */

import { expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UpdateToast, type UpdateCheckState } from "./update-check";
import type { UpdateCheck } from "./api";

function state(over: Partial<UpdateCheckState> = {}): UpdateCheckState {
  return {
    autoCheck: true,
    setAutoCheck: vi.fn(),
    busy: false,
    result: null,
    failed: null,
    manual: false,
    check: vi.fn().mockResolvedValue(undefined),
    dismiss: vi.fn(),
    ...over,
  };
}

function availableResult(over: Partial<Extract<UpdateCheck, { status: "available" }>> = {}) {
  return {
    status: "available" as const,
    current: "0.2.0",
    latest: "0.3.0",
    channel: "stable",
    checkedAt: "2026-09-15T00:00:00Z",
    downloadUrl: "https://dl.example.com/ruyin/stable/Ruyin-Setup-0.3.0.exe",
    ...over,
  };
}

test("UpdateToast: 没有新版本时不弹 —— 已是最新 / 没查到 / 检查失败 / 还没查过，都静默", () => {
  const cases: Array<Partial<UpdateCheckState>> = [
    {},
    { result: { status: "current", current: "0.2.0", latest: "0.2.0", channel: "stable", checkedAt: "t" } },
    { result: { status: "unreachable", current: "0.2.0", reason: "feed 502", channel: "stable", checkedAt: "t" } },
    { failed: "网络不可达" },
  ];
  for (const over of cases) {
    const { container, unmount } = render(<UpdateToast state={state(over)} />);
    expect(container).toBeEmptyDOMElement();
    unmount();
  }
});

test("UpdateToast: 有新版本时弹出，说清当前/最新版本与渠道，点「升级」打开下载地址", async () => {
  vi.stubGlobal("open", vi.fn());
  const dismiss = vi.fn();
  render(<UpdateToast state={state({ result: availableResult(), dismiss })} />);

  expect(screen.getByText("发现新版本")).toBeInTheDocument();
  const body = screen.getByText(/0\.3\.0/).closest("p");
  expect(body?.textContent).toContain("0.2.0");
  expect(body?.textContent).toContain("stable");

  await userEvent.setup().click(screen.getByRole("button", { name: "升级" }));
  expect(globalThis.open).toHaveBeenCalledWith(
    "https://dl.example.com/ruyin/stable/Ruyin-Setup-0.3.0.exe",
    "_blank",
    "noopener",
  );

  await userEvent.setup().click(screen.getByRole("button", { name: "关闭" }));
  expect(dismiss).toHaveBeenCalled();
  vi.unstubAllGlobals();
});

test("UpdateToast: 没有下载地址时不拼一个猜出来的地址，只说明拿不到", () => {
  render(<UpdateToast state={state({ result: availableResult({ downloadUrl: undefined }) })} />);
  expect(screen.getByText("这次没能拿到安装包地址")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "升级" })).not.toBeInTheDocument();
});

test("UpdateToast: 右上角的叉号也能关（与「关闭」按钮是同一个 dismiss）", async () => {
  const dismiss = vi.fn();
  render(<UpdateToast state={state({ result: availableResult(), dismiss })} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "关闭提醒" }));
  expect(dismiss).toHaveBeenCalled();
});

test("UpdateToast: 渠道信息缺失时不硬拼一个", () => {
  render(<UpdateToast state={state({ result: availableResult({ channel: "" }) })} />);
  const body = screen.getByText(/0\.3\.0/).closest("p");
  expect(body?.textContent).not.toContain("渠道");
});
