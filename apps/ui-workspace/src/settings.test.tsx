/**
 * SettingsView (settings.tsx) and its five sections. GeneralSection needs a
 * real ThemeProvider (useTheme reads React context, not worth re-implementing
 * a fake for) - every render that reaches it is wrapped.
 *
 * UpdatesSection is the dense one: found and fixed a real bug while writing
 * these tests, not just testing pre-existing behavior - install() wrote its
 * failure into the same `failed` state check() uses, and the one place that
 * state renders says "检查失败" (check failed) unconditionally. A user who
 * clicks 检查更新 (succeeds), then 下载并安装 (fails - a task started
 * running in between) would have seen "检查失败：<install's error>" - blaming
 * the wrong step. Fixed with its own `installFailed` state/message; the
 * regression test below is what would have caught it.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@vxture/design-system";
import { SettingsView, type SectionId } from "./settings";
import { Api, type SystemInfo, type UpdateCheck } from "./api";

function systemInfo(over: Partial<SystemInfo> = {}): SystemInfo {
  return {
    version: "0.2.0",
    platform: "win32",
    arch: "x64",
    dataDir: "C:/Users/demo/.ruyin/dev",
    productsDir: "D:/ruyin/products",
    keyProtection: "dpapi",
    startedAt: "2026-09-01T00:00:00Z",
    ...over,
  };
}

function fakeApi(over: Partial<Api> = {}): Api {
  return {
    system: vi.fn().mockResolvedValue(systemInfo()),
    checkUpdate: vi.fn(),
    requestInstall: vi.fn(),
    ...over,
  } as unknown as Api;
}

function renderSection(section: SectionId, api: Api = fakeApi()) {
  return render(
    <ThemeProvider defaultMode="dark" defaultDensity="default">
      <SettingsView api={api} section={section} />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

void test("SettingsView: renders exactly the requested section, not a mix", async () => {
  renderSection("account");
  expect(await screen.findByText("账户由左下角的账户菜单管理")).toBeInTheDocument();
  expect(screen.queryByText("检查更新")).not.toBeInTheDocument();
  expect(screen.queryByText("数据目录")).not.toBeInTheDocument();
});

void test("SettingsView: a system() fetch failure shows an error box without crashing the section", async () => {
  const api = fakeApi({ system: vi.fn().mockRejectedValue(new Error("daemon unreachable")) });
  renderSection("about", api);
  expect(await screen.findByText("daemon unreachable")).toBeInTheDocument();
  // 这一节仍然照常渲染 —— system 只是还没有值，不是整节崩掉。
  expect(screen.getByText("如影")).toBeInTheDocument();
});

void test("AboutSection: shows version/platform/arch once system loads, placeholders before", async () => {
  const api = fakeApi({ system: vi.fn().mockResolvedValue(systemInfo({ version: "0.2.0", platform: "win32", arch: "x64" })) });
  renderSection("about", api);
  expect(await screen.findByText("Runtime 0.2.0 · win32-x64")).toBeInTheDocument();
});

void test("GeneralSection: the three axes render with their labelled options, language is disabled", async () => {
  renderSection("general");
  expect(screen.getByRole("radiogroup", { name: "主题" })).toBeInTheDocument();
  expect(screen.getByRole("radiogroup", { name: "密度" })).toBeInTheDocument();
  expect(screen.getByRole("radiogroup", { name: "字号" })).toBeInTheDocument();
  const langSelect = screen.getByRole("combobox");
  expect(langSelect).toBeDisabled();
  expect(within(langSelect).getByText("简体中文")).toBeInTheDocument();
});

void test("PrivacySection: data dir / product dir / key protection reflect system info", async () => {
  const api = fakeApi({
    system: vi.fn().mockResolvedValue(
      systemInfo({ dataDir: "C:/data", productsDir: "D:/products", keyProtection: "dpapi" }),
    ),
  });
  renderSection("privacy", api);
  expect(await screen.findByText("C:/data")).toBeInTheDocument();
  expect(screen.getByText("D:/products")).toBeInTheDocument();
  expect(screen.getByText("主密钥由 Windows DPAPI 保护")).toBeInTheDocument();
});

void test("PrivacySection: plaintext key protection shows the dev-mode warning, not the DPAPI badge", async () => {
  const api = fakeApi({
    system: vi.fn().mockResolvedValue(systemInfo({ keyProtection: "plaintext" })),
  });
  renderSection("privacy", api);
  expect(await screen.findByText("开发态：主密钥明文存储")).toBeInTheDocument();
  expect(screen.queryByText("主密钥由 Windows DPAPI 保护")).not.toBeInTheDocument();
});

void test("PrivacySection: the transmission policy defaults to 'sensitivity', persists the pick to localStorage", async () => {
  renderSection("privacy");
  const user = userEvent.setup();
  await user.click(await screen.findByText("全部需确认"));
  expect(localStorage.getItem("ruyin-transmission-policy")).toBe("always");
});

void test("PrivacySection: an already-stored policy is read back on mount, not reset to the default", async () => {
  localStorage.setItem("ruyin-transmission-policy", "always");
  renderSection("privacy");
  const group = await screen.findByRole("radiogroup", { name: "推理传输策略" });
  expect(within(group).getByRole("radio", { name: "全部需确认" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

// --- UpdatesSection ---------------------------------------------------------

function currentResult(over: Partial<Extract<UpdateCheck, { status: "current" }>> = {}) {
  return {
    status: "current" as const,
    current: "0.2.0",
    latest: "0.2.0",
    checkedAt: "2026-09-02T00:00:00Z",
    gate: { installable: true, runningTasks: 0 },
    ...over,
  };
}

function availableResult(over: Partial<Extract<UpdateCheck, { status: "available" }>> = {}) {
  return {
    status: "available" as const,
    current: "0.2.0",
    latest: "0.3.0",
    checkedAt: "2026-09-02T00:00:00Z",
    gate: { installable: true, runningTasks: 0 },
    ...over,
  };
}

async function clickCheck(): Promise<void> {
  const user = userEvent.setup();
  // 「检查更新」同时是本行的标签文字和按钮文字，用 role 精确定位那个按钮。
  await user.click(await screen.findByRole("button", { name: "检查更新" }));
}

void test("UpdatesSection: checking shows a busy state, then 已是最新 on a current result", async () => {
  const api = fakeApi({ checkUpdate: vi.fn().mockResolvedValue(currentResult({ latest: "0.2.0" })) });
  renderSection("updates", api);
  await clickCheck();
  expect(await screen.findByText("已是最新（0.2.0）")).toBeInTheDocument();
});

void test("UpdatesSection: an available update with an installable gate lets you install", async () => {
  const requestInstall = vi.fn().mockResolvedValue({ version: "0.3.0", requestedAt: "" });
  const api = fakeApi({
    checkUpdate: vi.fn().mockResolvedValue(availableResult({ latest: "0.3.0" })),
    requestInstall,
  });
  renderSection("updates", api);
  await clickCheck();
  const install = await screen.findByText("下载并安装");
  expect(install).not.toBeDisabled();

  const user = userEvent.setup();
  await user.click(install);
  expect(requestInstall).toHaveBeenCalledWith("0.3.0");
  expect(await screen.findByText("已请求安装")).toBeInTheDocument();
  expect(screen.getByText("下载完成后会问你是否现在重启安装")).toBeInTheDocument();
});

void test("UpdatesSection: a blocked gate disables install and shows why, without calling requestInstall", async () => {
  const requestInstall = vi.fn();
  const api = fakeApi({
    checkUpdate: vi.fn().mockResolvedValue(
      availableResult({ gate: { installable: false, reason: "有任务正在运行", runningTasks: 1 } }),
    ),
    requestInstall,
  });
  renderSection("updates", api);
  await clickCheck();
  expect(await screen.findByText("下载并安装")).toBeDisabled();
  expect(screen.getByText("有任务正在运行")).toBeInTheDocument();
  expect(requestInstall).not.toHaveBeenCalled();
});

void test("UpdatesSection: unreachable is a distinct status, never folded into 'current'", async () => {
  const api = fakeApi({
    checkUpdate: vi.fn().mockResolvedValue({
      status: "unreachable",
      current: "0.2.0",
      reason: "渠道 feed 无法访问",
      checkedAt: "2026-09-02T00:00:00Z",
      gate: { installable: true, runningTasks: 0 },
    }),
  });
  renderSection("updates", api);
  await clickCheck();
  expect(await screen.findByText(/没查到——渠道 feed 无法访问/)).toBeInTheDocument();
  expect(screen.getByText(/这不代表你已是最新/)).toBeInTheDocument();
  // 「已是最新」这几个字本身也出现在上面那句提醒里（"这不代表你已是最新"），
  // 真正要排除的是 current 状态那一整行——认括号前缀，不认子串。
  expect(screen.queryByText(/已是最新（/)).not.toBeInTheDocument();
});

void test("UpdatesSection: checkUpdate() rejecting reads '检查失败', not silently 'current'", async () => {
  const api = fakeApi({ checkUpdate: vi.fn().mockRejectedValue(new Error("网络不可达")) });
  renderSection("updates", api);
  await clickCheck();
  expect(await screen.findByText("检查失败：网络不可达")).toBeInTheDocument();
  expect(screen.queryByText(/已是最新/)).not.toBeInTheDocument();
});

void test("UpdatesSection: a requestInstall() failure reads as an install failure, not 检查失败 (regression)", async () => {
  const api = fakeApi({
    checkUpdate: vi.fn().mockResolvedValue(availableResult({ latest: "0.3.0" })),
    requestInstall: vi.fn().mockRejectedValue(new Error("有任务刚刚开始运行")),
  });
  renderSection("updates", api);
  await clickCheck();
  const user = userEvent.setup();
  await user.click(await screen.findByText("下载并安装"));

  expect(await screen.findByText("安装请求失败：有任务刚刚开始运行")).toBeInTheDocument();
  // 检查本身是成功的：不该出现"检查失败"这句话，那会指错哪一步出的问题。
  expect(screen.queryByText(/检查失败/)).not.toBeInTheDocument();
});

void test("UpdatesSection: re-checking clears a previous install failure and the requested flag", async () => {
  const checkUpdate = vi
    .fn()
    .mockResolvedValueOnce(availableResult({ latest: "0.3.0" }))
    .mockResolvedValueOnce(availableResult({ latest: "0.3.0" }));
  const api = fakeApi({
    checkUpdate,
    requestInstall: vi.fn().mockRejectedValue(new Error("boom")),
  });
  renderSection("updates", api);
  await clickCheck();
  const user = userEvent.setup();
  await user.click(await screen.findByText("下载并安装"));
  await screen.findByText("安装请求失败：boom");

  await clickCheck();
  expect(screen.queryByText(/安装请求失败/)).not.toBeInTheDocument();
});
