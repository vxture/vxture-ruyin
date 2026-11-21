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
import { fireEvent } from "@testing-library/react";
import { HomePage } from "./home";
import { Api, type ProductInfo, type ProjectMeta, type SessionInfo, type PublicProduct } from "./api";

const publicProducts: PublicProduct[] = [
  {productCode:"public-a",productName:"目录产品甲",productType:"general_agent",productNick:"CAT-A",description:"平台实时简介",iconUrl:"https://cdn.test/a.png",iconVersion:"a1",releaseVersion:"2.0.0",releaseStage:"stable"},
  {productCode:"other",productName:"非智能体产品",productType:"service",productNick:null,description:null,iconUrl:null,iconVersion:null,releaseVersion:null,releaseStage:null},
  {productCode:"public-b",productName:"目录产品乙",productType:"industry_agent",productNick:null,description:null,iconUrl:null,iconVersion:null,releaseVersion:null,releaseStage:"beta"},
  {productCode:"public-c",productName:"目录产品丙",productType:"agent",productNick:null,description:null,iconUrl:null,iconVersion:null,releaseVersion:null,releaseStage:"stable"},
  {productCode:"public-d",productName:"目录产品丁",productType:"agent",productNick:null,description:null,iconUrl:null,iconVersion:null,releaseVersion:null,releaseStage:"stable"},
];

function product(over: Partial<ProductInfo> = {}): ProductInfo {
  return {
    id: "bidproposal",
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
    productId: "bidproposal",
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
    subscribedProducts: vi.fn().mockResolvedValue([]),
    productCatalog: vi.fn().mockResolvedValue([]),
    recommendedProducts: vi.fn().mockResolvedValue([]),
    productIcon: vi.fn().mockResolvedValue(null),
    system: vi.fn().mockResolvedValue(null),
    registry: vi.fn().mockResolvedValue({status:"ok",base:"b",checkedAt:"t",generatedAt:"t",installable:false,items:[]}),
    installFromRegistry: vi.fn().mockResolvedValue({}),
    installPackage: vi.fn(),
    preflightPackage: vi.fn().mockResolvedValue({ productId: "vxture.new", version: "1.0.0", signed: true, name: "演示智能体", publisher: "vxture" }),
    fetchProduct: vi.fn().mockResolvedValue({ status: "current" }),
    activateProduct: vi.fn(),
    deactivateProduct: vi.fn(),
    createProject: vi.fn(),
    pinProductVersion: vi.fn(),
    ...over,
  } as unknown as Api;
}

function noop() {}

test("Install menu routes to the same standalone agent page without mounting a second manager",async()=>{
 const onRefresh=vi.fn();const api=fakeApi({products:vi.fn().mockResolvedValue([product()])});
 render(<HomePage api={api} products={[]} workspaces={[]} health={{ok:true}} onOpen={noop} onCreated={noop} onRefresh={onRefresh} onError={noop}/>);
 await userEvent.click(screen.getByRole("button",{name:"安装智能体"}));await userEvent.click(await screen.findByRole("menuitem",{name:"安装管理"}));
 expect(window.location.hash).toBe("#agents");expect(screen.queryByRole("dialog",{name:"安装管理"})).toBeNull();expect(api.products).not.toHaveBeenCalled();
});

test('package picker cancellation keeps the prior install state and confirmation failure remains retryable',async()=>{
 const api=fakeApi({installPackage:vi.fn().mockRejectedValueOnce(Error('Installation rejected')).mockResolvedValue({productId:'vxture.new',version:'1.0.0',signed:true})}),onError=vi.fn();
 const {container}=render(<HomePage api={api} products={[]} workspaces={[]} health={{ok:true}} onOpen={noop} onCreated={noop} onRefresh={noop} onError={onError}/>);
 const input=container.querySelector('input[type="file"]')!;
 fireEvent.change(input,{target:{files:[]}});expect(api.preflightPackage).not.toHaveBeenCalled();
 const user=userEvent.setup();await user.upload(input as HTMLInputElement,new File(['package'],'bid.ruyinpkg'));
 await user.click(await screen.findByRole('button',{name:'取消'}));
 expect(api.installPackage).not.toHaveBeenCalled();expect(screen.queryByRole('group',{name:'智能体包预检结果'})).toBeNull();
 await user.upload(input as HTMLInputElement,new File(['package'],'bid.ruyinpkg'));
 await user.click(await screen.findByRole('button',{name:'确认安装'}));
 await vi.waitFor(()=>expect(onError).toHaveBeenCalledWith('Installation rejected'));
 await user.click(screen.getByRole('button',{name:'确认安装'}));
 expect(await screen.findByText('已安装 vxture.new@1.0.0（已签名）')).toBeTruthy();
});

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

void test("HomePage: the empty-state button opens the application center without selecting a product", async () => {
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
  await user.click(await screen.findByText("应用中心"));
  expect(globalThis.open).toHaveBeenCalledWith(
    "https://vxture.com/appcenter",
    "_blank",
    "noopener",
  );
});

/** The application center follows the website configuration, independently of Console. */
void test("HomePage: the application center uses the configured website independently of Console", async () => {
  const api = fakeApi({
    session: vi.fn().mockResolvedValue({
      signedIn: false,
      consoleBase: "https://staging.vxture.com",
      consoleAppBase: "https://console.staging.vxture.com",
    } as SessionInfo),
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
  await user.click(await screen.findByText("应用中心"));
  expect(globalThis.open).toHaveBeenCalledWith(
    "https://staging.vxture.com/appcenter",
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
  // 版本号前带 Runtime（owner 2026-09-18 第 6 条）：孤零零一个版本号不说明它是谁的。
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
    "暂时没有响应",
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
  expect(screen.getByText("暂时读不到订阅信息，以下是这台电脑上已安装的智能体。")).toBeInTheDocument();
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
    screen.queryByText("暂时读不到订阅信息，以下是这台电脑上已安装的智能体。"),
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
  onEnterProduct?: (id: string) => void;
  onCreated?: (id: string) => void | Promise<void>;
  onRefresh?: () => void | Promise<void>;
  onError?: (msg: string) => void;
} = {}) {
  return render(
    <HomePage
      api={over.api ?? fakeApi()}
      products={over.products ?? [product()]}
      workspaces={over.workspaces ?? []}
      health={{ ok: true, version: "0.1.0" }}
      onOpen={over.onOpen ?? noop}
      onEnterProduct={over.onEnterProduct}
      onCreated={over.onCreated ?? noop}
      onRefresh={over.onRefresh ?? noop}
      onError={over.onError ?? noop}
    />,
  );
}

void test("ProductCard: entering the product does not implicitly open or create a project", async () => {
  const api = fakeApi();
  const onEnterProduct = vi.fn();
  const onOpen = vi.fn();
  renderHome({ api, onEnterProduct, onOpen, workspaces: [workspace()] });
  await userEvent.click(screen.getByRole("button", { name: "打开" }));
  expect(onEnterProduct).toHaveBeenCalledWith("bidproposal");
  expect(onOpen).not.toHaveBeenCalled();
  expect(api.createProject).not.toHaveBeenCalled();
});

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
  expect(screen.getAllByText("本地已装")).toHaveLength(4);
  expect(screen.getByText("未订阅")).toBeInTheDocument();
  expect(screen.getByText("已停用")).toBeInTheDocument();
});

void test("ProductCard: the code sits under the name; the version lives bottom-left, flush with the icon, followed by the count and its unit", () => {
  renderHome({
    products: [product({ id: "bidproposal", version: "2.3.0" })],
    workspaces: [workspace(), workspace({ id: "prj_2" })],
  });
  // owner 2026-09-04：名称下面只留产品 code；版本移到左下角、顶头对齐图标，
  // 关键数字紧随其后，单位「项目」是再小再淡的一档。
  expect(document.querySelector(".pcard-ident")?.textContent?.trim()).toBe("bidproposal");
  const meta = document.querySelector(".pcard-foot > .pcard-meta") as HTMLElement;
  expect(meta.querySelector(".pcard-version")?.textContent).toBe("v2.3.0");
  expect(meta.querySelector(".pcard-count b")?.textContent).toBe("2");
  expect(meta.querySelector(".pcard-unit")?.textContent).toBe("项目");
  // Order in the footer: version first, then the count (spacing is CSS, not text).
  expect(meta.firstElementChild).toHaveTextContent("本地已装");
  expect(Array.from(meta.children).slice(1).map((c) => c.className)).toEqual(["pcard-version", "pcard-count"]);
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
  expect(within(foot as HTMLElement).getByRole("button", {name:"打开"})).toBeEnabled();
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
  // 版面上只留结论。**算法名不在首页出现**（owner 2026-09-17）：首页这张卡是
  // 一眼扫过去的状态，不是加密说明书；完整三层写在「设置 › 数据加密」，同一套
  // 事实抄两份迟早两份各自漂。
  expect(cards[1]?.textContent).not.toContain("SQLCipher");
  expect(cards[1]?.textContent).not.toContain("AES-256-GCM");
  expect(cards[1]?.getAttribute("title")).toContain("加密保存");
});

void test("ProductCard: only this product's projects are counted, not every project on the machine", () => {
  renderHome({
    products: [product({ id: "bidproposal" })],
    workspaces: [
      workspace({ id: "p1", productId: "bidproposal" }),
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
    products: [product({ id: "bidproposal", name: "标书编写" })],
    workspaces: [],
    onCreated,
  });
  await userEvent.click(screen.getByRole("button", { name: "打开" }));
  // 首页不再有取名字的表单：让人在还没进门时先取名，是把产品的第一步搬进了框架。
  expect(createProject).toHaveBeenCalledWith("bidproposal", "标书编写");
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

void test("ProductCard: local open remains available when the product has no online address", () => {
  renderHome({ products: [product()], workspaces: [workspace({ id: "prj_1" })] });
  const foot = document.querySelector(".pcard-foot") as HTMLElement;
  expect(within(foot).queryByRole("button", {name: "在线使用"})).toBeNull();
  expect(within(foot).getByRole("button", {name: "打开"})).toBeEnabled();
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
    products: [product({ id: "bidproposal", availability: "disabled" })],
    onRefresh,
  });
  await userEvent.click(screen.getByRole("button", { name: "启用" }));
  expect(activateProduct).toHaveBeenCalledWith("bidproposal");
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
    "https://vxture.com/pricing?product=vxture.crm",
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

void test("HomePage: 我的智能体 的标题行「在线使用」打开 RUYIN 网站", async () => {
  renderHome({ products: [product()] });
  await userEvent.click(within(document.querySelector(".section-actions") as HTMLElement).getByRole("button", { name: "在线使用" }));
  expect(globalThis.open).toHaveBeenCalledWith(
    "https://ruyin.work",
    "_blank",
    "noopener",
  );
});

// --- 热门推荐 ----------------------------------------------------------------
//
// 这一栏说的是「平台上有这些」，不是「你有这些」。两者混淆正是首页那条硬规则
// （不得硬编码产品）要防的事，所以下面几条测的核心就是这条边界。

test("热门智能体: current platform metadata supplies three agents in order, with shared real logos and release status", async () => {
  const api=fakeApi({productCatalog:vi.fn().mockResolvedValue(publicProducts)});
  renderHome({products:[],api});
  await screen.findByText("目录产品甲");
  expect([...document.querySelectorAll(".pcard--catalog h3")].map(h=>h.textContent)).toEqual(["目录产品甲","目录产品乙","目录产品丙"]);
  expect(screen.queryByText("非智能体产品")).toBeNull();expect(screen.queryByText("目录产品丁")).toBeNull();
  expect(screen.getByText("CAT-A")).toBeInTheDocument();expect(screen.getByText("平台实时简介")).toBeInTheDocument();
  expect(screen.getByText("v2.0.0")).toBeInTheDocument();expect(screen.getAllByText("正式版")).toHaveLength(2);expect(screen.getByText("公测版")).toBeInTheDocument();
  const logo=screen.getByText("目录产品甲").closest("article")!.querySelector("img")!;
  expect(logo).toHaveAttribute("src","https://cdn.test/a.png");
  expect(api.productIcon).toHaveBeenCalledWith("public-a","a1");expect(api.productIcon).toHaveBeenCalledWith("public-b","current");
  fireEvent.error(logo);expect(screen.getByText("目录产品甲").closest("article")!.querySelector(".pcard-icon svg")).toBeInTheDocument();
  expect(screen.getAllByRole("button",{name:"了解详情"})).toHaveLength(3);
  expect(screen.queryByRole("button",{name:"打开"})).toBeNull();expect(screen.queryByRole("button",{name:"去平台订阅"})).toBeNull();
});

test("signed-in recommendations use tenant candidates and backfill after excluding subscription and installation cards",async()=>{
 const api=signedInApi(vi.fn().mockResolvedValue([subscription({productCode:"public-a",productName:"已有甲"})]));
 vi.mocked(api.recommendedProducts).mockResolvedValue(publicProducts);
 renderHome({api,products:[product({id:"public-b",name:"已装乙"})]});
 await screen.findByText("目录产品丙");
 const cards=document.querySelectorAll(".pcard--catalog h3");expect([...cards].map(card=>card.textContent)).toEqual(["目录产品丙","目录产品丁"]);
 expect(api.productCatalog).not.toHaveBeenCalled();expect(api.recommendedProducts).toHaveBeenCalledTimes(1);
 expect(screen.queryByText("目录产品甲")).toBeNull();expect(screen.queryByText("目录产品乙")).toBeNull();
});

test("recommendations refresh with subscription changes and retain only new candidates",async()=>{
 const subscriptions=vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([subscription({productCode:"public-a",productName:"新订阅甲"})]);
 const api=signedInApi(subscriptions);vi.mocked(api.recommendedProducts).mockResolvedValue(publicProducts);
 renderHome({api,products:[]});await screen.findByText("目录产品甲");
 fireEvent(window,new Event("focus"));await screen.findByText("新订阅甲");
 await vi.waitFor(()=>expect([...document.querySelectorAll(".pcard--catalog h3")].map(card=>card.textContent)).toEqual(["目录产品乙","目录产品丙","目录产品丁"]));
 expect(api.recommendedProducts).toHaveBeenCalledTimes(2);
});

test("late recommendation replies cannot reintroduce another scope's candidates and failure is not an empty success",async()=>{
 const old=deferredResult<PublicProduct[]>(),api=signedInApi(vi.fn().mockResolvedValue([]));
 vi.mocked(api.recommendedProducts).mockReturnValueOnce(old.promise).mockRejectedValueOnce(Error("forbidden"));
 const view=renderHome({api,products:[]});await vi.waitFor(()=>expect(api.recommendedProducts).toHaveBeenCalled());
 vi.mocked(api.session).mockResolvedValue({signedIn:true,org:{id:"new-tenant"},workspace:{id:"new-workspace"}} as SessionInfo);
 fireEvent(window,new Event("focus"));await screen.findByText("暂时无法读取智能体目录，请稍后重试。");
 old.resolve(publicProducts);await Promise.resolve();expect(screen.queryByText("目录产品甲")).toBeNull();
 expect(screen.queryByText("暂无新的可订阅智能体，可前往应用中心浏览。")).toBeNull();view.unmount();
});

test("热门智能体: loading, empty and unavailable remain distinct; unmounted replies are ignored",async()=>{
  const pending=deferredResult<PublicProduct[]>();
  const api=fakeApi({productCatalog:vi.fn().mockReturnValue(pending.promise)});
  const view=renderHome({products:[],api});
  expect(screen.getByText("正在读取智能体目录…")).toBeInTheDocument();
  await vi.waitFor(()=>expect(api.productCatalog).toHaveBeenCalled());
  view.unmount();pending.resolve(publicProducts);await Promise.resolve();expect(screen.queryByText("目录产品甲")).toBeNull();
  const empty=renderHome({products:[]});await screen.findByText("暂无新的可订阅智能体，可前往应用中心浏览。");empty.unmount();
  renderHome({products:[],api:fakeApi({productCatalog:vi.fn().mockRejectedValue(Error("offline"))})});
  await screen.findByText("暂时无法读取智能体目录，请稍后重试。");expect(screen.queryByText("暂无新的可订阅智能体，可前往应用中心浏览。")).toBeNull();
});

test("热门智能体: late catalog failures after unmount are ignored",async()=>{
  let reject!:(e:Error)=>void;
  const promise=new Promise<PublicProduct[]>((_,fail)=>{reject=fail;});
  const api=fakeApi({productCatalog:vi.fn().mockReturnValue(promise)});
  const view=renderHome({products:[],api});
  await vi.waitFor(()=>expect(api.productCatalog).toHaveBeenCalled());
  view.unmount();reject(Error("offline"));await Promise.resolve();
  expect(screen.queryByText("暂时无法读取智能体目录，请稍后重试。")).toBeNull();
});

void test("热门智能体: 浏览全部 opens the real catalog page", async () => {
  renderHome({ products: [] });
  await userEvent.click(screen.getByRole("button", { name: "浏览全部" }));
  expect(globalThis.open).toHaveBeenCalledWith(
    "https://vxture.com/appcenter",
    "_blank",
    "noopener",
  );
});

void test("热门智能体: a card's 了解详情 opens the catalog page in a new tab, and opens nothing local", async () => {
  const onOpen = vi.fn();
  renderHome({ products: [], onOpen, api:fakeApi({productCatalog:vi.fn().mockResolvedValue(publicProducts)}) });
  await userEvent.click((await screen.findAllByRole("button", { name: "了解详情" }))[0]!);
  expect(globalThis.open).toHaveBeenCalledWith(
    "https://vxture.com/appcenter",
    "_blank",
    "noopener",
  );
  // 目录里的东西不是你的：点它不该把任何本地项目打开。
  expect(onOpen).not.toHaveBeenCalled();
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
  await user.click(screen.getByRole("button", { name: "安装智能体" }));
  await user.click(await screen.findByRole("menuitem", { name: "导入安装包" }));
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

  expect(installPackage).not.toHaveBeenCalled();
  expect(await screen.findByRole("group", { name: "智能体包预检结果" })).toHaveTextContent("演示智能体");
  await user.click(screen.getByRole("button", { name: "确认安装" }));
  expect(installPackage).toHaveBeenCalledWith(file);
  expect(await screen.findByText("已安装 vxture.new@1.0.0（已签名）")).toBeInTheDocument();
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
  await user.click(await screen.findByRole("button", { name: "确认安装" }));
  expect(await screen.findByText("已安装 vxture.new@1.0.0（未签名）")).toBeInTheDocument();
});

void test("InstallPackageRow: a rejected package calls onError with the daemon's reason", async () => {
  const installPackage = vi.fn().mockRejectedValue(new Error("checksum 不符"));
  const onError = vi.fn();
  const { container } = render(
    <HomePage
      api={fakeApi({ preflightPackage: installPackage } as Partial<Api>)}
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
  expect(screen.queryByRole("button", { name: "确认安装" })).not.toBeInTheDocument();
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
  expect(screen.getByText(/AI 能力尚未开通/)).toBeInTheDocument();
  // 订阅徽章不被顶掉：两件事都成立。
  expect(screen.getByText("已订阅")).toBeInTheDocument();
  // 要分清，不是要拦住：打开入口还在。
  expect(screen.getByRole("button", { name: /打开|新建/ })).toBeInTheDocument();
});

void test("HomePage: missing legacy host model does not label independently connected agents unavailable", async () => {
  const api=fakeApi({system:vi.fn().mockResolvedValue({keyProtection:"dpapi",capabilitySurface:"unavailable"})});
  render(<HomePage api={api} products={[product()]} workspaces={[]} health={{ok:true}} onOpen={noop} onCreated={noop} onRefresh={noop} onError={noop}/>);
  expect(await screen.findByText("已加密")).toBeInTheDocument();
  expect(screen.getByText("已订阅")).toBeInTheDocument();expect(screen.queryByText("未接通")).not.toBeInTheDocument();
  expect(screen.queryByText(/\u793a\u4f8b\u5185\u5bb9/)).not.toBeInTheDocument();expect(screen.getByRole("button",{name:/打开|新建/})).toBeEnabled();
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
  expect(screen.queryByText(/AI 能力尚未开通/)).not.toBeInTheDocument();
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
  id: "bidproposal",
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
  await user.click(screen.getByRole("button", { name: "安装智能体" }));
  await user.click(await screen.findByRole("menuitem", { name: "浏览产品库" }));
  // 守护进程那句 `index unreachable: ECONNREFUSED` **不进界面**（owner 2026-09-17）。
  expect(await screen.findByText("这次没读到产品库，请稍后再试")).toBeInTheDocument();
  expect(document.body.textContent).not.toContain("ECONNREFUSED");
  // 「这不代表产品库是空的」那半句删了：新话本身就没有说成「空的」，
  // 再解释一遍反而把一句提示变成一段说明（owner 2026-09-17）。
  expect(screen.queryByText(/没有产品/)).not.toBeInTheDocument();
  expect(registry).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "安装智能体" }));
  await user.click(await screen.findByRole("menuitem", { name: "收起产品库" }));
  expect(screen.queryByText(/这次没读到产品库/)).not.toBeInTheDocument();
  // Reopening does not refetch - the catalog is kept.
  await user.click(screen.getByRole("button", { name: "安装智能体" }));
  await user.click(await screen.findByRole("menuitem", { name: "浏览产品库" }));
  expect(registry).toHaveBeenCalledTimes(1);
});

void test("HomePage/产品库: an installable catalog lists packages with 未签名 and installs on click, then refreshes", async () => {
  const registry = vi
    .fn()
    .mockResolvedValueOnce({ status: "ok", base: "https://dl", generatedAt: "g", checkedAt: "t", installable: true, items: [bidItem] })
    .mockResolvedValue({ status: "ok", base: "https://dl", generatedAt: "g", checkedAt: "t", installable: true, items: [{ ...bidItem, installed: true }] });
  const installFromRegistry = vi.fn().mockResolvedValue({ productId: "bidproposal", version: "1.0.0", signed: false, from: "registry" });
  const onRefresh = vi.fn();
  const api = fakeApi({ registry, installFromRegistry });
  render(
    <HomePage api={api} products={[]} workspaces={[]} health={{ ok: true }} onOpen={noop} onCreated={noop} onRefresh={onRefresh} onError={noop} />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "安装智能体" }));
  await user.click(await screen.findByRole("menuitem", { name: "浏览产品库" }));
  const list = await screen.findByLabelText("产品库");
  expect(within(list).getByText("标书编写")).toBeInTheDocument();
  expect(within(list).getByText("未签名")).toBeInTheDocument();
  await user.click(within(list).getByRole("button", { name: "安装" }));
  expect(installFromRegistry).toHaveBeenCalledWith("bidproposal", "1.0.0");
  expect(await within(list).findByText("已安装")).toBeInTheDocument();
  expect(onRefresh).toHaveBeenCalled();
});

void test("HomePage/产品库: a production machine can see the catalog but is told it will not install unsigned packages", async () => {
  const api = fakeApi({
    registry: vi.fn().mockResolvedValue({ status: "ok", base: "https://dl", generatedAt: "g", checkedAt: "t", installable: false, items: [bidItem] }),
  });
  homeWith(api);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "安装智能体" }));
  await user.click(await screen.findByRole("menuitem", { name: "浏览产品库" }));
  const list = await screen.findByLabelText("产品库");
  expect(within(list).getByText("未签名，不能安装")).toBeInTheDocument();
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
  await user.click(screen.getByRole("button", { name: "安装智能体" }));
  await user.click(await screen.findByRole("menuitem", { name: "浏览产品库" }));
  expect(await screen.findByText("产品库里暂时没有可安装的智能体")).toBeInTheDocument();
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
  await user.click(screen.getByRole("button", { name: "安装智能体" }));
  await user.click(await screen.findByRole("menuitem", { name: "浏览产品库" }));
  await vi.waitFor(() => expect(onError).toHaveBeenCalledWith("daemon down"));
  // Second open refetches because the first attempt left no catalog.
  await user.click(screen.getByRole("button", { name: "安装智能体" }));
  await user.click(await screen.findByRole("menuitem", { name: "收起产品库" }));
  await user.click(screen.getByRole("button", { name: "安装智能体" }));
  await user.click(await screen.findByRole("menuitem", { name: "浏览产品库" }));
  const list = await screen.findByLabelText("产品库");
  await user.click(within(list).getByRole("button", { name: "安装" }));
  await vi.waitFor(() => expect(onError).toHaveBeenCalledWith("package sha256 mismatch"));
});

/* ---------------- 我的智能体：标题行动作与卡片动作（2026-09-03 重排）---------------- */

void test("我的智能体 header: 更新 · 安装 · 在线使用, with 在线使用 as the primary action on the right", async () => {
  const api = fakeApi();
  render(
    <HomePage api={api} products={[product()]} workspaces={[]} health={{ ok: true }} onOpen={noop} onCreated={noop} onRefresh={noop} onError={noop} />,
  );
  const actions = document.querySelector(".section-actions") as HTMLElement;
  const names = within(actions).getAllByRole("button").map((b) => b.textContent);
  expect(names).toEqual(["检查智能体更新", "安装智能体", "在线使用"]);
});

void test("更新: refreshes registry without contract-fetch installation", async () => {
  const api=fakeApi(),onRefresh=vi.fn(),onError=vi.fn();
  render(<HomePage api={api} products={[product()]} workspaces={[]} health={{ok:true}} onOpen={noop} onCreated={noop} onRefresh={onRefresh} onError={onError}/>);
  await vi.waitFor(()=>expect(api.registry).toHaveBeenCalledTimes(1));
  await userEvent.click(screen.getByRole("button",{name:"检查智能体更新"}));
  expect(api.registry).toHaveBeenCalledTimes(2);expect(onRefresh).toHaveBeenCalledTimes(1);expect(api.fetchProduct).not.toHaveBeenCalled();
  vi.mocked(api.registry).mockResolvedValueOnce({status:"unreachable",base:"b",reason:"internal path",checkedAt:"t"});
  await userEvent.click(screen.getByRole("button",{name:"检查智能体更新"}));
  expect(onError).toHaveBeenCalledWith("这次没读到产品库，请稍后再试");
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
  expect(pinProductVersion).toHaveBeenCalledWith("bidproposal", "1.2.0");
  await vi.waitFor(() => expect(onRefresh).toHaveBeenCalled());
  unmount();

  render(
    <HomePage api={fakeApi()} products={[product({ version: "1.2.0", versions: ["1.0.0", "1.2.0"] })]} workspaces={[]} health={{ ok: true }} onOpen={noop} onCreated={noop} onRefresh={noop} onError={noop} />,
  );
  expect(screen.queryByRole("button", { name: /更新版本/ })).not.toBeInTheDocument();
});

void test("ProductCard: a failed version pin goes to onError; missing online URL stays disabled", async () => {
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
  expect(within(document.querySelector(".pcard") as HTMLElement).queryByRole("button",{name:"在线使用"})).toBeNull();
});

void test("ProductCard: the warning about an unwired capability surface is styled as a warning, not as description text", async () => {
  const api = fakeApi({ system: vi.fn().mockResolvedValue({ keyProtection: "dpapi", capabilitySurface: "mock" }) });
  render(
    <HomePage api={api} products={[product()]} workspaces={[]} health={{ ok: true }} onOpen={noop} onCreated={noop} onRefresh={noop} onError={noop} />,
  );
  const note = await screen.findByRole("note");
  expect(note.className).toContain("pcard-alert--warning");
  expect(note.textContent).toContain("AI 能力尚未开通");
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
  expect(onSelectProduct).toHaveBeenLastCalledWith("bidproposal");
  await user.click(screen.getByRole("button",{name:"打开"}));
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
      selectedProductId="bidproposal"
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
  expect(screen.queryByText(/这次没读到产品库/)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "安装智能体" }));
  await user.click(await screen.findByRole("menuitem", { name: "浏览产品库" }));
  expect(await screen.findByText("这次没读到产品库，请稍后再试")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "安装智能体" }));
  await user.click(await screen.findByRole("menuitem", { name: "收起产品库" }));
  expect(screen.queryByText(/这次没读到产品库/)).not.toBeInTheDocument();
});

void test("更新 button: carries a new tag only while some product has a newer version waiting, and checks on click", async () => {
  const registry = vi.fn().mockResolvedValue({status:"ok",base:"b",checkedAt:"t",generatedAt:"t",installable:false,items:[]});
  const { unmount } = render(
    <HomePage
      api={fakeApi({ registry })}
      products={[product({ version: "1.0.0", versions: ["1.0.0", "1.1.0"] })]}
      workspaces={[]}
      health={{ ok: true }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={noop}
      onError={noop}
    />,
  );
  // new 标记：库里攒着一版没切过去。卡片上也有一个「更新版本 vX」，所以按标题行取。
  const header = () => within(document.querySelector(".section-actions") as HTMLElement);
  const button = header().getByRole("button", { name: /更新/ });
  expect(button.querySelector(".dot-new")?.textContent).toBe("new");
  await userEvent.setup().click(button);
  await vi.waitFor(() => expect(registry).toHaveBeenCalledTimes(2));
  unmount();

  render(
    <HomePage
      api={fakeApi()}
      products={[product({ version: "1.1.0", versions: ["1.0.0", "1.1.0"] })]}
      workspaces={[]}
      health={{ ok: true }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={noop}
      onError={noop}
    />,
  );
  expect(
    within(document.querySelector(".section-actions") as HTMLElement)
      .getByRole("button", { name: /更新/ })
      .querySelector(".dot-new"),
  ).toBeNull();
});

void test("更新: startup failure stays silent; manual retry explains registry failure", async () => {
 const registry=vi.fn().mockRejectedValue(new Error("internal path")),onError=vi.fn();
 render(<HomePage api={fakeApi({registry})} products={[product()]} workspaces={[]} health={{ok:true}} onOpen={noop} onCreated={noop} onRefresh={noop} onError={onError}/>);
 await vi.waitFor(()=>expect(registry).toHaveBeenCalledTimes(1));expect(onError).not.toHaveBeenCalled();
 await userEvent.click(screen.getByRole("button",{name:"检查智能体更新"}));expect(onError).toHaveBeenCalledWith("这次没读到产品库，请稍后再试");
});
void test("更新: packages are independent of the model capability surface", async () => {
 const api=fakeApi({system:vi.fn().mockResolvedValue({keyProtection:"dpapi",capabilitySurface:"mock"})});
 render(<HomePage api={api} products={[product()]} workspaces={[]} health={{ok:true}} onOpen={noop} onCreated={noop} onRefresh={noop} onError={noop}/>);
 await vi.waitFor(()=>expect(api.registry).toHaveBeenCalledTimes(1));expect(screen.getByRole("button",{name:"检查智能体更新"})).toBeEnabled();
 await userEvent.click(screen.getByRole("button",{name:"检查智能体更新"}));expect(api.registry).toHaveBeenCalledTimes(2);expect(api.fetchProduct).not.toHaveBeenCalled();
});

function subscription(over: Record<string, unknown> = {}) {
  return {
    subscriptionId: "s1",
    productCode: "vxtpl",
    productName: "产品范本",
    productNick: null,
    planName: "Starter",
    tier: "starter",
    status: "active",
    releaseVersion: "2.1.0",
    endAt: null,
    homeUrl: "https://vxtpl.vxture.com",
    ...over,
  };
}

function signedInApi(subscribedProducts: ReturnType<typeof vi.fn>) {
  return fakeApi({
    session: vi.fn().mockResolvedValue({ signedIn: true, consoleBase: "https://vxture.com" } as SessionInfo),
    subscribedProducts,
  } as Partial<Api>);
}

const catalogWith = (items: typeof bidItem[], installable = false) => ({status:"ok" as const,base:"b",generatedAt:"t",checkedAt:"t",installable,items});

test("loading and failed subscriptions never claim that a signed-in account has no agents", async () => {
  const pending=deferredResult<ReturnType<typeof subscription>[]>(),rows=vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce([subscription()]);
  renderHome({api:signedInApi(rows),products:[]});
  await screen.findByText("正在读取智能体…");
  expect(screen.queryByText("当前账号没有可用的智能体")).toBeNull();
  pending.resolve([]);await screen.findByText("当前账号没有可用的智能体");
});

test("unavailable subscription metadata is retryable rather than an empty account", async () => {
  const rows=vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([subscription()]);
  renderHome({api:signedInApi(rows),products:[]});
  expect(await screen.findByText("暂时读不到智能体，请稍后重试")).toBeInTheDocument();
  expect(screen.queryByText("当前账号没有可用的智能体")).toBeNull();
  await userEvent.click(screen.getByRole("button",{name:"重新读取"}));
  expect(await screen.findByText("产品范本")).toBeInTheDocument();
});
function deferredResult<T>() {
  let resolve!: (value:T)=>void;
  const promise=new Promise<T>(r=>{resolve=r;});
  return {promise,resolve};
}

test("product card opens the exact CoSpace address and deduplicates expired history", async () => {
  const api=signedInApi(vi.fn().mockResolvedValue([
    subscription({productCode:"cospace",productName:"CoSpace",homeUrl:"https://cospace.ruyin.work/space"}),
    subscription({productCode:"cospace",productName:"CoSpace history",status:"expired"}),
  ]));
  renderHome({api,products:[]});
  const card=(await screen.findByText("CoSpace")).closest("article")!;
  expect(screen.queryByText("CoSpace history")).toBeNull();
  expect(within(card).queryByRole("button",{name:"安装"})).toBeNull();
  expect(within(card).queryByText("本机未安装")).toBeNull();
  await userEvent.click(within(card).getByRole("button",{name:"在线使用"}));
  expect(window.open).toHaveBeenCalledWith("https://cospace.ruyin.work/space","_blank","noopener");
});

test("unsafe or absent online addresses are omitted with guidance instead of guessing a domain", async () => {
  const api=signedInApi(vi.fn().mockResolvedValue([subscription({homeUrl:"javascript:alert(1)"})]));
  renderHome({api,products:[]});
  const card=(await screen.findByText("产品范本")).closest("article")!;
  expect(within(card).queryByRole("button",{name:"在线使用"})).toBeNull();
  expect(within(card).getByText("暂无可用入口")).toHaveAttribute("title",expect.stringContaining("导入已有安装包"));
  expect(within(card).queryByText("本机未安装")).toBeNull();
  expect(window.open).not.toHaveBeenCalled();
});

test("a subscribed product installs its published package, reports failure, and permits retry", async () => {
  const api=signedInApi(vi.fn().mockResolvedValue([subscription({productCode:"bidproposal"})]));
  vi.mocked(api.registry).mockResolvedValue(catalogWith([{...bidItem,signed:true}]));
  vi.mocked(api.installFromRegistry).mockRejectedValueOnce(new Error("Signature rejected")).mockResolvedValue({productId:"bidproposal",version:"1.0.0",signed:true,from:"registry"});
  const onError=vi.fn(),onRefresh=vi.fn();
  renderHome({api,products:[],onError,onRefresh});
  const button=await screen.findByRole("button",{name:"安装"});
  await userEvent.click(button);expect(onError).toHaveBeenCalledWith("Signature rejected");
  expect(onRefresh).not.toHaveBeenCalled();
  await userEvent.click(button);
  expect(api.installFromRegistry).toHaveBeenLastCalledWith("bidproposal","1.0.0");
  expect(onRefresh).toHaveBeenCalledTimes(1);
});

test("published desktop supply adds muted local state and installation beside the independent online action",async()=>{
 const api=signedInApi(vi.fn().mockResolvedValue([subscription({productCode:"bidproposal",releaseVersion:"9.0.0"})]));
 vi.mocked(api.registry).mockResolvedValue(catalogWith([{...bidItem,version:"1.3.0",signed:true}]));
 renderHome({api,products:[]});
 const install=await screen.findByRole("button",{name:"安装"}),card=install.closest("article")!;
 expect(within(card).getByText("本机未安装")).toHaveClass("pcard-install-state");
 expect(card.querySelector(".pcard-install-state svg")).toBeInTheDocument();
 expect(card.querySelector(".pcard-meta")?.firstElementChild).toHaveTextContent("本机未安装");
 expect(within(card).getByText("v1.3.0")).toHaveAttribute("title","可安装的本地版本：1.3.0");
 expect(within(card).queryByText("v9.0.0")).toBeNull();
 const online=within(card).getByRole("button",{name:"在线使用"});
 expect(install.className).toContain("border");expect(online.className).toContain("bg-primary");
 await userEvent.click(online);expect(window.open).toHaveBeenCalledWith("https://vxtpl.vxture.com/","_blank","noopener");
 expect(api.installFromRegistry).not.toHaveBeenCalled();
});

test("desktop-only supply offers installation without a disabled online action; installed agents offer local open",async()=>{
 const api=signedInApi(vi.fn().mockResolvedValue([subscription({productCode:"bidproposal",homeUrl:null})]));
 vi.mocked(api.registry).mockResolvedValue(catalogWith([{...bidItem,signed:true}]));
 const view=renderHome({api,products:[]});
 const install=await screen.findByRole("button",{name:"安装"}),card=install.closest("article")!;
 expect(within(card).queryByRole("button",{name:"在线使用"})).toBeNull();
 expect(install.className).toContain("bg-primary");
 await userEvent.click(install);expect(api.installFromRegistry).toHaveBeenCalledWith("bidproposal","1.0.0");
 view.unmount();
 renderHome({api,products:[product()]});
 expect(screen.getByText("本地已装")).toHaveClass("pcard-install-state");
 expect(screen.getByRole("button",{name:"打开"})).toBeEnabled();
 expect(within(screen.getByText("本地已装").closest("article")!).queryByRole("button",{name:"在线使用"})).toBeNull();
});

test("unlisted and unreachable package catalogs never label online agents as uninstalled or unsupported",async()=>{
 for(const catalog of [catalogWith([]),{status:"unreachable",reason:"offline",base:"registry",checkedAt:"now"} as const]){
  const api=signedInApi(vi.fn().mockResolvedValue([subscription()]));vi.mocked(api.registry).mockResolvedValue(catalog);
  const view=renderHome({api,products:[]});const card=(await screen.findByText("产品范本")).closest("article")!;
  await vi.waitFor(()=>expect(api.registry).toHaveBeenCalled());
  expect(within(card).queryByText("本机未安装")).toBeNull();expect(within(card).queryByRole("button",{name:"安装"})).toBeNull();
  await userEvent.click(within(card).getByRole("button",{name:"在线使用"}));expect(window.open).toHaveBeenCalled();
  expect(within(card).queryByText(/不支持/)).toBeNull();view.unmount();
 }
});

test("production refuses unsigned card installs while development retains the same verified installer", async () => {
  const api=signedInApi(vi.fn().mockResolvedValue([subscription({productCode:"bidproposal"})]));
  vi.mocked(api.registry).mockResolvedValue(catalogWith([bidItem]));
  renderHome({api,products:[]});
  const button=await screen.findByRole("button",{name:"安装"});
  expect(button).toBeDisabled();await userEvent.click(button);
  expect(api.installFromRegistry).not.toHaveBeenCalled();
});

test("local update installs a new package before activating it, and failed downloads never pin", async () => {
  const api=fakeApi({registry:vi.fn().mockResolvedValue(catalogWith([{...bidItem,version:"1.2.0",signed:true}]))});
  const onError=vi.fn(),onRefresh=vi.fn(),download=deferredResult<Awaited<ReturnType<Api["installFromRegistry"]>>>();
  vi.mocked(api.installFromRegistry).mockReturnValueOnce(download.promise);
  renderHome({api,onError,onRefresh});
  await userEvent.click(await screen.findByRole("button",{name:"更新版本 v1.2.0"}));
  expect(api.installFromRegistry).toHaveBeenCalledWith("bidproposal","1.2.0");
  expect(api.pinProductVersion).not.toHaveBeenCalled();
  expect(screen.getByRole("button",{name:"更新版本 v1.2.0"})).toBeDisabled();
  download.resolve({productId:"bidproposal",version:"1.2.0",signed:true,from:"registry"});
  await vi.waitFor(()=>expect(api.pinProductVersion).toHaveBeenCalledWith("bidproposal","1.2.0"));
  expect(onRefresh).toHaveBeenCalled();
  vi.mocked(api.installFromRegistry).mockRejectedValueOnce(new Error("Checksum mismatch"));
  vi.mocked(api.pinProductVersion).mockClear();
  await userEvent.click(screen.getByRole("button",{name:"更新版本 v1.2.0"}));
  expect(onError).toHaveBeenCalledWith("Checksum mismatch");
  expect(api.pinProductVersion).not.toHaveBeenCalled();
  expect(api.fetchProduct).not.toHaveBeenCalled();
});

test("a newer unsigned registry package cannot be activated by a production card", async () => {
  const api=fakeApi({registry:vi.fn().mockResolvedValue(catalogWith([{...bidItem,version:"2.0.0"}]))});
  renderHome({api});
  const button=await screen.findByRole("button",{name:"更新版本 v2.0.0"});
  expect(button).toBeDisabled();await userEvent.click(button);
  expect(api.installFromRegistry).not.toHaveBeenCalled();expect(api.pinProductVersion).not.toHaveBeenCalled();
});

test("focus refresh picks up a changed launch URL; transient failure retains the current account's metadata", async () => {
  const rows=vi.fn().mockResolvedValueOnce([subscription()]).mockResolvedValueOnce([subscription({homeUrl:"https://new.test/path"})]).mockRejectedValueOnce(new Error("offline"));
  const api=signedInApi(rows);
  renderHome({api,products:[]});
  await screen.findByText("产品范本");
  fireEvent(window,new Event("focus"));await vi.waitFor(()=>expect(rows).toHaveBeenCalledTimes(2));
  const card=screen.getByText("产品范本").closest("article")!;
  await userEvent.click(within(card).getByRole("button",{name:"在线使用"}));
  expect(window.open).toHaveBeenLastCalledWith("https://new.test/path","_blank","noopener");
  fireEvent(window,new Event("focus"));await vi.waitFor(()=>expect(rows).toHaveBeenCalledTimes(3));
  expect(screen.getByText("产品范本")).toBeInTheDocument();
});

test("late subscription responses cannot restore another account or a logged-out view", async () => {
  const late=deferredResult<ReturnType<typeof subscription>[]>();
  const api=signedInApi(vi.fn().mockReturnValueOnce(late.promise));
  renderHome({api,products:[]});
  await vi.waitFor(()=>expect(api.subscribedProducts).toHaveBeenCalled());
  vi.mocked(api.session).mockResolvedValue({signedIn:false} as SessionInfo);
  fireEvent(window,new Event("focus"));
  await screen.findByText("登录后同步你的智能体");
  late.resolve([subscription()]);
  await vi.waitFor(()=>expect(screen.queryByText("产品范本")).toBeNull());
});

test("a stale session result is ignored after a more recent focus check", async () => {
  const session=deferredResult<SessionInfo>(),api=signedInApi(vi.fn().mockResolvedValue([subscription()]));
  vi.mocked(api.session).mockReturnValueOnce(session.promise);
  renderHome({api,products:[]});
  fireEvent(window,new Event("focus"));
  await screen.findByText("产品范本");
  session.resolve({signedIn:false} as SessionInfo);
  await vi.waitFor(()=>expect(screen.queryByText("登录后同步你的智能体")).toBeNull());
  expect(api.subscribedProducts).toHaveBeenCalledTimes(1);
});

test("an installed agent uses its platform URL too", async () => {
  const api=signedInApi(vi.fn().mockResolvedValue([subscription({productCode:"bidproposal",homeUrl:"https://bid.ruyin.work/"})]));
  renderHome({api});
  const card=screen.getByText("标书编写",{selector:"h3"}).closest("article")!;
  await vi.waitFor(()=>expect(within(card).getByRole("button",{name:"在线使用"})).toBeEnabled());
  await userEvent.click(within(card).getByRole("button",{name:"在线使用"}));
  expect(window.open).toHaveBeenCalledWith("https://bid.ruyin.work/","_blank","noopener");
});

/*
 * 首页以平台订阅为准（owner 2026-09-15）。此前「我的智能体」只列本机装了的，
 * 平台订阅只给本地卡片贴标签 —— 于是用户订了 vxtpl、arda，首页上却只有随包的
 * 测试夹具，看起来像是一个都没订。
 */
void test("HomePage: online subscriptions are listed without inventing desktop supply; expired products retain renewal", async () => {
  const subscribedProducts = vi.fn().mockResolvedValue([
    subscription(),
    subscription({ subscriptionId: "s2", productCode: "arda", productName: null, productNick: "发票助手", status: "expired", releaseVersion: null }),
    subscription({ subscriptionId: "s3", productCode: "nameless", productName: null, productNick: null, releaseVersion: "3.0.0" }),
    // 本机已装的由本地卡片承载，不重复出一张
    subscription({ subscriptionId: "s4", productCode: "bidproposal" }),
    // 没有产品码的订阅行对不上任何东西，不渲染
    subscription({ subscriptionId: "s5", productCode: null, productName: "无码" }),
  ]);
  render(
    <HomePage
      api={signedInApi(subscribedProducts)}
      products={[product({ entitled: null })]}
      workspaces={[]}
      health={{ ok: true }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={noop}
      onError={noop}
    />,
  );
  expect(await screen.findByText("产品范本")).toBeInTheDocument();
  expect(screen.getByText("发票助手")).toBeInTheDocument();
  // 名字都没有时退到产品码（标题与标识行各一次）
  expect(screen.getAllByText("nameless")).toHaveLength(2);
  expect(screen.queryByText("无码")).not.toBeInTheDocument();
  expect(screen.queryByText("本机未安装")).toBeNull();
  expect(screen.getByText("已过期")).toBeInTheDocument();
  // 档位标签、版本号、产品介绍分居三处（owner 2026-09-16，与本地卡片同一套
  // 版式）：档位是标题行右侧的标签，不再塞进描述里。
  expect(screen.getAllByText("STRT")).toHaveLength(3);
  const remoteCard = screen.getByText("产品范本").closest("article") as HTMLElement;
  expect(within(remoteCard.querySelector("header")!).queryByText("本机未安装")).toBeNull();
  expect(remoteCard.querySelector(".pcard-foot .pcard-install-state")).toBeNull();
  expect(within(remoteCard).getByText("v2.1.0")).toBeInTheDocument();
  expect(within(remoteCard).getByText("Vxture 智能体")).toBeInTheDocument();
  // 过期那张没有 releaseVersion，左下角就不该冒出一个空的版本号。
  const expiredCard = screen.getByText("发票助手").closest("article") as HTMLElement;
  expect(within(expiredCard).queryByText(/^v/)).not.toBeInTheDocument();
  // 本地卡只有 bidproposal 一张
  expect(screen.getAllByText("bidproposal")).toHaveLength(1);
  // 订阅清单问到了：「订阅状态尚未接通」那句不再出现
  expect(screen.queryByText("暂时读不到订阅信息，以下是这台电脑上已安装的智能体。")).not.toBeInTheDocument();

  const renew = screen.getByRole("button", { name: "续订" });
  await userEvent.setup().click(renew);
  expect(window.open).toHaveBeenCalledWith(
    "https://vxture.com/pricing?product=arda",
    "_blank",
    "noopener",
  );
  // 「在线使用」落这个产品自己的边缘地址（owner 2026-09-16 现场纠错：第一版
  // 落到了通用应用中心）——`<productCode>.<consoleBase 主机名>`，与本机
  // `product-ui-server.ts` 的 `<productId>.localhost:<port>` 同一个模型。
  const card = screen.getByText("产品范本").closest("article") as HTMLElement;
  await userEvent.setup().click(within(card).getByRole("button", { name: /在线使用/ }));
  expect(window.open).toHaveBeenCalledWith("https://vxtpl.vxture.com/", "_blank", "noopener");
});

/** 边缘地址跟着会话的 consoleBase 走，不是写死 vxture.com——staging 会话应该落到 staging 的边缘域名。 */
void test("HomePage: product URL comes from metadata independently of Console domain", async () => {
  const api = fakeApi({
    session: vi.fn().mockResolvedValue({ signedIn: true, consoleBase: "https://staging.vxture.com" } as SessionInfo),
    subscribedProducts: vi.fn().mockResolvedValue([subscription()]),
  } as Partial<Api>);
  vi.stubGlobal("open", vi.fn());
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
  const card = (await screen.findByText("产品范本")).closest("article") as HTMLElement;
  await userEvent.setup().click(within(card).getByRole("button", { name: /在线使用/ }));
  expect(window.open).toHaveBeenCalledWith("https://vxtpl.vxture.com/", "_blank", "noopener");
});

void test("HomePage: 本机一个都没装、平台上有订阅 —— 不显示「没有可用的智能体」，而是列出订阅", async () => {
  render(
    <HomePage
      api={signedInApi(vi.fn().mockResolvedValue([subscription()]))}
      products={[]}
      workspaces={[]}
      health={{ ok: true }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={noop}
      onError={noop}
    />,
  );
  expect(await screen.findByText("产品范本")).toBeInTheDocument();
  expect(screen.queryByText("当前账号没有可用的智能体")).not.toBeInTheDocument();
});

void test("HomePage: 订阅清单问失败、或返回的不是数组 —— 当作不知道，不渲染成「没有订阅」", async () => {
  for (const subscribedProducts of [
    vi.fn().mockRejectedValue(new Error("网关 502")),
    vi.fn().mockResolvedValue({ unexpected: true }),
  ]) {
    const view = render(
      <HomePage
        api={signedInApi(subscribedProducts)}
        products={[product({ entitled: null })]}
        workspaces={[]}
        health={{ ok: true }}
        onOpen={noop}
        onCreated={noop}
        onRefresh={noop}
        onError={noop}
      />,
    );
    await vi.waitFor(() => expect(subscribedProducts).toHaveBeenCalled());
    expect(screen.getByText("暂时读不到订阅信息，以下是这台电脑上已安装的智能体。")).toBeInTheDocument();
    expect(screen.queryByText("本机未安装")).not.toBeInTheDocument();
    view.unmount();
  }
});

void test("HomePage: 没登录不去问订阅清单", async () => {
  const subscribedProducts = vi.fn();
  const session = vi.fn().mockResolvedValue({ signedIn: false } as SessionInfo);
  render(
    <HomePage
      api={fakeApi({ session, subscribedProducts } as Partial<Api>)}
      products={[product()]}
      workspaces={[]}
      health={{ ok: true }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={noop}
      onError={noop}
    />,
  );
  await vi.waitFor(() => expect(session).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 20));
  expect(subscribedProducts).not.toHaveBeenCalled();
});

void test("HomePage: development fixtures are not installed agents, regardless of subscription", () => {
 for(const entitled of [null,true]){
  const view=render(<HomePage api={fakeApi()} products={[product({supply:"builtin",entitled})]} workspaces={[]} health={{ok:true}} onOpen={noop} onCreated={noop} onRefresh={noop} onError={noop}/>);
  expect(screen.queryByRole("heading",{name:"标书编写"})).not.toBeInTheDocument();
  expect(screen.queryByText("内置示例")).not.toBeInTheDocument();expect(screen.queryByRole("button",{name:"打开"})).not.toBeInTheDocument();view.unmount();
 }
});

test("runtime preparation is visible, becomes ready without focus, and stops polling after completion",async()=>{
 const system=vi.fn().mockResolvedValueOnce({startupState:"initializing"}).mockResolvedValue({startupState:"ready"});
 const view=renderHome({api:fakeApi({system})});
 expect(await screen.findByText("正在准备")).toBeInTheDocument();
 await screen.findByText("已就绪",{}, {timeout:2000});expect(system).toHaveBeenCalledTimes(2);view.unmount();
 renderHome({api:fakeApi({system:vi.fn().mockResolvedValue({startupState:"failed"})})});
 expect(await screen.findByText("准备失败")).toBeInTheDocument();
});

test("runtime preparation polling ignores late replies and clears the pending timer on unmount",async()=>{
 const pending=deferredResult<Awaited<ReturnType<Api["system"]>>>(),system=vi.fn().mockReturnValue(pending.promise);
 const view=renderHome({api:fakeApi({system})});view.unmount();
 pending.resolve({startupState:"initializing"} as Awaited<ReturnType<Api["system"]>>);await Promise.resolve();
 const next=renderHome({api:fakeApi({system:vi.fn().mockResolvedValue({startupState:"initializing"})})});
 await screen.findByText("正在准备");next.unmount();expect(system).toHaveBeenCalledTimes(1);
});

test("agent cards use platform descriptions and logos; failed and unsafe images keep the default icon",async()=>{
 const api=signedInApi(vi.fn().mockResolvedValue([
  subscription({productCode:"bidproposal",description:"平台提供的本地产品说明",iconUrl:"https://cdn.test/local.png"}),
  subscription({productCode:"remote",productName:"远端产品",description:"平台远端产品说明",iconUrl:"https://cdn.test/remote.png"}),
  subscription({productCode:"unsafe",productName:"无效图片产品",iconUrl:"javascript:alert(1)"}),
 ]));
 render(<HomePage api={api} products={[product({subscription:{status:"active",tier:"pro",bundled:false,trialEndsAt:null,currentPeriodEnd:null,cancelAtPeriodEnd:false}})]}
  workspaces={[]} health={{ok:true}} onOpen={noop} onCreated={noop} onRefresh={noop} onError={noop}/>);
 const local=(await screen.findByText("平台提供的本地产品说明")).closest("article")!;
 const remote=screen.getByText("平台远端产品说明").closest("article")!;
 expect(local.querySelector("img")).toHaveAttribute("src","https://cdn.test/local.png");
 expect(remote.querySelector("img")).toHaveAttribute("src","https://cdn.test/remote.png");
 expect(within(local.querySelector("header")!).getByText("PRO")).toBeInTheDocument();
 expect(within(local.querySelector("header")!).queryByText("本地已装")).toBeNull();
 expect(local.querySelector(".pcard-meta")?.firstElementChild).toHaveTextContent("本地已装");
 fireEvent.error(remote.querySelector("img")!);expect(remote.querySelector("img")).toBeNull();
 expect(remote.querySelector(".pcard-icon svg")).toBeInTheDocument();
 expect(screen.getByText("无效图片产品").closest("article")?.querySelector("img")).toBeNull();
});

test("platform release stage accompanies the tier and product nickname, without treating subscription as release status",async()=>{
 const rows=["preview","beta","stable","sunset","unknown"].map((releaseStage,index)=>subscription({subscriptionId:"s"+index,productCode:"p"+index,productName:"产品"+index,productNick:"NICK"+index,releaseStage}));
 const api=signedInApi(vi.fn().mockResolvedValue(rows));
 render(<HomePage api={api} products={[product({id:"p2"})]} workspaces={[]} health={{ok:true}} onOpen={noop} onCreated={noop} onRefresh={noop} onError={noop}/>);
 for(const label of ["预览版","公测版","正式版","停售中"])expect((await screen.findAllByText(label)).length).toBeGreaterThan(0);
 expect(screen.getByText("NICK2")).toHaveClass("pcard-ident");
 const unknown=screen.getByText("产品4").closest("article")!;expect(within(unknown).getByText("已订阅")).toBeInTheDocument();
});

test("hosted product icons use temporary object URLs, clean up, and ignore late responses",async()=>{
 const create=vi.fn().mockReturnValue("blob:hosted"),revoke=vi.fn();vi.stubGlobal("URL",Object.assign(URL,{createObjectURL:create,revokeObjectURL:revoke}));
 let settle!:(blob:Blob|null)=>void;
 const api=signedInApi(vi.fn().mockResolvedValue([subscription({iconVersion:"v1",iconUrl:null})]));
 api.productIcon=vi.fn().mockResolvedValue(new Blob(["logo"],{type:"image/png"}));
 const view=render(<HomePage api={api} products={[]} workspaces={[]} health={{ok:true}} onOpen={noop} onCreated={noop} onRefresh={noop} onError={noop}/>);
 await vi.waitFor(()=>expect(document.querySelector("img.pcard-product-logo")).toHaveAttribute("src","blob:hosted"));
 expect(api.productIcon).toHaveBeenCalledWith("vxtpl","v1");view.unmount();expect(revoke).toHaveBeenCalledWith("blob:hosted");
 api.productIcon=vi.fn().mockReturnValue(new Promise<Blob|null>(resolve=>{settle=resolve;}));
 const late=render(<HomePage api={api} products={[]} workspaces={[]} health={{ok:true}} onOpen={noop} onCreated={noop} onRefresh={noop} onError={noop}/>);
 await vi.waitFor(()=>expect(api.productIcon).toHaveBeenCalled());late.unmount();settle(null);await Promise.resolve();expect(create).toHaveBeenCalledTimes(1);
});
