/**
 * Workbench (workbench.tsx): the host chrome - header identity, sidebar
 * sections, search, view routing. HomePage/SettingsView/ProjectPanel/
 * UserSlot/PendingInbox each already have their own dedicated test file, so
 * they're mocked to stubs here; this file is about Workbench's own
 * orchestration (which view is showing, what the header/sidebar say about
 * it, refreshSidebar's error handling, the focus-driven entitlements pull),
 * not re-testing children that are already covered.
 *
 * useHostChrome reads navigator.userAgent into a module-scope constant at
 * import time, not per-render - jsdom's default UA never contains
 * "Electron", so every test here runs in "browser" chrome except the one
 * that explicitly stubs the UA and re-imports the module (vi.resetModules)
 * before rendering, to prove the electron branch too.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Api, type ProductInfo, type ProjectList, type ProjectMeta } from "./api";

vi.mock("./home", () => ({
  HomePage: (props: {
    onOpen: (id: string) => void;
    onCreated: (id: string) => Promise<void>;
  }) => (
    <div data-testid="home-stub">
      home
      <button onClick={() => props.onOpen("prj_from_home")}>home-stub-open</button>
      <button onClick={() => void props.onCreated("prj_from_created")}>
        home-stub-created
      </button>
    </div>
  ),
}));
// SETTINGS_SECTIONS/PROJECT_TABS now live in their own tiny modules (so the
// sidebar doesn't drag in the lazy-loaded SettingsView/ProjectPanel just to
// read the section/tab list - see workspace-tabs.ts's header comment) -
// mocked separately from the components themselves, with the same real data.
vi.mock("./settings-sections", () => ({
  SETTINGS_SECTIONS: [
    { id: "account", label: "账户", icon: "role" },
    { id: "general", label: "通用", icon: "settings" },
    { id: "privacy", label: "数据与隐私", icon: "lock" },
    { id: "updates", label: "软件更新", icon: "arrow-down" },
    { id: "about", label: "关于", icon: "info" },
  ],
}));
vi.mock("./settings", () => ({
  SettingsView: ({ section }: { section: string }) => (
    <div data-testid="settings-stub">settings:{section}</div>
  ),
}));
vi.mock("./workspace-tabs", () => ({
  PROJECT_TABS: [
    { id: "overview", label: "概览" },
    { id: "context", label: "上下文" },
    { id: "tasks", label: "任务" },
    { id: "audit", label: "审计" },
  ],
}));
vi.mock("./workspace", () => ({
  ProjectPanel: (props: { id: string; tab: string; onPending: (n: number) => void }) => (
    <div data-testid="project-panel-stub">
      project:{props.id}:{props.tab}
      <button onClick={() => props.onPending(3)}>project-stub-set-pending</button>
    </div>
  ),
}));
vi.mock("./user", () => ({
  UserSlot: (props: { onOpenSettings: () => void }) => (
    <div data-testid="user-slot-stub">
      user
      <button onClick={() => props.onOpenSettings()}>user-stub-open-settings</button>
    </div>
  ),
}));
vi.mock("./pending", () => ({
  usePending: () => [],
  PendingInbox: (props: { onOpen: (id: string) => void }) => (
    <div data-testid="pending-inbox-stub">
      pending
      <button onClick={() => props.onOpen("prj_from_pending")}>pending-stub-open</button>
    </div>
  ),
}));

function product(over: Partial<ProductInfo> = {}): ProductInfo {
  return {
    id: "vxture.bid",
    name: "标书编写",
    version: "1.0.0",
    installed: true,
    state: "active",
    entitled: true,
    availability: "available",
    subscription: null,
    commercialIntent: null,
    versions: ["1.0.0"],
    managed: true,
    supply: "package",
    ...over,
  };
}

function workspace(over: Partial<ProjectMeta> = {}): ProjectMeta {
  return {
    id: "prj_1",
    productId: "vxture.bid",
    productVersion: "1.0.0",
    name: "投标项目",
    projectType: "project",
    createdAt: "2026-09-01T00:00:00Z",
    workspaceId: "wsp_1",
    ...over,
  };
}

function projectList(items: ProjectMeta[], elsewhere = 0): ProjectList {
  return { items, elsewhere };
}

function fakeApi(over: Partial<Api> = {}): Api {
  return {
    session: vi.fn().mockResolvedValue({ signedIn: false, issuer: "", consoleBase: "https://vxture.com", entitlementsConfigured: false }),
    system: vi.fn().mockResolvedValue(null),
    products: vi.fn().mockResolvedValue([]),
    projects: vi.fn().mockResolvedValue(projectList([])),
    refreshEntitlements: vi.fn().mockResolvedValue([]),
    ...over,
  } as unknown as Api;
}

// workbench.tsx pulls in the whole @vxture/design-system surface (it's the
// shell host); a cold `await import("./workbench")` in a fresh worker costs
// ~9-10s to transform, well past the 5s default - not a hang, just a big
// module graph the first time. Every test here does that import. Under
// --coverage (v8 instrumentation) plus full-suite worker contention this has
// been observed stretching past 20s once, so 30s for margin.
vi.setConfig({ testTimeout: 30_000 });

beforeEach(() => {
  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ ok: true, version: "0.2.0" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

void test("Workbench: starts on the home view, showing the brand and the home stub", async () => {
  const { Workbench } = await import("./workbench");
  render(<Workbench api={fakeApi()} />);
  expect(await screen.findByText("如影 RUYIN")).toBeInTheDocument();
  expect(screen.getByTestId("home-stub")).toBeInTheDocument();
  expect(screen.queryByTestId("settings-stub")).not.toBeInTheDocument();
});

void test("Workbench: a refreshSidebar failure surfaces as an error box, not a silent blank sidebar", async () => {
  const { Workbench } = await import("./workbench");
  const api = fakeApi({ products: vi.fn().mockRejectedValue(new Error("守护进程未响应")) });
  render(<Workbench api={api} />);
  expect(await screen.findByText("守护进程未响应")).toBeInTheDocument();
});

void test("Workbench: clicking 设置 switches the header identity, sidebar domain, and main content together", async () => {
  const { Workbench } = await import("./workbench");
  render(<Workbench api={fakeApi()} />);
  await screen.findByTestId("home-stub");

  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "设置" }));

  expect(await screen.findByTestId("settings-stub")).toHaveTextContent("settings:account");
  // "设置"同时出现在标题栏身份、侧栏域名、侧栏分区项里，都是预期行为——
  // 钉标题栏身份那一处（产品名/项目名那一路让给它）。
  expect(screen.getByText("设置", { selector: ".app-ident-product" })).toBeInTheDocument();
  // 回工作台的箭头出现了 —— 不再是 home 视图。
  expect(screen.getByRole("button", { name: "回到工作台" })).toBeInTheDocument();
});

void test("Workbench: opening a project shows its product/project identity in the header and routes the panel", async () => {
  const { Workbench } = await import("./workbench");
  const api = fakeApi({
    products: vi.fn().mockResolvedValue([product()]),
    projects: vi.fn().mockResolvedValue(projectList([workspace({ id: "prj_open", name: "我的投标" })])),
  });
  render(<Workbench api={api} />);

  const user = userEvent.setup();
  await user.click(await screen.findByText("我的投标"));

  expect(await screen.findByTestId("project-panel-stub")).toHaveTextContent(
    "project:prj_open:overview",
  );
  // 产品名/项目名同时出现在标题栏与侧栏，都是预期行为——钉标题栏那一处。
  expect(screen.getByText("标书编写", { selector: ".app-ident-product" })).toBeInTheDocument();
  expect(screen.getByText("我的投标", { selector: ".app-ident-doc" })).toBeInTheDocument();
});

void test("Workbench: 设置 always lands on the account section", async () => {
  // navigate() 里真有一条"未知分区名回退到 account"的分支，但 navigate() 只能
  // 通过 NavLink 的 href 触发，而侧栏/标题栏能点到的 href 全部来自
  // SETTINGS_SECTIONS 这份固定数据——没有一条真实交互路径能拼出一个不存在的
  // 分区名。所以这里只如实验证唯一可达的路径：点"设置"落在 account。
  const { Workbench } = await import("./workbench");
  render(<Workbench api={fakeApi()} />);
  await screen.findByTestId("home-stub");

  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "设置" }));
  await screen.findByTestId("settings-stub");
  expect(screen.getByTestId("settings-stub")).toHaveTextContent("settings:account");
});

void test("Workbench: the sidebar splits attributed projects from the unattributed import queue", async () => {
  const { Workbench } = await import("./workbench");
  const api = fakeApi({
    projects: vi.fn().mockResolvedValue(
      projectList([
        workspace({ id: "prj_mine", name: "我的项目", workspaceId: "wsp_1" }),
        workspace({ id: "prj_legacy", name: "老项目", workspaceId: undefined }),
      ]),
    ),
  });
  render(<Workbench api={api} />);
  expect(await screen.findByText("最近工作")).toBeInTheDocument();
  expect(screen.getByText("待导入工作区")).toBeInTheDocument();
  expect(screen.getByText("我的项目")).toBeInTheDocument();
  expect(screen.getByText("老项目")).toBeInTheDocument();
});

void test("Workbench: 最近工作 is newest-first, and each row carries its product as the second line", async () => {
  const { Workbench } = await import("./workbench");
  const api = fakeApi({
    products: vi
      .fn()
      .mockResolvedValue([product({ id: "vxture.bid", name: "标书编写" })]),
    projects: vi.fn().mockResolvedValue(
      projectList([
        workspace({
          id: "prj_old",
          name: "旧的",
          workspaceId: "wsp_1",
          createdAt: "2026-01-01T00:00:00Z",
        }),
        workspace({
          id: "prj_new",
          name: "新的",
          workspaceId: "wsp_1",
          createdAt: "2026-09-01T00:00:00Z",
        }),
      ]),
    ),
  });
  render(<Workbench api={api} />);
  await screen.findByText("最近工作");
  // 产品名走第二行：项目名是他要找的东西，产品名是用来区分重名的上下文。
  expect(screen.getAllByText("标书编写").length).toBeGreaterThan(0);
  const rows = screen.getAllByRole("link").map((a) => a.textContent ?? "");
  const iNew = rows.findIndex((t) => t.includes("新的"));
  const iOld = rows.findIndex((t) => t.includes("旧的"));
  expect(iNew).toBeGreaterThanOrEqual(0);
  expect(iNew).toBeLessThan(iOld);
});

void test("Workbench: with no real project the 最近工作 samples show, marked 示例 and linking nowhere", async () => {
  const { Workbench } = await import("./workbench");
  const { DEMO_RECENT } = await import("./catalog");
  const api = fakeApi({ projects: vi.fn().mockResolvedValue(projectList([])) });
  render(<Workbench api={api} />);
  await screen.findByText("最近工作");
  const sample = DEMO_RECENT[0]!;
  // 样例不指向任何项目路由 —— 一个点进去是空的项目，比没有这一组更让人困惑。
  // 而且每条 href 必须唯一：侧栏拿它当 key，撞 key 会让这一组删不干净。
  const hrefs = DEMO_RECENT.map(
    (d) => screen.getByText(d.project).closest("a")?.getAttribute("href") ?? "",
  );
  expect(new Set(hrefs).size).toBe(DEMO_RECENT.length);
  for (const h of hrefs) {
    expect(h).not.toMatch(/^#ws\//);
  }
  expect(screen.getByText(sample.project).closest("a")).toHaveAttribute(
    "href",
    "#sample/0",
  );
  // 同一个产品下可以有多条样例，所以按 All 取。
  expect(screen.getAllByText(`示例 · ${sample.product}`).length).toBeGreaterThan(0);
});

void test("Workbench: one real project and the whole sample group is gone - never mixed together", async () => {
  const { Workbench } = await import("./workbench");
  const { DEMO_RECENT } = await import("./catalog");
  const api = fakeApi({
    projects: vi
      .fn()
      .mockResolvedValue(
        projectList([workspace({ id: "prj_real", name: "真项目", workspaceId: "wsp_1" })]),
      ),
  });
  render(<Workbench api={api} />);
  expect(await screen.findByText("真项目")).toBeInTheDocument();
  // 真假混排是最坏的一种：用户没有办法分辨哪一条是自己的。
  for (const d of DEMO_RECENT) {
    expect(screen.queryByText(d.project)).not.toBeInTheDocument();
  }
});

void test("Workbench: projects left in other workspaces are reported by count only, in the sidebar footer", async () => {
  const { Workbench } = await import("./workbench");
  const api = fakeApi({ projects: vi.fn().mockResolvedValue(projectList([], 3)) });
  render(<Workbench api={api} />);
  expect(await screen.findByText("另有 3 个项目在其他工作区")).toBeInTheDocument();
});

void test("Workbench: search filters across projects, products, and actions by the typed query", async () => {
  const { Workbench } = await import("./workbench");
  const api = fakeApi({
    products: vi.fn().mockResolvedValue([product({ name: "标书编写" })]),
    projects: vi.fn().mockResolvedValue(projectList([workspace({ name: "某储能电站投标" })])),
  });
  render(<Workbench api={api} />);
  await screen.findByTestId("home-stub");

  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText("搜索项目、产品与动作…"), "储能");

  // "某储能电站投标"同时出现在侧栏项目导航与搜索结果列表里，都是预期
  // 行为——结果列表（cmdk，role="option"/"listbox"）才是这条断言要盯的地方。
  const results = within(await screen.findByRole("listbox"));
  expect(await results.findByText("某储能电站投标")).toBeInTheDocument();
  expect(results.queryByText("标书编写")).not.toBeInTheDocument();
  expect(results.queryByText("回到首页")).not.toBeInTheDocument();
});

void test("Workbench: search surfaces a matching action, and selecting it navigates there", async () => {
  const { Workbench } = await import("./workbench");
  render(<Workbench api={fakeApi()} />);
  await screen.findByTestId("home-stub");

  // 弹层的开合完全由 query 是否非空决定（点击/聚焦/方向键都不开），所以
  // "空查询也能看到默认动作"这个前提本身不成立——真实组件里，输入框一旦清空
  // 弹层立刻关。这里改成断言真实行为：查询词只命中动作标签时，只有它出现。
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText("搜索项目、产品与动作…"), "设置");

  const results = within(await screen.findByRole("listbox"));
  expect(await results.findByText("打开设置")).toBeInTheDocument();
  expect(results.queryByText("回到首页")).not.toBeInTheDocument();

  await user.click(results.getByText("打开设置"));
  expect(await screen.findByTestId("settings-stub")).toHaveTextContent("settings:account");
});

void test("Workbench: the runtime health badge reflects a real /health failure, not a stale 就绪", async () => {
  globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
  const { Workbench } = await import("./workbench");
  render(<Workbench api={fakeApi()} />);
  expect(await screen.findByText("未连接")).toBeInTheDocument();
});

void test("Workbench: window focus triggers an entitlements refresh (D5) without an error blocking it", async () => {
  const { Workbench } = await import("./workbench");
  const refreshEntitlements = vi.fn().mockResolvedValue([product({ id: "vxture.new" })]);
  const api = fakeApi({ refreshEntitlements });
  render(<Workbench api={api} />);
  await screen.findByTestId("home-stub");

  window.dispatchEvent(new Event("focus"));
  await vi.waitFor(() => expect(refreshEntitlements).toHaveBeenCalledTimes(1));
});

void test("Workbench: opening a project with same-product siblings lists them in the sidebar", async () => {
  const { Workbench } = await import("./workbench");
  const api = fakeApi({
    products: vi.fn().mockResolvedValue([product()]),
    projects: vi.fn().mockResolvedValue(
      projectList([
        workspace({ id: "prj_a", name: "项目甲" }),
        workspace({ id: "prj_b", name: "项目乙" }),
      ]),
    ),
  });
  render(<Workbench api={api} />);

  const user = userEvent.setup();
  await user.click(await screen.findByText("项目甲"));
  await screen.findByTestId("project-panel-stub");

  expect(screen.getByText("同产品的其他项目")).toBeInTheDocument();
  expect(screen.getByText("项目乙")).toBeInTheDocument();
});

void test("Workbench: 回到工作台 navigates back to the home view from settings", async () => {
  const { Workbench } = await import("./workbench");
  render(<Workbench api={fakeApi()} />);
  await screen.findByTestId("home-stub");

  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "设置" }));
  await screen.findByTestId("settings-stub");

  await user.click(screen.getByRole("button", { name: "回到工作台" }));
  expect(await screen.findByTestId("home-stub")).toBeInTheDocument();
  expect(screen.queryByTestId("settings-stub")).not.toBeInTheDocument();
});

void test("Workbench: the sidebar collapse toggle flips collapsed state", async () => {
  const { Workbench } = await import("./workbench");
  render(<Workbench api={fakeApi()} />);
  await screen.findByTestId("home-stub");

  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "收起导航" }));
  expect(await screen.findByRole("button", { name: "展开导航" })).toBeInTheDocument();
});

void test("Workbench: selecting a project from search results opens it", async () => {
  const { Workbench } = await import("./workbench");
  const api = fakeApi({
    projects: vi.fn().mockResolvedValue(
      projectList([workspace({ id: "prj_x", name: "某储能电站投标" })]),
    ),
  });
  render(<Workbench api={api} />);
  await screen.findByTestId("home-stub");

  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText("搜索项目、产品与动作…"), "储能");
  const results = within(await screen.findByRole("listbox"));
  await user.click(await results.findByText("某储能电站投标"));

  expect(await screen.findByTestId("project-panel-stub")).toHaveTextContent(
    "project:prj_x:overview",
  );
});

void test("Workbench: search results for a product and for 回到首页 both navigate back to home", async () => {
  const { Workbench } = await import("./workbench");
  const api = fakeApi({ products: vi.fn().mockResolvedValue([product({ name: "标书编写" })]) });
  render(<Workbench api={api} />);
  await screen.findByTestId("home-stub");
  const user = userEvent.setup();
  const box = screen.getByPlaceholderText("搜索项目、产品与动作…");

  // 产品搜索结果的 onSelect。
  await user.click(screen.getByRole("button", { name: "设置" }));
  await screen.findByTestId("settings-stub");
  await user.type(box, "标书");
  await user.click(await within(await screen.findByRole("listbox")).findByText("标书编写"));
  await screen.findByTestId("home-stub");

  // "回到首页"动作的 onSelect —— 和上面是两处不同的闭包，各自要摸到。
  await user.click(screen.getByRole("button", { name: "设置" }));
  await screen.findByTestId("settings-stub");
  await user.type(box, "首页");
  await user.click(await within(await screen.findByRole("listbox")).findByText("回到首页"));
  expect(await screen.findByTestId("home-stub")).toBeInTheDocument();
});

void test("Workbench: HomePage's onOpen routes to the opened project", async () => {
  const { Workbench } = await import("./workbench");
  render(<Workbench api={fakeApi()} />);
  await screen.findByTestId("home-stub");

  const user = userEvent.setup();
  await user.click(screen.getByText("home-stub-open"));
  expect(await screen.findByTestId("project-panel-stub")).toHaveTextContent(
    "project:prj_from_home:overview",
  );
});

void test("Workbench: HomePage's onCreated refreshes the sidebar and opens the new project", async () => {
  const { Workbench } = await import("./workbench");
  const api = fakeApi();
  render(<Workbench api={api} />);
  await screen.findByTestId("home-stub");

  const user = userEvent.setup();
  await user.click(screen.getByText("home-stub-created"));
  expect(await screen.findByTestId("project-panel-stub")).toHaveTextContent(
    "project:prj_from_created:overview",
  );
  // openProject 先 refreshSidebar() 才 setView —— 挂载时已经拉过一次，创建
  // 后这是第二次，不是没刷新就跳。
  expect(api.projects).toHaveBeenCalledTimes(2);
});

void test("Workbench: PendingInbox's onOpen routes to the pending project", async () => {
  const { Workbench } = await import("./workbench");
  render(<Workbench api={fakeApi()} />);
  await screen.findByTestId("home-stub");

  const user = userEvent.setup();
  await user.click(screen.getByText("pending-stub-open"));
  expect(await screen.findByTestId("project-panel-stub")).toHaveTextContent(
    "project:prj_from_pending:overview",
  );
});

void test("Workbench: UserSlot's onOpenSettings opens settings", async () => {
  const { Workbench } = await import("./workbench");
  render(<Workbench api={fakeApi()} />);
  await screen.findByTestId("home-stub");

  const user = userEvent.setup();
  await user.click(screen.getByText("user-stub-open-settings"));
  expect(await screen.findByTestId("settings-stub")).toHaveTextContent("settings:account");
});

void test("Workbench: the active workspace name shows in the header once signed in", async () => {
  const { Workbench } = await import("./workbench");
  const api = fakeApi({
    session: vi.fn().mockResolvedValue({
      signedIn: true,
      workspace: { name: "某工作区" },
      issuer: "",
      consoleBase: "https://vxture.com",
      entitlementsConfigured: false,
    }),
  });
  render(<Workbench api={api} />);
  await screen.findByTestId("home-stub");
  expect(await screen.findByText("某工作区")).toBeInTheDocument();
});

void test("Workbench: search also matches a project by its productId, not just its name", async () => {
  const { Workbench } = await import("./workbench");
  const api = fakeApi({
    projects: vi.fn().mockResolvedValue(
      projectList([workspace({ name: "无关名字", productId: "vxture.bid" })]),
    ),
  });
  render(<Workbench api={api} />);
  await screen.findByTestId("home-stub");

  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText("搜索项目、产品与动作…"), "vxture.bid");
  const results = within(await screen.findByRole("listbox"));
  expect(await results.findByText("无关名字")).toBeInTheDocument();
});

void test("Workbench: pending task count from an open project appends to the 任务 tab label", async () => {
  const { Workbench } = await import("./workbench");
  const api = fakeApi({
    products: vi.fn().mockResolvedValue([product()]),
    projects: vi.fn().mockResolvedValue(projectList([workspace({ id: "prj_1" })])),
  });
  render(<Workbench api={api} />);

  const user = userEvent.setup();
  await user.click(await screen.findByText("投标项目"));
  await screen.findByTestId("project-panel-stub");

  await user.click(screen.getByText("project-stub-set-pending"));
  expect(await screen.findByText("任务（3）")).toBeInTheDocument();
});

void test("Workbench (electron chrome): the caption-button spacer appears, browser chrome's does not", async () => {
  vi.resetModules();
  vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Electron/30.0.0" });
  const { Workbench } = await import("./workbench");
  const { container } = render(<Workbench api={fakeApi()} />);
  await screen.findByTestId("home-stub");
  expect(container.querySelector(".caption-spacer")).toBeInTheDocument();
});

