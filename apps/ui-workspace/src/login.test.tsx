/**
 * SessionGate/LoginScreen/DragStrip (login.tsx). None of these three are
 * exported except SessionGate, so LoginScreen and DragStrip are driven
 * through it - the same way a user actually reaches them.
 *
 * SessionGate's signed-in branch renders <Workbench/>, a ~570-line
 * component with its own API surface tested separately in workbench.test.tsx.
 * Mocked here to a stub so this file is about SessionGate's own
 * loading/signed-out/signed-in branching, not Workbench's internals.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionGate } from "./login";
import { Api, type SessionInfo } from "./api";

let hostChrome: "electron" | "browser" = "browser";

vi.mock("./host-chrome", () => ({
  useHostChrome: () => hostChrome,
}));
vi.mock("./workbench", () => ({
  Workbench: (props: { onSignedOut: () => void }) => (
    <div data-testid="workbench-stub">
      workbench
      <button onClick={() => props.onSignedOut()}>workbench-stub-sign-out</button>
    </div>
  ),
}));

function signedOut(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    signedIn: false,
    issuer: "https://accounts.vxture.com",
    consoleBase: "https://vxture.com",
    entitlementsConfigured: false,
    ...overrides,
  };
}

function signedIn(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    signedIn: true,
    issuer: "https://accounts.vxture.com",
    consoleBase: "https://vxture.com",
    entitlementsConfigured: true,
    profile: { sub: "u1", name: "郭彦豪" },
    ...overrides,
  } as SessionInfo;
}

function fakeApi(overrides: Partial<Api> = {}): Api {
  return {
    // 窗口按钮的颜色同步（chrome-theme.ts）在 SessionGate 挂载时就会上报一次。
    setChromeTheme: vi.fn().mockResolvedValue({ theme: "dark" }),
    session: vi.fn().mockResolvedValue(signedOut()),
    login: vi.fn().mockResolvedValue({ authorizeUrl: "https://accounts.vxture.com/authorize" }),
    endSessionUrl: vi
      .fn()
      .mockResolvedValue({ url: "https://accounts.vxture.com/oidc/end_session?client_id=ruyin" }),
    ...overrides,
  } as unknown as Api;
}

beforeEach(() => {
  hostChrome = "browser";
  vi.stubGlobal("open", vi.fn().mockReturnValue({ opener: null }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

void test("SessionGate: shows a loading splash before the first session() resolves", () => {
  const api = fakeApi({ session: vi.fn((): Promise<SessionInfo> => new Promise(() => {})) }); // never resolves
  render(<SessionGate api={api} />);
  expect(screen.getByText("正在连接运行时…")).toBeInTheDocument();
});

void test("SessionGate: signed out shows the login screen", async () => {
  const api = fakeApi({ session: vi.fn().mockResolvedValue(signedOut()) });
  render(<SessionGate api={api} />);
  expect(await screen.findByText("登录 Vxture 账号")).toBeInTheDocument();
});

/**
 * 登录之前先把状态说出来（owner 2026-09-10 实测之后要的）。
 *
 * 实测过的事实：清空重来一遍 —— 第一次登录**有**验证，退出后第二次**静默直入**。
 * 也就是说 authorize 上那个 `prompt=select_account` 被平台忽略了，账号选择器
 * 在平台补上支持之前不会出现。桌面应用又不该去杀浏览器里的会话（浏览器级、
 * 跨应用），所以界面这一侧能做的只有两件：**说出来**，并**给一条换人的路**。
 *
 * 钉的是那句话真的在屏幕上 —— 一个静默发生、又没人告诉你的登录，比说清楚了
 * 的更糟。
 */
void test("LoginScreen: 说明「会直接用浏览器里那个账号」，并给出换人的路", async () => {
  const api = fakeApi();
  render(<SessionGate api={api} />);
  await screen.findByText("登录 Vxture 账号");

  await screen.findByText(/浏览器中若已登录 Vxture，会直接用那个账号继续/);
  const link = await screen.findByText(/先在浏览器里退出 Vxture/);
  expect(link.closest("a")).toHaveAttribute(
    "href",
    "https://accounts.vxture.com/oidc/end_session?client_id=ruyin",
  );
});

/**
 * 点了「换人」之后要接着告诉他下一步 —— 这一步**不会自动接回来**。
 *
 * 实测 `end_session` 把 `post_logout_redirect_uri` 也忽略了（带回环地址、带乱写
 * 的地址、什么都不带，三种回应逐字相同），所以没有可靠的返回跳。换人只能是
 * 两步，那就得说出第二步是什么，否则用户在浏览器里退完了会站在那儿等它自己
 * 回来。
 */
void test("LoginScreen: 点了换人之后，告诉他退完回来再点登录", async () => {
  const api = fakeApi();
  render(<SessionGate api={api} />);
  const link = await screen.findByText(/先在浏览器里退出 Vxture/);
  expect(screen.queryByText(/回到这里再点一次登录/)).not.toBeInTheDocument();

  const user = userEvent.setup();
  await user.click(link);
  expect(await screen.findByText(/在浏览器里退出之后，回到这里再点一次登录/)).toBeInTheDocument();
});

/**
 * 平台没公布 `end_session_endpoint` 时**不给这个入口** —— 给一个点了没反应的
 * 链接，比没有这个链接更糟。那句状态说明照旧留着：它成立与否跟平台有没有这个
 * 端点无关。
 */
void test("LoginScreen: 平台没公布 end_session 时不给换人入口，但状态说明照留", async () => {
  const api = fakeApi({ endSessionUrl: vi.fn().mockResolvedValue({}) });
  render(<SessionGate api={api} />);
  await screen.findByText(/浏览器中若已登录 Vxture，会直接用那个账号继续/);
  expect(screen.queryByText(/先在浏览器里退出 Vxture/)).not.toBeInTheDocument();
});

/** 取不到就当没有 —— 一次失败的请求不该把登录页打坏。 */
void test("LoginScreen: end-session 地址取不到时安静降级，不影响登录", async () => {
  const api = fakeApi({ endSessionUrl: vi.fn().mockRejectedValue(new Error("daemon says no")) });
  render(<SessionGate api={api} />);
  expect(await screen.findByText("登录 Vxture 账号")).toBeInTheDocument();
  expect(screen.queryByText(/先在浏览器里退出 Vxture/)).not.toBeInTheDocument();
});

void test("SessionGate: a session() rejection is treated as signed-out, not stuck loading or crashed", async () => {
  const api = fakeApi({ session: vi.fn().mockRejectedValue(new Error("daemon says no")) });
  render(<SessionGate api={api} />);
  expect(await screen.findByText("登录 Vxture 账号")).toBeInTheDocument();
});

void test("SessionGate: signed in renders the product (Workbench), not the login screen", async () => {
  const api = fakeApi({ session: vi.fn().mockResolvedValue(signedIn()) });
  render(<SessionGate api={api} />);
  expect(await screen.findByTestId("workbench-stub")).toBeInTheDocument();
  expect(screen.queryByText("登录 Vxture 账号")).not.toBeInTheDocument();
});

/**
 * 退出登录之后必须回到登录页 —— 这一条是 owner 2026-09-10 报的那个 bug 的正面。
 *
 * 当时的样子：点了退出，只有侧栏底部那一格翻成未登录，**工作台原地不动、照样
 * 可点，设置 › 账号还照旧显示着人**。原因就在这里：闸门只在挂载时读过一次会话，
 * 没有任何东西再叫它读第二次。
 *
 * 所以钉两件事：① 闸门确实重读了会话（`session` 被调了第二次）；② 重读之后
 * 换回了登录页 —— 只钉①的话，一个读了却不换页的实现照样能过。
 */
void test("SessionGate: 工作台报出退出后，闸门重读会话并换回登录页", async () => {
  const sessionFn = vi
    .fn()
    .mockResolvedValueOnce(signedIn())
    .mockResolvedValue(signedOut());
  const api = fakeApi({ session: sessionFn });
  render(<SessionGate api={api} />);
  await screen.findByTestId("workbench-stub");

  const user = userEvent.setup();
  await user.click(screen.getByText("workbench-stub-sign-out"));

  expect(await screen.findByText("登录 Vxture 账号")).toBeInTheDocument();
  expect(screen.queryByTestId("workbench-stub")).not.toBeInTheDocument();
  expect(sessionFn).toHaveBeenCalledTimes(2);
});

void test("DragStrip: renders in the Electron chrome, not in a plain browser tab", async () => {
  const api = fakeApi();
  hostChrome = "browser";
  const { container, rerender } = render(<SessionGate api={api} />);
  await screen.findByText("登录 Vxture 账号");
  expect(container.querySelector(".dragstrip")).not.toBeInTheDocument();

  hostChrome = "electron";
  rerender(<SessionGate api={api} />);
  await screen.findByText("登录 Vxture 账号");
  expect(container.querySelector(".dragstrip.titlebar-electron")).toBeInTheDocument();
});

void test("LoginScreen: clicking the button calls api.login(), opens the authorize URL, and shows the fallback link", async () => {
  const login = vi.fn().mockResolvedValue({ authorizeUrl: "https://accounts.vxture.com/authorize?state=abc" });
  const api = fakeApi({ login });
  render(<SessionGate api={api} />);
  const button = await screen.findByText("登录 Vxture 账号");

  const user = userEvent.setup();
  await user.click(button);

  expect(login).toHaveBeenCalledTimes(1);
  expect(globalThis.open).toHaveBeenCalledWith(
    "https://accounts.vxture.com/authorize?state=abc",
    "_blank",
  );
  const fallback = await screen.findByText("未打开？点此继续 ↗");
  expect(fallback).toHaveAttribute("href", "https://accounts.vxture.com/authorize?state=abc");
});

void test("LoginScreen: polls session() after login and moves to the product once signed in", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const session = vi
    .fn()
    .mockResolvedValueOnce(signedOut()) // SessionGate 初次挂载
    .mockResolvedValue(signedOut()); // startLogin 打开浏览器之后，轮询前几次仍未登录
  const api = fakeApi({ session });
  render(<SessionGate api={api} />);
  const button = await screen.findByText("登录 Vxture 账号");
  fireEvent.click(button);
  await vi.waitFor(() => expect(api.login).toHaveBeenCalledTimes(1));

  // 轮询命中登录成功。
  session.mockResolvedValue(signedIn());
  await vi.advanceTimersByTimeAsync(2000);

  expect(await screen.findByTestId("workbench-stub")).toBeInTheDocument();
  vi.useRealTimers();
});

void test("LoginScreen: clicking 登录 again while a poll is already running replaces it instead of running both", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const session = vi.fn().mockResolvedValue(signedOut()); // 从不签入，两次轮询都跑满
  const api = fakeApi({ session });
  render(<SessionGate api={api} />);
  const button = await screen.findByText("登录 Vxture 账号");

  fireEvent.click(button);
  await vi.waitFor(() => expect(api.login).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(2000); // 第一个 interval 真的跑起来了

  const callsBeforeSecondClick = session.mock.calls.length;
  fireEvent.click(button); // 第二次点击：该清掉第一个 interval，不是叠加一个
  await vi.waitFor(() => expect(api.login).toHaveBeenCalledTimes(2));

  await vi.advanceTimersByTimeAsync(2000);
  // 只清了旧的、留了新的：这次推进只该看到一次轮询，不是两次（两个 interval
  // 并存的话，同一笔 2000ms 会各自触发一次 session()，calls 会跳 +2）。
  expect(session.mock.calls.length).toBe(callsBeforeSecondClick + 1);
  vi.useRealTimers();
});

void test("LoginScreen: gives up polling after 5 minutes rather than polling forever", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const session = vi.fn().mockResolvedValue(signedOut()); // 从不签入
  const api = fakeApi({ session });
  render(<SessionGate api={api} />);
  const button = await screen.findByText("登录 Vxture 账号");
  fireEvent.click(button);
  await vi.waitFor(() => expect(api.login).toHaveBeenCalledTimes(1));

  const callsBeforeCutoff = () => session.mock.calls.length;
  await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 2000);
  const stoppedAt = callsBeforeCutoff();

  // 超时之后不该再新起轮询：再往前推，调用次数不该继续涨。
  await vi.advanceTimersByTimeAsync(10_000);
  expect(callsBeforeCutoff()).toBe(stoppedAt);
  vi.useRealTimers();
});

void test("LoginScreen: the two legal links point at the website's /legal/ directory (verified live 2026-09-03; /privacy and /terms are 404)", async () => {
  const api = fakeApi({ session: vi.fn().mockResolvedValue(signedOut()) });
  render(<SessionGate api={api} />);
  const privacy = (await screen.findByRole("link", { name: "隐私政策" })) as HTMLAnchorElement;
  const terms = screen.getByRole("link", { name: "服务条款" }) as HTMLAnchorElement;
  expect(privacy.href).toBe("https://vxture.com/legal/privacy");
  expect(terms.href).toBe("https://vxture.com/legal/terms");
  expect(privacy.target).toBe("_blank");
});
