/**
 * 关于页的「随包第三方组件许可」（third-party-notices.tsx，TD-058）。
 *
 * 列的是**生成的那份清单**（third-party-list.ts），不是手写的 —— 这里钉的是：数目对得上、
 * 打开后每一条都在、说清 RUYIN 本身闭源、指向随包的全文与 Chromium 的那份。
 */

import { expect, test } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThirdPartyNotices } from "./third-party-notices";
import { THIRD_PARTY } from "./third-party-list";

test("ThirdPartyNotices: 入口写着随包组件的数目，就是生成清单的条数", () => {
  render(<ThirdPartyNotices />);
  expect(screen.getByRole("button", { name: `随包第三方组件许可（${THIRD_PARTY.length}）` })).toBeInTheDocument();
  expect(THIRD_PARTY.length).toBeGreaterThan(50);
  expect(THIRD_PARTY.some((e) => e.name.startsWith("@vxture/"))).toBe(false);
});

test("ThirdPartyNotices: 打开后逐条列出组件、版本、许可证与随哪一块；说清闭源与全文在哪", async () => {
  const entries = [
    { name: "react", version: "18.3.1", license: "MIT", usedBy: ["ui"] },
    { name: "jszip", version: "3.10.1", license: "(MIT OR GPL-3.0-or-later)", usedBy: ["daemon"] },
    { name: "electron", version: "42.10.1", license: "MIT", usedBy: ["shell"] },
    { name: "shared", version: "1.0.0", license: "ISC", usedBy: ["daemon", "ui"] },
  ];
  render(<ThirdPartyNotices entries={entries} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "随包第三方组件许可（4）" }));

  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText(/RUYIN 本身是闭源商业软件/)).toBeInTheDocument();
  expect(within(dialog).getByText(/THIRD-PARTY-NOTICES\.txt/)).toBeInTheDocument();
  expect(within(dialog).getByText(/LICENSES\.chromium\.html/)).toBeInTheDocument();
  const rows = within(dialog).getAllByRole("row").slice(1); // 去掉表头
  expect(rows).toHaveLength(4);
  expect(within(rows[1]!).getByText("(MIT OR GPL-3.0-or-later)")).toBeInTheDocument();
  expect(within(rows[2]!).getByText("桌面壳")).toBeInTheDocument();
  expect(within(rows[3]!).getByText("运行时、界面")).toBeInTheDocument();
});
