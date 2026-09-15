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
  return { quotaUsage: vi.fn().mockResolvedValue(usage()), ...over } as unknown as Api;
}

afterEach(() => vi.restoreAllMocks());

test("quotaLines: an all-zero metric is dropped; used-without-limit is kept", () => {
  expect(quotaLines(usage()).map((l) => l.key)).toEqual(["ai.credit"]);
  expect(
    quotaLines(usage({ aiCredit: { used: 0, limit: 0 }, storage: { used: 5, limit: 0 } })).map((l) => l.key),
  ).toEqual(["storage"]);
  expect(quotaLines(usage({ aiCredit: { used: 0, limit: 0 } }))).toEqual([]);
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
  expect(screen.getByText("工作区：某工作区")).toBeInTheDocument();
  expect(await screen.findByText("AI 额度")).toBeInTheDocument();
  expect(screen.getByText("已用 750 / 1,000 · 剩余 250")).toBeInTheDocument();
  expect(screen.getByText("存储")).toBeInTheDocument();
  expect(screen.getByText("已用 1.0 GB / 10.0 GB · 剩余 9.0 GB")).toBeInTheDocument();
  expect(quotaUsage).toHaveBeenCalledTimes(1);
  const admin = screen.getByRole("link", { name: /租户管理/ }) as HTMLAnchorElement;
  expect(admin.href).toBe("https://vxture.com/zh-CN/tenant-settings");
  expect(admin.target).toBe("_blank");
});

test("TenantMenu: no quota at all says so; a metric without a limit shows used only", async () => {
  const quotaUsage = vi
    .fn()
    .mockResolvedValueOnce(usage({ aiCredit: { used: 0, limit: 0 } }))
    .mockResolvedValueOnce(usage({ aiCredit: { used: 42, limit: 0 } }));
  const api = fakeApi({ quotaUsage });
  const user = userEvent.setup();
  const first = render(<TenantMenu api={api} session={session()} />);
  await user.click(screen.getByRole("button", { name: /某工作区/ }));
  expect(await screen.findByText("当前工作区没有生效的配额")).toBeInTheDocument();
  first.unmount();
  render(<TenantMenu api={api} session={session()} />);
  await user.click(screen.getByRole("button", { name: /某工作区/ }));
  expect(await screen.findByText("已用 42")).toBeInTheDocument();
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

test("TenantMenu: missing tenant / workspace names fall back to explicit placeholders, and the console base defaults", async () => {
  const user = userEvent.setup();
  render(
    <TenantMenu api={fakeApi()} session={session({ org: undefined, workspace: undefined, consoleBase: "" })} />,
  );
  await user.click(screen.getByRole("button", { name: /未选定工作区/ }));
  expect(await screen.findByText("未命名租户")).toBeInTheDocument();
  expect((screen.getByRole("link", { name: /租户管理/ }) as HTMLAnchorElement).href).toBe(
    "https://vxture.com/zh-CN/tenant-settings",
  );
});
