/**
 * Workbench - the signed-in/local product surface on the DS shell system (L3
 * portal experience). Frameless titlebar: the ShellHeader adapts to the host
 * (electron / installed-PWA WCO / plain browser) for a single title-bar
 * contract. Views (home / workspace / settings) are state-routed - the daemon
 * serves a single page, no URL router.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
} from "react";
import {
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
import { Api, type ProductInfo, type ProjectMeta } from "./api";
import { ProjectPanel } from "./workspace";
import { HomePage } from "./home";
import { SettingsView } from "./settings";
import { UserSlot } from "./user";
import { PendingInbox, usePending } from "./pending";

/** Caption-overlay clearance only applies inside the Electron shell. */
const IS_ELECTRON = navigator.userAgent.includes("Electron");

/**
 * 窗口 chrome 由谁提供。**两种，不是三种：**
 *  - electron：桌面应用。无边框壳，本 header 就是标题栏（拖拽区 + Windows
 *    按钮避让）。**这是唯一的应用入口**——它自己拉起运行时。
 *  - browser：浏览器访问。窗口自带标题栏，header 退化为应用工具条，不假装
 *    标题栏（无拖拽、无避让），避免双标题栏。
 *
 * 曾有第三种 `wco`：装成 PWA 后 Window Controls Overlay 生效，外观与 electron
 * 同构。已随 PWA 一并去掉——**它长得像桌面应用，却不启动运行时**，守护进程没跑
 * 时点开就是「未连接」。一个永远不会出现的分支只会让读代码的人以为它被处理了。
 */
export type HostChrome = "electron" | "browser";

export function useHostChrome(): HostChrome {
  return IS_ELECTRON ? "electron" : "browser";
}

type View =
  | { kind: "home" }
  | { kind: "settings" }
  | { kind: "workspace"; id: string };

const viewHref = (v: View): string =>
  v.kind === "workspace" ? `#ws/${v.id}` : `#${v.kind}`;

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

export function Workbench({ api }: { api: Api }) {
  const [products, setProducts] = useState<ProductInfo[]>([]);
  const [workspaces, setWorkspaces] = useState<ProjectMeta[]>([]);
  /** 其他工作区里还有几个项目。只报数量——让人知道数据还在，不泄露名字。 */
  const [elsewhere, setElsewhere] = useState(0);
  const [view, setView] = useState<View>({ kind: "home" });
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const health = useRuntimeHealth();
  const chrome = useHostChrome();
  const pending = usePending(api);

  const refreshSidebar = useCallback(async () => {
    try {
      setProducts(await api.products());
      const list = await api.projects();
      setWorkspaces(list.items);
      setElsewhere(list.elsewhere);
      setError(null);
    } catch (e) {
      setError(String((e as Error).message));
    }
  }, [api]);

  useEffect(() => {
    void refreshSidebar();
  }, [refreshSidebar]);

  /**
   * 窗口重新获得焦点时立刻拉一次订阅（TD-014 D5）。
   *
   * **这一刻正是用户付完款回到应用的那一刻**——订阅轮询是 5 分钟一次，让他对着
   * 一个「未订阅」的界面等上几分钟，是这条最难解释的失败。C2 自身有 45 秒缓存，
   * 所以频繁切窗口不会打爆平台。
   */
  useEffect(() => {
    const onFocus = () => {
      void api
        .refreshEntitlements()
        .then((list) => setProducts(list))
        // 拉不到就沿用现有判定（ADR-003），不把用户锁住，也不报错打扰他。
        .catch(() => {});
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [api]);

  const navigate = useCallback((href: string) => {
    if (href === "#home") setView({ kind: "home" });
    else if (href === "#settings") setView({ kind: "settings" });
    else if (href.startsWith("#ws/")) {
      setView({ kind: "workspace", id: href.slice(4) });
    }
  }, []);

  const openProject = useCallback(
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
    const mine = workspaces.filter((w) => w.workspaceId);
    // 归属为空的另起一组：它们不是普通项目，是一份**待导入队列**（ADR-015）。
    // 混在一起会让「这是个不该长期存在的状态」这件事消失。
    const pendingImport = workspaces.filter((w) => !w.workspaceId);
    if (mine.length > 0) {
      list.push({
        title: "项目",
        dividerBefore: true,
        items: mine.map((w) => ({
          href: `#ws/${w.id}`,
          label: w.name,
          icon: "cube" as const,
        })),
      });
    }
    if (pendingImport.length > 0) {
      list.push({
        title: "待导入工作区",
        dividerBefore: true,
        items: pendingImport.map((w) => ({
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
        description: `${w.productId} · ${w.projectType}`,
        icon: "cube" as const,
        onSelect: () => navigate(`#ws/${w.id}`),
      }));
    if (wsItems.length > 0) {
      groups.push({ key: "ws", heading: "项目", items: wsItems });
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
      className={chrome === "browser" ? "app-topbar" : `app-topbar titlebar titlebar-${chrome}`}
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
              placeholder: "搜索项目、产品与动作…",
              empty: "没有匹配的结果",
              resultsLabel: "搜索结果",
            }}
          />
        </div>
      }
      trailing={
        <div className="no-drag flex items-center gap-xs">
          {/* 常驻：未决确认在哪个视图都看得见。放进某个页面里等于又要求
              用户先找对地方，而那正是这条要修的问题。 */}
          <PendingInbox
            rows={pending}
            onOpen={(id) => setView({ kind: "workspace", id })}
          />
          <StatusBadge tone={health.ok ? "success" : "danger"} dot>
            {health.ok ? `Runtime ${health.version ?? ""}` : "未连接"}
          </StatusBadge>
          {/* 「安装桌面应用」（PWA）已移除，理由见 login.tsx 同处注释。 */}
          <ShellIconButton
            icon="settings"
            label="设置"
            active={view.kind === "settings"}
            onClick={() => navigate("#settings")}
          />
          {chrome === "electron" && <span className="caption-spacer" aria-hidden />}
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
        <>
          {/* 只报数量，不报名字：隔离要照做，但「切到别的工作区，项目全没了」
              在用户那里和「数据丢了」分不开。 */}
          {elsewhere > 0 && !collapsed && (
            <p className="sidebar-elsewhere">
              另有 {elsewhere} 个项目在其他工作区
            </p>
          )}
          <UserSlot
            api={api}
            productIds={products.map((p) => p.id)}
            collapsed={collapsed}
            onOpenSettings={() => navigate("#settings")}
          />
        </>
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
          <ProjectPanel key={view.id} api={api} id={view.id} />
        ) : (
          <HomePage
            api={api}
            products={products}
            workspaces={workspaces}
            health={health}
            onOpen={(id) => setView({ kind: "workspace", id })}
            onCreated={openProject}
            onError={setError}
          />
        )}
      </ShellPageContainer>
    </ShellViewport>
  );
}
