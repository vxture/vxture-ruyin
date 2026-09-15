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
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@vxture/design-system";
import { useEffect, useState } from "react";
import { SettingsView, type SectionId } from "./settings";
import { resolveSection } from "./settings-sections";
import { Api, type SystemInfo, type HardwareInfo, type UpdateCheck, ApiError } from "./api";

function systemInfo(over: Partial<SystemInfo> = {}): SystemInfo {
  return {
    version: "0.2.0",
    platform: "win32",
    arch: "x64",
    dataDir: "C:/Users/demo/.ruyin/dev",
    productsDir: "D:/ruyin/products",
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
    testConnector: vi.fn().mockResolvedValue({ ok: true, tools: [] }),
    activateConnector: vi.fn().mockResolvedValue({}),
    system: vi.fn().mockResolvedValue(systemInfo()),
    checkUpdate: vi.fn(),
    // 缺省当作「守护进程没接这一路」（真实的常见状态：老版本守护进程、或装配
    // 没配）—— 与 server.ts 那一路没配 hardwareInfo 时如实回的 503 一致。
    hardware: vi.fn().mockRejectedValue(new ApiError(503, { error: "HARDWARE_INFO_NOT_CONFIGURED" })),
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

/**
 * 「本机固件信息」块（关于页）：采集成功时逐项展示。不新开一张卡 ——
 * 嵌在身份卡里的 `.about-hardware` 子块（见 AboutSection 里的说明）。
 */
void test("AboutSection: 本机固件信息 —— 采集成功时逐项展示", async () => {
  const hardware: HardwareInfo = {
    cpu: { manufacturer: "GenuineIntel", brand: "Intel(R) Core(TM) i7", cores: 16 },
    memoryTotalBytes: 34359738368,
    baseboard: { manufacturer: "ASUS", model: "ROG STRIX" },
    bios: { vendor: "American Megatrends", version: "2.10" },
    os: { distro: "Windows 11 Pro", build: "22631" },
    // 两块磁盘各自缺一边（一块没 vendor、一块没 name）——`d.name ?? d.vendor`
    // 两条分支都要有真的走过，不能只靠其中一块顶两条。
    disks: [
      { name: "Samsung SSD 980", sizeBytes: 536870912000 },
      { vendor: "WD", sizeBytes: 2147483648 },
    ],
    macAddresses: ["AA:BB:CC:DD:EE:01"],
    machineId: "4C4C4544-0033-3210-8031-B9C04F503332",
  };
  const api = fakeApi({ hardware: vi.fn().mockResolvedValue(hardware) });
  renderSection("about", api);
  expect(await screen.findByText("Intel(R) Core(TM) i7 · 16 核")).toBeInTheDocument();
  expect(screen.getByText("32.0 GB")).toBeInTheDocument();
  expect(screen.getByText("ASUS ROG STRIX")).toBeInTheDocument();
  expect(screen.getByText("American Megatrends · 2.10")).toBeInTheDocument();
  expect(screen.getByText("Windows 11 Pro · build 22631")).toBeInTheDocument();
  expect(screen.getByText("Samsung SSD 980 · 500.0 GB；WD · 2.0 GB")).toBeInTheDocument();
  expect(screen.getByText("AA:BB:CC:DD:EE:01")).toBeInTheDocument();
  expect(screen.getByText("4C4C4544-0033-3210-8031-B9C04F503332")).toBeInTheDocument();
});

/**
 * 字段缺失各有各的理由——**整块没读到**（主板/BIOS/磁盘/网卡/机器 ID/内存，
 * 落到「—」）和**读到了但缺子字段**（CPU 有型号没核数、系统有发行版没 build 号，
 * 落到只显示那半），两种都要落实，不报错也不假装有数据。
 */
void test("AboutSection: 本机固件信息 —— 缺整块的落「—」，缺子字段的只显示那半", async () => {
  const hardware: HardwareInfo = {
    cpu: { brand: "Test CPU" }, // 没有 cores
    os: { distro: "Windows 11 Pro" }, // 没有 build
    // baseboard / bios / disks / macAddresses / machineId / memoryTotalBytes 全不给
  };
  const api = fakeApi({ hardware: vi.fn().mockResolvedValue(hardware) });
  const { container } = renderSection("about", api);
  await screen.findByText("Test CPU");
  expect(screen.getByText("Windows 11 Pro")).toBeInTheDocument();
  const rows = container.querySelectorAll(".about-hardware .fact-row");
  expect(rows).toHaveLength(8);
  const emptyRows = [...rows].filter((r) => r.querySelector(".fact-empty"));
  // 8 行里，处理器与操作系统那两行有值（型号/发行版），其余 6 行落「—」。
  expect(emptyRows).toHaveLength(6);
});

/**
 * 上一条钉的是「有 cpu/os 对象、里面缺字段」；这一条钉的是「压根没有 cpu/os
 * 对象」——两件事在 AboutSection 里走的是同一个三元表达式的外层和内层，
 * 只测其中一种会把另一种漏在覆盖率外面。
 */
void test("AboutSection: 本机固件信息 —— CPU/操作系统整块都没读到时也落「—」", async () => {
  const hardware: HardwareInfo = {};
  const api = fakeApi({ hardware: vi.fn().mockResolvedValue(hardware) });
  const { container } = renderSection("about", api);
  await screen.findByText("本机固件信息");
  const rows = container.querySelectorAll(".about-hardware .fact-row");
  expect(rows).toHaveLength(8);
  for (const row of rows) {
    expect(row.querySelector(".fact-empty")).toBeInTheDocument();
  }
});

/** 守护进程没接这一路（旧版本 / 装配没配）：如实说不可用，不是空着或报错崩页。 */
void test("AboutSection: 本机固件信息 —— 守护进程未接这一路时如实说不可用", async () => {
  renderSection("about"); // fakeApi() 缺省就是 503（HARDWARE_INFO_NOT_CONFIGURED）
  expect(await screen.findByText(/本机固件信息暂不可用/)).toBeInTheDocument();
  expect(screen.queryByText("处理器")).not.toBeInTheDocument();
});

/**
 * 关于页只有身份 + 三条条款 + 一条判断式提醒（owner 2026-09-10 连收两次：
 * 四张卡 → 两块 → 去掉「须知」）。
 *
 * 钉**结构**而不只是文案：只钉文案的话，下一个人再加两张卡，用例照样全绿。
 */
void test("AboutSection: 两块版式 —— 关于信息自动布满，提示按需显隐", async () => {
  const { container } = renderSection("about");
  await screen.findByText("RUYIN");
  // 没有板块卡、没有导航按钮：这一页收过三次，钉住结构才拦得住第四次被撑回导航站。
  // **唯一的按钮**是「随包第三方组件许可」（TD-058，2026-09-12）：它不去别处，只是就地
  // 展开一份许可证要求的署名清单。再多一个按钮，这条就该红。
  expect(container.querySelectorAll(".set-block")).toHaveLength(0);
  const buttons = container.querySelectorAll("button");
  expect(buttons).toHaveLength(1);
  expect(buttons[0]).toHaveClass("about-third-party");
  expect(container.querySelectorAll(".about-legal-btn")).toHaveLength(3);

  // 第一块永远在；第二块**不出现时连元素都不在**（不是 display:none 占着位）——
  // 占着位的话第一块就布不满，而那正是 owner 要的「自动布满」。
  expect(container.querySelector(".about-page")).toBeInTheDocument();
  expect(container.querySelector(".about-main")).toBeInTheDocument();
  expect(container.querySelector(".about-notice")).not.toBeInTheDocument();
});

/**
 * 三条条款 —— **只列真的存在的那几页**。
 *
 * 2026-09-10 跟着语言前缀跳转逐条实测过 `vxture.com/legal/*`：`privacy` /
 * `terms` / `cookies` / `refund` 是 200，`dpa` / `security` / `subprocessors` /
 * `open-source` / `acceptable-use` / `licenses` 全是 404。
 *
 * 第二个断言比第一个重要：**没有多出来的**。一个点开是 404 的法律链接比没有这个
 * 链接糟得多 —— 用户会以为是自己没找到。
 */
void test("AboutSection: 条款只有实测存在的三页，且不含 Cookie 政策", async () => {
  renderSection("about");
  const privacy = await screen.findByText("隐私政策");
  expect(privacy.closest("a")).toHaveAttribute("href", "https://vxture.com/legal/privacy");
  expect(screen.getByText("服务条款").closest("a")).toHaveAttribute(
    "href",
    "https://vxture.com/legal/terms",
  );
  expect(screen.getByText("退款政策").closest("a")).toHaveAttribute(
    "href",
    "https://vxture.com/legal/refund",
  );
  // 那一页**在**（200），故意不链：它讲的是网站的必要 / 偏好 / 分析 / 第三方
  // Cookie，而桌面应用不设分析 Cookie、也没有第三方 Cookie。
  expect(screen.queryByText(/Cookie/)).not.toBeInTheDocument();
});

/** 做成按钮式，但底层仍是真链接 —— 中键新开、右键复制地址都得留着。 */
void test("AboutSection: 按钮式条款底层仍是 <a>，不是 button", async () => {
  const { container } = renderSection("about");
  await screen.findByText("隐私政策");
  for (const el of container.querySelectorAll(".about-legal-btn")) {
    expect(el.tagName).toBe("A");
    expect(el).toHaveAttribute("target", "_blank");
    expect(el).toHaveAttribute("rel", expect.stringContaining("noopener"));
  }
});

/** 条款地址跟着会话走；未登录时落到与登录页同一个缺省，不是空链接。 */
void test("AboutSection: 外链基址取自会话的 consoleBase，未登录则落到默认站点", async () => {
  const api = fakeApi({
    session: vi.fn().mockResolvedValue({ signedIn: true, consoleBase: "https://staging.vxture.com" }),
  });
  renderSection("about", api);
  await vi.waitFor(() =>
    expect(screen.getByText("隐私政策").closest("a")).toHaveAttribute(
      "href",
      "https://staging.vxture.com/legal/privacy",
    ),
  );
});

/**
 * 底部那条未签名提醒是**判断式**的（owner 2026-09-10）：签了就自己没了，不需要
 * 有人回来删这段文案。
 *
 * 三种状态各钉一条，**中间那条最要紧**：`unpackaged` 绝不能当成「未签名」——
 * 从仓里直接跑时根本没有安装包可谈，那时挂一条讲 SmartScreen 的提醒是错的。
 * 缺失 ≠ 否定，同 `capabilitySurface` 的纪律。
 */
void test("AboutSection: 未签名才提醒；已签名与开发态都不提醒", async () => {
  const withSigning = (v: SystemInfo["codeSigning"]) =>
    fakeApi({ system: vi.fn().mockResolvedValue(systemInfo({ codeSigning: v })) });

  const unsignedRender = renderSection("about", withSigning("unsigned"));
  expect(await screen.findByText(/SmartScreen/)).toBeInTheDocument();
  // 只讲 SmartScreen 会误导开着智能应用控制的用户：那里是封锁，不是警告（TD-001 补记）。
  expect(screen.getByText(/智能应用控制/)).toBeInTheDocument();
  expect(unsignedRender.container.querySelector(".about-notice")).toBeInTheDocument();
  cleanup();

  renderSection("about", withSigning("signed"));
  await screen.findByText("RUYIN");
  expect(screen.queryByText(/SmartScreen/)).not.toBeInTheDocument();
  cleanup();

  renderSection("about", withSigning("unpackaged"));
  await screen.findByText("RUYIN");
  expect(screen.queryByText(/SmartScreen/)).not.toBeInTheDocument();
});

/**
 * 提醒**只留一处**（owner 2026-09-10）。原来「软件更新」页上还有一条无条件的
 * 同款语气块 —— 那一条签名那天会原地变成一句假话，而没有任何东西会提醒谁回来
 * 删它。这条断言盯着它别回来。
 */
void test("软件更新页不再重复那条 SmartScreen 提醒（只留关于页那一处）", async () => {
  renderSection("updates");
  await screen.findByText("检查");
  expect(screen.queryByText(/SmartScreen/)).not.toBeInTheDocument();
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

void test("Settings/连接器: a streamable_http connector shows its url, not a command/args tooltip", async () => {
  const httpView = {
    state: "active" as const,
    id: "crm-http",
    transport: "streamable_http" as const,
    url: "http://127.0.0.1:8931/mcp",
    source: "lan" as const,
    installedAt: "2026-09-14T00:00:00.000Z",
    health: { ok: true, checkedAt: "2026-09-14T00:00:00.000Z" },
    tools: ["lookup_account"],
  };
  const api = fakeApi({ connectors: vi.fn().mockResolvedValue({ items: [httpView] }) });
  renderRouted("connectors", api);
  const list = await screen.findByLabelText("已安装的连接器");
  const code = within(list).getByText("crm-http");
  expect(code).toHaveAttribute("title", "http://127.0.0.1:8931/mcp");
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
    transport: "stdio",
    command: "node",
    args: ["crm.js", "--port", "1"],
  });
  // 连不上时原因照原样转达，并给出「暂存」这条路。
  expect(await screen.findByText(/ECONNREFUSED 127\.0\.0\.1:8931/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "添加并启用" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "暂存（不启用）" }));
  expect(installConnector).toHaveBeenLastCalledWith({
    id: "crm",
    transport: "stdio",
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
    transport: "stdio",
    command: "node",
    args: [],
    source: "lan",
  });
});

void test("Settings/连接器: 传输方式切到 Streamable HTTP 后走地址，不走命令；测试与安装都带上地址而不是命令", async () => {
  const testConnector = vi.fn().mockResolvedValue({ ok: true, tools: ["crm_search"] });
  const installConnector = vi.fn().mockResolvedValue(crmView);
  const api = fakeApi({
    connectors: vi.fn().mockResolvedValue({ items: [] }),
    testConnector,
    installConnector,
  });
  renderRouted("connectors", api);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "添加连接器" }));
  await user.type(screen.getByPlaceholderText("如 crm"), "crm");
  await user.selectOptions(screen.getByLabelText("传输方式"), "streamable_http");

  // 换了传输方式，命令那两行不该还在 —— 它们讲的是另一条连接细节。
  expect(screen.queryByPlaceholderText(/^如 node/)).not.toBeInTheDocument();
  await user.type(screen.getByPlaceholderText(/^http:\/\/127\.0\.0\.1/), "http://127.0.0.1:8931/mcp");
  await user.click(screen.getByRole("button", { name: "测试连接" }));
  expect(testConnector).toHaveBeenCalledWith({
    id: "crm",
    transport: "streamable_http",
    url: "http://127.0.0.1:8931/mcp",
  });
  expect(await screen.findByText(/连接成功/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "添加并启用" }));
  expect(installConnector).toHaveBeenLastCalledWith({
    id: "crm",
    transport: "streamable_http",
    url: "http://127.0.0.1:8931/mcp",
    source: "lan",
  });
});

void test("Settings/连接器: 换传输方式会清空上一次的测试结果 —— 那是对着另一条连接细节测的", async () => {
  const api = fakeApi({
    connectors: vi.fn().mockResolvedValue({ items: [] }),
    testConnector: vi.fn().mockResolvedValue({ ok: true, tools: ["crm_search"] }),
  });
  renderRouted("connectors", api);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "添加连接器" }));
  await user.type(screen.getByPlaceholderText("如 crm"), "crm");
  await user.selectOptions(screen.getByLabelText("传输方式"), "streamable_http");
  await user.type(screen.getByPlaceholderText(/^http:\/\/127\.0\.0\.1/), "http://127.0.0.1:8931/mcp");
  await user.click(screen.getByRole("button", { name: "测试连接" }));
  expect(await screen.findByText(/连接成功/)).toBeInTheDocument();

  // 切回 stdio：地址字段消失、命令字段回来，测试结果不该带着上一种传输的痕迹。
  await user.selectOptions(screen.getByLabelText("传输方式"), "stdio");
  expect(screen.queryByPlaceholderText(/^http:\/\/127\.0\.0\.1/)).not.toBeInTheDocument();
  expect(screen.getByPlaceholderText(/^如 node/)).toBeInTheDocument();
  expect(screen.queryByText(/连接成功/)).not.toBeInTheDocument();
  // 没测过（这一次是对着 stdio 测的，命令还是空的）：主按钮该关着。
  expect(screen.getByRole("button", { name: "添加并启用" })).toBeDisabled();
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
  expect(api.installConnector).toHaveBeenCalledWith({
    id: "crm",
    transport: "stdio",
    command: "node",
    args: [],
    source: "lan",
  });
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
  // 云同步那句要**在选之前**就在弹窗里（TD-051）：选完再拒也拦得住，但那时用户
  // 已经打开过文件选择框、挑了一个他觉得很合理的位置。
  const dialog = screen.getByRole("dialog");
  expect(dialog.textContent).toContain("不要选云同步盘目录");
  expect(dialog.textContent).toContain("OneDrive");
  // **认不出来的拦不住，所以这句必须在**：拦截只认得出常见的几家，挂成盘符的
  // 那些认不出来。提醒是第一位的，拦截是补网 —— 少了这句，用户会以为「没被拒
  // 就是安全的」。
  expect(dialog.textContent).toContain("认不出来");
  // 这两段是**渲染出去的正文**。JSX 不解析 Markdown，写 ** 用户就会看见两个星号
  // —— 这条曾经真的漏出去过（2026-09-07 在浏览器里看到的），所以钉一条。
  expect(dialog.textContent).not.toContain("**");
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

/**
 * 小类默认收着（owner 2026-09-07：大类可收缩、小类按业务功能下拉展开），所以取
 * 行之前先把小类全部展开。
 *
 * 顺带把这一组用例从**按下标**断言改成**按内容**断言。分组之后行序由组序决定，
 * 再写 `rows[1]` 就只是在断言分类算法 —— 而这些用例问的从来是「有没有这一条、
 * 它说了什么」。
 */
async function capabilityRows(kind: "技能" | "工具"): Promise<HTMLElement[]> {
  // 展开要放在 waitFor 里重试：清单是异步拉的，先点一次的话那时小类还不存在。
  // 展开是幂等的 —— 开过的小类 aria-expanded 变 true，不会再被点到。
  const lists = await waitFor(() => {
    for (const trigger of screen.queryAllByRole("button", { expanded: false })) fireEvent.click(trigger);
    return screen.getAllByRole("list", { name: new RegExp(`^${kind} · `) });
  });
  return lists.flatMap((list) => within(list).getAllByRole("listitem"));
}

/** 按行内文字取一行。取不到就把现有的行全打出来 —— 断言失败要能读懂。 */
function rowWith(rows: HTMLElement[], text: string | RegExp): HTMLElement {
  const hit = rows.find((r) =>
    typeof text === "string" ? (r.textContent ?? "").includes(text) : text.test(r.textContent ?? ""),
  );
  if (!hit) {
    throw new Error(
      `没有匹配「${text}」的行；现有 ${rows.length} 行：\n` + rows.map((r) => r.textContent).join("\n"),
    );
  }
  return hit;
}

test("能力平台：技能按层列出，被覆盖 / 停用 / 含脚本各说各的，工具的状态如实", async () => {
  renderSection("skills", skillsApi());
  const rows = await capabilityRows("技能");
  expect(rows).toHaveLength(3);
  // 预置层那条 officecli-docx 被用户层盖住：标「被覆盖」，不标「启用」。
  const shadowed = rowWith(rows, "iofficeai.officecli");
  expect(within(shadowed).getByText("被用户层覆盖")).toBeTruthy();
  expect(within(shadowed).getByText("预置")).toBeTruthy();
  // 装而不启用：停用，且标出含脚本。
  const disabled = rowWith(rows, "sn-deep-research");
  expect(within(disabled).getByText("停用")).toBeTruthy();
  expect(within(disabled).getByText("含脚本（本地不跑）")).toBeTruthy();
  expect(within(disabled).getByText(/装而不启用/)).toBeTruthy();
  // 用户层那条生效。
  const mine = rowWith(rows, /v1\.2\.0/);
  expect(within(mine).getByText("启用")).toBeTruthy();
  expect(screen.getByText("预置 2 · 产品分发 0 · 用户 1")).toBeTruthy();

  const toolRows = await capabilityRows("工具");
  expect(toolRows).toHaveLength(6);
  expect(within(rowWith(toolRows, "crm")).getByText("工具：crm_lookup、crm_write")).toBeTruthy();
  expect(within(rowWith(toolRows, "x.custom")).getByText("custom-tier")).toBeTruthy();
  const playwright = rowWith(toolRows, "microsoft.playwright-mcp");
  expect(within(playwright).getByText("已登记")).toBeTruthy();
  expect(within(playwright).getByText("MCP 服务器")).toBeTruthy();
  expect(within(rowWith(toolRows, "tavily")).getByText("经 Runos")).toBeTruthy();
});

test("能力平台：两个大类可以收起，收起之后条数还在（owner 2026-09-07）", async () => {
  renderSection("skills", skillsApi());
  // 展开态：行在。
  expect(await capabilityRows("技能")).toHaveLength(3);
  // 计数挂在标题上，收起之后它是唯一还看得见的量 —— 所以先确认它在。
  const heads = screen.getAllByRole("heading", { level: 3 });
  expect(heads.some((h) => (h.textContent ?? "").startsWith("技能") && h.textContent!.includes("3"))).toBe(true);

  await userEvent.click(screen.getAllByRole("button", { name: "收起" })[0]!);
  // 收起：这一类的小类清单整个不在了，但标题与条数还在。
  expect(screen.queryAllByRole("list", { name: /^技能 · / })).toHaveLength(0);
  expect(screen.getAllByRole("heading", { level: 3 }).some((h) => (h.textContent ?? "").startsWith("技能"))).toBe(true);

  await userEvent.click(screen.getByRole("button", { name: "展开" }));
  expect(await capabilityRows("技能")).toHaveLength(3);
});

test("能力平台：停用走 disable、启用走 enable（B-3 动词），键带 layer/source；刷新调 refresh 再重拉", async () => {
  const api = skillsApi();
  renderSection("skills", api);
  const rows = await capabilityRows("技能");
  await userEvent.click(within(rowWith(rows, "sn-deep-research")).getByRole("button", { name: "启用" }));
  expect(api.setSkillEnabled).toHaveBeenCalledWith(
    { name: "sn-deep-research", layer: "bundled", source: "opensensenova.sensenova-skills" },
    true,
  );
  await userEvent.click(within(rowWith(rows, /v1\.2\.0/)).getByRole("button", { name: "停用" }));
  expect(api.setSkillEnabled).toHaveBeenCalledWith({ name: "officecli-docx", layer: "user", source: "user" }, false);

  await userEvent.click(screen.getByRole("button", { name: "刷新" }));
  expect(api.refreshSkills).toHaveBeenCalledTimes(1);
  expect(api.skills).toHaveBeenCalledTimes(4); // 首次 + 两次开关后的重拉 + 刷新后的重拉
});

test("能力平台：按层筛选只看用户层；没有登记册时说清，不是空清单", async () => {
  renderSection("skills", skillsApi());
  expect(await capabilityRows("技能")).toHaveLength(3);
  fireEvent.change(screen.getByLabelText("按来源层筛选"), { target: { value: "user" } });
  expect(await capabilityRows("技能")).toHaveLength(1);
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
  const rows = await capabilityRows("技能");
  expect(await screen.findByText("没有工具登记册。")).toBeTruthy();
  await userEvent.click(within(rowWith(rows, "sn-deep-research")).getByRole("button", { name: "启用" }));
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
  await capabilityRows("技能");
  await userEvent.click(screen.getByRole("button", { name: "刷新" }));
  const busy = screen.getByRole("button", { name: "刷新中…" });
  expect((busy as HTMLButtonElement).disabled).toBe(true);
  settle();
  expect(await screen.findByRole("button", { name: "刷新" })).toBeTruthy();
});

test("能力平台：预置的 MCP 服务器能启动 / 停止（走连接器的 activate / deactivate），起不了的原因就在行里", async () => {
  const api = skillsApi({
    tools: vi.fn().mockResolvedValue({
      items: [
        { id: "microsoft.playwright-mcp", kind: "mcp-server", source: "microsoft.playwright-mcp", status: "registered", launchable: true, detail: "可启动（node）；需要 Chromium", license: "Apache-2.0", tier: "default" },
        { id: "aas-ee.open-websearch", kind: "mcp-server", source: "aas-ee.open-websearch", status: "available", launchable: true, detail: "运行中（node）", tools: ["search"] },
        { id: "microsoft.markitdown", kind: "mcp-server", source: "microsoft.markitdown", status: "unavailable", launchable: true, detail: "需要本机有 uv（https://docs.astral.sh/uv/），uvx 不在 PATH 里" },
        { id: "x.registered", kind: "mcp-server", source: "x.registered", status: "registered", detail: "发行形态未核实" },
      ],
    }),
    activateConnector: vi.fn().mockResolvedValue({}),
    deactivateConnector: vi.fn().mockResolvedValue({}),
  });
  renderSection("skills", api);
  const rows = await capabilityRows("工具");
  await userEvent.click(within(rowWith(rows, "microsoft.playwright-mcp")).getByRole("button", { name: "启动" }));
  expect(api.activateConnector).toHaveBeenCalledWith("microsoft.playwright-mcp");
  await userEvent.click(within(rowWith(rows, "aas-ee.open-websearch")).getByRole("button", { name: "停止" }));
  expect(api.deactivateConnector).toHaveBeenCalledWith("aas-ee.open-websearch");
  const noUv = rowWith(rows, "microsoft.markitdown");
  expect(within(noUv).getByText(/需要本机有 uv/)).toBeTruthy();
  expect(within(noUv).getByRole("button", { name: "启动" })).toBeTruthy();
  // 只登记的没有按钮。
  expect(within(rowWith(rows, "x.registered")).queryByRole("button")).toBeNull();
});

test("连接器：预置的服务器标「预置」，只能停用不能卸载", async () => {
  const api = fakeApi({
    connectors: vi.fn().mockResolvedValue({
      items: [
        { id: "aas-ee.open-websearch", transport: "stdio", command: "C:/Ruyin.exe", args: ["cli.js"], source: "bundled", installedAt: "", state: "active", health: { ok: true, checkedAt: "" }, tools: ["search"], bundled: { runtime: "node" } },
        { id: "crm", transport: "stdio", command: "node", args: ["crm.js"], source: "lan", installedAt: "2026-09-04", state: "active", health: { ok: true, checkedAt: "" }, tools: [] },
      ],
    }),
    deactivateConnector: vi.fn().mockResolvedValue({}),
    removeConnector: vi.fn().mockResolvedValue({}),
  });
  renderSection("connectors", api);
  const list = await screen.findByRole("list", { name: "已安装的连接器" });
  const rows = within(list).getAllByRole("listitem");
  expect(within(rows[0]!).getByText("预置")).toBeTruthy();
  expect(within(rows[0]!).queryByRole("button", { name: "卸载" })).toBeNull();
  await userEvent.click(within(rows[0]!).getByRole("button", { name: "停用" }));
  expect(api.deactivateConnector).toHaveBeenCalledWith("aas-ee.open-websearch");
  expect(within(rows[1]!).getByRole("button", { name: "卸载" })).toBeTruthy();
});

test("能力平台 / 连接器：启动与停用失败时，原因照原样转达", async () => {
  const api = skillsApi({
    tools: vi.fn().mockResolvedValue({
      items: [{ id: "microsoft.markitdown", kind: "mcp-server", source: "microsoft.markitdown", status: "unavailable", launchable: true, detail: "需要 uv" }],
    }),
    activateConnector: vi.fn().mockRejectedValue(new Error('bundled tool server "microsoft.markitdown" cannot start: 需要本机有 uv')),
  });
  renderSection("skills", api);
  const rows = await capabilityRows("工具");
  await userEvent.click(within(rows[0]!).getByRole("button", { name: "启动" }));
  expect(await screen.findByText(/cannot start: 需要本机有 uv/)).toBeTruthy();

  const connectorsApi = fakeApi({
    connectors: vi.fn().mockResolvedValue({
      items: [
        { id: "aas-ee.open-websearch", transport: "stdio", command: "C:/Ruyin.exe", args: [], source: "bundled", installedAt: "", state: "active", health: { ok: true, checkedAt: "" }, tools: [], bundled: { runtime: "node" } },
      ],
    }),
    deactivateConnector: vi.fn().mockRejectedValue(new Error("进程没停下来")),
  });
  renderSection("connectors", connectorsApi);
  const list = await screen.findByRole("list", { name: "已安装的连接器" });
  await userEvent.click(within(list).getByRole("button", { name: "停用" }));
  expect(await screen.findByText("进程没停下来")).toBeTruthy();
});

/* ---- 能力平台 / 获取通道（ADR-018 §7.2，TD-042）---- */

/** 一件未获取的载荷：体积 / 许可证 / 来源主机都在，点之前就看得见。 */
const shellComponent = {
  id: "browser.chromium-headless-shell",
  state: "not-acquired" as const,
  downloadBytes: 120_200_717,
  diskBytes: 283_200_000,
  license: "BSD-3-Clause",
  origin: "cdn.playwright.dev",
};

function acquisitionApi(over: Record<string, unknown> = {}) {
  return skillsApi({
    tools: vi.fn().mockResolvedValue({
      items: [
        {
          id: "microsoft.playwright-mcp",
          kind: "mcp-server",
          source: "microsoft.playwright-mcp",
          status: "needs-acquisition",
          launchable: true,
          license: "Apache-2.0",
          tier: "default",
          detail: "未获取：需下载 114.6 MB（占盘 270.1 MB）—— 在「能力平台」里点「获取」，或从本地文件导入",
          tools: ["browser_navigate", "browser_click"],
          component: shellComponent,
        },
        {
          id: "aas-ee.open-websearch",
          kind: "mcp-server",
          source: "aas-ee.open-websearch",
          status: "available",
          launchable: true,
          detail: "运行中（node）",
          tools: ["search"],
        },
      ],
    }),
    acquireComponent: vi.fn().mockResolvedValue({}),
    cancelComponent: vi.fn().mockResolvedValue({ cancelled: true }),
    pickFolder: vi.fn().mockResolvedValue({ path: "E:/offline-tools" }),
    ...over,
  });
}

test("能力平台：未获取的行有自己的徽标，体积 / 许可证 / 来源主机都在按钮左边", async () => {
  renderSection("skills", acquisitionApi());
  const row = rowWith(await capabilityRows("工具"), "microsoft.playwright-mcp");
  expect(within(row).getByText("未获取")).toBeTruthy();
  // 点之前必须看得见要下多少、什么许可证、从哪个主机来。
  expect(within(row).getByText(/需下载 114\.6 MB（占盘 270\.1 MB）/)).toBeTruthy();
  expect(within(row).getByText(/BSD-3-Clause/)).toBeTruthy();
  expect(within(row).getByText(/来自 cdn\.playwright\.dev/)).toBeTruthy();
  // 停着 / 还没获取的行也列工具名 —— 用户在下载之前就看得见会多出哪些工具。
  expect(within(row).getByText("工具：browser_navigate、browser_click")).toBeTruthy();
  // 顶上那句常驻事实数的是「能不能起」，不是清单上有几条。
  expect(screen.getByText(/预置 1 个，随安装包而来、不下载任何字节；另有 1 个需要获取/)).toBeTruthy();
});

test("能力平台：点「获取」只带 id —— 地址不在界面手上", async () => {
  const api = acquisitionApi();
  renderSection("skills", api);
  const rows = await capabilityRows("工具");
  await userEvent.click(within(rowWith(rows, "microsoft.playwright-mcp")).getByRole("button", { name: "获取" }));
  expect(api.acquireComponent).toHaveBeenCalledWith("browser.chromium-headless-shell", undefined);
});

test("能力平台：「从本地文件导入」走系统目录框（气隙机器那条路）", async () => {
  const api = acquisitionApi();
  renderSection("skills", api);
  const rows = await capabilityRows("工具");
  await userEvent.click(within(rowWith(rows, "microsoft.playwright-mcp")).getByRole("button", { name: "从本地文件导入" }));
  expect(api.pickFolder).toHaveBeenCalled();
  expect(api.acquireComponent).toHaveBeenCalledWith("browser.chromium-headless-shell", "E:/offline-tools");
});

test("能力平台：用户在目录框里取消，就什么都不做", async () => {
  const api = acquisitionApi({ pickFolder: vi.fn().mockResolvedValue({ cancelled: true }) });
  renderSection("skills", api);
  const rows = await capabilityRows("工具");
  await userEvent.click(within(rowWith(rows, "microsoft.playwright-mcp")).getByRole("button", { name: "从本地文件导入" }));
  expect(api.acquireComponent).not.toHaveBeenCalled();
});

test("能力平台：获取中显示进度与「取消」，不显示「获取」", async () => {
  const api = acquisitionApi({
    tools: vi.fn().mockResolvedValue({
      items: [
        {
          id: "microsoft.playwright-mcp",
          kind: "mcp-server",
          source: "microsoft.playwright-mcp",
          status: "acquiring",
          launchable: true,
          component: { ...shellComponent, state: "acquiring", receivedBytes: 45_298_483, totalBytes: 120_200_717 },
        },
      ],
    }),
  });
  renderSection("skills", api);
  const row = rowWith(await capabilityRows("工具"), "microsoft.playwright-mcp");
  expect(within(row).getByText("43.2 MB / 114.6 MB")).toBeTruthy();
  expect(within(row).queryByRole("button", { name: "获取" })).toBeNull();
  await userEvent.click(within(row).getByRole("button", { name: "取消" }));
  expect(api.cancelComponent).toHaveBeenCalledWith("browser.chromium-headless-shell");
});

test.each([
  ["unreachable", /网络到不了/],
  // 「上游已经没有这一版了」与「网络到不了」**必须是两句话**：前者重试一百次
  // 还是 404，把它说成后者，用户会一直重试一件永远不会成的事。
  ["gone", /重试没有用/],
  // 回执在、文件被杀毒隔离掉了：这一种要说的是「先移除」，不是「再点一次」。
  ["payload-missing", /文件不在了/],
  ["mismatch", /与清单里那条摘要不符，已丢弃/],
  ["no-space", /磁盘不够/],
  ["license-missing", /缺许可证文件，已回滚/],
  ["refused-origin", /来源不在允许的名单里/],
  ["cancelled", /已取消/],
] as const)("能力平台：获取失败各说各的 —— %s 不折叠成一句「失败了」", async (state, said) => {
  const api = acquisitionApi({
    tools: vi.fn().mockResolvedValue({
      items: [
        {
          id: "microsoft.playwright-mcp",
          kind: "mcp-server",
          source: "microsoft.playwright-mcp",
          status: "needs-acquisition",
          launchable: true,
          component: { ...shellComponent, state, reason: "守护进程原样转达的那一句" },
        },
      ],
    }),
  });
  renderSection("skills", api);
  const row = rowWith(await capabilityRows("工具"), "microsoft.playwright-mcp");
  expect(within(row).getByText(said)).toBeTruthy();
  // 原因照原样转达，不改写成「请稍后再试」。
  expect(within(row).getByText(/守护进程原样转达的那一句/)).toBeTruthy();
  // 失败之后按钮还在：这是一个用户点一下就能再试的事实。
  expect(within(row).getByRole("button", { name: "获取" })).toBeTruthy();
});

test("能力平台：获取失败时把守护进程的原话摆出来", async () => {
  const api = acquisitionApi({
    acquireComponent: vi.fn().mockRejectedValue(new Error("sha256 abc 与清单的 def 不符 —— 字节已丢弃")),
  });
  renderSection("skills", api);
  const rows = await capabilityRows("工具");
  await userEvent.click(within(rowWith(rows, "microsoft.playwright-mcp")).getByRole("button", { name: "获取" }));
  expect(await screen.findByText(/字节已丢弃/)).toBeTruthy();
});

test("能力平台：探不到工具名时写一句原因，不写空数组", async () => {
  const api = acquisitionApi({
    tools: vi.fn().mockResolvedValue({
      items: [
        {
          id: "haris-musa.excel-mcp-server",
          kind: "mcp-server",
          source: "haris-musa.excel-mcp-server",
          status: "unavailable",
          launchable: true,
          toolsUnprobed: "本次构建没有 vendored 它（runtime = uvx）",
        },
      ],
    }),
  });
  renderSection("skills", api);
  const rows = await capabilityRows("工具");
  expect(within(rows[0]!).getByText(/工具名未探到：本次构建没有 vendored 它/)).toBeTruthy();
});

test("能力平台：取消失败时也把原话摆出来（reload 之后再放，否则会被抹掉）", async () => {
  const api = acquisitionApi({
    cancelComponent: vi.fn().mockRejectedValue(new Error("已经落地了，取消不了")),
    tools: vi.fn().mockResolvedValue({
      items: [
        {
          id: "microsoft.playwright-mcp",
          kind: "mcp-server",
          source: "microsoft.playwright-mcp",
          status: "acquiring",
          launchable: true,
          component: { ...shellComponent, state: "acquiring", receivedBytes: 1, totalBytes: 2 },
        },
      ],
    }),
  });
  renderSection("skills", api);
  const rows = await capabilityRows("工具");
  await userEvent.click(within(rows[0]!).getByRole("button", { name: "取消" }));
  expect(await screen.findByText("已经落地了，取消不了")).toBeTruthy();
});

// ───────────────────────── 能力调用路径（ADR-025） ─────────────────────────

test("能力平台：顶上说清能力调用路径 —— 当前档位、Runos 是兼容协议的本地能力面、云端通路未开放", async () => {
  renderSection(
    "skills",
    skillsApi({
      capabilityRouting: vi.fn().mockResolvedValue({
        name: "Runos",
        note: "兼容 Runos 协议的本地能力面",
        cloudOpen: false,
        source: "default",
        errors: [],
        current: { mode: "local_only", source: "default", label: "只许本机" },
      }),
    } as Partial<Api>),
  );
  expect(await screen.findByText("只许本机")).toBeInTheDocument();
  // 名字出现的地方，说明必须一起出现
  expect(screen.getByText(/Runos（兼容 Runos 协议的本地能力面）/)).toBeInTheDocument();
  expect(screen.getByText(/云端 Runos 通路尚未开放/)).toBeInTheDocument();
});

test("能力平台：云端通路开放后不再说「尚未开放」", async () => {
  renderSection(
    "skills",
    skillsApi({
      capabilityRouting: vi.fn().mockResolvedValue({
        name: "Runos",
        note: "兼容 Runos 协议的本地能力面",
        cloudOpen: true,
        source: "file",
        errors: [],
        current: { mode: "prefer_local", source: "workspace", label: "优先本机" },
      }),
    } as Partial<Api>),
  );
  expect(await screen.findByText("优先本机")).toBeInTheDocument();
  expect(screen.queryByText(/尚未开放/)).not.toBeInTheDocument();
});

test("能力平台：路由配置读不到时不显示调用路径那一行，不猜一个档位", async () => {
  renderSection(
    "skills",
    skillsApi({ capabilityRouting: vi.fn().mockRejectedValue(new Error("503")) } as Partial<Api>),
  );
  await capabilityRows("技能");
  expect(screen.queryByText(/能力调用路径/)).not.toBeInTheDocument();
});

// ───────────────────────── Runos 清单（ADR-020 §6.2 / RY-204） ─────────────────────────

const CATALOG_ITEMS = [
  {
    capabilityId: "opensensenova.sn-deep-research",
    primitiveType: "skill",
    title: "Deep Research",
    displayName: { "zh-CN": "深度研究", en: "Deep Research" },
    category: "research",
    tags: ["preset"],
    summary: "多步研究",
    local: { runnable: true, via: "preset-skill" },
  },
  {
    capabilityId: "addyosmani.api-and-interface-design",
    primitiveType: "skill",
    title: "API and Interface Design",
    tags: [],
    local: { runnable: false },
  },
  {
    capabilityId: "markitdown.document-to-markdown",
    primitiveType: "connector",
    title: "Document to Markdown",
    category: "document",
    tags: [],
    local: { runnable: false },
  },
];

function catalogPage(over: Record<string, unknown> = {}) {
  return {
    items: CATALOG_ITEMS,
    total: 3,
    source: {
      kind: "platform",
      state: "synced",
      fetchedAt: "2026-09-15T08:00:00Z",
      total: 3,
      ref: "sha256:abc",
      diff: { added: 2, removed: 0, changed: 1 },
    },
    ...over,
  };
}

async function catalogBlock(): Promise<HTMLElement> {
  const title = await screen.findByText("Runos 清单");
  return title.closest("section") as HTMLElement;
}

test("Runos 清单：平台还没有目录端点时如实说没有 —— 刷新不可点、没有筛选，第一句就说它不是安装", async () => {
  renderSection(
    "skills",
    skillsApi({
      capabilityCatalog: vi.fn().mockResolvedValue({
        items: [],
        total: 0,
        source: { kind: "platform", state: "unavailable", reason: "平台尚未提供能力目录（vxture-platform#339）" },
      }),
    } as Partial<Api>),
  );
  expect(await screen.findByText("平台尚未提供能力目录，暂时没有清单。")).toBeInTheDocument();
  expect(screen.getByText(/vxture-platform#339/)).toBeInTheDocument();
  expect(screen.getByText(/不是安装：条目不会下载到本机/)).toBeInTheDocument();
  expect(within(await catalogBlock()).getByRole("button", { name: "刷新" })).toBeDisabled();
  expect(screen.queryByRole("textbox", { name: "搜索 Runos 清单" })).not.toBeInTheDocument();
});

test("Runos 清单：有数据源、还没取到过 —— 说还没有，并转达上次失败的原因", async () => {
  renderSection(
    "skills",
    skillsApi({
      capabilityCatalog: vi.fn().mockResolvedValue({
        items: [],
        total: 0,
        source: { kind: "platform", state: "never", reason: "取到 2 条，平台说共 3 条" },
      }),
    } as Partial<Api>),
  );
  expect(await screen.findByText("还没有取到 Runos 清单。")).toBeInTheDocument();
  expect(screen.getByText("取到 2 条，平台说共 3 条")).toBeInTheDocument();
  expect(within(await catalogBlock()).getByRole("button", { name: "刷新" })).toBeEnabled();
});

test("Runos 清单：旧的一份照样列，但说清是哪一刻的、为什么没更新", async () => {
  renderSection(
    "skills",
    skillsApi({
      capabilityCatalog: vi.fn().mockResolvedValue(
        catalogPage({
          source: { kind: "platform", state: "stale", fetchedAt: "2026-09-14T08:00:00Z", total: 3, reason: "HTTP 502" },
        }),
      ),
    } as Partial<Api>),
  );
  expect(await screen.findByText(/^显示的是 .+ 时的清单，之后没能更新。$/)).toBeInTheDocument();
  expect(screen.getByText("HTTP 502")).toBeInTheDocument();
  expect(screen.queryByText(/本次新增/)).not.toBeInTheDocument();
});

test("Runos 清单：同步过的一份 —— 条数、时间、本次变化，每条标本机能不能跑（D4）", async () => {
  renderSection("skills", skillsApi({ capabilityCatalog: vi.fn().mockResolvedValue(catalogPage()) } as Partial<Api>));
  expect(await screen.findByText(/^共 3 项 · 更新于 /)).toBeInTheDocument();
  expect(screen.getByText("本次新增 2 · 下线 0 · 变更 1")).toBeInTheDocument();
  const rows = within(screen.getByRole("list", { name: "Runos 清单条目" })).getAllByRole("listitem");
  expect(rows).toHaveLength(3);
  // 中文显示名优先，没有才用 title
  expect(within(rows[0]!).getByText("深度研究")).toBeInTheDocument();
  expect(within(rows[0]!).getByText("本机可运行")).toBeInTheDocument();
  expect(within(rows[0]!).getByText("research")).toBeInTheDocument();
  expect(within(rows[1]!).getByText("API and Interface Design")).toBeInTheDocument();
  expect(within(rows[1]!).getByText("本机无")).toBeInTheDocument();
  expect(within(rows[2]!).getByText("markitdown.document-to-markdown")).toBeInTheDocument();
  expect(within(rows[2]!).getByText("仅云端")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "再显示更多" })).not.toBeInTheDocument();
});

test("Runos 清单：没有变化时不说「本次新增 0」", async () => {
  renderSection(
    "skills",
    skillsApi({
      capabilityCatalog: vi.fn().mockResolvedValue(
        catalogPage({
          source: { kind: "platform", state: "synced", total: 3, diff: { added: 0, removed: 0, changed: 0 } },
        }),
      ),
    } as Partial<Api>),
  );
  expect(await screen.findByText(/^共 3 项 · 更新于 —$/)).toBeInTheDocument();
  expect(screen.queryByText(/本次新增/)).not.toBeInTheDocument();
});

test("Runos 清单：按类型筛选交给守护进程；筛完没有就说没有，筛选本身还在", async () => {
  const capabilityCatalog = vi
    .fn()
    .mockResolvedValueOnce(catalogPage())
    .mockResolvedValue(catalogPage({ items: [], total: 0 }));
  renderSection("skills", skillsApi({ capabilityCatalog } as Partial<Api>));
  await screen.findByRole("list", { name: "Runos 清单条目" });
  await userEvent.click(screen.getByRole("radio", { name: "执行器" }));
  await waitFor(() => expect(capabilityCatalog).toHaveBeenLastCalledWith({ type: "executor" }));
  expect(await screen.findByText("没有符合条件的条目。")).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "执行器" })).toBeInTheDocument();
});

test("Runos 清单：搜索词交给守护进程（q），空白不发", async () => {
  const capabilityCatalog = vi.fn().mockResolvedValue(catalogPage());
  renderSection("skills", skillsApi({ capabilityCatalog } as Partial<Api>));
  const box = await screen.findByRole("textbox", { name: "搜索 Runos 清单" });
  fireEvent.change(box, { target: { value: " excel " } });
  await waitFor(() => expect(capabilityCatalog).toHaveBeenLastCalledWith({ q: "excel" }));
  fireEvent.change(box, { target: { value: "   " } });
  await waitFor(() => expect(capabilityCatalog).toHaveBeenLastCalledWith({}));
});

test("Runos 清单：「再显示更多」带着游标取下一页并接在后面；取完按钮就没了", async () => {
  const capabilityCatalog = vi
    .fn()
    .mockResolvedValueOnce(catalogPage({ items: CATALOG_ITEMS.slice(0, 2), nextCursor: "2" }))
    .mockResolvedValueOnce(catalogPage({ items: CATALOG_ITEMS.slice(2) }));
  renderSection("skills", skillsApi({ capabilityCatalog } as Partial<Api>));
  await userEvent.click(await screen.findByRole("button", { name: "再显示更多" }));
  await waitFor(() => expect(capabilityCatalog).toHaveBeenLastCalledWith({ cursor: "2" }));
  await waitFor(() =>
    expect(within(screen.getByRole("list", { name: "Runos 清单条目" })).getAllByRole("listitem")).toHaveLength(3),
  );
  expect(screen.queryByRole("button", { name: "再显示更多" })).not.toBeInTheDocument();
});

test("Runos 清单：翻页失败留着已经列出的，并说一句", async () => {
  const capabilityCatalog = vi
    .fn()
    .mockResolvedValueOnce(catalogPage({ items: CATALOG_ITEMS.slice(0, 2), nextCursor: "2" }))
    .mockRejectedValueOnce(new Error("网络断了"));
  renderSection("skills", skillsApi({ capabilityCatalog } as Partial<Api>));
  await userEvent.click(await screen.findByRole("button", { name: "再显示更多" }));
  expect(await screen.findByText("网络断了")).toBeInTheDocument();
  expect(within(screen.getByRole("list", { name: "Runos 清单条目" })).getAllByRole("listitem")).toHaveLength(2);
});

test("Runos 清单：刷新 = 手动取一次再重读", async () => {
  const capabilityCatalog = vi.fn().mockResolvedValue(catalogPage());
  const refreshCapabilityCatalog = vi.fn().mockResolvedValue({ outcome: "synced", source: catalogPage().source });
  renderSection("skills", skillsApi({ capabilityCatalog, refreshCapabilityCatalog } as Partial<Api>));
  await userEvent.click(within(await catalogBlock()).getByRole("button", { name: "刷新" }));
  await waitFor(() => expect(refreshCapabilityCatalog).toHaveBeenCalledWith("manual"));
  await waitFor(() => expect(capabilityCatalog).toHaveBeenCalledTimes(2));
});

test("Runos 清单：刷新失败把守护进程的原因原样说出来，列表照旧", async () => {
  const capabilityCatalog = vi.fn().mockResolvedValue(catalogPage());
  const refreshCapabilityCatalog = vi
    .fn()
    .mockRejectedValue(new ApiError(502, { message: "取到 2 条，平台说共 3 条" }));
  renderSection("skills", skillsApi({ capabilityCatalog, refreshCapabilityCatalog } as Partial<Api>));
  await userEvent.click(within(await catalogBlock()).getByRole("button", { name: "刷新" }));
  expect(await screen.findByText("取到 2 条，平台说共 3 条")).toBeInTheDocument();
  expect(screen.getByRole("list", { name: "Runos 清单条目" })).toBeInTheDocument();
});

test("Runos 清单：这套装配没有清单（503）时整块不显示，不拿空列表冒充", async () => {
  renderSection(
    "skills",
    skillsApi({
      capabilityCatalog: vi.fn().mockRejectedValue(new ApiError(503, { message: "CAPABILITY_CATALOG_NOT_CONFIGURED" })),
    } as Partial<Api>),
  );
  await capabilityRows("技能");
  expect(screen.queryByText("Runos 清单")).not.toBeInTheDocument();
});
