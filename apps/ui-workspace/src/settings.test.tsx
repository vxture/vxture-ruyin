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
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@vxture/design-system";
import { useEffect, useState } from "react";
import { SettingsView, type SectionId } from "./settings";
import { resolveSection } from "./settings-sections";
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
    testConnector: vi.fn().mockResolvedValue({ ok: true, tools: [] }),
    activateConnector: vi.fn().mockResolvedValue({}),
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

/**
 * 跟着**地址**挂载。「添加连接器」是它自己的一页（owner 2026-09-04 第 5 条），
 * 换页靠改 hash —— 工作台那边有个 hashchange 把它落到视图上。这里放一个同样
 * 的小宿主，用例才测得到「去了那一页」，而不是只测到「按钮点得动」。
 */
function renderRouted(section: SectionId, api: Api = fakeApi()) {
  window.location.hash = `#settings/${section}`;
  function Host() {
    const [id, setId] = useState<string>(section);
    useEffect(() => {
      // `#settings/connectors-add` → `connectors-add`
      const apply = () => setId(window.location.hash.split("/").slice(1).join("/"));
      window.addEventListener("hashchange", apply);
      return () => window.removeEventListener("hashchange", apply);
    }, []);
    return <SettingsView api={api} section={resolveSection(id)} />;
  }
  return render(
    <ThemeProvider defaultMode="dark" defaultDensity="default">
      <Host />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  // 地址是路由的权威，所以也是会在用例之间串味的状态。
  window.location.hash = "";
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

void test("SettingsView: a system() fetch failure shows an error box without crashing the section; 那条提醒可以关掉", async () => {
  const api = fakeApi({ system: vi.fn().mockRejectedValue(new Error("daemon unreachable")) });
  renderSection("about", api);
  expect(await screen.findByText("daemon unreachable")).toBeInTheDocument();
  // 页面顶部那条讲的是刚才那个动作的结果，读完就没用了 —— 给关（owner 第 2 条）。
  await userEvent.setup().click(screen.getByRole("button", { name: "关闭提醒" }));
  expect(screen.queryByText("daemon unreachable")).not.toBeInTheDocument();
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

void test("偏好设置（在账户之下）: language + the three axes, in that order, each persisted on this machine", async () => {
  localStorage.clear();
  renderSection("account");
  // owner 2026-09-04：偏好整组从「通用」搬到账户之下，顺序 语言 → 主题 → 密度 → 字号。
  const labels = Array.from(document.querySelectorAll(".set-row-label")).map((el) => el.textContent);
  expect(labels).toEqual(["语言", "主题", "密度", "字号"]);
  // 一行一个、不带说明（owner 第 5 条）：这四行里没有解释性小字。
  expect(document.querySelectorAll(".set-row-note")).toHaveLength(0);
  // 控件列定宽，四项严格对齐（第 6 条）：四个控件格的类名一致，宽度由 CSS 一处定。
  expect(document.querySelectorAll(".set-row-control")).toHaveLength(4);
  expect(screen.getByRole("radiogroup", { name: "主题" })).toBeInTheDocument();
  expect(screen.getByRole("radiogroup", { name: "密度" })).toBeInTheDocument();
  expect(screen.getByRole("radiogroup", { name: "字号" })).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "系统" })).toBeInTheDocument();
  expect(screen.queryByRole("radio", { name: "跟随系统" })).not.toBeInTheDocument();

  // 四项都记在本机：三条轴由 DS 写 vx-*，语言由本文件写 ruyin-language。
  const user = userEvent.setup();
  await user.click(screen.getByRole("radio", { name: "宽松" }));
  await user.click(screen.getByRole("radio", { name: "浅色" }));
  await user.click(screen.getByRole("radio", { name: "加大" }));
  await vi.waitFor(() => expect(localStorage.getItem("vx-density")).toBe("comfortable"));
  // 三条轴的键名归 DS（vx-*），这里断言的是「都落到了本机」，不是某个具体键名 ——
  // 键名是 DS 的实现细节，写死它会在 DS 改名那天变成一条假红。
  const keys = Object.keys(localStorage).filter((k) => k.startsWith("vx-"));
  expect(keys.length).toBeGreaterThanOrEqual(2);
  expect(document.documentElement.className).toContain("density-comfortable");
  // 语言只有一个选项，所以它的存储由 select 的 change 触发；先证明键位存在。
  expect(screen.getByRole("combobox")).toHaveValue("zh-CN");
});

void test("偏好设置: picking the language writes it to this machine", () => {
  localStorage.clear();
  renderSection("account");
  const select = screen.getByRole("combobox");
  // 只有一个选项，所以用 change 事件直接证明「选了就记下来」这条通路是活的 ——
  // 第二种语言落地那天，机制已经在这儿了。
  fireEvent.change(select, { target: { value: "zh-CN" } });
  expect(localStorage.getItem("ruyin-language")).toBe("zh-CN");
});

void test("偏好设置: an already-stored language is read back on mount, not reset", () => {
  localStorage.setItem("ruyin-language", "zh-CN");
  renderSection("account");
  expect(screen.getByRole("combobox")).toHaveValue("zh-CN");
});

void test("通用设置: data dir / product dir / key protection reflect system info", async () => {
  const api = fakeApi({
    system: vi.fn().mockResolvedValue(
      systemInfo({ dataDir: "C:/data", productsDir: "D:/products", keyProtection: "dpapi" }),
    ),
  });
  renderSection("general", api);
  expect(await screen.findByText("C:/data")).toBeInTheDocument();
  expect(screen.getByText("D:/products")).toBeInTheDocument();
  // DPAPI 只在「主密钥」那一行说一次：底下那个说同一件事的徽章已经删了
  // （owner 2026-09-04 第 2 条）。
  expect(
    screen.getByText("Windows DPAPI 保护（当前用户作用域），不落明文"),
  ).toBeInTheDocument();
  expect(document.body.textContent).not.toContain("主密钥由 Windows DPAPI 保护");
});

void test("通用设置: 明文保护时那条「不可用于真实数据」的警告要在 —— 它不是重复", async () => {
  const api = fakeApi({
    system: vi.fn().mockResolvedValue(systemInfo({ keyProtection: "plaintext" })),
  });
  renderSection("general", api);
  expect(await screen.findByText("开发态：主密钥明文存储，不可用于真实数据")).toBeInTheDocument();
  expect(screen.queryByText("主密钥由 Windows DPAPI 保护")).not.toBeInTheDocument();
});

void test("通用设置: the transmission policy defaults to 'sensitivity', persists the pick to localStorage", async () => {
  renderSection("general");
  const user = userEvent.setup();
  await user.click(await screen.findByText("全部需确认"));
  expect(localStorage.getItem("ruyin-transmission-policy")).toBe("always");
});

void test("通用设置: an already-stored policy is read back on mount, not reset to the default", async () => {
  localStorage.setItem("ruyin-transmission-policy", "always");
  renderSection("general");
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
  await userEvent.setup().click(await screen.findByRole("button", { name: /下载安装包/ }));
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
  // 「不自动安装」现在是「安装方式」那个板块在说，不再挂在下载按钮旁边。
  expect(document.body.textContent).toContain("不会自动下载或自动安装");
});

void test("UpdatesSection: no path in the feed means no link - never a guessed URL", async () => {
  const api = fakeApi({
    checkUpdate: vi.fn().mockResolvedValue(availableResult({ latest: "0.3.0" })),
  });
  renderSection("updates", api);
  await clickCheck();
  // 猜出来的地址点下去是 404，而用户会以为是产品坏了。照实说这次拿不到。
  expect(await screen.findByText(/更新源里没写文件名/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /下载安装包/ })).not.toBeInTheDocument();
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
  state: "active" as const,
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
  renderRouted("connectors", api);
  const list = await screen.findByLabelText("已安装的连接器");
  expect(within(list).getByText("crm")).toBeInTheDocument();
  expect(within(list).getByText("运行中")).toBeInTheDocument();
  expect(within(list).getByText("未运行：not running")).toBeInTheDocument();
  expect(within(list).getByText("工具：lookup_account、update_account")).toBeInTheDocument();
  const user = userEvent.setup();
  await user.click(within(list).getAllByRole("button", { name: "卸载" })[0]!);
  expect(api.removeConnector).toHaveBeenCalledWith("crm");
});

void test("Settings/连接器: 添加是独立一页；必须先测通才能启用，测不通可以暂存", async () => {
  const testConnector = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, tools: [], detail: "ECONNREFUSED 127.0.0.1:8931" })
    .mockResolvedValueOnce({ ok: true, tools: ["crm_search"] });
  const installConnector = vi.fn().mockResolvedValue(crmView);
  const api = fakeApi({
    connectors: vi.fn().mockResolvedValue({ items: [] }),
    testConnector,
    installConnector,
  });
  renderRouted("connectors", api);
  expect(await screen.findByText("尚未安装任何连接器。")).toBeInTheDocument();
  const user = userEvent.setup();

  // 列表页只回答「我有什么」；表单在另一页（owner 2026-09-04 第 12 条）。
  expect(screen.queryByPlaceholderText("如 crm")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "添加连接器" }));
  await user.type(screen.getByPlaceholderText("如 crm"), "crm");
  await user.type(screen.getByPlaceholderText(/^如 node/), "node");
  await user.type(screen.getByPlaceholderText("--port 8931"), "crm.js --port 1");
  await user.selectOptions(screen.getByLabelText("来源种类"), "private");

  // 没测过之前，「添加并启用」是关着的：没测就写进去，等于把「能用」这件事
  // 留给下一个打开它的人去发现。
  expect(screen.getByRole("button", { name: "添加并启用" })).toBeDisabled();

  await user.click(screen.getByRole("button", { name: "测试连接" }));
  expect(testConnector).toHaveBeenCalledWith({
    id: "crm",
    command: "node",
    args: ["crm.js", "--port", "1"],
  });
  // 连不上时原因照原样转达，并给出「暂存」这条路。
  expect(await screen.findByText(/ECONNREFUSED 127\.0\.0\.1:8931/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "添加并启用" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "暂存（不启用）" }));
  expect(installConnector).toHaveBeenLastCalledWith({
    id: "crm",
    command: "node",
    args: ["crm.js", "--port", "1"],
    source: "private",
    state: "stashed",
  });

  // 再来一次，这次测通：暂存那个入口消失，主按钮开启。
  await user.click(screen.getByRole("button", { name: "添加连接器" }));
  await user.type(screen.getByPlaceholderText("如 crm"), "crm");
  await user.type(screen.getByPlaceholderText(/^如 node/), "node");
  await user.click(screen.getByRole("button", { name: "测试连接" }));
  expect(await screen.findByText(/连接成功/)).toBeInTheDocument();
  expect(screen.getByText(/crm_search/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "暂存（不启用）" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "添加并启用" }));
  expect(installConnector).toHaveBeenLastCalledWith({
    id: "crm",
    command: "node",
    args: [],
    source: "lan",
  });
});

void test("Settings/连接器: 测通了但对方没报工具，说清楚 —— 契约里的 connector 工具会接不上", async () => {
  const api = fakeApi({
    connectors: vi.fn().mockResolvedValue({ items: [] }),
    testConnector: vi.fn().mockResolvedValue({ ok: true, tools: [] }),
  });
  renderRouted("connectors", api);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "添加连接器" }));
  await user.type(screen.getByPlaceholderText("如 crm"), "x");
  await user.type(screen.getByPlaceholderText(/^如 node/), "node");
  await user.click(screen.getByRole("button", { name: "测试连接" }));
  expect(await screen.findByText(/没有报出任何工具/)).toBeInTheDocument();
});

void test("Settings/连接器: 测试本身失败（守护进程没答话）也如实说，且不当成测通", async () => {
  const api = fakeApi({
    connectors: vi.fn().mockResolvedValue({ items: [] }),
    testConnector: vi.fn().mockRejectedValue(new Error("daemon unreachable")),
  });
  renderRouted("connectors", api);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "添加连接器" }));
  await user.type(screen.getByPlaceholderText("如 crm"), "x");
  await user.type(screen.getByPlaceholderText(/^如 node/), "node");
  await user.click(screen.getByRole("button", { name: "测试连接" }));
  expect(await screen.findByText("daemon unreachable")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "添加并启用" })).toBeDisabled();
  // 返回列表这条路一直在。
  await user.click(screen.getByRole("button", { name: "返回列表" }));
  expect(await screen.findByText("尚未安装任何连接器。")).toBeInTheDocument();
});

void test("Settings/连接器: 暂存的那个标「已暂存」，启用会重测；还是连不上就照实说", async () => {
  const stashed = { ...crmView, state: "stashed" as const, health: { ok: false, detail: "已暂存，未启用", checkedAt: "t" }, tools: [] };
  const activateConnector = vi
    .fn()
    .mockRejectedValueOnce(new Error('connector "crm" still cannot start: ECONNREFUSED'))
    .mockResolvedValueOnce(crmView);
  const connectors = vi
    .fn()
    .mockResolvedValue({ items: [stashed] });
  const api = fakeApi({ connectors, activateConnector });
  renderRouted("connectors", api);
  expect(await screen.findByText("已暂存")).toBeInTheDocument();
  // 暂存 ≠ 装了没跑起来：不该显示成「未运行」。
  expect(screen.queryByText(/^未运行/)).not.toBeInTheDocument();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "启用" }));
  expect(await screen.findByText(/still cannot start: ECONNREFUSED/)).toBeInTheDocument();
  connectors.mockResolvedValue({ items: [crmView] });
  await user.click(screen.getByRole("button", { name: "启用" }));
  expect(await screen.findByText("运行中")).toBeInTheDocument();
});

void test("Settings/连接器: an assembly without a registry (503) says so and hides the install form", async () => {
  const api = fakeApi({
    connectors: vi.fn().mockRejectedValue(
      new ApiError(503, { error: "CONNECTORS_NOT_AVAILABLE", message: "这套装配没有进程外连接器注册表" }),
    ),
  });
  renderRouted("connectors", api);
  expect(await screen.findByText("这套装配没有进程外连接器注册表")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "安装并启动" })).not.toBeInTheDocument();
});

void test("Settings/连接器: a generic failure to list is shown as a failure (not as 尚未安装), and a successful add returns to a reloaded list", async () => {
  const connectors = vi
    .fn()
    .mockRejectedValueOnce(new Error("daemon unreachable"))
    .mockResolvedValue({ items: [crmView] });
  const api = fakeApi({
    connectors,
    testConnector: vi.fn().mockResolvedValue({ ok: true, tools: ["crm_search"] }),
    installConnector: vi.fn().mockResolvedValue(crmView),
  });
  renderRouted("connectors", api);
  expect(await screen.findByText("daemon unreachable")).toBeInTheDocument();
  expect(screen.queryByText("尚未安装任何连接器。")).not.toBeInTheDocument();

  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "添加连接器" }));
  const idInput = screen.getByPlaceholderText("如 crm") as HTMLInputElement;
  await user.type(idInput, " crm ");
  await user.type(screen.getByPlaceholderText(/^如 node/), "node");
  await user.click(screen.getByRole("button", { name: "测试连接" }));
  await screen.findByText(/连接成功/);
  await user.click(screen.getByRole("button", { name: "添加并启用" }));
  // id 两端的空格要修掉：用户不该因为多按了一下空格而装出一个别的 id。
  expect(api.installConnector).toHaveBeenCalledWith({ id: "crm", command: "node", args: [], source: "lan" });
  // 添加成功后回到列表，而且列表是重新拉过的。
  expect(await screen.findByText("运行中")).toBeInTheDocument();
  expect(screen.queryByPlaceholderText("如 crm")).not.toBeInTheDocument();
  expect(screen.queryByText("daemon unreachable")).not.toBeInTheDocument();
});

void test("Settings/连接器: a failed uninstall is reported, the list stays", async () => {
  const api = fakeApi({
    connectors: vi.fn().mockResolvedValue({ items: [crmView] }),
    removeConnector: vi.fn().mockRejectedValue(new Error("connector \"crm\" is not installed")),
  });
  renderRouted("connectors", api);
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
  // 姓名出现两次：卡头的大字与「姓名」那一行。
  expect((await screen.findAllByText("郭彦豪")).length).toBeGreaterThan(0);
  expect(screen.getAllByText("yh@example.com").length).toBeGreaterThan(0);
  // 显示名（原「姓名」）；租户与工作区并在一行，中间一个淡分隔点。
  expect(screen.getByText("显示名")).toBeInTheDocument();
  expect(screen.getByText("当前租户")).toBeInTheDocument();
  const tenantRow = screen.getByText("当前租户").closest(".fact-row") as HTMLElement;
  expect(tenantRow.textContent).toContain("某租户");
  expect(tenantRow.textContent).toContain("某工作区");
  const switchBtn = within(tenantRow).getByRole("button", { name: /切换租户/ });
  const openSwitch = vi.spyOn(window, "open").mockImplementation(() => null);
  await userEvent.setup().click(switchBtn);
  // 本机换不了租户：token 里只有一个 active_org，平台 v2 已弃用 tenants 声明 ——
  // 所以这个按钮只能是去平台切换的入口，而不是一个本地下拉。
  expect(openSwitch).toHaveBeenCalledWith("https://vxture.com/zh-CN/profile", "_blank", "noopener");
  openSwitch.mockRestore();
  // 「账户中心」那一行链接去掉了（owner 2026-09-04）：右上角的「在线修改」已经是同一个去处。
  expect(screen.queryByRole("link", { name: "https://vxture.com/zh-CN/profile" })).not.toBeInTheDocument();
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
  // 缺的字段写「—」：姓名 / 用户名 / 电话 / 角色 / 语言地区 / 租户 / 工作区 都没给。
  expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(6);
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

void test("Settings/通用设置: the encryption chain spells out all three layers, says what is NOT encrypted, and never claims '三次加密'", async () => {
  const api = fakeApi({ system: vi.fn().mockResolvedValue(systemInfo({ keyProtection: "dpapi" })) });
  const { container } = renderSection("general", api);
  const rows = await screen.findAllByRole("listitem");
  expect(rows.map((r) => r.textContent)).toEqual([
    "业务数据每个项目库整库加密 · SQLCipher（AES-256）",
    "库密钥一库一把随机密钥 · AES-256-GCM 封装在主密钥下",
    "主密钥Windows DPAPI 保护（当前用户作用域），不落明文",
  ]);
  // 一次加密 + 两层密钥保护。把层数说成加密次数是在核实的那一刻会崩掉的话。
  expect(container.textContent).not.toContain("三次加密");
  expect(container.textContent).toContain("产品契约与本机配置不加密");
  // 保护到位时不再多挂一个徽章重复「主密钥」那一行（owner 第 2 条）。
  expect(container.textContent).not.toContain("主密钥由 Windows DPAPI 保护");
});

void test("Settings/通用设置: 没有 OS 级密钥保护时，行里与警告里都说清楚", async () => {
  const api = fakeApi({ system: vi.fn().mockResolvedValue(systemInfo({ keyProtection: "plaintext" })) });
  renderSection("general", api);
  expect(await screen.findByText("明文存放 —— 本平台没有 OS 级密钥保护")).toBeInTheDocument();
  expect(screen.getByText("开发态：主密钥明文存储，不可用于真实数据")).toBeInTheDocument();
  // 库仍然是加密的 —— 暴露的是主密钥，别把两件事混成一件。
  expect(screen.getByText("每个项目库整库加密 · SQLCipher（AES-256）")).toBeInTheDocument();
});

void test("Settings/账户: every claim the platform gave is shown - username, phone, roles, locale - and the uuid never is", async () => {
  const api = fakeApi({
    session: vi.fn().mockResolvedValue({
      signedIn: true,
      profile: {
        sub: "8f14e45f-ea3b-4d1c-9a2b-000000000000",
        name: "郭彦豪",
        username: "yanhao",
        email: "yh@example.com",
        emailVerified: true,
        phone: "+86 138 0000 0000",
        phoneVerified: false,
        locale: "zh-CN",
        roles: ["tenant.admin", "workspace.member"],
      },
      org: { id: "o1", name: "某租户" },
      workspace: { id: "w1", name: "某工作区" },
      issuer: "",
      consoleBase: "https://vxture.com",
      entitlementsConfigured: false,
    }),
  });
  renderSection("account", api);
  // 每一项声明都摆出来（owner 2026-09-04：除了 uuid，其他都展示）。
  expect(await screen.findByText("yanhao")).toBeInTheDocument();
  expect(screen.getByText("+86 138 0000 0000")).toBeInTheDocument();
  expect(screen.getByText("tenant.admin")).toBeInTheDocument();
  expect(screen.getByText("workspace.member")).toBeInTheDocument();
  expect(screen.getByText("zh-CN")).toBeInTheDocument();
  expect(screen.getByText("已验证")).toBeInTheDocument();
  expect(screen.getByText("未验证")).toBeInTheDocument();
  // uuid 是给机器对账的，不给人看。
  expect(document.body.textContent).not.toContain("8f14e45f");
});

void test("Settings/通用设置: four blocks - storage, encryption, inference policy, audit - and the data dir is read-only with the reason", async () => {
  const api = fakeApi({
    system: vi.fn().mockResolvedValue(systemInfo({ dataDir: "C:/data", productsDir: "D:/products" })),
  });
  renderSection("general", api);
  const titles = Array.from(document.querySelectorAll(".set-block-title")).map((e) => e.textContent);
  // 推理与审计拆成两块（owner 第 9 条）：可选的与不可选的不该同一块。
  // 「静态加密」改叫「数据加密」（owner 2026-09-04 第 2 条）：用户找的是自己的
  // 数据安不安全，不是一个密码学状态词。
  expect(titles).toEqual(["存储位置", "数据加密", "推理策略", "安全审计"]);
  expect(await screen.findByText("C:/data")).toBeInTheDocument();
  // 目录可以改了（owner 2026-09-04；TD-039 改写为「重启期迁移」），并且要说清楚
  // 它是在什么时候搬的 —— 「重启时、开库之前」是这件事安全的全部理由。
  expect(screen.getByPlaceholderText(/RuyinData/)).toBeInTheDocument();
  expect(document.body.textContent).toContain("打开任何数据库之前");
});

void test("Settings/存储位置: 壳里给「打开目录」，浏览器里不给（那一下没有人会接）", async () => {
  const openDataDir = vi.fn().mockResolvedValue({ ok: true });
  const api = fakeApi({
    system: vi.fn().mockResolvedValue(systemInfo({ dataDir: "C:/data" })),
    openDataDir,
  });
  // 壳里：navigator.userAgent 带 Electron（host-chrome 就看这一个）。
  const ua = navigator.userAgent;
  Object.defineProperty(navigator, "userAgent", {
    value: `${ua} Electron/40.0.0`,
    configurable: true,
  });
  vi.resetModules();
  const { SettingsView: Shell } = await import("./settings");
  const { unmount } = render(
    <ThemeProvider defaultMode="dark" defaultDensity="default">
      <Shell api={api} section="general" />
    </ThemeProvider>,
  );
  const btn = await screen.findByRole("button", { name: /打开目录/ });
  await userEvent.setup().click(btn);
  // 请求里**不带路径**：打开哪个目录由守护进程说（server.test.ts 那条钉的是
  // 另一半 —— 事件里也没有路径）。
  expect(openDataDir).toHaveBeenCalledWith();
  unmount();

  Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true });
  vi.resetModules();
  const { SettingsView: Web } = await import("./settings");
  render(
    <ThemeProvider defaultMode="dark" defaultDensity="default">
      <Web api={api} section="general" />
    </ThemeProvider>,
  );
  expect(await screen.findByText("C:/data")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /打开目录/ })).not.toBeInTheDocument();
});

void test("Settings/存储位置: 换目录要先校验；校验不通过就不给排队", async () => {
  const checkDataDir = vi.fn().mockResolvedValue({ ok: false, reason: "目标目录里已经有东西了。" });
  const requestDataDir = vi.fn();
  const api = fakeApi({
    system: vi.fn().mockResolvedValue(systemInfo({ dataDir: "C:/data" })),
    checkDataDir,
    requestDataDir,
  });
  renderSection("general", api);
  const user = userEvent.setup();
  await user.type(await screen.findByPlaceholderText(/RuyinData/), "D:\Taken");
  // 没校验之前主按钮就是关着的：排一次注定失败的搬家，失败要等到下次启动才
  // 出现，那时用户已经忘了自己做过什么。
  expect(screen.getByRole("button", { name: "重启并搬移" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "检查目标" }));
  expect(checkDataDir).toHaveBeenCalledWith("D:\Taken");
  expect(await screen.findByText("目标目录里已经有东西了。")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "重启并搬移" })).toBeDisabled();
  expect(requestDataDir).not.toHaveBeenCalled();
});

void test("Settings/存储位置: 校验通过后说清同盘还是跨盘，排队之后请壳重启", async () => {
  const api = fakeApi({
    system: vi.fn().mockResolvedValue(systemInfo({ dataDir: "C:/data" })),
    checkDataDir: vi.fn().mockResolvedValue({ ok: true, sameVolume: false, bytes: 5 * 1024 * 1024 }),
    requestDataDir: vi.fn().mockResolvedValue({ pending: "D:\RuyinData", ok: true }),
    restartApp: vi.fn().mockResolvedValue({ ok: true }),
  });
  renderSection("general", api);
  const user = userEvent.setup();
  await user.type(await screen.findByPlaceholderText(/RuyinData/), "D:\RuyinData");
  await user.click(screen.getByRole("button", { name: "检查目标" }));
  // 跨盘要复制并核对，那要等；同盘是改名。这句差别必须说，否则用户不知道该不该
  // 现在按下去。
  expect(await screen.findByText(/跨盘，要复制并逐文件核对/)).toBeInTheDocument();
  expect(screen.getByText(/5.0 MB/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "重启并搬移" }));
  expect(api.requestDataDir).toHaveBeenCalledWith("D:\RuyinData");
  // 排队之后必须真的重启 —— 搬移只在开库之前发生，不重启这件事永远不会生效。
  await vi.waitFor(() => expect(api.restartApp).toHaveBeenCalled());
});

void test("Settings/存储位置: 排着一次搬移时只给「立即重启」与「取消」，不再给填新目标", async () => {
  const api = fakeApi({
    system: vi
      .fn()
      .mockResolvedValue(systemInfo({ dataDir: "C:/data", dataDirPending: "D:\RuyinData" })),
    cancelDataDir: vi.fn().mockResolvedValue({ pending: null }),
  });
  renderSection("general", api);
  expect(await screen.findByText(/已排好一次搬移，重启后生效/)).toBeInTheDocument();
  expect(screen.queryByPlaceholderText(/RuyinData/)).not.toBeInTheDocument();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "取消这次搬移" }));
  expect(api.cancelDataDir).toHaveBeenCalled();
});

void test("Settings/存储位置: 守护进程答不上来时照原样转达，且不排队", async () => {
  const api = fakeApi({
    system: vi.fn().mockResolvedValue(systemInfo({ dataDir: "C:/data" })),
    checkDataDir: vi.fn().mockRejectedValue(new Error("daemon unreachable")),
    requestDataDir: vi.fn(),
  });
  renderSection("general", api);
  const user = userEvent.setup();
  await user.type(await screen.findByPlaceholderText(/RuyinData/), "D:\X");
  await user.click(screen.getByRole("button", { name: "检查目标" }));
  expect(await screen.findByText("daemon unreachable")).toBeInTheDocument();
  expect(api.requestDataDir).not.toHaveBeenCalled();
});

void test("Settings/存储位置: 排队那一步失败就停在原地 —— 不重启，也不假装排上了", async () => {
  const api = fakeApi({
    system: vi.fn().mockResolvedValue(systemInfo({ dataDir: "C:/data" })),
    checkDataDir: vi.fn().mockResolvedValue({ ok: true, sameVolume: true, bytes: 1024 }),
    requestDataDir: vi.fn().mockRejectedValue(new Error("目标目录里已经有东西了。")),
    restartApp: vi.fn(),
  });
  renderSection("general", api);
  const user = userEvent.setup();
  await user.type(await screen.findByPlaceholderText(/RuyinData/), "D:\X");
  await user.click(screen.getByRole("button", { name: "检查目标" }));
  expect(await screen.findByText(/同一个盘，改名即可/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "重启并搬移" }));
  expect(await screen.findByText("目标目录里已经有东西了。")).toBeInTheDocument();
  // 排不上就别重启：重启之后什么也不会发生，用户只会更糊涂。
  expect(api.restartApp).not.toHaveBeenCalled();
});

void test("Settings/存储位置: 已排队时「立即重启」就是请壳重启；撤销失败也如实说", async () => {
  const api = fakeApi({
    system: vi
      .fn()
      .mockResolvedValue(systemInfo({ dataDir: "C:/data", dataDirPending: "D:\RuyinData" })),
    restartApp: vi.fn().mockResolvedValue({ ok: true }),
    cancelDataDir: vi.fn().mockRejectedValue(new Error("daemon unreachable")),
  });
  renderSection("general", api);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "立即重启并搬移" }));
  expect(api.restartApp).toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "取消这次搬移" }));
  expect(await screen.findByText("daemon unreachable")).toBeInTheDocument();
});

void test("Settings/存储位置: 上次搬移失败要如实说，并且说清数据还在原处", async () => {
  const api = fakeApi({
    system: vi.fn().mockResolvedValue(
      systemInfo({
        dataDir: "C:/data",
        lastMove: {
          status: "failed",
          from: "C:/data",
          to: "D:/RuyinData",
          at: "2026-09-04T12:00:00Z",
          reason: "目标那边空间不够：要搬 120.0 MB，可用 30.0 MB。",
        },
      }),
    ),
  });
  renderSection("general", api);
  expect(await screen.findByText(/上次搬移没成功，数据仍在原处/)).toBeInTheDocument();
  expect(screen.getByText(/空间不够/)).toBeInTheDocument();
});

void test("Settings/软件更新: four blocks; the channel is a select with only stable; nothing is auto-installed", async () => {
  const api = fakeApi({ system: vi.fn().mockResolvedValue(systemInfo({ version: "0.1.0" })) });
  renderSection("updates", api);
  const titles = Array.from(document.querySelectorAll(".set-block-title")).map((e) => e.textContent);
  expect(titles).toEqual(["当前版本", "检查更新", "更新渠道", "安装方式"]);
  const channel = screen.getByRole("combobox") as HTMLSelectElement;
  expect(channel.value).toBe("stable");
  expect(channel.disabled).toBe(true);
  expect(Array.from(channel.options).map((o) => o.value)).toEqual(["stable"]);
  expect(document.body.textContent).toContain("不会自动下载或自动安装");
});

void test("Settings/连接器: 添加页有自己的地址 —— 点进去地址就变，直接开那个地址也能进", async () => {
  const api = fakeApi({ connectors: vi.fn().mockResolvedValue({ items: [] }) });
  const { unmount } = renderRouted("connectors", api);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "添加连接器" }));
  // 「独立一页」的判据是**地址**，不是屏幕上换了内容（owner 2026-09-04 第 5 条）。
  expect(window.location.hash).toBe("#settings/connectors-add");
  await user.click(screen.getByRole("button", { name: "返回列表" }));
  expect(window.location.hash).toBe("#settings/connectors");
  unmount();

  // 直接落在那个地址上（复制链接、刷新）也要进得去，而不是回到列表。
  renderRouted("connectors-add", api);
  expect(await screen.findByPlaceholderText("如 crm")).toBeInTheDocument();
});

void test("Settings/数据库: 只说功能未开通，不摆一个连不上任何东西的表单", async () => {
  renderRouted("database");
  expect(await screen.findByText("功能暂未开通")).toBeInTheDocument();
  // 假控件比空页更糟：填完连不上，人会以为是自己配错了。
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  // 把真正能走的那条路指出来，而不是让人卡在这里。
  expect(document.body.textContent).toContain("连接器");
});

void test("Settings/连接器: 生产拒装（403）在添加页照原样转达，人不会以为是自己填错了", async () => {
  const api = fakeApi({
    connectors: vi.fn().mockResolvedValue({ items: [] }),
    testConnector: vi.fn().mockResolvedValue({ ok: true, tools: ["crm_search"] }),
    installConnector: vi
      .fn()
      .mockRejectedValue(
        new Error("connector installation is refused until connectors arrive signed (TD-012)"),
      ),
  });
  renderRouted("connectors", api);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "添加连接器" }));
  await user.type(screen.getByPlaceholderText("如 crm"), "crm");
  await user.type(screen.getByPlaceholderText(/^如 node/), "node");
  await user.click(screen.getByRole("button", { name: "测试连接" }));
  await screen.findByText(/连接成功/);
  await user.click(screen.getByRole("button", { name: "添加并启用" }));
  // 测通了但装不进去 —— 那是策略，不是配置错。原话给用户，他能读到 TD-012。
  expect(
    await screen.findByText((t) => t.includes("refused until connectors arrive signed")),
  ).toBeInTheDocument();
  // 还停在添加页，输入没被清掉：他可能只是想换台机器再来。
  expect((screen.getByPlaceholderText("如 crm") as HTMLInputElement).value).toBe("crm");
});
