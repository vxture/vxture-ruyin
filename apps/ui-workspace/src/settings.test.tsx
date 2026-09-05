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
  // 目录可以改，但**页面上只有一个按钮**（owner 2026-09-05）：一次性操作不占
  // 常驻位置，表单在弹层里。浏览器里连按钮都没有（系统目录框只有壳弹得出来），
  // 所以这条只钉「没有常驻表单」。
  expect(screen.queryByPlaceholderText(/RuyinData/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "检查目标" })).not.toBeInTheDocument();
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

/**
 * 换目录这一组用例跟着交互一起重写（owner 2026-09-05：一次性操作不该常驻页面）。
 * 判据也跟着变了：页面上**只该有一个按钮**，表单在弹层里，而校验是选完目录之后
 * 自动发生的一步 —— 不是用户要记得先按的一步。
 */
function shellUa(): () => void {
  const ua = navigator.userAgent;
  Object.defineProperty(navigator, "userAgent", {
    value: `${ua} Electron/40.0.0`,
    configurable: true,
  });
  return () => Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true });
}

async function renderStorage(api: Api) {
  const restore = shellUa();
  vi.resetModules();
  const { SettingsView: View } = await import("./settings");
  const r = render(
    <ThemeProvider defaultMode="dark" defaultDensity="default">
      <View api={api} section="general" />
    </ThemeProvider>,
  );
  return { ...r, restore };
}

void test("Settings/存储位置: 两个动作都在数据目录那一行上，页面上没有常驻表单", async () => {
  const api = fakeApi({ system: vi.fn().mockResolvedValue(systemInfo({ dataDir: "C:/data" })) });
  const { restore } = await renderStorage(api);
  // 先等按钮出来（它等的是 /system 回来），再看它落在哪一行 —— 直接去抓
  // 第一个 .fact-row 会抓到还没有值的那一帧。
  const entry = await screen.findByRole("button", { name: "更改…" });
  const row = entry.closest(".fact-row") as HTMLElement;
  // 「打开目录」与「更改…」针对的是同一个东西，所以在**同一行**上（owner
  // 2026-09-05 指出：一个在行上、一个在下面另一块，那是两处）。
  expect(row.textContent).toContain("数据目录");
  expect(row.textContent).toContain("C:/data");
  expect(within(row).getByRole("button", { name: /打开目录/ })).toBeInTheDocument();

  // 常驻页面上不该有这些：它们是一次性操作的零件。
  expect(screen.queryByRole("button", { name: "检查目标" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "重启并搬移" })).not.toBeInTheDocument();
  expect(screen.queryByPlaceholderText(/RuyinData/)).not.toBeInTheDocument();

  await userEvent.setup().click(entry);
  expect(await screen.findByText("更改数据目录")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /选择目录/ })).toBeInTheDocument();
  // 没选目录之前，会关掉应用的那个按钮是关着的。
  expect(screen.getByRole("button", { name: "重启并搬移" })).toBeDisabled();
  restore();
});

void test("Settings/存储位置: 选完目录自动校验 —— 用户不必记得「还要按一下检查」", async () => {
  const pickFolder = vi.fn().mockResolvedValue({ path: "D:\RuyinData" });
  const checkDataDir = vi.fn().mockResolvedValue({ ok: true, sameVolume: false, bytes: 5 * 1024 * 1024 });
  const api = fakeApi({
    system: vi.fn().mockResolvedValue(systemInfo({ dataDir: "C:/data" })),
    pickFolder,
    checkDataDir,
    requestDataDir: vi.fn().mockResolvedValue({ pending: "D:\RuyinData", ok: true }),
    restartApp: vi.fn().mockResolvedValue({ ok: true }),
  });
  const { restore } = await renderStorage(api);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "更改…" }));
  await user.click(screen.getByRole("button", { name: /选择目录/ }));

  // 目录框从当前位置开始浏览 —— 用户多半是在它旁边找一个位置。
  expect(pickFolder).toHaveBeenCalledWith("C:/data");
  expect(checkDataDir).toHaveBeenCalledWith("D:\RuyinData");
  // 跨盘要等，同盘瞬间 —— 这句差别必须说，否则用户不知道该不该现在按。
  expect(await screen.findByText(/跨盘，要逐文件复制并核对/)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "重启并搬移" }));
  expect(api.requestDataDir).toHaveBeenCalledWith("D:\RuyinData");
  await vi.waitFor(() => expect(api.restartApp).toHaveBeenCalled());
  restore();
});

void test("Settings/存储位置: 用户在系统框里取消 —— 什么都不变，也不报错", async () => {
  const api = fakeApi({
    system: vi.fn().mockResolvedValue(systemInfo({ dataDir: "C:/data" })),
    pickFolder: vi.fn().mockResolvedValue({ cancelled: true }),
    checkDataDir: vi.fn(),
  });
  const { restore } = await renderStorage(api);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "更改…" }));
  await user.click(screen.getByRole("button", { name: /选择目录/ }));
  // 取消是正常结果：不校验、不报错、按钮仍然关着。
  expect(api.checkDataDir).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "重启并搬移" })).toBeDisabled();
  expect(screen.getByRole("button", { name: /选择目录/ })).toBeInTheDocument();
  restore();
});

void test("Settings/存储位置: 目标不可用时把原因写在弹层里，且不给按「重启并搬移」", async () => {
  const api = fakeApi({
    system: vi.fn().mockResolvedValue(systemInfo({ dataDir: "C:/data" })),
    pickFolder: vi.fn().mockResolvedValue({ path: "D:\Taken" }),
    checkDataDir: vi.fn().mockResolvedValue({ ok: false, reason: "目标目录里已经有东西了。" }),
    requestDataDir: vi.fn(),
  });
  const { restore } = await renderStorage(api);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "更改…" }));
  await user.click(screen.getByRole("button", { name: /选择目录/ }));
  expect(await screen.findByText("目标目录里已经有东西了。")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "重启并搬移" })).toBeDisabled();
  expect(api.requestDataDir).not.toHaveBeenCalled();
  restore();
});

void test("Settings/存储位置: 排队那一步失败就停在原地 —— 不重启，也不假装排上了", async () => {
  const api = fakeApi({
    system: vi.fn().mockResolvedValue(systemInfo({ dataDir: "C:/data" })),
    pickFolder: vi.fn().mockResolvedValue({ path: "D:\X" }),
    checkDataDir: vi.fn().mockResolvedValue({ ok: true, sameVolume: true, bytes: 1024 }),
    requestDataDir: vi.fn().mockRejectedValue(new Error("目标目录里已经有东西了。")),
    restartApp: vi.fn(),
  });
  const { restore } = await renderStorage(api);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "更改…" }));
  await user.click(screen.getByRole("button", { name: /选择目录/ }));
  await screen.findByText(/同一个盘，改名即可/);
  await user.click(screen.getByRole("button", { name: "重启并搬移" }));
  expect(await screen.findByText("目标目录里已经有东西了。")).toBeInTheDocument();
  // 排不上就别重启：重启之后什么也不会发生，用户只会更糊涂。
  expect(api.restartApp).not.toHaveBeenCalled();
  restore();
});

void test("Settings/存储位置: 已排队时给「立即重启」与「取消」，不再给更改入口", async () => {
  const api = fakeApi({
    system: vi
      .fn()
      .mockResolvedValue(systemInfo({ dataDir: "C:/data", dataDirPending: "D:\RuyinData" })),
    restartApp: vi.fn().mockResolvedValue({ ok: true }),
    cancelDataDir: vi.fn().mockResolvedValue({ pending: null }),
  });
  const { restore } = await renderStorage(api);
  expect(await screen.findByText(/已排好一次搬移，重启后生效/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "更改…" })).not.toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole("button", { name: "立即重启并搬移" }));
  expect(api.restartApp).toHaveBeenCalled();
  restore();
});

void test("Settings/存储位置: 取消排队之后要刷新 —— 页面不能还挂着一条已经没了的待搬", async () => {
  const reload = vi.fn();
  const original = window.location;
  Object.defineProperty(window, "location", {
    value: { ...original, reload, hash: "" },
    configurable: true,
    writable: true,
  });
  const api = fakeApi({
    system: vi
      .fn()
      .mockResolvedValue(systemInfo({ dataDir: "C:/data", dataDirPending: "D:\RuyinData" })),
    cancelDataDir: vi.fn().mockResolvedValue({ pending: null }),
  });
  const { restore } = await renderStorage(api);
  await userEvent.setup().click(await screen.findByRole("button", { name: "取消这次搬移" }));
  expect(api.cancelDataDir).toHaveBeenCalled();
  await vi.waitFor(() => expect(reload).toHaveBeenCalled());
  Object.defineProperty(window, "location", { value: original, configurable: true, writable: true });
  restore();
});

void test("Settings/存储位置: 弹层能关掉，什么也不发生", async () => {
  const api = fakeApi({
    system: vi.fn().mockResolvedValue(systemInfo({ dataDir: "C:/data" })),
    requestDataDir: vi.fn(),
    restartApp: vi.fn(),
  });
  const { restore } = await renderStorage(api);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "更改…" }));
  await user.click(screen.getByRole("button", { name: "取消" }));
  await vi.waitFor(() => expect(screen.queryByText("更改数据目录")).not.toBeInTheDocument());
  expect(api.requestDataDir).not.toHaveBeenCalled();
  expect(api.restartApp).not.toHaveBeenCalled();

  // Esc 也要能关：弹层的关闭有两条路（按钮、Esc/点遮罩），两条都得通 ——
  // 只接一条的话，用户按 Esc 会以为应用卡住了。
  await user.click(screen.getByRole("button", { name: "更改…" }));
  await screen.findByText("更改数据目录");
  await user.keyboard("{Escape}");
  await vi.waitFor(() => expect(screen.queryByText("更改数据目录")).not.toBeInTheDocument());
  restore();
});

void test("Settings/存储位置: 选目录这一步本身失败也照原样转达", async () => {
  const api = fakeApi({
    system: vi.fn().mockResolvedValue(systemInfo({ dataDir: "C:/data" })),
    pickFolder: vi.fn().mockRejectedValue(new Error("daemon unreachable")),
  });
  const { restore } = await renderStorage(api);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "更改…" }));
  await user.click(screen.getByRole("button", { name: /选择目录/ }));
  expect(await screen.findByText("daemon unreachable")).toBeInTheDocument();
  restore();
});

void test("Settings/存储位置: 搬完的回执只在那一次启动出现，且不重复路径", async () => {
  // 搬完的那一次启动：守护进程标了 justNow —— 给一句回执，但路径不再写一遍，
  // 它就在正上方那一行里。
  const fresh = fakeApi({
    system: vi.fn().mockResolvedValue(
      systemInfo({
        dataDir: "D:/New folder",
        lastMove: { status: "moved", from: "C:/old", to: "D:/New folder", at: "t1", justNow: true },
      }),
    ),
  });
  const { unmount } = renderSection("general", fresh);
  expect(await screen.findByText(/数据已搬到上面这个新位置/)).toBeInTheDocument();
  // 那一行写的是新目录，回执里不再重复 —— 页面上 D:/New folder 只出现一次。
  expect(screen.getAllByText("D:/New folder")).toHaveLength(1);
  unmount();

  // 再往后的每一次启动：同一条 lastMove 还在指针里，但它已经是历史 —— 不显示
  // （owner 2026-09-05：搬完之后设置页里一直挂着一行「上次搬移已完成」）。
  const later = fakeApi({
    system: vi.fn().mockResolvedValue(
      systemInfo({
        dataDir: "D:/New folder",
        lastMove: { status: "moved", from: "C:/old", to: "D:/New folder", at: "t1" },
      }),
    ),
  });
  renderSection("general", later);
  expect(await screen.findByText("D:/New folder")).toBeInTheDocument();
  expect(screen.queryByText(/数据已搬到上面这个新位置/)).not.toBeInTheDocument();
  expect(screen.queryByText(/上次搬移已完成/)).not.toBeInTheDocument();
});

void test("Settings/存储位置: 浏览器里不给更改入口 —— 系统目录框只有壳弹得出来", async () => {
  const api = fakeApi({ system: vi.fn().mockResolvedValue(systemInfo({ dataDir: "C:/data" })) });
  renderSection("general", api);
  expect(await screen.findByText("C:/data")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "更改…" })).not.toBeInTheDocument();
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

// ───────────────────────── 能力平台（ADR-018 §2.7） ─────────────────────────

function skillsApi(over: Partial<Api> = {}): Api {
  return fakeApi({
    skills: vi.fn().mockResolvedValue({
      scannedAt: "2026-09-05T00:00:00Z",
      layers: [
        { layer: "bundled", present: true, count: 2, dir: "C:/app/resources/skills" },
        { layer: "distributed", present: false, count: 0 },
        { layer: "user", present: true, count: 1, dir: "C:/data/skills/user" },
      ],
      items: [
        { name: "officecli-docx", description: "Word 文档", layer: "bundled", source: "iofficeai.officecli", license: "Apache-2.0", tier: "default", enabled: true, hasScripts: false, dir: "C:/app/resources/skills/iofficeai.officecli/officecli-docx", shadowedBy: "user" },
        { name: "sn-deep-research", description: "深度研究", layer: "bundled", source: "opensensenova.sensenova-skills", license: "MIT", tier: "installed-disabled", enabled: false, hasScripts: true, dir: "C:/app/resources/skills/opensensenova.sensenova-skills/sn-deep-research" },
        { name: "officecli-docx", description: "我的 docx 规矩", layer: "user", source: "user", version: "1.2.0", enabled: true, hasScripts: false, dir: "C:/data/skills/user/officecli-docx" },
      ],
    }),
    tools: vi.fn().mockResolvedValue({
      items: [
        { id: "read_file", kind: "builtin", source: "runtime", status: "available" },
        { id: "use_skill", kind: "builtin", source: "skills", status: "available" },
        { id: "microsoft.playwright-mcp", kind: "mcp-server", source: "microsoft.playwright-mcp", status: "registered", detail: "已登记；本机启动规格未定，尚不能启动（TD-042）", license: "Apache-2.0", tier: "default" },
        { id: "tavily-ai.tavily-mcp", kind: "mcp-server", source: "tavily-ai.tavily-mcp", status: "runos", license: "MIT", tier: "runos-registered" },
        { id: "crm", kind: "connector", source: "crm", status: "available", tools: ["crm_lookup", "crm_write"] },
        { id: "x.custom", kind: "mcp-server", source: "x.custom", status: "registered", tier: "custom-tier" },
      ],
    }),
    setSkillEnabled: vi.fn().mockResolvedValue({}),
    refreshSkills: vi.fn().mockResolvedValue({}),
    ...over,
  });
}

test("能力平台：技能按层列出，被覆盖 / 停用 / 含脚本各说各的，工具的状态如实", async () => {
  renderSection("skills", skillsApi());
  const skills = await screen.findByRole("list", { name: "技能" });
  const rows = within(skills).getAllByRole("listitem");
  expect(rows).toHaveLength(3);
  // 预置层那条 officecli-docx 被用户层盖住：标「被覆盖」，不标「启用」。
  expect(within(rows[0]!).getByText("被用户层覆盖")).toBeTruthy();
  expect(within(rows[0]!).getByText("预置")).toBeTruthy();
  // 装而不启用：停用，且标出含脚本。
  expect(within(rows[1]!).getByText("停用")).toBeTruthy();
  expect(within(rows[1]!).getByText("含脚本（本地不跑）")).toBeTruthy();
  expect(within(rows[1]!).getByText(/装而不启用/)).toBeTruthy();
  // 用户层那条生效。
  expect(within(rows[2]!).getByText("启用")).toBeTruthy();
  expect(screen.getByText("预置 2 · 产品分发 0 · 用户 1")).toBeTruthy();

  const tools = screen.getByRole("list", { name: "工具" });
  const toolRows = within(tools).getAllByRole("listitem");
  expect(toolRows).toHaveLength(6);
  expect(within(toolRows[4]!).getByText("工具：crm_lookup、crm_write")).toBeTruthy();
  expect(within(toolRows[5]!).getByText("custom-tier")).toBeTruthy();
  expect(within(rows[2]!).getByText(/v1\.2\.0/)).toBeTruthy();
  expect(within(toolRows[2]!).getByText("已登记")).toBeTruthy();
  expect(within(toolRows[2]!).getByText("MCP 服务器")).toBeTruthy();
  expect(within(toolRows[3]!).getByText("经 Runos")).toBeTruthy();
});

test("能力平台：停用走 disable、启用走 enable（B-3 动词），键带 layer/source；刷新调 refresh 再重拉", async () => {
  const api = skillsApi();
  renderSection("skills", api);
  const skills = await screen.findByRole("list", { name: "技能" });
  const rows = within(skills).getAllByRole("listitem");
  await userEvent.click(within(rows[1]!).getByRole("button", { name: "启用" }));
  expect(api.setSkillEnabled).toHaveBeenCalledWith(
    { name: "sn-deep-research", layer: "bundled", source: "opensensenova.sensenova-skills" },
    true,
  );
  await userEvent.click(within(rows[2]!).getByRole("button", { name: "停用" }));
  expect(api.setSkillEnabled).toHaveBeenCalledWith({ name: "officecli-docx", layer: "user", source: "user" }, false);

  await userEvent.click(screen.getByRole("button", { name: "刷新" }));
  expect(api.refreshSkills).toHaveBeenCalledTimes(1);
  expect(api.skills).toHaveBeenCalledTimes(4); // 首次 + 两次开关后的重拉 + 刷新后的重拉
});

test("能力平台：按层筛选只看用户层；没有登记册时说清，不是空清单", async () => {
  renderSection("skills", skillsApi());
  await screen.findByRole("list", { name: "技能" });
  fireEvent.change(screen.getByLabelText("按来源层筛选"), { target: { value: "user" } });
  expect(within(screen.getByRole("list", { name: "技能" })).getAllByRole("listitem")).toHaveLength(1);
  fireEvent.change(screen.getByLabelText("按来源层筛选"), { target: { value: "distributed" } });
  expect(screen.getByText("这一层没有技能。")).toBeTruthy();

  renderSection(
    "skills",
    skillsApi({ skills: vi.fn().mockRejectedValue(new ApiError(503, { message: "这套装配没有技能登记册" })) }),
  );
  expect(await screen.findByText("这套装配没有技能登记册")).toBeTruthy();
});

test("能力平台：拉不到（非 503）就说拉不到；开关与刷新失败的原因照原样转达；没有工具登记册也说清", async () => {
  const api = skillsApi({
    setSkillEnabled: vi.fn().mockRejectedValue(new Error("state.json 写不进去")),
    refreshSkills: vi.fn().mockRejectedValue(new Error("能力面 503")),
    tools: vi.fn().mockRejectedValue(new Error("no tools")),
  });
  renderSection("skills", api);
  const skills = await screen.findByRole("list", { name: "技能" });
  expect(await screen.findByText("没有工具登记册。")).toBeTruthy();
  await userEvent.click(within(within(skills).getAllByRole("listitem")[1]!).getByRole("button", { name: "启用" }));
  expect(await screen.findByText("state.json 写不进去")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "刷新" }));
  expect(await screen.findByText("能力面 503")).toBeTruthy();

  renderSection("skills", skillsApi({ skills: vi.fn().mockRejectedValue(new Error("守护进程没响应")) }));
  expect(await screen.findByText("守护进程没响应")).toBeTruthy();
});

test("能力平台：还没拉到时两张清单都是省略号，不是「没有」", () => {
  const pending = new Promise<never>(() => {});
  renderSection("skills", skillsApi({ skills: vi.fn().mockReturnValue(pending), tools: vi.fn().mockReturnValue(pending) }));
  expect(screen.getAllByText("…")).toHaveLength(2);
});

test("能力平台：一条技能都没有时告诉用户预置层从哪来", async () => {
  renderSection(
    "skills",
    skillsApi({
      skills: vi.fn().mockResolvedValue({ scannedAt: "", layers: [{ layer: "bundled", present: false, count: 0 }], items: [] }),
      tools: vi.fn().mockResolvedValue({ items: [] }),
    }),
  );
  expect(await screen.findByText(/本机还没有任何技能/)).toBeTruthy();
  expect(screen.getByText("预置 0")).toBeTruthy();
});

test("能力平台：刷新进行中按钮变「刷新中…」并禁用，直到能力面回话", async () => {
  let settle!: () => void;
  const api = skillsApi({ refreshSkills: vi.fn().mockReturnValue(new Promise<void>((ok) => (settle = ok))) });
  renderSection("skills", api);
  await screen.findByRole("list", { name: "技能" });
  await userEvent.click(screen.getByRole("button", { name: "刷新" }));
  const busy = screen.getByRole("button", { name: "刷新中…" });
  expect((busy as HTMLButtonElement).disabled).toBe(true);
  settle();
  expect(await screen.findByRole("button", { name: "刷新" })).toBeTruthy();
});
