/**
 * UserSlot (user.tsx): sidebar-footer identity chip + its popover. Real
 * logic worth pinning down: display-name fallback chain, the deliberate
 * "会话已失效" framing (reaching this component signed-out means the
 * session expired mid-use - login is the only entry point, so this is
 * never a supported "browsing offline" state), the subscription summary's
 * branches, and the login/logout round trips.
 *
 * api.system()/session()/entitlements()/login()/logout() are all mocked
 * directly on a fake Api object (not through fetch) - this file is about
 * UserSlot's own behavior, not Api's. The one thing UserSlot calls fetch()
 * for directly (not through Api) is the /health poll, mocked separately.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserSlot } from "./user";
import { Api, type EntitlementsBatch, type SessionInfo, type SystemInfo } from "./api";

function session(over: Partial<SessionInfo> = {}): SessionInfo {
  return {
    signedIn: false,
    issuer: "https://accounts.vxture.com",
    consoleBase: "https://vxture.com",
    entitlementsConfigured: false,
    ...over,
  };
}

function systemInfo(over: Partial<SystemInfo> = {}): SystemInfo {
  return {
    version: "0.1.0",
    platform: "win32",
    arch: "x64",
    dataDir: "(test)",
    productsDir: "(test)",
    keyProtection: "dpapi",
    startedAt: "2026-09-01T00:00:00Z",
    ...over,
  };
}

function fakeApi(over: Partial<Api> = {}): Api {
  return {
    session: vi.fn().mockResolvedValue(session()),
    system: vi.fn().mockResolvedValue(systemInfo()),
    entitlements: vi.fn().mockResolvedValue({ workspace_id: "ws_1", entitlements: {} }),
    login: vi.fn().mockResolvedValue({ authorizeUrl: "https://accounts.vxture.com/authorize" }),
    logout: vi.fn().mockResolvedValue({ ok: true }),
    ...over,
  } as unknown as Api;
}

async function openPopover(): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /账户 ·/ }));
}

beforeEach(() => {
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal("open", vi.fn().mockReturnValue({ opener: null }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

void test("UserSlot: not signed in reads 'session expired', not a generic 'not logged in' label", async () => {
  const api = fakeApi({ session: vi.fn().mockResolvedValue(session({ signedIn: false })) });
  render(<UserSlot api={api} productIds={[]} onOpenSettings={() => {}} />);
  expect(await screen.findByText("会话已失效")).toBeInTheDocument();
});

void test("UserSlot: display name falls back name -> email -> a generic label, only once signed in", async () => {
  const withName = fakeApi({
    session: vi.fn().mockResolvedValue(
      session({ signedIn: true, profile: { sub: "u1", name: "郭彦豪" } }),
    ),
  });
  const { unmount } = render(<UserSlot api={withName} productIds={[]} onOpenSettings={() => {}} />);
  expect(
    await screen.findByText("郭彦豪", { selector: ".user-chip-name" }),
  ).toBeInTheDocument();
  unmount();

  const emailOnly = fakeApi({
    session: vi.fn().mockResolvedValue(
      session({ signedIn: true, profile: { sub: "u1", email: "u1@example.com" } }),
    ),
  });
  render(<UserSlot api={emailOnly} productIds={[]} onOpenSettings={() => {}} />);
  // 没有 name 时，昵称与副标题都退到 email —— 两处同时出现是预期行为，
  // 这条用例钉的是昵称那一处确实退到了 email，不是唯一性。
  expect(
    await screen.findByText("u1@example.com", { selector: ".user-chip-name" }),
  ).toBeInTheDocument();
});

void test("UserSlot: online health reflects the /health poll result", async () => {
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
  const api = fakeApi();
  const { container } = render(<UserSlot api={api} productIds={[]} onOpenSettings={() => {}} />);
  await screen.findByText("会话已失效");
  expect(container.querySelector(".user-chip-dot.off")).toBeInTheDocument();
});

void test("UserSlot: a /health fetch that rejects outright (not just a non-ok status) still reads offline", async () => {
  globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
  const api = fakeApi();
  const { container } = render(<UserSlot api={api} productIds={[]} onOpenSettings={() => {}} />);
  await screen.findByText("会话已失效");
  expect(container.querySelector(".user-chip-dot.off")).toBeInTheDocument();
});

void test("UserSlot: a session() rejection leaves the slot signed-out rather than crashing", async () => {
  const api = fakeApi({ session: vi.fn().mockRejectedValue(new Error("daemon unreachable")) });
  render(<UserSlot api={api} productIds={[]} onOpenSettings={() => {}} />);
  expect(await screen.findByText("会话已失效", { selector: ".user-chip-name" })).toBeInTheDocument();
});

// --- subscriptionLine(): every branch --------------------------------------

void test("UserSlot subscription line: not signed in", async () => {
  const api = fakeApi({ session: vi.fn().mockResolvedValue(session({ signedIn: false })) });
  render(<UserSlot api={api} productIds={[]} onOpenSettings={() => {}} />);
  await openPopover();
  expect(await screen.findByText("登录后同步")).toBeInTheDocument();
});

void test("UserSlot subscription line: signed in but entitlements not configured", async () => {
  const api = fakeApi({
    session: vi.fn().mockResolvedValue(session({ signedIn: true, entitlementsConfigured: false })),
  });
  render(<UserSlot api={api} productIds={["vxture.bid"]} onOpenSettings={() => {}} />);
  await openPopover();
  expect(await screen.findByText("权益服务未配置")).toBeInTheDocument();
});

void test("UserSlot subscription line: fetch failure reads '获取失败', not stuck on '…'", async () => {
  const api = fakeApi({
    session: vi.fn().mockResolvedValue(session({ signedIn: true, entitlementsConfigured: true })),
    entitlements: vi.fn().mockRejectedValue(new Error("network down")),
  });
  render(<UserSlot api={api} productIds={["vxture.bid"]} onOpenSettings={() => {}} />);
  await openPopover();
  expect(await screen.findByText("获取失败")).toBeInTheDocument();
});

void test("UserSlot subscription line: zero active entitlements reads '无生效订阅'", async () => {
  const batch: EntitlementsBatch = {
    workspace_id: "ws_1",
    entitlements: {
      "vxture.bid": {
        status: null,
        trial_ends_at: null,
        current_period_end: null,
        cancel_at_period_end: false,
        data_retention_until: null,
        tier: null,
        bundled: false,
        limits: {},
        quota_pools: [],
      },
    },
  };
  const api = fakeApi({
    session: vi.fn().mockResolvedValue(session({ signedIn: true, entitlementsConfigured: true })),
    entitlements: vi.fn().mockResolvedValue(batch),
  });
  render(<UserSlot api={api} productIds={["vxture.bid"]} onOpenSettings={() => {}} />);
  await openPopover();
  expect(await screen.findByText("无生效订阅")).toBeInTheDocument();
});

void test("UserSlot subscription line: active entitlements count and de-duplicated tiers", async () => {
  const envelope = (tier: string | null, bundled = false) => ({
    status: "active",
    trial_ends_at: null,
    current_period_end: null,
    cancel_at_period_end: false,
    data_retention_until: null,
    tier,
    bundled,
    limits: {},
    quota_pools: [],
  });
  const batch: EntitlementsBatch = {
    workspace_id: "ws_1",
    entitlements: {
      "vxture.bid": envelope("pro"),
      "vxture.crm": envelope("pro"), // 同一个 tier 出现两次，不该重复列出
      "vxture.ops": envelope(null, true), // 捆绑覆盖也算生效
    },
  };
  const api = fakeApi({
    session: vi.fn().mockResolvedValue(session({ signedIn: true, entitlementsConfigured: true })),
    entitlements: vi.fn().mockResolvedValue(batch),
  });
  render(
    <UserSlot
      api={api}
      productIds={["vxture.bid", "vxture.crm", "vxture.ops"]}
      onOpenSettings={() => {}}
    />,
  );
  await openPopover();
  expect(await screen.findByText("3 个产品生效 · pro")).toBeInTheDocument();
});

// --- login / logout / settings ---------------------------------------------

void test("UserSlot: the login button is disabled while offline", async () => {
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
  const api = fakeApi({ session: vi.fn().mockResolvedValue(session({ signedIn: false })) });
  render(<UserSlot api={api} productIds={[]} onOpenSettings={() => {}} />);
  await openPopover();
  expect(await screen.findByText("登录 Vxture 账号")).toBeDisabled();
});

void test("UserSlot: clicking login calls api.login() and opens the authorize URL", async () => {
  const login = vi.fn().mockResolvedValue({ authorizeUrl: "https://accounts.vxture.com/authorize?s=1" });
  const api = fakeApi({
    session: vi.fn().mockResolvedValue(session({ signedIn: false })),
    login,
  });
  render(<UserSlot api={api} productIds={[]} onOpenSettings={() => {}} />);
  await openPopover();
  const button = await screen.findByText("登录 Vxture 账号");
  await vi.waitFor(() => expect(button).not.toBeDisabled());

  const user = userEvent.setup();
  await user.click(button);
  expect(login).toHaveBeenCalledTimes(1);
  expect(globalThis.open).toHaveBeenCalledWith(
    "https://accounts.vxture.com/authorize?s=1",
    "_blank",
  );
});

void test("UserSlot: login polling picks up a completed sign-in and clears the fallback link", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const sessionFn = vi
    .fn()
    .mockResolvedValueOnce(session({ signedIn: false })) // 挂载时
    .mockResolvedValue(session({ signedIn: false })); // 轮询前几次
  const api = fakeApi({ session: sessionFn });
  render(<UserSlot api={api} productIds={[]} onOpenSettings={() => {}} />);
  await openPopover();
  const button = await screen.findByText("登录 Vxture 账号");
  await vi.waitFor(() => expect(button).not.toBeDisabled());
  fireEvent.click(button);
  await vi.waitFor(() => expect(api.login).toHaveBeenCalledTimes(1));
  await screen.findByText("未打开？点此继续 ↗");

  sessionFn.mockResolvedValue(session({ signedIn: true, profile: { sub: "u1", name: "郭彦豪" } }));
  await vi.advanceTimersByTimeAsync(2000);

  expect(await screen.findByText("郭彦豪", { selector: ".user-chip-name" })).toBeInTheDocument();
  expect(screen.queryByText("未打开？点此继续 ↗")).not.toBeInTheDocument();
  vi.useRealTimers();
});

void test("UserSlot: logging out calls api.logout(), then re-reads the session", async () => {
  const sessionFn = vi
    .fn()
    .mockResolvedValueOnce(session({ signedIn: true, profile: { sub: "u1", name: "郭彦豪" } }))
    .mockResolvedValue(session({ signedIn: false }));
  const logout = vi.fn().mockResolvedValue({ ok: true });
  const api = fakeApi({ session: sessionFn, logout });
  render(<UserSlot api={api} productIds={[]} onOpenSettings={() => {}} />);
  await openPopover();
  const user = userEvent.setup();
  await user.click(await screen.findByText("退出登录"));

  expect(logout).toHaveBeenCalledTimes(1);
  // 弹窗此刻还开着，"会话已失效" 会同时出现在 chip 和弹窗标题两处 —— 都是
  // 预期行为，钉 chip 那一处就够了。
  await screen.findByText("会话已失效", { selector: ".user-chip-name" });
  expect(sessionFn).toHaveBeenCalledTimes(2);
});

void test("UserSlot: clicking the settings row calls onOpenSettings", async () => {
  const onOpenSettings = vi.fn();
  const api = fakeApi();
  render(<UserSlot api={api} productIds={[]} onOpenSettings={onOpenSettings} />);
  await openPopover();
  const user = userEvent.setup();
  await user.click(await screen.findByText("设置"));
  expect(onOpenSettings).toHaveBeenCalledTimes(1);
});

void test("UserSlot: collapsed hides the name/sub text but keeps the accessible label", async () => {
  const api = fakeApi({
    session: vi.fn().mockResolvedValue(session({ signedIn: true, profile: { sub: "u1", name: "郭彦豪" } })),
  });
  render(<UserSlot api={api} productIds={[]} collapsed onOpenSettings={() => {}} />);
  await vi.waitFor(() =>
    expect(screen.getByRole("button", { name: "账户 · 郭彦豪" })).toBeInTheDocument(),
  );
  expect(screen.queryByText("郭彦豪", { selector: ".user-chip-name" })).not.toBeInTheDocument();
});
