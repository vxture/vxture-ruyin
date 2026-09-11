/**
 * 标题栏的 Runtime 下拉（runtime-menu.tsx）。
 *
 * 三行环境事实是 2026-09-11 从用户面板**挪**过来的；原来钉在 user.test.tsx 里的
 * 那几条断言一并搬到这里，**词句一个字不改** —— 它们与首页第一板块逐字一致，
 * 挪了位置不等于可以换说法。
 */

import { afterEach, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RuntimeMenu } from "./runtime-menu";
import type { Api, SessionInfo, SystemInfo } from "./api";

function systemInfo(over: Partial<SystemInfo> = {}): SystemInfo {
  return {
    version: "0.1.0",
    platform: "win32",
    arch: "x64",
    dataDir: "(test)",
    productsDir: "(test)",
    keyProtection: "dpapi",
    codeSigning: "unpackaged",
    capabilitySurface: "configured",
    startedAt: "2026-09-01T00:00:00Z",
    ...over,
  };
}

function signedIn(workspace = "某工作区"): SessionInfo {
  return {
    signedIn: true,
    issuer: "https://accounts.vxture.com",
    consoleBase: "https://vxture.com",
    entitlementsConfigured: true,
    workspace: { name: workspace },
  } as SessionInfo;
}

function fakeApi(system: () => Promise<SystemInfo>): Api {
  return { system: vi.fn(system) } as unknown as Api;
}

async function open(): Promise<void> {
  await userEvent.setup().click(screen.getByRole("button", { name: /运行时/ }));
}

afterEach(() => vi.restoreAllMocks());

/** 徽标保持短：只是版本，详情在下拉里 —— 省出来的地方不该又被一串运行信息占回去。 */
test("RuntimeMenu: 徽标只写 Runtime 与版本；详情要点开才看得到", async () => {
  render(
    <RuntimeMenu
      api={fakeApi(() => Promise.resolve(systemInfo()))}
      health={{ ok: true, version: "0.1.0" }}
      session={signedIn()}
    />,
  );
  expect(screen.getByText("Runtime 0.1.0")).toBeInTheDocument();
  expect(screen.queryByText("运行环境")).not.toBeInTheDocument();
});

/**
 * 三行与首页第一板块**逐字一致**（原 user.test.tsx 的断言，一个字不改）。
 */
test("RuntimeMenu: 三行环境事实与首页逐字一致", async () => {
  render(
    <RuntimeMenu
      api={fakeApi(() => Promise.resolve(systemInfo({ keyProtection: "dpapi" })))}
      health={{ ok: true, version: "0.1.0" }}
      session={signedIn("某工作区")}
    />,
  );
  await open();
  expect(await screen.findByText("运行环境")).toBeInTheDocument();
  expect(screen.getByText("已就绪 · Runtime 0.1.0")).toBeInTheDocument();
  expect(screen.getByText("数据加密")).toBeInTheDocument();
  expect(await screen.findByText("已加密 · SQLCipher")).toBeInTheDocument();
  expect(screen.getByText("平台连接")).toBeInTheDocument();
  expect(screen.getByText("已连接 · 某工作区")).toBeInTheDocument();
});

/** 原 user.test.tsx：非 DPAPI 读作开发态，而不是留空。 */
test("RuntimeMenu: 非 DPAPI 的主密钥保护读作开发态，不是留空", async () => {
  render(
    <RuntimeMenu
      api={fakeApi(() => Promise.resolve(systemInfo({ keyProtection: "plaintext" })))}
      health={{ ok: true, version: "0.1.0" }}
      session={signedIn()}
    />,
  );
  await open();
  expect(await screen.findByText("开发态 · 主密钥明文")).toBeInTheDocument();
});

/**
 * 原 user.test.tsx：系统信息还没回来时，运行环境那行照样说已就绪 —— 它看的是
 * /health，不看系统信息；加密那一行在此之前显示省略号，不猜一个状态出来。
 */
test("RuntimeMenu: 系统信息未到时运行环境照说已就绪，加密那行是省略号", async () => {
  render(
    <RuntimeMenu
      api={fakeApi(() => new Promise<SystemInfo>(() => {}))}
      health={{ ok: true, version: "0.1.0" }}
      session={signedIn()}
    />,
  );
  await open();
  expect(await screen.findByText(/^已就绪/)).toBeInTheDocument();
  expect(screen.getByText("…")).toBeInTheDocument();
});

test("RuntimeMenu: 未登录时平台连接读作未登录", async () => {
  render(
    <RuntimeMenu
      api={fakeApi(() => Promise.resolve(systemInfo()))}
      health={{ ok: true, version: "0.1.0" }}
    />,
  );
  await open();
  expect(await screen.findByText("未登录")).toBeInTheDocument();
});

/**
 * **连不上时点开要能看到它是什么、会怎样。** 此前徽标只是一个红色的「未连接」——
 * 点了没反应，也不告诉用户是该等还是该动手。
 */
test("RuntimeMenu: 连不上时徽标写未连接，点开说清楚会怎样", async () => {
  render(
    <RuntimeMenu
      api={fakeApi(() => Promise.reject(new Error("down")))}
      health={{ ok: false }}
    />,
  );
  // 徽标与下拉里「运行环境」那一行都写「未连接」—— 这里先认徽标。
  expect(screen.getByText("未连接")).toBeInTheDocument();
  await open();
  expect(await screen.findByText(/连不上本机的运行时/)).toBeInTheDocument();
});

/** 连得上的时候不出现那句说明 —— 一直挂着的警告会教人忽略它。 */
test("RuntimeMenu: 连得上时不出现连不上的说明", async () => {
  render(
    <RuntimeMenu
      api={fakeApi(() => Promise.resolve(systemInfo()))}
      health={{ ok: true, version: "0.1.0" }}
      session={signedIn()}
    />,
  );
  await open();
  await screen.findByText("运行环境");
  expect(screen.queryByText(/连不上本机的运行时/)).not.toBeInTheDocument();
});
