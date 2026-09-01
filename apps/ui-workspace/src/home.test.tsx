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
  expect(await screen.findByText("登录后同步你的业务产品")).toBeInTheDocument();
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
  expect(await screen.findByText("当前账号没有可用的业务产品")).toBeInTheDocument();
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
  await user.click(await screen.findByText("到 Vxture 平台订阅 ↗"));
  expect(globalThis.open).toHaveBeenCalledWith(
    "https://vxture.com/subscribe",
    "_blank",
    "noopener",
  );
});

void test("HomePage: metrics reflect health/product/workspace counts and key protection", async () => {
  const api = fakeApi({ system: vi.fn().mockResolvedValue({ keyProtection: "dpapi" }) });
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
  expect(screen.getByText("就绪")).toBeInTheDocument();
  expect(screen.getByText("本地守护进程 0.2.0")).toBeInTheDocument();
  expect(screen.getByText("2")).toBeInTheDocument(); // 项目数
  expect(await screen.findByText("已加密")).toBeInTheDocument();
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
  expect(screen.getByText("等待守护进程")).toBeInTheDocument();
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

// --- InstalledProductCard ----------------------------------------------------

void test("HomePage: the usable-products grid uses 2 vs 3-column layout once there's more than one card", () => {
  const { container, rerender } = render(
    <HomePage
      api={fakeApi()}
      products={[product({ id: "vxture.bid" }), product({ id: "vxture.crm" })]}
      workspaces={[]}
      health={{ ok: true }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={noop}
      onError={noop}
    />,
  );
  expect(container.querySelector(".md\\:grid-cols-2:not(.xl\\:grid-cols-3)")).toBeTruthy();

  rerender(
    <HomePage
      api={fakeApi()}
      products={[
        product({ id: "vxture.bid" }),
        product({ id: "vxture.crm" }),
        product({ id: "vxture.ops" }),
      ]}
      workspaces={[]}
      health={{ ok: true }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={noop}
      onError={noop}
    />,
  );
  expect(container.querySelector(".xl\\:grid-cols-3")).toBeTruthy();
});

void test("HomePage: the blocked-products grid gets the same column treatment past two cards", () => {
  const { container } = render(
    <HomePage
      api={fakeApi()}
      products={[
        product({ id: "vxture.bid", availability: "disabled", state: "inactive", reason: "已停用" }),
        product({ id: "vxture.crm", availability: "disabled", state: "inactive", reason: "已停用" }),
        product({ id: "vxture.ops", availability: "disabled", state: "inactive", reason: "已停用" }),
      ]}
      workspaces={[]}
      health={{ ok: true }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={noop}
      onError={noop}
    />,
  );
  expect(container.querySelector(".xl\\:grid-cols-3")).toBeTruthy();
});

void test("InstalledProductCard: entitled shows 已订阅, merely-installed shows 本地已装", () => {
  const { rerender } = render(
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
  expect(screen.getByText("已订阅")).toBeInTheDocument();

  rerender(
    <HomePage
      api={fakeApi()}
      products={[product({ entitled: false })]}
      workspaces={[]}
      health={{ ok: true }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={noop}
      onError={noop}
    />,
  );
  expect(screen.getByText("本地已装")).toBeInTheDocument();
});

void test("InstalledProductCard: clicking an existing project opens it, and lists 'N more' past three", async () => {
  const onOpen = vi.fn();
  const workspaces = ["a", "b", "c", "d"].map((s) => workspace({ id: `prj_${s}`, name: `项目${s}` }));
  render(
    <HomePage
      api={fakeApi()}
      products={[product()]}
      workspaces={workspaces}
      health={{ ok: true }}
      onOpen={onOpen}
      onCreated={noop}
      onRefresh={noop}
      onError={noop}
    />,
  );
  expect(await screen.findByText("等 4 个")).toBeInTheDocument();
  const user = userEvent.setup();
  await user.click(screen.getByText("项目a"));
  expect(onOpen).toHaveBeenCalledWith("prj_a");
});

void test("InstalledProductCard: 新建项目 is disabled without a workspace (not signed in / no workspace)", async () => {
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
    />,
  );
  expect(await screen.findByText("新建项目")).toBeDisabled();
  expect(
    screen.getByText("登录并选择工作区后可新建——项目须归属于一个工作区"),
  ).toBeInTheDocument();
});

async function renderWithWorkspace(
  apiOverrides: Partial<Api>,
  extra: Partial<Parameters<typeof HomePage>[0]> = {},
) {
  const workspaceSession: SessionInfo = {
    signedIn: true,
    issuer: "",
    consoleBase: "https://vxture.com",
    entitlementsConfigured: false,
    workspace: { id: "wsp_1", name: "演示工作区" },
  };
  // apiOverrides 里从不带 session（每个调用点都只给 createProject 之类），
  // 展开放在前面、显式 session 放在后面，两边都不会触发"可能被覆盖"的告警。
  const withSession = fakeApi({ ...apiOverrides, session: vi.fn().mockResolvedValue(workspaceSession) });
  render(
    <HomePage
      api={withSession}
      products={[product()]}
      workspaces={[]}
      health={{ ok: true }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={noop}
      onError={noop}
      {...extra}
    />,
  );
  await screen.findByText("将建在「演示工作区」，从这里开始第一个项目");
  return withSession;
}

void test("InstalledProductCard: creating a project opens a name field, submits, and calls onCreated", async () => {
  const createProject = vi.fn().mockResolvedValue({ id: "prj_new" });
  const onCreated = vi.fn();
  await renderWithWorkspace({ createProject }, { onCreated });

  const user = userEvent.setup();
  await user.click(screen.getByText("新建项目"));
  const input = screen.getByPlaceholderText("项目名称");
  await user.type(input, "我的新项目");
  await user.click(screen.getByText("创建"));

  expect(createProject).toHaveBeenCalledWith("vxture.bid", "我的新项目");
  await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith("prj_new"));
});

void test("InstalledProductCard: an empty name falls back to the product's own name", async () => {
  const createProject = vi.fn().mockResolvedValue({ id: "prj_new" });
  await renderWithWorkspace({ createProject });

  const user = userEvent.setup();
  await user.click(screen.getByText("新建项目"));
  await user.click(screen.getByText("创建"));
  expect(createProject).toHaveBeenCalledWith("vxture.bid", "标书编写");
});

void test("InstalledProductCard: a failed creation calls onError, not a silent no-op", async () => {
  const createProject = vi.fn().mockRejectedValue(new Error("产品未安装"));
  const onError = vi.fn();
  await renderWithWorkspace({ createProject }, { onError });

  const user = userEvent.setup();
  await user.click(screen.getByText("新建项目"));
  await user.click(screen.getByText("创建"));
  await vi.waitFor(() => expect(onError).toHaveBeenCalledWith("产品未安装"));
});

void test("InstalledProductCard: a product with no canned blurb falls back to a generic description", () => {
  render(
    <HomePage
      api={fakeApi()}
      products={[product({ id: "vxture.crm", name: "CRM" })]}
      workspaces={[]}
      health={{ ok: true }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={noop}
      onError={noop}
    />,
  );
  expect(screen.getByText("Vxture 业务产品")).toBeInTheDocument();
});

void test("InstalledProductCard: pressing Escape while naming a new project cancels it", async () => {
  await renderWithWorkspace({});
  const user = userEvent.setup();
  await user.click(screen.getByText("新建项目"));
  await user.type(screen.getByPlaceholderText("项目名称"), "半途而废{Escape}");
  expect(screen.queryByPlaceholderText("项目名称")).not.toBeInTheDocument();
  expect(screen.getByText("新建项目")).toBeInTheDocument();
});

void test("InstalledProductCard: an existing project in the workspace drops the 'first project' hint", async () => {
  const session = {
    signedIn: true,
    issuer: "",
    consoleBase: "https://vxture.com",
    entitlementsConfigured: false,
    workspace: { id: "wsp_1", name: "演示工作区" },
  } as SessionInfo;
  render(
    <HomePage
      api={fakeApi({ session: vi.fn().mockResolvedValue(session) })}
      products={[product()]}
      workspaces={[workspace()]}
      health={{ ok: true }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={noop}
      onError={noop}
    />,
  );
  expect(await screen.findByText("将建在「演示工作区」")).toBeInTheDocument();
  expect(screen.queryByText(/从这里开始第一个项目/)).not.toBeInTheDocument();
});

void test("InstalledProductCard: the version dropdown only appears with a real second version to pick", () => {
  const { rerender } = render(
    <HomePage
      api={fakeApi()}
      products={[product({ versions: ["1.0.0"] })]}
      workspaces={[]}
      health={{ ok: true }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={noop}
      onError={noop}
    />,
  );
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

  rerender(
    <HomePage
      api={fakeApi()}
      products={[product({ versions: ["1.0.0", "0.9.0"] })]}
      workspaces={[]}
      health={{ ok: true }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={noop}
      onError={noop}
    />,
  );
  expect(screen.getByRole("combobox")).toBeInTheDocument();
});

void test("InstalledProductCard: switching version pins it, then refreshes", async () => {
  const pinProductVersion = vi.fn().mockResolvedValue(product());
  const onRefresh = vi.fn();
  render(
    <HomePage
      api={fakeApi({ pinProductVersion } as Partial<Api>)}
      products={[product({ versions: ["1.0.0", "0.9.0"] })]}
      workspaces={[]}
      health={{ ok: true }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={onRefresh}
      onError={noop}
    />,
  );
  const user = userEvent.setup();
  await user.selectOptions(screen.getByRole("combobox"), "0.9.0");
  expect(pinProductVersion).toHaveBeenCalledWith("vxture.bid", "0.9.0");
  await vi.waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
});

void test("InstalledProductCard: 停用 calls deactivateProduct then refreshes; a failure calls onError", async () => {
  const deactivateProduct = vi.fn().mockRejectedValue(new Error("守护进程忙"));
  const onError = vi.fn();
  render(
    <HomePage
      api={fakeApi({ deactivateProduct } as Partial<Api>)}
      products={[product()]}
      workspaces={[]}
      health={{ ok: true }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={noop}
      onError={onError}
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByText("停用"));
  expect(deactivateProduct).toHaveBeenCalledWith("vxture.bid");
  await vi.waitFor(() => expect(onError).toHaveBeenCalledWith("守护进程忙"));
});

void test("InstalledProductCard: a successful 停用 refreshes rather than requiring a manual reload", async () => {
  const deactivateProduct = vi.fn().mockResolvedValue(product({ state: "inactive" }));
  const onRefresh = vi.fn();
  render(
    <HomePage
      api={fakeApi({ deactivateProduct } as Partial<Api>)}
      products={[product()]}
      workspaces={[]}
      health={{ ok: true }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={onRefresh}
      onError={noop}
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByText("停用"));
  await vi.waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
});

void test("InstalledProductCard: a failed version pin calls onError with the daemon's reason", async () => {
  const pinProductVersion = vi.fn().mockRejectedValue(new Error("该版本已从库中移除"));
  const onError = vi.fn();
  render(
    <HomePage
      api={fakeApi({ pinProductVersion } as Partial<Api>)}
      products={[product({ versions: ["1.0.0", "0.9.0"] })]}
      workspaces={[]}
      health={{ ok: true }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={noop}
      onError={onError}
    />,
  );
  const user = userEvent.setup();
  await user.selectOptions(screen.getByRole("combobox"), "0.9.0");
  await vi.waitFor(() => expect(onError).toHaveBeenCalledWith("该版本已从库中移除"));
});

void test("HomePage: 在平台管理订阅 (the button shown once there are usable products) opens the subscribe page too", async () => {
  const api = fakeApi({
    session: vi.fn().mockResolvedValue({ signedIn: true, consoleBase: "https://vxture.com" } as SessionInfo),
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
  const user = userEvent.setup();
  await user.click(await screen.findByText("在平台管理订阅 ↗"));
  expect(globalThis.open).toHaveBeenCalledWith(
    "https://vxture.com/subscribe",
    "_blank",
    "noopener",
  );
});

// --- Blocked products ---------------------------------------------------------

void test("Blocked products: not_entitled shows 未订阅 with a subscribe/renew link; disabled shows 已停用 with 启用", async () => {
  const activateProduct = vi.fn().mockResolvedValue(product());
  const onRefresh = vi.fn();
  render(
    <HomePage
      api={fakeApi({ activateProduct } as Partial<Api>)}
      products={[
        product({
          id: "vxture.crm",
          name: "CRM",
          availability: "not_entitled",
          entitled: false,
          reason: "平台订阅未覆盖此产品",
          commercialIntent: "subscribe",
        }),
        product({
          id: "vxture.ops",
          name: "运维",
          availability: "disabled",
          state: "inactive",
          reason: "已在本机停用",
        }),
      ]}
      workspaces={[]}
      health={{ ok: true }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={onRefresh}
      onError={noop}
    />,
  );

  expect(await screen.findByText("未订阅")).toBeInTheDocument();
  expect(screen.getByText("平台订阅未覆盖此产品")).toBeInTheDocument();
  expect(screen.getByText("去平台订阅 ↗")).toBeInTheDocument();

  expect(screen.getByText("已停用")).toBeInTheDocument();
  const user = userEvent.setup();
  await user.click(screen.getByText("启用"));
  expect(activateProduct).toHaveBeenCalledWith("vxture.ops");
  await vi.waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
});

void test("Blocked products: a failed 启用 calls onError with the daemon's reason", async () => {
  const activateProduct = vi.fn().mockRejectedValue(new Error("产品需要重新签名验证"));
  const onError = vi.fn();
  render(
    <HomePage
      api={fakeApi({ activateProduct } as Partial<Api>)}
      products={[
        product({ id: "vxture.ops", availability: "disabled", state: "inactive", reason: "已在本机停用" }),
      ]}
      workspaces={[]}
      health={{ ok: true }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={noop}
      onError={onError}
    />,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByText("启用"));
  await vi.waitFor(() => expect(onError).toHaveBeenCalledWith("产品需要重新签名验证"));
});

void test("Blocked products: a bundled-covered product with no commercialIntent shows no subscribe button (D4)", () => {
  render(
    <HomePage
      api={fakeApi()}
      products={[
        product({
          id: "vxture.ops",
          availability: "disabled",
          state: "inactive",
          reason: "已在本机停用",
          commercialIntent: null,
        }),
      ]}
      workspaces={[]}
      health={{ ok: true }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={noop}
      onError={noop}
    />,
  );
  expect(screen.queryByText(/去平台/)).not.toBeInTheDocument();
});

void test("Blocked products: renew intent links to the renew flow, not first-purchase", async () => {
  render(
    <HomePage
      api={fakeApi({
        session: vi.fn().mockResolvedValue({ signedIn: true, consoleBase: "https://vxture.com" } as SessionInfo),
      })}
      products={[
        product({
          id: "vxture.crm",
          availability: "not_entitled",
          entitled: false,
          commercialIntent: "renew",
        }),
      ]}
      workspaces={[]}
      health={{ ok: true }}
      onOpen={noop}
      onCreated={noop}
      onRefresh={noop}
      onError={noop}
    />,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByText("去平台续费 ↗"));
  expect(globalThis.open).toHaveBeenCalledWith(
    "https://vxture.com/subscribe?product=vxture.crm&intent=renew",
    "_blank",
    "noopener",
  );
});

// --- InstallPackageRow --------------------------------------------------------

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
