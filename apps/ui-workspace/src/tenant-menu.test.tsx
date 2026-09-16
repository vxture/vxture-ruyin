/**
 * TenantMenu (tenant-menu.tsx): the header's tenant / workspace menu - three
 * things and no more: tenant + workspace, read-only quota, tenant admin link.
 * Quota comes from the platform's quota-usage read (api.quotaUsage), which is
 * per workspace - not assembled from whichever products happen to be installed.
 */

import { afterEach, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TenantMenu, fmtBytes, quotaLines } from "./tenant-menu";
import { Api, type QuotaUsage, type SessionInfo } from "./api";

function session(over: Partial<SessionInfo> = {}): SessionInfo {
  return {
    signedIn: true,
    issuer: "",
    consoleBase: "https://vxture.com",
    entitlementsConfigured: true,
    org: { id: "o1", name: "某租户" },
    workspace: { id: "w1", name: "某工作区" },
    ...over,
  };
}

function usage(over: Partial<QuotaUsage> = {}): QuotaUsage {
  return {
    aiCredit: { used: 750, limit: 1000 },
    storage: { used: 0, limit: 0 },
    ...over,
  };
}

function fakeApi(over: Partial<Api> = {}): Api {
  return {
    quotaUsage: vi.fn().mockResolvedValue(usage()),
    orgLogo: vi.fn().mockResolvedValue(null),
    ...over,
  } as unknown as Api;
}

afterEach(() => vi.restoreAllMocks());

test("quotaLines: both lines are always present, even when a metric is 0/0", () => {
  expect(quotaLines(usage()).map((l) => l.key)).toEqual(["ai.credit", "storage"]);
  expect(
    quotaLines(usage({ aiCredit: { used: 0, limit: 0 }, storage: { used: 0, limit: 0 } })).map((l) => l.key),
  ).toEqual(["ai.credit", "storage"]);
});

test("fmtBytes: bytes read as human units, whole bytes stay whole", () => {
  expect(fmtBytes(512)).toBe("512 B");
  expect(fmtBytes(1536)).toBe("1.5 KB");
  expect(fmtBytes(5 * 1024 ** 3)).toBe("5.0 GB");
  expect(fmtBytes(3 * 1024 ** 5)).toBe("3072.0 TB");
});

test("TenantMenu: trigger shows the workspace name only; opening shows tenant, workspace, quota meters and the tenant-admin link", async () => {
  const quotaUsage = vi.fn().mockResolvedValue(
    usage({ storage: { used: 1024 ** 3, limit: 10 * 1024 ** 3 } }),
  );
  render(<TenantMenu api={fakeApi({ quotaUsage })} session={session()} />);
  const trigger = screen.getByRole("button", { name: /某工作区/ });
  expect(trigger.textContent).toBe("某工作区");
  const user = userEvent.setup();
  await user.click(trigger);
  expect(await screen.findByText("某租户")).toBeInTheDocument();
  // 身份卡第二行不再带「工作区：」前缀（owner 2026-09-16）：与触发按钮同一个
  // 裸名字，图标已经说明这是工作区，文字前缀是同一件事说两遍。
  expect(screen.getAllByText("某工作区")).toHaveLength(2); // 触发按钮 + 身份卡各一次
  expect(await screen.findByText("AI Credits")).toBeInTheDocument();
  expect(screen.getByText("750 点")).toBeInTheDocument();
  expect(screen.getByText("已用 750 点，总量 1,000 点")).toBeInTheDocument();
  expect(screen.getByText("Storage Spaces")).toBeInTheDocument();
  expect(screen.getByText("1.0 GB")).toBeInTheDocument();
  expect(screen.getByText("已用 1.0 GB，总量 10.0 GB")).toBeInTheDocument();
  expect(quotaUsage).toHaveBeenCalledTimes(1);
  const admin = screen.getByRole("link", { name: /租户管理/ }) as HTMLAnchorElement;
  expect(admin.href).toBe("https://console.vxture.com/tenant-settings");
  expect(admin.target).toBe("_blank");
});

/**
 * 「租户管理」落在 console-bff 本体上，不是官网 consoleBase（owner 2026-09-16
 * audit：与「用户中心」「配额用量」同一类错，见 user.tsx 的 consoleAppBase 说明——
 * 第一版这里也误拼去了官网）。
 */
test("TenantMenu: 「租户管理」跟着 consoleAppBase 走，不是 consoleBase", async () => {
  render(
    <TenantMenu
      api={fakeApi()}
      session={session({
        consoleBase: "https://vxture.com",
        consoleAppBase: "https://console.staging.vxture.com",
      })}
    />,
  );
  await userEvent.setup().click(screen.getByRole("button", { name: /某工作区/ }));
  const admin = (await screen.findByRole("link", { name: /租户管理/ })) as HTMLAnchorElement;
  expect(admin.href).toBe("https://console.staging.vxture.com/tenant-settings");
});

/**
 * 配额行常驻（owner 2026-09-16）：哪怕当前是 0/0 也照样露出来，不再整段隐藏。
 * 标题行只放裸数字（owner 同一轮纠正：标题行放不下「已用/剩余」这类文字）。
 * 明细行也常驻（owner 三次纠正后明确）：哪怕总量是 0，也照样写「已用 X，
 * 总量 0」——这一行不该在「行常驻」之后又自己藏一次。
 */
test("TenantMenu: 配额行与明细行都常驻，哪怕是 0/0", async () => {
  const quotaUsage = vi
    .fn()
    .mockResolvedValueOnce(usage({ aiCredit: { used: 0, limit: 0 } }))
    .mockResolvedValueOnce(usage({ aiCredit: { used: 42, limit: 0 } }));
  const api = fakeApi({ quotaUsage });
  const user = userEvent.setup();
  const first = render(<TenantMenu api={api} session={session()} />);
  await user.click(screen.getByRole("button", { name: /某工作区/ }));
  expect(await screen.findByText("AI Credits")).toBeInTheDocument();
  expect(screen.getByText("Storage Spaces")).toBeInTheDocument();
  // 两条都是 0/0：标题行是裸数字（AI 额度带「点」这个自己的单位，存储走
  // 字节格式化，零值也带单位后缀），明细行常驻，总量 0 也照样写出来。
  expect(screen.getByText("0 点")).toBeInTheDocument();
  expect(screen.getByText("0 B")).toBeInTheDocument();
  expect(screen.getByText("已用 0 点，总量 0 点")).toBeInTheDocument();
  expect(screen.getByText("已用 0 B，总量 0 B")).toBeInTheDocument();
  first.unmount();

  render(<TenantMenu api={api} session={session()} />);
  await user.click(screen.getByRole("button", { name: /某工作区/ }));
  expect(await screen.findByText("42 点")).toBeInTheDocument();
  expect(screen.getByText("已用 42 点，总量 0 点")).toBeInTheDocument();
});

test("TenantMenu: entitlements not configured, or a failed fetch, each say why - never a stale number", async () => {
  const user = userEvent.setup();
  const quotaUsage = vi.fn();
  const a = render(
    <TenantMenu api={fakeApi({ quotaUsage })} session={session({ entitlementsConfigured: false })} />,
  );
  await user.click(screen.getByRole("button", { name: /某工作区/ }));
  expect(await screen.findByText("权益服务未接通")).toBeInTheDocument();
  expect(quotaUsage).not.toHaveBeenCalled();
  a.unmount();

  render(
    <TenantMenu api={fakeApi({ quotaUsage: vi.fn().mockRejectedValue(new Error("网关 502")) })} session={session()} />,
  );
  await user.click(screen.getByRole("button", { name: /某工作区/ }));
  expect(await screen.findByText("网关 502")).toBeInTheDocument();
});

test("TenantMenu: missing tenant / workspace names fall back to explicit placeholders, and the console-app base defaults", async () => {
  const user = userEvent.setup();
  render(
    <TenantMenu
      api={fakeApi()}
      session={session({ org: undefined, workspace: undefined, consoleAppBase: "" })}
    />,
  );
  await user.click(screen.getByRole("button", { name: /未选定工作区/ }));
  expect(await screen.findByText("未命名租户")).toBeInTheDocument();
  expect((screen.getByRole("link", { name: /租户管理/ }) as HTMLAnchorElement).href).toBe(
    "https://console.vxture.com/tenant-settings",
  );
});

/**
 * 身份卡用租户自己的 logo（owner 2026-09-16），标题栏那颗触发按钮不用——
 * 只在弹出面板里。Radix Avatar 只在图片真的加载完之后才挂 `<img>`（jsdom 里
 * 不会触发 load 事件），所以跟 user.test.tsx 同一个断言写法：要么还没挂
 * （src 还没到），要么挂了就必须是这个 URL——不接受除此之外的任何 src。
 */
test("TenantMenu: 有租户 logo 时身份卡用它做头像", async () => {
  const revoke = vi.fn();
  const createUrl = vi.fn().mockReturnValue("blob:tenant-logo");
  vi.stubGlobal("URL", { ...URL, createObjectURL: createUrl, revokeObjectURL: revoke });
  const orgLogo = vi.fn().mockResolvedValue(new Blob(["fake-png"], { type: "image/png" }));
  const { container } = render(
    <TenantMenu api={fakeApi({ orgLogo })} session={session()} />,
  );
  await userEvent.setup().click(screen.getByRole("button", { name: /某工作区/ }));
  await vi.waitFor(() => expect(orgLogo).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => {
    const img = container.querySelector("img");
    expect(img === null || img.getAttribute("src") === "blob:tenant-logo").toBe(true);
  });
});

test("TenantMenu: 没有租户 logo（null）时身份卡落到首字兜底，不落到通用图标", async () => {
  const orgLogo = vi.fn().mockResolvedValue(null);
  const { container } = render(
    <TenantMenu api={fakeApi({ orgLogo })} session={session()} />,
  );
  await userEvent.setup().click(screen.getByRole("button", { name: /某工作区/ }));
  await vi.waitFor(() => expect(orgLogo).toHaveBeenCalledTimes(1));
  expect(container.querySelector("img")).not.toBeInTheDocument();
  // 「某租户」的首字。
  expect(screen.getByText("某")).toBeInTheDocument();
});
