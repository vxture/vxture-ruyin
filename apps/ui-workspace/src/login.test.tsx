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
  Workbench: () => <div data-testid="workbench-stub">workbench</div>,
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
    session: vi.fn().mockResolvedValue(signedOut()),
    login: vi.fn().mockResolvedValue({ authorizeUrl: "https://accounts.vxture.com/authorize" }),
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
