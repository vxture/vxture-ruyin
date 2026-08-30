/**
 * App shell - desktop workbench chrome on the DS shell system (L3 portal
 * experience layer). Frameless titlebar: the ShellHeader doubles as the
 * Electron drag region, with clearance for the Windows caption overlay.
 * ShellViewport carries sidebar nav (ShellSidebarNav), the ⌘K search box,
 * and the agent dock slot. Views (home / workspace / settings) are
 * state-routed - the daemon serves a single page, no URL router.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
} from "react";
import {
  Button,
  Input,
  ShellBrand,
  ShellHeader,
  ShellIconButton,
  ShellPageContainer,
  ShellSearchBox,
  ShellSidebarNav,
  ShellViewport,
  StatusBadge,
  type ShellNavSection,
  type ShellSearchGroup,
} from "@vxture/design-system";
import { Api, type ProductInfo, type WorkspaceMeta } from "./api";
import { WorkspacePanel } from "./workspace";
import { HomePage } from "./home";
import { SettingsView } from "./settings";
import { UserSlot } from "./user";

/** Caption-overlay clearance only applies inside the Electron shell. */
const IS_ELECTRON = navigator.userAgent.includes("Electron");

type View =
  | { kind: "home" }
  | { kind: "settings" }
  | { kind: "workspace"; id: string };

const viewHref = (v: View): string =>
  v.kind === "workspace" ? `#ws/${v.id}` : `#${v.kind}`;

export default function App() {
  const fromQuery = new URLSearchParams(location.search).get("token");
  const [token, setToken] = useState<string | null>(fromQuery);
  if (!token) {
    return <TokenGate onSubmit={setToken} />;
  }
  return <Workbench api={new Api(token)} />;
}

function TokenGate({ onSubmit }: { onSubmit: (t: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="token-gate">
      <ShellBrand label="如影 RUYIN" tag="Workspace Runtime" />
      <p className="text-body-md text-muted-foreground">
        本地智能工作环境 · 粘贴 Runtime 会话 token（daemon 启动日志中打印）以连接。
      </p>
      <div className="row">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="session token"
          onKeyDown={(e) => e.key === "Enter" && value && onSubmit(value)}
        />
        <Button onClick={() => value && onSubmit(value)}>连接</Button>
      </div>
    </div>
  );
}

function useRuntimeHealth() {
  const [health, setHealth] = useState<{ ok: boolean; version?: string }>({
    ok: false,
  });
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const res = await fetch("/health");
        const data = (await res.json()) as { ok: boolean; version: string };
        if (alive) setHealth({ ok: res.ok && data.ok, version: data.version });
      } catch {
        if (alive) setHealth({ ok: false });
      }
    };
    void check();
    const timer = setInterval(() => void check(), 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  return health;
}

function Workbench({ api }: { api: Api }) {
  const [products, setProducts] = useState<ProductInfo[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceMeta[]>([]);
  const [view, setView] = useState<View>({ kind: "home" });
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const health = useRuntimeHealth();

  const refreshSidebar = useCallback(async () => {
    try {
      setProducts(await api.products());
      setWorkspaces(await api.workspaces());
      setError(null);
    } catch (e) {
      setError(String((e as Error).message));
    }
  }, [api]);

  useEffect(() => {
    void refreshSidebar();
  }, [refreshSidebar]);

  const navigate = useCallback((href: string) => {
    if (href === "#home") setView({ kind: "home" });
    else if (href === "#settings") setView({ kind: "settings" });
    else if (href.startsWith("#ws/")) {
      setView({ kind: "workspace", id: href.slice(4) });
    }
  }, []);

  const openWorkspace = useCallback(
    async (id: string) => {
      await refreshSidebar();
      setView({ kind: "workspace", id });
    },
    [refreshSidebar],
  );

  // Nav link element: state routing behind ordinary anchors, so the DS nav
  // keeps native anchor semantics (middle-click etc. are meaningless here).
  const NavLink = useMemo(() => {
    return function NavLink({
      href,
      children,
      onClick: _ignored,
      ...rest
    }: AnchorHTMLAttributes<HTMLAnchorElement>) {
      return (
        <a
          href={href}
          {...rest}
          onClick={(e) => {
            e.preventDefault();
            if (href) navigate(href);
          }}
        >
          {children}
        </a>
      );
    };
  }, [navigate]);

  // One dimension per band: brand lives in the header, the sidebar's domain
  // row says 工作台, sections navigate surfaces only. 设置 is a utility
  // (header gear + account menu), not a sibling of navigation.
  const sections: ShellNavSection[] = useMemo(() => {
    const list: ShellNavSection[] = [
      {
        title: "总览",
        items: [{ href: "#home", label: "首页", icon: "home" }],
      },
    ];
    if (workspaces.length > 0) {
      list.push({
        title: "工作空间",
        dividerBefore: true,
        items: workspaces.map((w) => ({
          href: `#ws/${w.id}`,
          label: w.name,
          icon: "cube" as const,
        })),
      });
    }
    return list;
  }, [workspaces]);

  const searchGroups: ShellSearchGroup[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (s: string) => q.length === 0 || s.toLowerCase().includes(q);
    const groups: ShellSearchGroup[] = [];
    const wsItems = workspaces
      .filter((w) => match(w.name) || match(w.productId))
      .slice(0, 6)
      .map((w) => ({
        key: w.id,
        label: w.name,
        description: `${w.productId} · ${w.workspaceType}`,
        icon: "cube" as const,
        onSelect: () => navigate(`#ws/${w.id}`),
      }));
    if (wsItems.length > 0) {
      groups.push({ key: "ws", heading: "工作空间", items: wsItems });
    }
    const productItems = products
      .filter((p) => match(p.name) || match(p.id))
      .map((p) => ({
        key: p.id,
        label: p.name,
        description: p.id,
        icon: "package" as const,
        meta: "已安装",
        onSelect: () => navigate("#home"),
      }));
    if (productItems.length > 0) {
      groups.push({ key: "products", heading: "产品", items: productItems });
    }
    const actions = [
      {
        key: "home",
        label: "回到首页",
        icon: "home" as const,
        onSelect: () => navigate("#home"),
      },
      {
        key: "settings",
        label: "打开设置",
        icon: "settings" as const,
        onSelect: () => navigate("#settings"),
      },
    ].filter((a) => match(a.label));
    if (actions.length > 0) {
      groups.push({ key: "actions", heading: "动作", items: actions });
    }
    return groups;
  }, [query, workspaces, products, navigate]);

  const header = (
    <ShellHeader
      className="titlebar"
      height="md"
      leading={
        <span className="no-drag">
          <ShellBrand
            label="如影 RUYIN"
            tag="Workspace"
            href="#home"
            className="cursor-pointer"
          />
        </span>
      }
      center={
        <div className="no-drag w-full max-w-[520px]">
          <ShellSearchBox
            query={query}
            onQueryChange={setQuery}
            groups={searchGroups}
            labels={{
              placeholder: "搜索工作空间、产品与动作…",
              empty: "没有匹配的结果",
              resultsLabel: "搜索结果",
            }}
          />
        </div>
      }
      trailing={
        <div className="no-drag flex items-center gap-xs">
          <StatusBadge tone={health.ok ? "success" : "danger"} dot>
            {health.ok ? `Runtime ${health.version ?? ""}` : "未连接"}
          </StatusBadge>
          <ShellIconButton
            icon="settings"
            label="设置"
            active={view.kind === "settings"}
            onClick={() => navigate("#settings")}
          />
          {IS_ELECTRON && <span className="caption-spacer" aria-hidden />}
        </div>
      }
    />
  );

  const sidebar = (
    <ShellSidebarNav
      domainName="工作台"
      sections={sections}
      collapsed={collapsed}
      onToggleCollapsed={() => setCollapsed(!collapsed)}
      isActive={(href) => href === viewHref(view)}
      storageKeyPrefix="ruyin-workbench"
      linkComponent={NavLink}
      labels={{
        expandNav: "展开导航",
        collapseNav: "收起导航",
        expandAllGroups: "展开全部分组",
        collapseAllGroups: "收起全部分组",
      }}
      footer={
        <UserSlot
          api={api}
          productIds={products.map((p) => p.id)}
          collapsed={collapsed}
          onOpenSettings={() => navigate("#settings")}
        />
      }
    />
  );

  return (
    // 无全局 agent 面：ruyin 是工作空间运行时（20-specs/10 §1.3），智能体现在
    // 各业务产品的任务流里（Harness 任务 + 人工检查点），不做壳级对话助手。
    <ShellViewport
      header={header}
      sidebar={sidebar}
      sidebarMode={collapsed ? "collapsed" : "expanded"}
    >
      <ShellPageContainer width="wide-2xl" className="workbench-page">
        {error && <div className="error-box">{error}</div>}
        {view.kind === "settings" ? (
          <SettingsView api={api} />
        ) : view.kind === "workspace" ? (
          <WorkspacePanel key={view.id} api={api} id={view.id} />
        ) : (
          <HomePage
            api={api}
            products={products}
            workspaces={workspaces}
            health={health}
            onOpen={(id) => setView({ kind: "workspace", id })}
            onCreated={openWorkspace}
            onError={setError}
          />
        )}
      </ShellPageContainer>
    </ShellViewport>
  );
}
