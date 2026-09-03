/**
 * HomePage (home.tsx): the work entry point. products/workspaces/health
 * arrive as props (the parent already fetched them); HomePage itself only
 * fetches session()/system() for display. Most of the file's real logic is
 * pure derivation from those props - usable vs blocked, subscriptionKnown,
 * which commercial entry point to show - so most of these tests don't need
 * to mock fetch at all, just build the right ProductInfo/ProjectMeta shapes.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomePage } from "./home";
import { CATALOG, CATALOG_SOURCE, RECOMMENDED } from "./catalog";
import { Api, type ProductInfo, type ProjectMeta, type SessionInfo } from "./api";

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

function fakeApi(over: Partial<Api> = {}): Api {
  return {
    session: vi.fn().mockResolvedValue(null),
    system: vi.fn().mockResolvedValue(null),
    installPackage: vi.fn(),
    fetchProduct: vi.fn().mockResolvedValue({ status: "current" }),
    activateProduct: vi.fn(),
    deactivateProduct: vi.fn(),
    createProject: vi.fn(),
    pinProductVersion: vi.fn(),
    ...over,
  } as unknown as Api;
}

function noop() {}

beforeEach(() => {
  vi.stubGlobal("open", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

void test("HomePage: zero usable products while signed out guides to login, not a first-purchase pitch already", async () => {
  const api = fakeApi({ session: vi.fn().mockResolvedValue({ signedIn: false } as SessionInfo) });
  render(
    <HomePage
      api={api}
      products={[]}
      workspaces={[]}
      health={{ ok: true, version: "0.1.0" }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={noop}
      onError={noop}
    />,
  );
  expect(await screen.findByText("登录后同步你的智能体")).toBeInTheDocument();
});

void test("HomePage: zero usable products while signed in says so, not a login prompt", async () => {
  const api = fakeApi({
    session: vi.fn().mockResolvedValue({ signedIn: true } as SessionInfo),
  });
  render(
    <HomePage
      api={api}
      products={[]}
      workspaces={[]}
      health={{ ok: true }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={noop}
      onError={noop}
    />,
  );
  expect(await screen.findByText("当前账号没有可用的智能体")).toBeInTheDocument();
});

void test("HomePage: the empty-state button opens the platform subscribe page in a new tab", async () => {
  const api = fakeApi({
    session: vi.fn().mockResolvedValue({ signedIn: false, consoleBase: "https://vxture.com" } as SessionInfo),
  });
  render(
    <HomePage
      api={api}
      products={[]}
      workspaces={[]}
      health={{ ok: true }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={noop}
      onError={noop}
    />,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByText("到 Vxture 平台订阅"));
  expect(globalThis.open).toHaveBeenCalledWith(
    "https://vxture.com/subscribe",
    "_blank",
    "noopener",
  );
});

// --- 概况三张卡 --------------------------------------------------------------
//
// 从四张减到三张：「可用产品」「项目」是下面列表的计数，把同一份事实说两遍，
// 占掉的是首屏最贵的位置。留下的三张各自回答一件**框架自己的事**。

void test("HomePage: the metric row is the three framework facts - runtime, encryption, platform", async () => {
  const api = fakeApi({
    system: vi.fn().mockResolvedValue({ keyProtection: "dpapi" }),
    session: vi.fn().mockResolvedValue({
      signedIn: true,
      workspace: { name: "演示工作区" },
    } as unknown as SessionInfo),
  });
  render(
    <HomePage
      api={api}
      products={[product()]}
      workspaces={[workspace(), workspace({ id: "prj_2" })]}
      health={{ ok: true, version: "0.2.0" }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={noop}
      onError={noop}
    />,
  );
  expect(screen.getByText("运行环境")).toBeInTheDocument();
  expect(screen.getByText("已就绪")).toBeInTheDocument();
  expect(screen.getByText("Runtime 0.2.0")).toBeInTheDocument();

  expect(screen.getByText("数据加密")).toBeInTheDocument();
  expect(await screen.findByText("已加密")).toBeInTheDocument();

  expect(screen.getByText("平台连接")).toBeInTheDocument();
  expect(await screen.findByText("已连接")).toBeInTheDocument();

  // 砍掉的两张不该以任何形式回来。
  expect(screen.queryByText("可用产品")).not.toBeInTheDocument();
  expect(screen.queryByText("本地业务项目")).not.toBeInTheDocument();
});

void test("HomePage: signed out, 平台连接 says 未登录 and points at logging in - it does not read as 已连接", async () => {
  const api = fakeApi({
    session: vi.fn().mockResolvedValue({ signedIn: false } as SessionInfo),
  });
  render(
    <HomePage
      api={api}
      products={[product()]}
      workspaces={[]}
      health={{ ok: true }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={noop}
      onError={noop}
    />,
  );
  expect(await screen.findByText("未登录")).toBeInTheDocument();
  expect(screen.queryByText("已连接")).not.toBeInTheDocument();
  // 「该怎么办」是解释，进 tooltip；版面上只留结论。
  const platform = document.querySelectorAll(".status-card")[2];
  expect(platform?.getAttribute("title")).toContain("登录 Vxture 账号");
});

void test("HomePage: an unreachable daemon shows 未连接, not a stale 就绪", () => {
  render(
    <HomePage
      api={fakeApi()}
      products={[]}
      workspaces={[]}
      health={{ ok: false }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={noop}
      onError={noop}
    />,
  );
  expect(screen.getByText("未连接")).toBeInTheDocument();
  expect(document.querySelector(".status-card")?.getAttribute("title")).toContain(
    "守护进程未响应",
  );
});

void test("HomePage: entitled products with entitled=null anywhere still count as 'subscription unknown', shows the caveat line", () => {
  render(
    <HomePage
      api={fakeApi()}
      products={[product({ entitled: null })]}
      workspaces={[]}
      health={{ ok: true }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={noop}
      onError={noop}
    />,
  );
  expect(screen.getByText("订阅状态尚未接通，以下为本地运行时已安装的产品。")).toBeInTheDocument();
});

void test("HomePage: once any product has a known entitlement, the caveat line disappears", () => {
  render(
    <HomePage
      api={fakeApi()}
      products={[product({ entitled: true })]}
      workspaces={[]}
      health={{ ok: true }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={noop}
      onError={noop}
    />,
  );
  expect(
    screen.queryByText("订阅状态尚未接通，以下为本地运行时已安装的产品。"),
  ).not.toBeInTheDocument();
});

// --- ProductCard -------------------------------------------------------------
//
// 一种卡片同时服务可用与不可用的产品：不可用的仍然列出（§18.5 数据可达），
// 只是动作换成「启用 / 去平台订阅」。以前它们分在两个 Section 里，同一个产品
// 换个订阅状态就跳到另一栏去，读起来像两种东西。

function renderHome(over: {
  products?: ProductInfo[];
  workspaces?: ProjectMeta[];
  api?: Api;
  onOpen?: (id: string) => void;
  onCreated?: (id: string) => void | Promise<void>;
  onRefresh?: () => void | Promise<void>;
  onError?: (msg: string) => void;
} = {}) {
  render(
    <HomePage
      api={over.api ?? fakeApi()}
      products={over.products ?? [product()]}
      workspaces={over.workspaces ?? []}
      health={{ ok: true, version: "0.1.0" }}
      onOpen={over.onOpen ?? noop}
      onCreated={over.onCreated ?? noop}
      onRefresh={over.onRefresh ?? noop}
      onError={over.onError ?? noop}
    />,
  );
}

void test("ProductCard: the badge tells the four states apart - 已订阅 / 本地已装 / 未订阅 / 已停用", () => {
  renderHome({
    products: [
      product({ id: "a", name: "A", entitled: true }),
      product({ id: "b", name: "B", entitled: null }),
      product({ id: "c", name: "C", entitled: false, availability: "not_entitled" }),
      product({ id: "d", name: "D", entitled: true, availability: "disabled" }),
    ],
  });
  expect(screen.getByText("已订阅")).toBeInTheDocument();
  expect(screen.getByText("本地已装")).toBeInTheDocument();
  expect(screen.getByText("未订阅")).toBeInTheDocument();
  expect(screen.getByText("已停用")).toBeInTheDocument();
});

void test("ProductCard: code and version read as one subtitle - vxture.bid v2.3.0", () => {
  renderHome({
    products: [product({ id: "vxture.bid", version: "2.3.0" })],
    workspaces: [],
  });
  // 标识和版本回答的是同一个问题（哪个产品的哪一版），所以连在一行里；
  // 拆到两处会逼读者把一句话的两半自己拼回去。
  const ident = document.querySelector(".pcard-ident");
  expect(ident?.textContent?.replace(/s+/g, " ").trim()).toBe("vxture.bid v2.3.0");
});

void test("ProductCard: the project count sits on the 打开 row and says it in one breath", () => {
  renderHome({
    products: [product()],
    workspaces: [workspace(), workspace({ id: "prj_2" })],
  });
  const foot = document.querySelector(".pcard-foot");
  // 「2 项目」就够了 —— 一个个位数不需要再配一行「项目（本地/总）」来解释。
  expect(foot?.textContent).toContain("2 项目");
  // 同一行里就是那个主动作。
  expect(foot?.querySelector("button")?.textContent).toBe("打开");
  // 口径在 tooltip 里，不在版面上：那行标签会比它解释的数字还长。
  expect(foot?.querySelector(".pcard-count")).toHaveAttribute(
    "title",
    "本机上属于该产品的项目：2",
  );
});

void test("StatusCards: three cards in a row, the explanation lives in the tooltip not on the page", async () => {
  const api = fakeApi({
    system: vi.fn().mockResolvedValue({ keyProtection: "dpapi" }),
    session: vi.fn().mockResolvedValue({
      signedIn: true,
      workspace: { name: "演示工作区" },
    } as unknown as SessionInfo),
  });
  renderHome({ api, products: [product()] });
  await screen.findByText("已加密");
  const cards = document.querySelectorAll(".status-card");
  // 三件事就是三张卡 —— 合并成一根条，读者得自己去数分隔点在哪。
  expect(cards).toHaveLength(3);
  // 版面上只留结论和一小截事实；「怎么加密的」这种解释在 title 里。
  expect(cards[1]?.textContent).toContain("DPAPI");
  expect(cards[1]?.textContent).not.toContain("全库加密");
  expect(cards[1]?.getAttribute("title")).toContain("整库加密");
});

void test("ProductCard: only this product's projects are counted, not every project on the machine", () => {
  renderHome({
    products: [product({ id: "vxture.bid" })],
    workspaces: [
      workspace({ id: "p1", productId: "vxture.bid" }),
      workspace({ id: "p2", productId: "vxture.other" }),
      workspace({ id: "p3", productId: "vxture.other" }),
    ],
  });
  expect(document.querySelector(".pcard-foot")?.textContent).toContain("1 项目");
});

void test("ProductCard: 打开 enters the most recent project, not whichever came back first", async () => {
  const onOpen = vi.fn();
  renderHome({
    workspaces: [
      workspace({ id: "old", createdAt: "2026-01-01T00:00:00Z" }),
      workspace({ id: "newest", createdAt: "2026-09-01T00:00:00Z" }),
      workspace({ id: "mid", createdAt: "2026-05-01T00:00:00Z" }),
    ],
    onOpen,
  });
  await userEvent.click(screen.getByRole("button", { name: "打开" }));
  expect(onOpen).toHaveBeenCalledWith("newest");
});

void test("ProductCard: 打开 with no project yet creates the first one named after the product", async () => {
  const createProject = vi.fn().mockResolvedValue({ id: "prj_new" });
  const onCreated = vi.fn();
  renderHome({
    api: fakeApi({ createProject }),
    products: [product({ id: "vxture.bid", name: "标书编写" })],
    workspaces: [],
    onCreated,
  });
  await userEvent.click(screen.getByRole("button", { name: "打开" }));
  // 首页不再有取名字的表单：让人在还没进门时先取名，是把产品的第一步搬进了框架。
  expect(createProject).toHaveBeenCalledWith("vxture.bid", "标书编写");
  await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith("prj_new"));
});

void test("ProductCard: a failed first-project creation surfaces the daemon's reason, not a dead button", async () => {
  const onError = vi.fn();
  renderHome({
    api: fakeApi({
      createProject: vi.fn().mockRejectedValue(new Error("工作区未选定")),
    }),
    workspaces: [],
    onError,
  });
  await userEvent.click(screen.getByRole("button", { name: "打开" }));
  await vi.waitFor(() => expect(onError).toHaveBeenCalledWith("工作区未选定"));
});

void test("ProductCard: 打开 is the card's only action - 在线使用 lives once on the section header", () => {
  renderHome({ products: [product()], workspaces: [workspace({ id: "prj_1" })] });
  const foot = document.querySelector(".pcard-foot")!;
  // 每张卡再放一个指向同一个地址的「在线」，是把一个入口复制 N 份。
  expect([...foot.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
    "打开",
  ]);
  // 那个入口仍然在，只是只有一处。
  expect(screen.getByRole("button", { name: "在线使用" })).toBeInTheDocument();
});

void test("ProductCard: a blocked product cannot be opened - no 打开, no 在线", () => {
  renderHome({
    products: [product({ availability: "not_entitled", commercialIntent: "subscribe" })],
  });
  expect(screen.queryByRole("button", { name: "打开" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "在线 ↗" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "去平台订阅" })).toBeInTheDocument();
});

void test("ProductCard: a blocked product says WHY - 打不开 and 因为退订所以打不开 are different things", () => {
  renderHome({
    products: [
      product({ availability: "not_entitled", reason: "订阅已于 8 月 31 日到期" }),
    ],
  });
  expect(screen.getByText("订阅已于 8 月 31 日到期")).toBeInTheDocument();
});

void test("ProductCard: 已停用 can be re-enabled here, then refreshes; a failure calls onError", async () => {
  const activateProduct = vi.fn().mockResolvedValue(undefined);
  const onRefresh = vi.fn();
  renderHome({
    api: fakeApi({ activateProduct }),
    products: [product({ id: "vxture.bid", availability: "disabled" })],
    onRefresh,
  });
  await userEvent.click(screen.getByRole("button", { name: "启用" }));
  expect(activateProduct).toHaveBeenCalledWith("vxture.bid");
  await vi.waitFor(() => expect(onRefresh).toHaveBeenCalled());
});

void test("ProductCard: a failed 启用 calls onError with the daemon's reason", async () => {
  const onError = vi.fn();
  renderHome({
    api: fakeApi({
      activateProduct: vi.fn().mockRejectedValue(new Error("产品库缺少该版本")),
    }),
    products: [product({ availability: "disabled" })],
    onError,
  });
  await userEvent.click(screen.getByRole("button", { name: "启用" }));
  await vi.waitFor(() => expect(onError).toHaveBeenCalledWith("产品库缺少该版本"));
});

void test("ProductCard: 未订阅 without commercialIntent shows no subscribe button (bundled-covered, D4)", () => {
  renderHome({
    products: [
      product({ availability: "not_entitled", entitled: false, commercialIntent: null }),
    ],
  });
  expect(screen.queryByRole("button", { name: /去平台(订阅|续费)/ })).not.toBeInTheDocument();
});

void test("ProductCard: renew intent links to the renew flow, not first-purchase", async () => {
  renderHome({
    products: [
      product({
        id: "vxture.crm",
        availability: "not_entitled",
        commercialIntent: "renew",
      }),
    ],
  });
  await userEvent.click(screen.getByRole("button", { name: "去平台续费" }));
  expect(globalThis.open).toHaveBeenCalledWith(
    "https://vxture.com/subscribe?product=vxture.crm&intent=renew",
    "_blank",
    "noopener",
  );
});

void test("ProductCard: per-product operations moved off the home page - no 新建项目 / 停用 / version picker", () => {
  renderHome({
    products: [product({ versions: ["1.0.0", "1.1.0"] })],
    workspaces: [workspace()],
  });
  // 进了产品就是进了另一套框架：这些操作归产品自己，不该在框架首页上。
  expect(screen.queryByText("新建项目")).not.toBeInTheDocument();
  expect(screen.queryByText("停用")).not.toBeInTheDocument();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
});

void test("HomePage: 我的智能体 的标题行链接是「在线使用」，落到 console 的应用中心", async () => {
  renderHome({ products: [product()] });
  await userEvent.click(screen.getByRole("button", { name: "在线使用" }));
  expect(globalThis.open).toHaveBeenCalledWith(
    "https://vxture.com/zh-CN/appcenter",
    "_blank",
    "noopener",
  );
});

// --- 热门推荐 ----------------------------------------------------------------
//
// 这一栏说的是「平台上有这些」，不是「你有这些」。两者混淆正是首页那条硬规则
// （不得硬编码产品）要防的事，所以下面几条测的核心就是这条边界。

void test("热门智能体: renders the platform catalog with its real 正式版 / 开发中 status", () => {
  renderHome({ products: [] });
  expect(screen.getByText("热门智能体")).toBeInTheDocument();
  const released = RECOMMENDED.filter((c) => c.status === "released");
  const building = RECOMMENDED.filter((c) => c.status === "building");
  for (const c of RECOMMENDED) {
    expect(screen.getByText(c.name)).toBeInTheDocument();
  }
  expect(screen.getAllByText("正式版")).toHaveLength(released.length);
  expect(screen.getAllByText("开发中")).toHaveLength(building.length);
  // Only the top three (owner): the rest of the catalog is not on the home page.
  expect(RECOMMENDED).toHaveLength(3);
  for (const c of CATALOG.slice(3)) {
    expect(screen.queryByText(c.name)).not.toBeInTheDocument();
  }
});

void test("热门智能体: every card says 了解详情, never a subscribe action the link cannot honour", () => {
  renderHome({ products: [] });
  // 这个链接落在目录页，不是某个产品的订阅流程 —— 所以按钮不写「订阅」，
  // 上没上线交给状态徽章说。写成「去平台订阅」是拿做不到的动作骗点击。
  expect(screen.getAllByRole("button", { name: "了解详情" })).toHaveLength(
    RECOMMENDED.length,
  );
  expect(
    screen.queryByRole("button", { name: "去平台订阅" }),
  ).not.toBeInTheDocument();
});

void test("热门智能体: NOTHING in the catalog is openable - 打开 belongs to products you actually have", () => {
  renderHome({ products: [] });
  // 这是这一栏与「我的智能体」之间那条线。目录里出现一个「打开」，就等于告诉
  // 用户他拥有一个其实没有的订阅 —— 首页那条硬规则防的正是这个。
  expect(screen.queryByRole("button", { name: "打开" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "在线 ↗" })).not.toBeInTheDocument();
});

void test("热门智能体: says where the list came from and when - it is a snapshot, not live", () => {
  renderHome({ products: [] });
  expect(
    screen.getByText(`取自 Vxture 平台目录（${CATALOG_SOURCE.capturedAt} 快照）。`),
  ).toBeInTheDocument();
});

void test("热门智能体: 浏览全部 opens the real catalog page", async () => {
  renderHome({ products: [] });
  await userEvent.click(screen.getByRole("button", { name: "浏览全部" }));
  expect(globalThis.open).toHaveBeenCalledWith(
    CATALOG_SOURCE.url,
    "_blank",
    "noopener",
  );
});

void test("热门智能体: a card's 了解详情 opens the catalog page in a new tab, and opens nothing local", async () => {
  const onOpen = vi.fn();
  renderHome({ products: [], onOpen });
  await userEvent.click(screen.getAllByRole("button", { name: "了解详情" })[0]!);
  expect(globalThis.open).toHaveBeenCalledWith(
    CATALOG_SOURCE.url,
    "_blank",
    "noopener",
  );
  // 目录里的东西不是你的：点它不该把任何本地项目打开。
  expect(onOpen).not.toHaveBeenCalled();
});

void test("热门智能体: capability tags come from the catalog entry, not invented per card", () => {
  renderHome({ products: [] });
  const first = CATALOG[0]!;
  for (const cap of first.capabilities) {
    expect(screen.getAllByText(cap).length).toBeGreaterThan(0);
  }
});

// --- InstallPackageRow --------------------------------------------------------

void test("InstallPackageRow: a DS button opens the picker - the browser-rendered control is hidden", async () => {
  const { container } = render(
    <HomePage
      api={fakeApi()}
      products={[]}
      workspaces={[]}
      health={{ ok: true }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={noop}
      onError={noop}
    />,
  );
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  // 原生控件由浏览器渲染，文案跟浏览器语言走（Choose File / No file chosen），
  // 改不掉，每个平台长得还不一样 —— 所以藏起来，由按钮代打开。功能仍走这个 input。
  expect(input).toBeInTheDocument();
  const clicked = vi.spyOn(input, "click");
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "安装" }));
  await user.click(await screen.findByRole("menuitem", { name: "安装本地包…" }));
  expect(clicked).toHaveBeenCalledTimes(1);
});

void test("InstallPackageRow: installing shows a busy state then the signed/unsigned result, and refreshes", async () => {
  const installPackage = vi.fn().mockResolvedValue({
    productId: "vxture.new",
    version: "1.0.0",
    signed: true,
  });
  const onDone = vi.fn();
  const { container } = render(
    <HomePage
      api={fakeApi({ installPackage } as Partial<Api>)}
      products={[]}
      workspaces={[]}
      health={{ ok: true }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={onDone}
      onError={noop}
    />,
  );
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([new Uint8Array([1, 2, 3])], "demo.ruyinpkg");
  const user = userEvent.setup();
  await user.upload(input, file);

  expect(installPackage).toHaveBeenCalledWith(file);
  expect(await screen.findByText("已安装 vxture.new@1.0.0（已副署）")).toBeInTheDocument();
});

void test("InstallPackageRow: an unsigned package says so explicitly, not the same as signed", async () => {
  const installPackage = vi.fn().mockResolvedValue({
    productId: "vxture.new",
    version: "1.0.0",
    signed: false,
  });
  const { container } = render(
    <HomePage
      api={fakeApi({ installPackage } as Partial<Api>)}
      products={[]}
      workspaces={[]}
      health={{ ok: true }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={noop}
      onError={noop}
    />,
  );
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const user = userEvent.setup();
  await user.upload(input, new File([new Uint8Array([1])], "demo.ruyinpkg"));
  expect(await screen.findByText("已安装 vxture.new@1.0.0（未签名）")).toBeInTheDocument();
});

void test("InstallPackageRow: a rejected package calls onError with the daemon's reason", async () => {
  const installPackage = vi.fn().mockRejectedValue(new Error("checksum 不符"));
  const onError = vi.fn();
  const { container } = render(
    <HomePage
      api={fakeApi({ installPackage } as Partial<Api>)}
      products={[]}
      workspaces={[]}
      health={{ ok: true }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={noop}
      onError={onError}
    />,
  );
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const user = userEvent.setup();
  await user.upload(input, new File([new Uint8Array([1])], "demo.ruyinpkg"));
  await vi.waitFor(() => expect(onError).toHaveBeenCalledWith("checksum 不符"));
});

// --- 能力面没接（TD-033）------------------------------------------------------
//
// 没配 RUYIN_CAPABILITY_BASE 时任务拿到的是 MockAIGateway 的字面量占位输出，而它
// 会一路走到用户面前当成工作成果。守护进程日志说了，但日志到不了用户眼前。

void test("HomePage: daemon says capabilitySurface=mock -> usable product card is marked 未接通 and says tasks give placeholder output, but stays openable", async () => {
  const api = fakeApi({
    system: vi.fn().mockResolvedValue({ keyProtection: "dpapi", capabilitySurface: "mock" }),
  });
  render(
    <HomePage
      api={api}
      products={[product()]}
      workspaces={[]}
      health={{ ok: true }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={noop}
      onError={noop}
    />,
  );
  expect(await screen.findByText("未接通")).toBeInTheDocument();
  expect(screen.getByText(/能力面未接通/)).toBeInTheDocument();
  // 订阅徽章不被顶掉：两件事都成立。
  expect(screen.getByText("已订阅")).toBeInTheDocument();
  // 要分清，不是要拦住：打开入口还在。
  expect(screen.getByRole("button", { name: /打开|新建/ })).toBeInTheDocument();
});

void test("HomePage: capabilitySurface=configured -> no 未接通 anywhere", async () => {
  const api = fakeApi({
    system: vi.fn().mockResolvedValue({ keyProtection: "dpapi", capabilitySurface: "configured" }),
  });
  render(
    <HomePage
      api={api}
      products={[product()]}
      workspaces={[]}
      health={{ ok: true }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={noop}
      onError={noop}
    />,
  );
  await screen.findByText("已加密");
  expect(screen.queryByText("未接通")).not.toBeInTheDocument();
  expect(screen.queryByText(/能力面未接通/)).not.toBeInTheDocument();
});

void test("HomePage: /system unknown (null) is not 'mock' - no 未接通 badge on a guess", async () => {
  const api = fakeApi({ system: vi.fn().mockResolvedValue(null) });
  render(
    <HomePage
      api={api}
      products={[product()]}
      workspaces={[]}
      health={{ ok: true }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={noop}
      onError={noop}
    />,
  );
  await vi.waitFor(() => expect(api.system).toHaveBeenCalled());
  expect(screen.queryByText("未接通")).not.toBeInTheDocument();
});

void test("HomePage: a blocked (not_entitled) card does not also get 未接通 - it will not run a task anyway", async () => {
  const api = fakeApi({
    system: vi.fn().mockResolvedValue({ keyProtection: "dpapi", capabilitySurface: "mock" }),
  });
  render(
    <HomePage
      api={api}
      products={[product({ entitled: false, availability: "not_entitled", reason: "订阅已到期" })]}
      workspaces={[]}
      health={{ ok: true }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={noop}
      onError={noop}
    />,
  );
  await screen.findByText("已加密");
  expect(screen.getByText("未订阅")).toBeInTheDocument();
  expect(screen.queryByText("未接通")).not.toBeInTheDocument();
});

/* ---------------- 静态产品库（流 C）------------------------------------------ */

const bidItem = {
  id: "vxture.bid",
  name: "标书编写",
  version: "1.0.0",
  publisher: "vxture",
  runtime: { minimum: "0.1.0" },
  size: 12345,
  signed: false,
  installed: false,
  installedVersions: [],
};

function homeWith(api: Api) {
  return render(
    <HomePage
      api={api}
      products={[]}
      workspaces={[]}
      health={{ ok: true }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={noop}
      onError={noop}
    />,
  );
}

void test("HomePage/产品库: nothing is fetched until opened; unreachable says so and does not read as empty", async () => {
  const registry = vi.fn().mockResolvedValue({ status: "unreachable", base: "https://dl", reason: "index unreachable: ECONNREFUSED", checkedAt: "t" });
  const api = fakeApi({ registry });
  homeWith(api);
  expect(registry).not.toHaveBeenCalled();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "安装" }));
  await user.click(await screen.findByRole("menuitem", { name: "从产品库安装" }));
  expect(await screen.findByText(/产品库没查到 —— index unreachable: ECONNREFUSED/)).toBeInTheDocument();
  expect(screen.getByText(/这不代表产品库是空的/)).toBeInTheDocument();
  expect(registry).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "安装" }));
  await user.click(await screen.findByRole("menuitem", { name: "收起产品库" }));
  expect(screen.queryByText(/产品库没查到/)).not.toBeInTheDocument();
  // Reopening does not refetch - the catalog is kept.
  await user.click(screen.getByRole("button", { name: "安装" }));
  await user.click(await screen.findByRole("menuitem", { name: "从产品库安装" }));
  expect(registry).toHaveBeenCalledTimes(1);
});

void test("HomePage/产品库: an installable catalog lists packages with 未签名 and installs on click, then refreshes", async () => {
  const registry = vi
    .fn()
    .mockResolvedValueOnce({ status: "ok", base: "https://dl", generatedAt: "g", checkedAt: "t", installable: true, items: [bidItem] })
    .mockResolvedValue({ status: "ok", base: "https://dl", generatedAt: "g", checkedAt: "t", installable: true, items: [{ ...bidItem, installed: true }] });
  const installFromRegistry = vi.fn().mockResolvedValue({ productId: "vxture.bid", version: "1.0.0", signed: false, from: "registry" });
  const onRefresh = vi.fn();
  const api = fakeApi({ registry, installFromRegistry });
  render(
    <HomePage api={api} products={[]} workspaces={[]} health={{ ok: true }} onOpen={noop} onCreated={noop} onRefresh={onRefresh} onError={noop} />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "安装" }));
  await user.click(await screen.findByRole("menuitem", { name: "从产品库安装" }));
  const list = await screen.findByLabelText("产品库");
  expect(within(list).getByText("标书编写")).toBeInTheDocument();
  expect(within(list).getByText("未签名")).toBeInTheDocument();
  await user.click(within(list).getByRole("button", { name: "安装" }));
  expect(installFromRegistry).toHaveBeenCalledWith("vxture.bid", "1.0.0");
  expect(await within(list).findByText("已安装")).toBeInTheDocument();
  expect(onRefresh).toHaveBeenCalled();
});

void test("HomePage/产品库: a production machine can see the catalog but is told it will not install unsigned packages", async () => {
  const api = fakeApi({
    registry: vi.fn().mockResolvedValue({ status: "ok", base: "https://dl", generatedAt: "g", checkedAt: "t", installable: false, items: [bidItem] }),
  });
  homeWith(api);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "安装" }));
  await user.click(await screen.findByRole("menuitem", { name: "从产品库安装" }));
  const list = await screen.findByLabelText("产品库");
  expect(within(list).getByText("本机不装未签名包")).toBeInTheDocument();
  expect(within(list).queryByRole("button", { name: "安装" })).not.toBeInTheDocument();
});

void test("HomePage/产品库: an empty catalog says so; a failed fetch and a failed install go to onError", async () => {
  const onError = vi.fn();
  const empty = fakeApi({
    registry: vi.fn().mockResolvedValue({ status: "ok", base: "https://dl", generatedAt: "g", checkedAt: "t", installable: true, items: [] }),
  });
  const first = render(
    <HomePage api={empty} products={[]} workspaces={[]} health={{ ok: true }} onOpen={noop} onCreated={noop} onRefresh={noop} onError={onError} />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "安装" }));
  await user.click(await screen.findByRole("menuitem", { name: "从产品库安装" }));
  expect(await screen.findByText("产品库里目前没有产品包")).toBeInTheDocument();
  first.unmount();

  const failing = fakeApi({
    registry: vi
      .fn()
      .mockRejectedValueOnce(new Error("daemon down"))
      .mockResolvedValue({ status: "ok", base: "https://dl", generatedAt: "g", checkedAt: "t", installable: true, items: [bidItem] }),
    installFromRegistry: vi.fn().mockRejectedValue(new Error("package sha256 mismatch")),
  });
  render(
    <HomePage api={failing} products={[]} workspaces={[]} health={{ ok: true }} onOpen={noop} onCreated={noop} onRefresh={noop} onError={onError} />,
  );
  await user.click(screen.getByRole("button", { name: "安装" }));
  await user.click(await screen.findByRole("menuitem", { name: "从产品库安装" }));
  await vi.waitFor(() => expect(onError).toHaveBeenCalledWith("daemon down"));
  // Second open refetches because the first attempt left no catalog.
  await user.click(screen.getByRole("button", { name: "安装" }));
  await user.click(await screen.findByRole("menuitem", { name: "收起产品库" }));
  await user.click(screen.getByRole("button", { name: "安装" }));
  await user.click(await screen.findByRole("menuitem", { name: "从产品库安装" }));
  const list = await screen.findByLabelText("产品库");
  await user.click(within(list).getByRole("button", { name: "安装" }));
  await vi.waitFor(() => expect(onError).toHaveBeenCalledWith("package sha256 mismatch"));
});

/* ---------------- 我的智能体：标题行动作与卡片动作（2026-09-03 重排）---------------- */

void test("我的智能体 header: 同步产品版本 · 安装本地包 · 在线使用, with 在线使用 as the primary action on the right", async () => {
  const api = fakeApi();
  render(
    <HomePage api={api} products={[product()]} workspaces={[]} health={{ ok: true }} onOpen={noop} onCreated={noop} onRefresh={noop} onError={noop} />,
  );
  const actions = document.querySelector(".section-actions") as HTMLElement;
  const names = within(actions).getAllByRole("button").map((b) => b.textContent);
  expect(names).toEqual(["同步产品版本", "安装", "在线使用"]);
});

void test("同步产品版本: fetches every product's contract; refreshes only when something new landed; a refusal reaches onError once", async () => {
  const fetchProduct = vi
    .fn()
    .mockResolvedValueOnce({ status: "current" })
    .mockResolvedValueOnce({ status: "fetched", version: "1.1.0" });
  const onRefresh = vi.fn();
  const api = fakeApi({ fetchProduct });
  render(
    <HomePage
      api={api}
      products={[product({ id: "a", name: "A" }), product({ id: "b", name: "B" })]}
      workspaces={[]}
      health={{ ok: true }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={onRefresh}
      onError={noop}
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "同步产品版本" }));
  await vi.waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  expect(fetchProduct).toHaveBeenCalledWith("a");
  expect(fetchProduct).toHaveBeenCalledWith("b");

  const onError = vi.fn();
  const refusing = fakeApi({
    fetchProduct: vi.fn().mockRejectedValue(new Error("契约拉取需要已配置的产品能力面")),
  });
  render(
    <HomePage api={refusing} products={[product({ id: "c", name: "C" }), product({ id: "d", name: "D" })]} workspaces={[]} health={{ ok: true }} onOpen={noop} onCreated={noop} onRefresh={noop} onError={onError} />,
  );
  await user.click(screen.getAllByRole("button", { name: "同步产品版本" })[1]!);
  await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
  expect(onError).toHaveBeenCalledWith("契约拉取需要已配置的产品能力面");
});

void test("ProductCard: 更新版本 appears only when the store holds a newer version than the active one, and pins it", async () => {
  const pinProductVersion = vi.fn().mockResolvedValue({});
  const onRefresh = vi.fn();
  const api = fakeApi({ pinProductVersion });
  const { unmount } = render(
    <HomePage
      api={api}
      products={[product({ version: "1.0.0", versions: ["1.0.0", "1.2.0", "1.1.0"] })]}
      workspaces={[]}
      health={{ ok: true }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={onRefresh}
      onError={noop}
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "更新版本 v1.2.0" }));
  expect(pinProductVersion).toHaveBeenCalledWith("vxture.bid", "1.2.0");
  await vi.waitFor(() => expect(onRefresh).toHaveBeenCalled());
  unmount();

  render(
    <HomePage api={fakeApi()} products={[product({ version: "1.2.0", versions: ["1.0.0", "1.2.0"] })]} workspaces={[]} health={{ ok: true }} onOpen={noop} onCreated={noop} onRefresh={noop} onError={noop} />,
  );
  expect(screen.queryByRole("button", { name: /更新版本/ })).not.toBeInTheDocument();
});

void test("ProductCard: a failed version pin goes to onError; 智能体介绍 is a link to the platform catalog", async () => {
  const onError = vi.fn();
  render(
    <HomePage
      api={fakeApi({ pinProductVersion: vi.fn().mockRejectedValue(new Error("版本不存在")) })}
      products={[product({ version: "1.0.0", versions: ["1.0.0", "1.1.0"] })]}
      workspaces={[]}
      health={{ ok: true }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={noop}
      onError={onError}
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "更新版本 v1.1.0" }));
  await vi.waitFor(() => expect(onError).toHaveBeenCalledWith("版本不存在"));
  const intro = screen.getByRole("link", { name: "智能体介绍" }) as HTMLAnchorElement;
  expect(intro.href).toBe("https://vxture.com/zh-CN/appcenter");
});

void test("ProductCard: the warning about an unwired capability surface is styled as a warning, not as description text", async () => {
  const api = fakeApi({ system: vi.fn().mockResolvedValue({ keyProtection: "dpapi", capabilitySurface: "mock" }) });
  render(
    <HomePage api={api} products={[product()]} workspaces={[]} health={{ ok: true }} onOpen={noop} onCreated={noop} onRefresh={noop} onError={noop} />,
  );
  const note = await screen.findByRole("note");
  expect(note.className).toContain("pcard-alert--warning");
  expect(note.textContent).toContain("能力面未接通");
});

void test("ProductCard: clicking the card body selects it for the sidebar; buttons and links do not toggle", async () => {
  const onSelectProduct = vi.fn();
  render(
    <HomePage
      api={fakeApi()}
      products={[product()]}
      workspaces={[]}
      health={{ ok: true }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={noop}
      onError={noop}
      selectedProductId={null}
      onSelectProduct={onSelectProduct}
    />,
  );
  const user = userEvent.setup();
  const card = document.querySelector(".pcard") as HTMLElement;
  await user.click(card.querySelector(".pcard-desc")!);
  expect(onSelectProduct).toHaveBeenLastCalledWith("vxture.bid");
  await user.click(screen.getByRole("link", { name: "智能体介绍" }));
  expect(onSelectProduct).toHaveBeenCalledTimes(1);
});

void test("ProductCard: a selected card is marked, and clicking it again reports null (nothing selected)", async () => {
  const onSelectProduct = vi.fn();
  render(
    <HomePage
      api={fakeApi()}
      products={[product()]}
      workspaces={[]}
      health={{ ok: true }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={noop}
      onError={noop}
      selectedProductId="vxture.bid"
      onSelectProduct={onSelectProduct}
    />,
  );
  const card = document.querySelector(".pcard") as HTMLElement;
  expect(card.className).toContain("pcard--selected");
  expect(card.getAttribute("aria-pressed")).toBe("true");
  await userEvent.setup().click(card.querySelector(".pcard-desc")!);
  expect(onSelectProduct).toHaveBeenLastCalledWith(null);
});

void test("我的智能体 header: 从产品库安装 toggles the registry list below the grid", async () => {
  const registry = vi.fn().mockResolvedValue({ status: "unreachable", base: "b", reason: "没网", checkedAt: "t" });
  render(
    <HomePage api={fakeApi({ registry })} products={[]} workspaces={[]} health={{ ok: true }} onOpen={noop} onCreated={noop} onRefresh={noop} onError={noop} />,
  );
  const user = userEvent.setup();
  expect(screen.queryByText(/产品库没查到/)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "安装" }));
  await user.click(await screen.findByRole("menuitem", { name: "从产品库安装" }));
  expect(await screen.findByText(/产品库没查到 —— 没网/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "安装" }));
  await user.click(await screen.findByRole("menuitem", { name: "收起产品库" }));
  expect(screen.queryByText(/产品库没查到/)).not.toBeInTheDocument();
});
