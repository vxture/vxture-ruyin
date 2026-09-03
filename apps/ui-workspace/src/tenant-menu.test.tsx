/**
 * TenantMenu (tenant-menu.tsx): the header's tenant / workspace menu - three
 * things and no more: tenant + workspace, read-only AI quota, tenant admin
 * link. Quota comes from the C2 envelopes via api.entitlements; shared pools
 * appear in several envelopes and must be counted once.
 */

import { afterEach, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TenantMenu, summarizeQuota } from "./tenant-menu";
import { Api, type EntitlementsBatch, type SessionInfo } from "./api";

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

function envelope(pools: EntitlementsBatch["entitlements"][string]["quota_pools"]): EntitlementsBatch["entitlements"][string] {
  return {
    status: "active",
    trial_ends_at: null,
    current_period_end: null,
    cancel_at_period_end: false,
    data_retention_until: null,
    tier: "pro",
    bundled: false,
    limits: {},
    quota_pools: pools,
  };
}

function fakeApi(over: Partial<Api> = {}): Api {
  return { entitlements: vi.fn().mockResolvedValue({ workspace_id: "w1", entitlements: {} }), ...over } as unknown as Api;
}

afterEach(() => vi.restoreAllMocks());

test("summarizeQuota: identical shared pools count once; different pools of one metric add up; unknown metrics keep their key", () => {
  const shared = { metric: "ai.credit", limit: 1000, remaining: 400, priority: 1 };
  const lines = summarizeQuota({
    workspace_id: "w1",
    entitlements: {
      a: envelope([shared, { metric: "x.custom", limit: 10, remaining: 3, priority: 1 }]),
      b: envelope([shared, { metric: "ai.credit", limit: 500, remaining: 100, priority: 2 }]),
    },
  });
  expect(lines).toEqual([
    { metric: "ai.credit", label: "AI 额度", limit: 1500, remaining: 500 },
    { metric: "x.custom", label: "x.custom", limit: 10, remaining: 3 },
  ]);
});

test("TenantMenu: trigger shows the workspace name only; opening shows tenant, workspace, quota meters and the tenant-admin link", async () => {
  const entitlements = vi.fn().mockResolvedValue({
    workspace_id: "w1",
    entitlements: { "vxture.bid": envelope([{ metric: "ai.credit", limit: 1000, remaining: 250, priority: 1 }]) },
  });
  render(<TenantMenu api={fakeApi({ entitlements })} session={session()} productIds={["vxture.bid"]} />);
  const trigger = screen.getByRole("button", { name: /某工作区/ });
  expect(trigger.textContent).toBe("某工作区");
  const user = userEvent.setup();
  await user.click(trigger);
  expect(await screen.findByText("某租户")).toBeInTheDocument();
  expect(screen.getByText("工作区：某工作区")).toBeInTheDocument();
  expect(await screen.findByText("AI 额度")).toBeInTheDocument();
  expect(screen.getByText("已用 750 / 1,000 · 剩余 250")).toBeInTheDocument();
  expect(entitlements).toHaveBeenCalledWith(["vxture.bid"]);
  const admin = screen.getByRole("link", { name: /租户管理/ }) as HTMLAnchorElement;
  expect(admin.href).toBe("https://vxture.com/zh-CN/tenant-settings");
  expect(admin.target).toBe("_blank");
});

test("TenantMenu: no quota pools from the platform says so; a pool without a limit shows remaining only", async () => {
  const entitlements = vi
    .fn()
    .mockResolvedValueOnce({ workspace_id: "w1", entitlements: { a: envelope([]) } })
    .mockResolvedValueOnce({
      workspace_id: "w1",
      entitlements: { a: envelope([{ metric: "ai.tokens", limit: 0, remaining: 42, priority: 1 }]) },
    });
  const api = fakeApi({ entitlements });
  const user = userEvent.setup();
  const first = render(<TenantMenu api={api} session={session()} productIds={["a"]} />);
  await user.click(screen.getByRole("button", { name: /某工作区/ }));
  expect(await screen.findByText("平台未下发配额池")).toBeInTheDocument();
  first.unmount();
  render(<TenantMenu api={api} session={session()} productIds={["a"]} />);
  await user.click(screen.getByRole("button", { name: /某工作区/ }));
  expect(await screen.findByText("剩余 42")).toBeInTheDocument();
  expect(screen.getByText("AI 用量")).toBeInTheDocument();
});

test("TenantMenu: entitlements not configured, no products, or a failed fetch each say why - never a stale number", async () => {
  const user = userEvent.setup();
  const a = render(<TenantMenu api={fakeApi()} session={session({ entitlementsConfigured: false })} productIds={["x"]} />);
  await user.click(screen.getByRole("button", { name: /某工作区/ }));
  expect(await screen.findByText("权益服务未接通")).toBeInTheDocument();
  a.unmount();

  const b = render(<TenantMenu api={fakeApi()} session={session()} productIds={[]} />);
  await user.click(screen.getByRole("button", { name: /某工作区/ }));
  expect(await screen.findByText("本机没有已订阅的智能体，暂无配额可看")).toBeInTheDocument();
  b.unmount();

  render(
    <TenantMenu
      api={fakeApi({ entitlements: vi.fn().mockRejectedValue(new Error("网关 502")) })}
      session={session()}
      productIds={["x"]}
    />,
  );
  await user.click(screen.getByRole("button", { name: /某工作区/ }));
  expect(await screen.findByText("网关 502")).toBeInTheDocument();
});

test("TenantMenu: missing tenant / workspace names fall back to explicit placeholders, and the console base defaults", async () => {
  const user = userEvent.setup();
  render(
    <TenantMenu
      api={fakeApi()}
      session={session({ org: undefined, workspace: undefined, consoleBase: "" })}
      productIds={[]}
    />,
  );
  await user.click(screen.getByRole("button", { name: /未选定工作区/ }));
  expect(await screen.findByText("未命名租户")).toBeInTheDocument();
  expect((screen.getByRole("link", { name: /租户管理/ }) as HTMLAnchorElement).href).toBe(
    "https://vxture.com/zh-CN/tenant-settings",
  );
});
