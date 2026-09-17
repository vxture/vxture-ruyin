/**
 * 关于页的「随包第三方组件许可」（third-party-notices.tsx，TD-058）。
 *
 * 列的是**生成的那份清单**（third-party-list.ts），不是手写的 —— 这里钉的是：数目对得上、
 * 打开后每一条都在，并指向安装目录里的许可证全文。
 */

import { expect, test } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThirdPartyNotices } from "./third-party-notices";
import { THIRD_PARTY } from "./third-party-list";

test("ThirdPartyNotices: 入口只说是什么，不报数目——数目只在弹出面板里说", () => {
  render(<ThirdPartyNotices />);
  expect(screen.getByRole("button", { name: "三方许可" })).toBeInTheDocument();
  expect(THIRD_PARTY.length).toBeGreaterThan(50);
  expect(THIRD_PARTY.some((e) => e.name.startsWith("@vxture/"))).toBe(false);
});

test("ThirdPartyNotices: 打开后逐条列出序号、组件、版本、许可证与所属模块；说清全文在哪、总数在描述里", async () => {
  const entries = [
    { name: "react", version: "18.3.1", license: "MIT", usedBy: ["ui"] },
    { name: "jszip", version: "3.10.1", license: "(MIT OR GPL-3.0-or-later)", usedBy: ["daemon"] },
    { name: "electron", version: "42.10.1", license: "MIT", usedBy: ["shell"] },
    { name: "shared", version: "1.0.0", license: "ISC", usedBy: ["daemon", "ui"] },
  ];
  render(<ThirdPartyNotices entries={entries} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "三方许可" }));

  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText(/以下 4 个是随 RUYIN 一起分发的第三方开源组件/)).toBeInTheDocument();
  // 文件名与路径不再摆给用户（owner 2026-09-17）：许可证全文叫什么文件是装机
  // 细节，一句「在安装目录里」已经够用。
  expect(within(dialog).getByText(/许可证全文在安装目录里/)).toBeInTheDocument();
  expect(dialog.textContent).not.toContain("THIRD-PARTY-NOTICES.txt");
  // 「随哪一块」读起来像半句话，改叫「所属模块」（owner 2026-09-15）。
  expect(within(dialog).getByRole("columnheader", { name: "所属模块" })).toBeInTheDocument();
  const rows = within(dialog).getAllByRole("row").slice(1); // 去掉表头
  expect(rows).toHaveLength(4);
  expect(within(rows[0]!).getByText("1")).toBeInTheDocument();
  expect(within(rows[3]!).getByText("4")).toBeInTheDocument();
  expect(within(rows[1]!).getByText("(MIT OR GPL-3.0-or-later)")).toBeInTheDocument();
  expect(within(rows[2]!).getByText("桌面应用")).toBeInTheDocument();
  expect(within(rows[3]!).getByText("运行环境、界面")).toBeInTheDocument();
});
