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
import { LocaleProvider } from "./locale-provider";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionGate } from "./login";
import { Api, type SessionInfo } from "./api";

let hostChrome: "electron" | "browser" = "browser";

vi.mock("./host-chrome", () => ({
  useHostChrome: () => hostChrome,
}));
vi.mock("./workbench", () => ({
  Workbench: (props: { onSignedOut: () => void;onSessionChanged:()=>void }) => (
    <div data-testid="workbench-stub">
      workbench
      <button onClick={() => props.onSignedOut()}>workbench-stub-sign-out</button>
      <button onClick={()=>props.onSessionChanged()}>workbench-stub-scope-change</button>
      <input aria-label="scope-local-state" defaultValue="fresh"/>
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
    ...overrides,
  } as unknown as Api;
}

const limitedLogin = signedOut({desktopLogin:{state:"device_limit",limit:3,devices:[
  {id:"old_pc",name:"Office PC",platform:"win32",lastActiveAt:"2026-11-20T04:00:00Z",current:false},
]}});

test("device limit replaces the login button, explicit release continues the same approved login",async()=>{
  const session=vi.fn().mockResolvedValueOnce(limitedLogin).mockResolvedValue(signedIn());
  const releaseDesktopDevice=vi.fn().mockResolvedValue({ok:true});
  render(<SessionGate api={fakeApi({session,releaseDesktopDevice})}/>);
  await screen.findByText("选择要释放的设备");
  expect(screen.queryByText("登录 Vxture 账号")).not.toBeInTheDocument();expect(releaseDesktopDevice).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("radio",{name:/Office PC/}));fireEvent.click(screen.getByRole("button",{name:"释放并在此登录"}));
  expect(releaseDesktopDevice).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"确认释放并继续"}));
  expect(await screen.findByTestId("workbench-stub")).toBeInTheDocument();expect(releaseDesktopDevice).toHaveBeenCalledExactlyOnceWith("old_pc");
});

test("pending device login can be cancelled without releasing any device",async()=>{
  const logout=vi.fn().mockResolvedValue({ok:true});const session=vi.fn().mockResolvedValueOnce(limitedLogin).mockResolvedValue(signedOut());
  render(<SessionGate api={fakeApi({session,logout})}/>);fireEvent.click(await screen.findByRole("button",{name:"取消登录"}));
  expect(await screen.findByText("登录 Vxture 账号")).toBeInTheDocument();expect(logout).toHaveBeenCalledTimes(1);
});

test("refresh outage preserves an already signed-in workbench",async()=>{
  const session=vi.fn().mockResolvedValueOnce(signedIn()).mockRejectedValue(Error("offline"));
  render(<SessionGate api={fakeApi({session})}/>);await screen.findByTestId("workbench-stub");fireEvent.focus(window);
  await waitFor(()=>expect(session).toHaveBeenCalledTimes(2));expect(screen.getByTestId("workbench-stub")).toBeInTheDocument();
});

test("a committed organization switch remounts scoped views without a signed-out screen",async()=>{
 const session=vi.fn().mockResolvedValueOnce(signedIn({org:{id:"old"},workspace:{id:"w1"}}))
  .mockResolvedValue(signedIn({org:{id:"new"},workspace:{id:"w2"}}));
 render(<SessionGate api={fakeApi({session})}/>);await screen.findByTestId("workbench-stub");
 fireEvent.change(screen.getByLabelText("scope-local-state"),{target:{value:"old scope"}});
 fireEvent.click(screen.getByRole("button",{name:"workbench-stub-scope-change"}));
 await waitFor(()=>expect(screen.getByLabelText("scope-local-state")).toHaveValue("fresh"));
 expect(screen.queryByText("登录 Vxture 账号")).toBeNull();expect(session).toHaveBeenCalledTimes(2);
});

test("failed and expired login states offer a clear retry",async()=>{
  const api=fakeApi({session:vi.fn().mockResolvedValue(signedOut({desktopLogin:{state:"timed_out"}})),login:vi.fn().mockRejectedValue(Error("offline"))});
  render(<SessionGate api={api}/>);expect(await screen.findByRole("alert")).toHaveTextContent("已过期");
  fireEvent.click(screen.getByText("登录 Vxture 账号"));await waitFor(()=>expect(api.login).toHaveBeenCalled());
});

test("device-limit sign-in has no redundant restart action and cancellation errors stay visible",async()=>{
  const api=fakeApi({session:vi.fn().mockResolvedValue(limitedLogin),logout:vi.fn().mockRejectedValue(Error("offline"))});
  render(<SessionGate api={api}/>);fireEvent.click(await screen.findByRole("button",{name:"取消登录"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("登录暂未完成");
  expect(screen.queryByRole("button",{name:"重新发起登录"})).not.toBeInTheDocument();
  expect(api.login).not.toHaveBeenCalled();
});

test("polling stops when the approved desktop login reaches its device limit",async()=>{
  vi.useFakeTimers({shouldAdvanceTime:true});
  try {
    const session=vi.fn().mockResolvedValueOnce(signedOut()).mockResolvedValue(limitedLogin);
    render(<SessionGate api={fakeApi({session})}/>);fireEvent.click(await screen.findByText("登录 Vxture 账号"));
    await vi.advanceTimersByTimeAsync(2100);await screen.findByText("选择要释放的设备");
    const calls=session.mock.calls.length;await vi.advanceTimersByTimeAsync(5000);expect(session).toHaveBeenCalledTimes(calls);
  } finally {vi.useRealTimers();}
});

test("failed host login status displays a retry without exposing provider details",async()=>{
  render(<SessionGate api={fakeApi({session:vi.fn().mockResolvedValue(signedOut({desktopLogin:{state:"failed"}}))})}/>);
  expect(await screen.findByRole("alert")).toHaveTextContent("登录暂未完成");
});

beforeEach(() => {
  hostChrome = "browser";
  vi.stubGlobal("open", vi.fn().mockReturnValue({ opener: null }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('returning from external login refreshes the gate without a second login attempt',async()=>{
 const api=fakeApi({session:vi.fn().mockResolvedValueOnce(signedOut()).mockResolvedValue(signedIn())});
 render(<SessionGate api={api}/>);await screen.findByText('登录 Vxture 账号');
 fireEvent.focus(window);
 expect(await screen.findByTestId('workbench-stub')).toBeTruthy();expect(api.login).not.toHaveBeenCalled();
});

void test("SessionGate: shows a loading splash before the first session() resolves", () => {
  const api = fakeApi({ session: vi.fn((): Promise<SessionInfo> => new Promise(() => {})) }); // never resolves
  render(<SessionGate api={api} />);
  expect(screen.getByText("正在连接运行时…")).toBeInTheDocument();
});

void test("SessionGate: pending deletion shows recovery, then refresh restores the workbench", async () => {
  const session = vi.fn().mockResolvedValueOnce(signedIn({
    accountStatus: "deleting",
    accountsBase: "https://accounts.staging.vxture.com",
  })).mockResolvedValue(signedIn());
  render(<SessionGate api={fakeApi({ session })} />);
  expect(await screen.findByRole("link", { name: "前往账号中心" })).toHaveAttribute(
    "href", "https://accounts.staging.vxture.com/account?section=deletion&vx_locale=zh-CN",
  );
  fireEvent.click(screen.getByRole("button", { name: "刷新账号状态" }));
  await screen.findByTestId("workbench-stub");
});

void test("SessionGate: pending deletion can sign out even when remote logout fails", async () => {
  const session = vi.fn().mockResolvedValueOnce(signedIn({ accountStatus: "deleting" }))
    .mockResolvedValue(signedOut());
  const logout = vi.fn().mockRejectedValue(new Error("remote logout unavailable"));
  render(<SessionGate api={fakeApi({ session, logout })} />);
  fireEvent.click(await screen.findByRole("button", { name: "退出登录" }));
  expect(await screen.findByText("登录 Vxture 账号")).toBeInTheDocument();
  expect(logout).toHaveBeenCalledTimes(1);
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
 * 跨应用），所以界面这一侧只做提示（owner 2026-09-15：只提示，不提供跳转
 * 链接——换账号这一步用户自己在浏览器里做）。
 *
 * 钉的是那句话真的在屏幕上 —— 一个静默发生、又没人告诉你的登录，比说清楚了
 * 的更糟。
 */
void test("LoginScreen: 说清浏览器登录态怎么回事，并给一条真的换人入口", async () => {
  const api = fakeApi();
  render(<SessionGate api={api} />);
  await screen.findByText("登录 Vxture 账号");

  await screen.findByText("浏览器中若已登录，会直接用那个账号继续。");
  // 「换个账号」入口留着但停用（TD-070），提示给的是用户自己做得到的那条路。
  expect(screen.getByRole("button", { name: "换个账号登录" })).toBeDisabled();
  expect(screen.queryByRole("link", { name: /退出/ })).not.toBeInTheDocument();
});

/**
 * 0a 的界面这一端（RY-103 §02）：主按钮**不带** `switchAccount`。
 *
 * 此前无条件带着 `prompt=select_account` 打到平台，才有了「浏览器已登录仍要输
 * 账号密码」（TD-069）。断言的是传给 `api.login` 的参数而不是最终 URL —— URL 由
 * 守护进程拼，那一端由 platform-session 的用例守着；这里守的是界面有没有把用户
 * 的意图说对。
 */
void test("LoginScreen: 主按钮不带 switchAccount", async () => {
  const login = vi.fn().mockResolvedValue({ authorizeUrl: "https://console.vxture.com/auth/login" });
  const api = fakeApi({ login });
  render(<SessionGate api={api} />);
  const user = userEvent.setup();

  await user.click(await screen.findByText("登录 Vxture 账号"));
  expect(login).toHaveBeenNthCalledWith(1, {});
});

/**
 * 「换个账号登录」停用（owner 2026-09-17，TD-070）。
 *
 * 平台 `authorize()` 确实兑现了 `select_account`，但它停放的登录挑战里不带
 * `prompt`，登录页随后调的 `resumeWithExistingSession` 只看浏览器里那份中央
 * 会话就把挑战消费掉、按原用户发码 —— 输了别人的账号、没输验证码，却以自己的
 * 身份登了进去。入口不该承诺它兑现不了的东西，所以停用。
 *
 * 两条断言缺一不可：**按不动**（否则用户仍会撞上那个假登录），以及**提示说的是
 * 用户自己做得到的那条路**（不是一句「暂不可用」——他要的是换账号，那件事今天
 * 仍然做得到，只是得先去浏览器里退出）。
 */
void test("LoginScreen: 「换个账号登录」停用，且提示给出可行的替代做法", async () => {
  const login = vi.fn();
  const api = fakeApi({ login });
  render(<SessionGate api={api} />);
  const user = userEvent.setup();

  const btn = await screen.findByRole("button", { name: "换个账号登录" });
  expect(btn).toBeDisabled();

  await user.click(btn);
  expect(login).not.toHaveBeenCalled();
  expect(globalThis.open).not.toHaveBeenCalled();

  /* 提示挂在外层 span 上 —— 停用的按钮不派发鼠标事件，title 写在它自己身上
     多半不会显示。这条断言就是守那个位置的。 */
  const hint = "先在浏览器里退出登录账号，然后点击登录";
  expect(btn.closest("[title]")).toHaveAttribute("title", hint);
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

/**
 * 一个页面，按钮变文案就够（owner 2026-09-16）：此前点了登录之后会另起一段
 * 「在浏览器中完成登录后自动返回…」提示 + 一条跳转链接，看着像切到了第二套
 * 内容。改成按钮自己从「登录 Vxture 账号」变成「登录验证中…」，其余（标题、
 * login-note）原样不动 —— 没有第二块内容冒出来。
 */
void test("LoginScreen: clicking the button calls api.login(), opens the authorize URL, and the button itself switches to a verifying label - no second content block appears", async () => {
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
  expect(await screen.findByText("登录验证中…")).toBeInTheDocument();
  expect(screen.queryByText("登录 Vxture 账号")).not.toBeInTheDocument();
  // 其余静态文案原样不动。
  expect(screen.getByText("浏览器中若已登录，会直接用那个账号继续。")).toBeInTheDocument();
  // 不再另起一段提示或跳转链接 —— 状态全由按钮自己的文案说完。
  expect(screen.queryByText(/在浏览器中完成登录后自动返回/)).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /点此继续/ })).not.toBeInTheDocument();
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

void test("LoginScreen: gives up polling after 5 minutes rather than polling forever, and the button drops back out of 验证中 so a retry is possible", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const session = vi.fn().mockResolvedValue(signedOut()); // 从不签入
  const api = fakeApi({ session });
  render(<SessionGate api={api} />);
  const button = await screen.findByText("登录 Vxture 账号");
  fireEvent.click(button);
  await vi.waitFor(() => expect(api.login).toHaveBeenCalledTimes(1));
  expect(await screen.findByText("登录验证中…")).toBeInTheDocument();

  const callsBeforeCutoff = () => session.mock.calls.length;
  await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 2000);
  const stoppedAt = callsBeforeCutoff();

  // 超时之后不该再新起轮询：再往前推，调用次数不该继续涨。
  await vi.advanceTimersByTimeAsync(10_000);
  expect(callsBeforeCutoff()).toBe(stoppedAt);
  // 放弃轮询之后按钮得回到能点的状态，不能永远卡在「登录验证中…」。
  expect(await screen.findByText("登录 Vxture 账号")).toBeInTheDocument();
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

/**
 * 语言的入口必须排在**任何门槛前面**（owner 2026-09-17）。
 *
 * 设置页那个开关进不去：要改语言得先登录，而看不懂界面的人正卡在登录页。
 * 这是本地化里一个经典的顺序问题，也是这条用例钉的那件事。
 */
test("登录页有语言入口，且当场生效 —— 改语言不必先登录", async () => {
  localStorage.clear();
  const api = fakeApi({
    session: vi.fn().mockResolvedValue({ signedIn: false, issuer: "", consoleBase: "https://vxture.com", entitlementsConfigured: false }),
  });
  render(
    <LocaleProvider>
      <SessionGate api={api} />
    </LocaleProvider>,
  );
  expect(await screen.findByText("登录 Vxture 账号")).toBeInTheDocument();

  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "语言" }));
  await user.click(await screen.findByRole("menuitem", { name: /English/ }));

  expect(await screen.findByText("Sign in with Vxture")).toBeInTheDocument();
  expect(screen.queryByText("登录 Vxture 账号")).not.toBeInTheDocument();
  expect(localStorage.getItem("ruyin-language")).toBe("en");
});
