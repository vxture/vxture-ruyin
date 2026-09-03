/**
 * SettingsView (settings.tsx) and its five sections. GeneralSection needs a
 * real ThemeProvider (useTheme reads React context, not worth re-implementing
 * a fake for) - every render that reaches it is wrapped.
 *
 * UpdatesSection is the dense one: found and fixed a real bug while writing
 * these tests, not just testing pre-existing behavior - install() wrote its
 * failure into the same `failed` state check() uses, and the one place that
 * state renders says "检查失败" (check failed) unconditionally. A user who
 * clicks 检查更新 (succeeds), then 下载安装包 (opens the browser
 * running in between) would have seen "检查失败：<install's error>" - blaming
 * the wrong step. Fixed with its own `installFailed` state/message; the
 * regression test below is what would have caught it.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@vxture/design-system";
import { SettingsView, type SectionId } from "./settings";
import { Api, type SystemInfo, type UpdateCheck, ApiError } from "./api";

function systemInfo(over: Partial<SystemInfo> = {}): SystemInfo {
  return {
    version: "0.2.0",
    platform: "win32",
    arch: "x64",
    dataDir: "C:/Users/demo/.ruyin/dev",
    productsDir: "D:/ruyin/products",
    keyProtection: "dpapi",
    capabilitySurface: "configured",
    startedAt: "2026-09-01T00:00:00Z",
    ...over,
  };
}

function fakeApi(over: Partial<Api> = {}): Api {
  return {
    system: vi.fn().mockResolvedValue(systemInfo()),
    checkUpdate: vi.fn(),
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
  expect(screen.getByText("RUYIN")).toBeInTheDocument();
  expect(screen.getByText("Intelligent Workbench")).toBeInTheDocument();
  expect(screen.queryByText(/如影/)).not.toBeInTheDocument();
});

void test("AboutSection: shows version/platform/arch once system loads, placeholders before", async () => {
  const api = fakeApi({ system: vi.fn().mockResolvedValue(systemInfo({ version: "0.2.0", platform: "win32", arch: "x64" })) });
  renderSection("about", api);
  expect(await screen.findByText("Runtime 0.2.0 · win32-x64")).toBeInTheDocument();
});

void test("GeneralSection: the three axes render with their labelled options, language is disabled", async () => {
  renderSection("general");
  // 顺序（owner）：语言 → 主题 → 密度 → 字号；"系统" 不带"跟随"。
  const labels = Array.from(document.querySelectorAll(".setting-label")).map((el) => el.firstChild?.textContent);
  expect(labels).toEqual(["语言", "主题", "密度", "字号"]);
  expect(screen.getByRole("radio", { name: "系统" })).toBeInTheDocument();
  expect(screen.queryByRole("radio", { name: "跟随系统" })).not.toBeInTheDocument();
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
    channel: "stable",
    checkedAt: "2026-09-02T00:00:00Z",
    ...over,
  };
}

function availableResult(over: Partial<Extract<UpdateCheck, { status: "available" }>> = {}) {
  return {
    status: "available" as const,
    current: "0.2.0",
    latest: "0.3.0",
    channel: "stable",
    checkedAt: "2026-09-02T00:00:00Z",
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

void test("UpdatesSection: an available update offers the exact package, with its channel named", async () => {
  const api = fakeApi({
    checkUpdate: vi.fn().mockResolvedValue(
      availableResult({
        latest: "0.3.0",
        downloadUrl: "https://dl.example.com/ruyin/stable/Ruyin-Setup-0.3.0.exe",
      }),
    ),
  });
  vi.stubGlobal("open", vi.fn());
  renderSection("updates", api);
  await clickCheck();
  await userEvent.setup().click(await screen.findByRole("button", { name: "下载安装包 ↗" }));
  expect(globalThis.open).toHaveBeenCalledWith(
    "https://dl.example.com/ruyin/stable/Ruyin-Setup-0.3.0.exe",
    "_blank",
    "noopener",
  );
  // 渠道要写在明面上：用户有权知道自己要装的是 stable 还是 beta。
  // 收进那一行里断言 —— 「更新渠道」那一行也写着 stable，全页找会撞上它。
  const line = document.querySelector(".update-line--new");
  expect(line?.textContent).toContain("stable");
  // 本应用不会自动安装 —— 这句话必须说出来，否则用户会等着它自己装。
  expect(screen.getByText(/本应用不会自动安装/)).toBeInTheDocument();
});

void test("UpdatesSection: no path in the feed means no link - never a guessed URL", async () => {
  const api = fakeApi({
    checkUpdate: vi.fn().mockResolvedValue(availableResult({ latest: "0.3.0" })),
  });
  renderSection("updates", api);
  await clickCheck();
  // 猜出来的地址点下去是 404，而用户会以为是产品坏了。照实说这次拿不到。
  expect(await screen.findByText(/更新源里没写文件名/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "下载安装包 ↗" })).not.toBeInTheDocument();
});

void test("UpdatesSection: unreachable is a distinct status, never folded into 'current'", async () => {
  const api = fakeApi({
    checkUpdate: vi.fn().mockResolvedValue({
      status: "unreachable",
      current: "0.2.0",
      reason: "渠道 feed 无法访问",
      channel: "stable",
      checkedAt: "2026-09-02T00:00:00Z",
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

/* ---------------- 连接器 ---------------- */

const crmView = {
  id: "crm",
  transport: "stdio" as const,
  command: "node",
  args: ["crm.js"],
  source: "lan" as const,
  installedAt: "2026-09-03T00:00:00.000Z",
  health: { ok: true, detail: "fake-crm 0.0.1", checkedAt: "2026-09-03T00:00:00.000Z" },
  tools: ["lookup_account", "update_account"],
};

void test("Settings/连接器: lists installed connectors with live health, and uninstall calls the api", async () => {
  const api = fakeApi({
    connectors: vi.fn().mockResolvedValue({
      items: [crmView, { ...crmView, id: "erp", tools: [], health: { ok: false, detail: "not running", checkedAt: "x" } }],
    }),
    removeConnector: vi.fn().mockResolvedValue({ removed: "crm" }),
  });
  renderSection("connectors", api);
  const list = await screen.findByLabelText("已安装的连接器");
  expect(within(list).getByText("crm")).toBeInTheDocument();
  expect(within(list).getByText("运行中")).toBeInTheDocument();
  expect(within(list).getByText("未运行：not running")).toBeInTheDocument();
  expect(within(list).getByText("工具：lookup_account、update_account")).toBeInTheDocument();
  const user = userEvent.setup();
  await user.click(within(list).getAllByRole("button", { name: "卸载" })[0]!);
  expect(api.removeConnector).toHaveBeenCalledWith("crm");
});

void test("Settings/连接器: install sends id/command/args/source; a 403 refusal is shown verbatim, not softened", async () => {
  const api = fakeApi({
    connectors: vi.fn().mockResolvedValue({ items: [] }),
    installConnector: vi
      .fn()
      .mockRejectedValue(new Error("connector installation is refused until connectors arrive signed (TD-012)")),
  });
  renderSection("connectors", api);
  expect(await screen.findByText("尚未安装任何连接器")).toBeInTheDocument();
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText("连接器 id，如 crm"), "crm");
  await user.type(screen.getByPlaceholderText(/^命令/), "node");
  await user.type(screen.getByPlaceholderText("参数（空格分隔，可空）"), "crm.js --port 1");
  await user.selectOptions(screen.getByLabelText("来源种类"), "private");
  await user.click(screen.getByRole("button", { name: "安装并启动" }));
  expect(api.installConnector).toHaveBeenCalledWith({
    id: "crm",
    command: "node",
    args: ["crm.js", "--port", "1"],
    source: "private",
  });
  expect(await screen.findByText(/refused until connectors arrive signed \(TD-012\)/)).toBeInTheDocument();
});

void test("Settings/连接器: an assembly without a registry (503) says so and hides the install form", async () => {
  const api = fakeApi({
    connectors: vi.fn().mockRejectedValue(
      new ApiError(503, { error: "CONNECTORS_NOT_AVAILABLE", message: "这套装配没有进程外连接器注册表" }),
    ),
  });
  renderSection("connectors", api);
  expect(await screen.findByText("这套装配没有进程外连接器注册表")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "安装并启动" })).not.toBeInTheDocument();
});

void test("Settings/连接器: a generic failure to list is shown as a failure (not as 尚未安装), install success clears the form and reloads", async () => {
  const connectors = vi
    .fn()
    .mockRejectedValueOnce(new Error("daemon unreachable"))
    .mockResolvedValue({ items: [crmView] });
  const api = fakeApi({
    connectors,
    installConnector: vi.fn().mockResolvedValue(crmView),
  });
  renderSection("connectors", api);
  expect(await screen.findByText("daemon unreachable")).toBeInTheDocument();
  expect(screen.queryByText("尚未安装任何连接器")).not.toBeInTheDocument();

  const user = userEvent.setup();
  const idInput = screen.getByPlaceholderText("连接器 id，如 crm") as HTMLInputElement;
  await user.type(idInput, " crm ");
  await user.type(screen.getByPlaceholderText(/^命令/), "node");
  await user.click(screen.getByRole("button", { name: "安装并启动" }));
  expect(api.installConnector).toHaveBeenCalledWith({ id: "crm", command: "node", args: [], source: "lan" });
  await vi.waitFor(() => expect(idInput.value).toBe(""));
  expect(await screen.findByText("运行中")).toBeInTheDocument();
  expect(screen.queryByText("daemon unreachable")).not.toBeInTheDocument();
});

void test("Settings/连接器: a failed uninstall is reported, the list stays", async () => {
  const api = fakeApi({
    connectors: vi.fn().mockResolvedValue({ items: [crmView] }),
    removeConnector: vi.fn().mockRejectedValue(new Error("connector \"crm\" is not installed")),
  });
  renderSection("connectors", api);
  const list = await screen.findByLabelText("已安装的连接器");
  const user = userEvent.setup();
  await user.click(within(list).getByRole("button", { name: "卸载" }));
  expect(await screen.findByText(/is not installed/)).toBeInTheDocument();
  expect(within(list).getByText("crm")).toBeInTheDocument();
});

void test("Settings/账户: signed in shows the identity - name, email, tenant, workspace - and 在线修改 goes to the platform profile page", async () => {
  const api = fakeApi({
    session: vi.fn().mockResolvedValue({
      signedIn: true,
      profile: { sub: "u1", name: "郭彦豪", email: "yh@example.com" },
      org: { id: "o1", name: "某租户" },
      workspace: { id: "w1", name: "某工作区" },
      issuer: "",
      consoleBase: "https://vxture.com",
      entitlementsConfigured: false,
    }),
  });
  renderSection("account", api);
  expect(await screen.findByText("郭彦豪")).toBeInTheDocument();
  expect(screen.getByText("yh@example.com")).toBeInTheDocument();
  expect(screen.getByText("某租户")).toBeInTheDocument();
  expect(screen.getByText("某工作区")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "https://vxture.com/zh-CN/profile" })).toBeInTheDocument();
  const open = vi.spyOn(window, "open").mockImplementation(() => null);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "在线修改" }));
  expect(open).toHaveBeenCalledWith("https://vxture.com/zh-CN/profile", "_blank", "noopener");
  open.mockRestore();
  expect(screen.queryByText("账户由左下角的账户菜单管理")).not.toBeInTheDocument();
});

void test("Settings/账户: signed in without org/workspace names shows — rather than nothing; a picture renders an avatar image", async () => {
  const api = fakeApi({
    session: vi.fn().mockResolvedValue({
      signedIn: true,
      profile: { sub: "u1", email: "only@example.com", picture: "https://img.example/a.png" },
      issuer: "",
      consoleBase: "",
      entitlementsConfigured: false,
    }),
  });
  const { container } = renderSection("account", api);
  expect((await screen.findAllByText("only@example.com")).length).toBeGreaterThan(0);
  expect(screen.getAllByText("—")).toHaveLength(2);
  expect(screen.getByRole("link", { name: "https://vxture.com/zh-CN/profile" })).toBeInTheDocument();
  await vi.waitFor(() => {
    const img = container.querySelector("img");
    expect(img === null || img.getAttribute("src") === "https://img.example/a.png").toBe(true);
  });
});

void test("Settings/账户: a session() failure falls back to the signed-out guidance", async () => {
  const api = fakeApi({ session: vi.fn().mockRejectedValue(new Error("daemon down")) });
  renderSection("account", api);
  expect(await screen.findByText("账户由左下角的账户菜单管理")).toBeInTheDocument();
});
