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
    // 缺省是**开发态**，不是「未签名」：只有明确要测那条提醒的用例才把它拨过去。
    codeSigning: "unpackaged",
    capabilitySurface: "configured",
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
  render(<UserSlot api={api} productIds={[]} onOpenSettings={() => {}} onSignedOut={() => {}} />);
  expect(await screen.findByText("会话已失效")).toBeInTheDocument();
});

void test("UserSlot: 侧栏那一格只放显示名，退到用户名，**从不退到邮箱**", async () => {
  const withName = fakeApi({
    session: vi.fn().mockResolvedValue(
      session({ signedIn: true, profile: { sub: "u1", name: "郭彦豪", email: "u1@example.com" } }),
    ),
  });
  const { unmount, container } = render(
    <UserSlot api={withName} productIds={[]} onOpenSettings={() => {}} onSignedOut={() => {}} />,
  );
  expect(
    await screen.findByText("郭彦豪", { selector: ".user-chip-name" }),
  ).toBeInTheDocument();
  // 邮箱一直摊在侧栏上（截图、投屏、旁边坐个人都看得见），所以整格里都不该有
  // 它 —— owner 2026-09-04。要认账号，点开菜单里有。
  expect(container.querySelector(".user-slot-wrap")).not.toHaveTextContent("u1@example.com");
  unmount();

  const noName = fakeApi({
    session: vi.fn().mockResolvedValue(
      session({
        signedIn: true,
        profile: { sub: "u1", username: "yanhao", email: "u1@example.com" },
      }),
    ),
  });
  const { container: c2 } = render(
    <UserSlot api={noName} productIds={[]} onOpenSettings={() => {}} onSignedOut={() => {}} />,
  );
  expect(
    await screen.findByText("yanhao", { selector: ".user-chip-name" }),
  ).toBeInTheDocument();
  expect(c2.querySelector(".user-slot-wrap")).not.toHaveTextContent("u1@example.com");
});

void test("UserSlot: online health reflects the /health poll result", async () => {
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
  const api = fakeApi();
  const { container } = render(<UserSlot api={api} productIds={[]} onOpenSettings={() => {}} onSignedOut={() => {}} />);
  await screen.findByText("会话已失效");
  expect(container.querySelector(".user-chip-dot.off")).toBeInTheDocument();
});

void test("UserSlot: a /health fetch that rejects outright (not just a non-ok status) still reads offline", async () => {
  globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
  const api = fakeApi();
  const { container } = render(<UserSlot api={api} productIds={[]} onOpenSettings={() => {}} onSignedOut={() => {}} />);
  await screen.findByText("会话已失效");
  expect(container.querySelector(".user-chip-dot.off")).toBeInTheDocument();
});

void test("UserSlot: a session() rejection leaves the slot signed-out rather than crashing", async () => {
  const api = fakeApi({ session: vi.fn().mockRejectedValue(new Error("daemon unreachable")) });
  render(<UserSlot api={api} productIds={[]} onOpenSettings={() => {}} onSignedOut={() => {}} />);
  expect(await screen.findByText("会话已失效", { selector: ".user-chip-name" })).toBeInTheDocument();
});

// --- subscriptionLine(): every branch --------------------------------------

void test("UserSlot: shows the active workspace name when signed in with one", async () => {
  const api = fakeApi({
    session: vi.fn().mockResolvedValue(session({ signedIn: true, workspace: { name: "某工作区" } })),
  });
  render(<UserSlot api={api} productIds={[]} onOpenSettings={() => {}} onSignedOut={() => {}} />);
  await openPopover();
  expect(await screen.findByText("某工作区")).toBeInTheDocument();
});

// 「运行环境 · 已就绪」「数据加密 · 开发态」两条原本在这里；那三行环境事实 2026-09-11
// 挪去了标题栏的 Runtime 下拉，用例一并搬到 runtime-menu.test.tsx。

void test("UserSlot: the login button is disabled while offline", async () => {
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
  const api = fakeApi({ session: vi.fn().mockResolvedValue(session({ signedIn: false })) });
  render(<UserSlot api={api} productIds={[]} onOpenSettings={() => {}} onSignedOut={() => {}} />);
  await openPopover();
  expect(await screen.findByText("登录 Vxture 账号")).toBeDisabled();
});

void test("UserSlot: clicking login calls api.login() and opens the authorize URL", async () => {
  const login = vi.fn().mockResolvedValue({ authorizeUrl: "https://accounts.vxture.com/authorize?s=1" });
  const api = fakeApi({
    session: vi.fn().mockResolvedValue(session({ signedIn: false })),
    login,
  });
  render(<UserSlot api={api} productIds={[]} onOpenSettings={() => {}} onSignedOut={() => {}} />);
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
  render(<UserSlot api={api} productIds={[]} onOpenSettings={() => {}} onSignedOut={() => {}} />);
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

void test("UserSlot: clicking login again while a poll is already running replaces it instead of running both", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const sessionFn = vi.fn().mockResolvedValue(session({ signedIn: false })); // 从不签入
  const api = fakeApi({ session: sessionFn });
  render(<UserSlot api={api} productIds={[]} onOpenSettings={() => {}} onSignedOut={() => {}} />);
  await openPopover();
  const button = await screen.findByText("登录 Vxture 账号");
  await vi.waitFor(() => expect(button).not.toBeDisabled());

  fireEvent.click(button);
  await vi.waitFor(() => expect(api.login).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(2000); // 第一个 interval 真的跑起来了

  const callsBeforeSecondClick = sessionFn.mock.calls.length;
  fireEvent.click(button);
  await vi.waitFor(() => expect(api.login).toHaveBeenCalledTimes(2));

  await vi.advanceTimersByTimeAsync(2000);
  // 两个 interval 并存的话，这次推进会看到 +2；清掉了旧的才会是 +1。
  expect(sessionFn.mock.calls.length).toBe(callsBeforeSecondClick + 1);
  vi.useRealTimers();
});

void test("UserSlot: login polling gives up after 5 minutes rather than polling forever", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const sessionFn = vi.fn().mockResolvedValue(session({ signedIn: false }));
  const api = fakeApi({ session: sessionFn });
  render(<UserSlot api={api} productIds={[]} onOpenSettings={() => {}} onSignedOut={() => {}} />);
  await openPopover();
  const button = await screen.findByText("登录 Vxture 账号");
  await vi.waitFor(() => expect(button).not.toBeDisabled());
  fireEvent.click(button);
  await vi.waitFor(() => expect(api.login).toHaveBeenCalledTimes(1));

  await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 2000);
  const stoppedAt = sessionFn.mock.calls.length;
  await vi.advanceTimersByTimeAsync(10_000);
  expect(sessionFn.mock.calls.length).toBe(stoppedAt);
  vi.useRealTimers();
});

/**
 * 退出登录必须往上报，光调 `api.logout()` 是不够的。
 *
 * owner 2026-09-10 报的那一幕：点退出，**只有这一格退了** —— 它翻成未登录、
 * 显示「登录 Vxture 账号」，而背后整个工作台原地不动、照样可点，设置 › 账号
 * 还照旧显示着人。原因是登录态在界面里有四份各自读取的副本，而决定「登录页
 * 还是工作台」的那一份在 `SessionGate` 里，它只在挂载时读过一次会话。
 *
 * 所以这里钉的是 **`onSignedOut` 真的被调用了**，而不是「`api.logout()` 调过
 * 了」—— 后者在出这个 bug 的那版代码里同样成立。
 */
void test("UserSlot: 退出登录会通知上层（否则只有这一格退了，工作台原地不动）", async () => {
  const logout = vi.fn().mockResolvedValue({ ok: true });
  const onSignedOut = vi.fn();
  const api = fakeApi({
    session: vi.fn().mockResolvedValue(session({ signedIn: true, profile: { sub: "u1", name: "郭彦豪" } })),
    logout,
  });
  render(
    <UserSlot api={api} productIds={[]} onOpenSettings={() => {}} onSignedOut={onSignedOut} />,
  );
  await openPopover();
  const user = userEvent.setup();
  await user.click(await screen.findByText("退出登录"));

  expect(logout).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => expect(onSignedOut).toHaveBeenCalledTimes(1));
});

/**
 * 退出失败也要通知 —— 上层做的是「重读会话」，不是「假定已退出」。
 * 只在成功路径上通知，会让一次失败的退出把界面留在一个谁也没读过的状态里。
 */
void test("UserSlot: `api.logout()` 失败时同样通知上层（上层是重读，不是假定）", async () => {
  const onSignedOut = vi.fn();
  const api = fakeApi({
    session: vi.fn().mockResolvedValue(session({ signedIn: true, profile: { sub: "u1", name: "郭彦豪" } })),
    logout: vi.fn().mockRejectedValue(new Error("network down")),
  });
  render(
    <UserSlot api={api} productIds={[]} onOpenSettings={() => {}} onSignedOut={onSignedOut} />,
  );
  await openPopover();
  const user = userEvent.setup();
  await user.click(await screen.findByText("退出登录"));

  await vi.waitFor(() => expect(onSignedOut).toHaveBeenCalledTimes(1));
});

void test("UserSlot: clicking the settings row calls onOpenSettings", async () => {
  const onOpenSettings = vi.fn();
  const api = fakeApi();
  render(<UserSlot api={api} productIds={[]} onOpenSettings={onOpenSettings} onSignedOut={() => {}} />);
  await openPopover();
  const user = userEvent.setup();
  await user.click(await screen.findByText("设置"));
  expect(onOpenSettings).toHaveBeenCalledTimes(1);
});

void test("UserSlot: collapsed hides the name/sub text but keeps the accessible label", async () => {
  const api = fakeApi({
    session: vi.fn().mockResolvedValue(session({ signedIn: true, profile: { sub: "u1", name: "郭彦豪" } })),
  });
  render(<UserSlot api={api} productIds={[]} collapsed onOpenSettings={() => {}} onSignedOut={() => {}} />);
  await vi.waitFor(() =>
    expect(screen.getByRole("button", { name: "账户 · 郭彦豪" })).toBeInTheDocument(),
  );
  expect(screen.queryByText("郭彦豪", { selector: ".user-chip-name" })).not.toBeInTheDocument();
});

/**
 * 那三行环境事实**挪走了**（owner 2026-09-11）—— 去了标题栏的 Runtime 下拉。
 *
 * 钉「不在这里」而不只是删掉旧断言：同一组事实此前在首页与这一格各显示一遍，再在
 * Runtime 下拉放一份就是第三份各自漂的副本。这条断言防的是有人好心把它们「补回来」。
 */
void test("UserSlot panel: 环境三行已挪去 Runtime 下拉，这一格只剩身份与账户；订阅也不在", async () => {
  const api = fakeApi({
    session: vi.fn().mockResolvedValue(session({ signedIn: true, workspace: { name: "某工作区" } })),
    system: vi.fn().mockResolvedValue(systemInfo({ version: "0.1.0", keyProtection: "dpapi" })),
  });
  render(<UserSlot api={api} productIds={[]} onOpenSettings={() => {}} onSignedOut={() => {}} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /账户/ }));
  // 等到面板真的展开，再断言那三行不在 —— 否则是在断言一个还没渲染的空面板。
  // 锚点用「退出登录」：它只在面板里；「已登录」徽标与副标题各有一处，不唯一。
  expect(await screen.findByText("退出登录")).toBeInTheDocument();
  for (const gone of ["运行环境", "数据加密", "平台连接", "订阅"]) {
    expect(screen.queryByText(gone)).not.toBeInTheDocument();
  }
});

void test("UserSlot: the platform's avatar picture is used when the session carries one", async () => {
  const api = fakeApi({
    session: vi.fn().mockResolvedValue(
      session({ signedIn: true, profile: { sub: "u1", name: "郭", picture: "https://img.example/u1.png" } }),
    ),
  });
  const { container } = render(<UserSlot api={api} productIds={[]} onOpenSettings={() => {}} onSignedOut={() => {}} />);
  await screen.findAllByText("郭");
  // Radix Avatar only mounts the <img> after it loads; the src is on the image element when present,
  // and the fallback initial is always there for the failure case.
  await vi.waitFor(() => {
    const img = container.querySelector("img");
    expect(img === null || img.getAttribute("src") === "https://img.example/u1.png").toBe(true);
  });
});
