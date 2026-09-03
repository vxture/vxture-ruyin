/**
 * 工作台 —— 建在 DS shell 之上的宿主外壳。视图按状态路由（守护进程只发一个
 * 页面，没有 URL router），无边框标题栏按宿主（Electron / 浏览器）适配。
 *
 * **chrome 有三态，规则只有一条：谁的导航就放在谁的侧栏里。**
 *
 *   工作台  如影 RUYIN            总览 / 项目
 *   产品    ← ｜ 产品名 · 项目名   产品的分区 + 同产品其他项目
 *   设置    ← ｜ 设置             设置的分区
 *
 * 参照 macOS：应用名在菜单栏，文档名在标题栏，宿主退到一侧。进了产品就是进了
 * 另一套框架，所以那条 32px 的页内 tab 横条与设置页内那根竖直导航都不该存在
 * —— 它们本来就是各自应用的导航。
 *
 * 产品名取自契约的 product.name：运行时展示的是产品声明过的事实，不是自己编的
 * 表达（ADR-011 的判据）。
 *
 * 当前工作区常驻标题栏：项目、订阅、权益、数据边界全按工作区划分，跨工作区
 * 访问会被服务端拒绝 —— 看不到自己在哪个工作区，那句拒绝就无从理解。
 */

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
} from "react";
import {
  Icon,
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
import { PROJECT_TABS, type TabId } from "./workspace-tabs";
import { SETTINGS_SECTIONS, type SectionId } from "./settings-sections";
import { DEMO_RECENT } from "./catalog";
import { UserSlot } from "./user";
import { PendingInbox, usePending } from "./pending";
import { useHostChrome } from "./host-chrome";

// 首页/设置/项目面板各自懒加载（TD-011②）——三个都不小（各自的 DS 组件面
// 加起来是这个应用体量的大头），而任一时刻至多一个在屏幕上。静态导入等于
// 让登录后的第一屏等三份都下载完，哪怕用户落地就只看首页。PROJECT_TABS/
// SETTINGS_SECTIONS 是纯数据（侧栏分区要用），照常静态导入——没有理由为几个
// 字符串常量拖出一整个异步边界。
const HomePage = lazy(() =>
  import("./home").then((m) => ({ default: m.HomePage })),
);
const SettingsView = lazy(() =>
  import("./settings").then((m) => ({ default: m.SettingsView })),
);
const ProjectPanel = lazy(() =>
  import("./workspace").then((m) => ({ default: m.ProjectPanel })),
);

type View =
  | { kind: "home" }
  | { kind: "settings"; section: SectionId }
  | { kind: "workspace"; id: string; tab: TabId };

/** 分区图标。名字取自 DS 图标表，改名会在构建时被类型挡住。 */
const TAB_ICON = {
  overview: "home",
  context: "folder-open",
  tasks: "list-checks",
  audit: "fingerprint",
} as const satisfies Record<TabId, string>;

const viewHref = (v: View): string =>
  v.kind === "workspace"
    ? `#ws/${v.id}/${v.tab}`
    : v.kind === "settings"
      ? `#settings/${v.section}`
      : `#${v.kind}`;

const isTab = (s: string): s is TabId =>
  PROJECT_TABS.some((t) => t.id === s);

/**
 * 当前会话的工作区名。
 *
 * 界面上原本一个字都没有 —— 而项目、订阅、权益、数据边界全按工作区划分
 * （ADR-015），跨工作区访问会被服务端拒绝。用户看着屏幕却不知道自己在哪个
 * 工作区，那句拒绝就无从理解。
 */
function useWorkspaceName(api: Api): string | undefined {
  const [name, setName] = useState<string | undefined>();
  useEffect(() => {
    let alive = true;
    const read = async () => {
      try {
        const s = await api.session();
        if (alive) setName(s.signedIn ? s.workspace?.name : undefined);
      } catch {
        /* 未接通时不显示，而不是显示一个猜的名字 */
      }
    };
    void read();
    const timer = setInterval(() => void read(), 30_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [api]);
  return name;
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
    else if (href.startsWith("#settings")) {
      const section = href.slice(10);
      setView({
        kind: "settings",
        section: SETTINGS_SECTIONS.some((x) => x.id === section)
          ? (section as SectionId)
          : "account",
      });
    }
    else if (href.startsWith("#ws/")) {
      const [id, tab] = href.slice(4).split("/");
      if (id) setView({ kind: "workspace", id, tab: isTab(tab ?? "") ? (tab as TabId) : "overview" });
    }
  }, []);

  const openProject = useCallback(
    async (id: string) => {
      await refreshSidebar();
      setView({ kind: "workspace", id, tab: "overview" });
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
  const openProjectMeta =
    view.kind === "workspace"
      ? workspaces.find((w) => w.id === view.id)
      : undefined;
  const openProductName =
    products.find((p) => p.id === openProjectMeta?.productId)?.name ??
    openProjectMeta?.productId;
  const [projectPending, setProjectPending] = useState(0);
  const workspaceName = useWorkspaceName(api);

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
      // 「最近工作」而不是「项目」：侧栏要回答的是「我刚才在做什么」，所以按
      // 新到旧排。产品名走 subLabel —— 项目名是他要找的东西，产品名是用来
      // 区分重名的上下文，两者不该挤在同一行里用连字符拼起来。
      const recent = [...mine].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      );
      list.push({
        title: "最近工作",
        dividerBefore: true,
        items: recent.map((w) => ({
          href: `#ws/${w.id}/overview`,
          label: w.name,
          subLabel:
            products.find((p) => p.id === w.productId)?.name ?? w.productId,
          icon: "cube" as const,
        })),
      });
    } else {
      // 一个真项目都没有时才放样例，好让这一栏的样子看得见。真数据一到就整组
      // 消失 —— 真假混排用户没法分辨（catalog.ts 的 DEMO_RECENT 有完整约束）。
      list.push({
        title: "最近工作",
        dividerBefore: true,
        // href 必须**逐条唯一**：侧栏拿 href 当 key，三条都写 `#home` 会撞成
        // 重复 key，React 就不保证增删的对应关系了 —— 真项目到位、这一组本该
        // 整体消失时，会有一条样例留在屏幕上，那正是这组数据最不能出的错。
        // `#sample/N` 不匹配 navigate() 的任何一支，点了什么也不发生。
        items: DEMO_RECENT.map((d, i) => ({
          href: `#sample/${i}`,
          label: d.project,
          subLabel: `示例 · ${d.product}`,
          icon: "cube" as const,
        })),
      });
    }
    if (pendingImport.length > 0) {
      list.push({
        title: "待导入工作区",
        dividerBefore: true,
        items: pendingImport.map((w) => ({
          href: `#ws/${w.id}/overview`,
          label: w.name,
          icon: "cube" as const,
        })),
      });
    }
    return list;
  }, [workspaces, products]);

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
        onSelect: () => navigate("#settings/account"),
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
      height="sm"
      leading={
        /* 两套 chrome。
         *
         * 工作台态：如影自己的身份。
         * 产品态：**进了产品就是进了另一套框架** —— 标题栏交给产品，写它的名字
         * 和当前项目，左边留一条回工作台的路。macOS 的做法：应用名在菜单栏，
         * 文档名在标题栏，宿主退到一侧。
         *
         * 产品名取自契约的 product.name —— 运行时展示的是产品声明过的事实，
         * 不是自己编的表达（ADR-011 的判据）。 */
        <span className="no-drag flex items-center gap-xs min-w-0">
          {view.kind !== "home" ? (
            <>
              <ShellIconButton
                icon="arrow-left"
                label="回到工作台"
                onClick={() => navigate("#home")}
              />
              <span className="app-ident min-w-0">
                {view.kind === "settings" ? (
                  <span className="app-ident-product">设置</span>
                ) : (
                  <>
                    <span className="app-ident-product">{openProductName}</span>
                    <span className="app-ident-sep">·</span>
                    <span className="app-ident-doc">
                      {openProjectMeta?.name ?? "项目"}
                    </span>
                  </>
                )}
              </span>
            </>
          ) : (
            /* 品牌 = 产品 = RUYIN（大写），标语 Intelligent Workbench（owner 2026-09-03 定）。
               字标只写 RUYIN：标记已经在左边了，再写一个中文名是同一个身份说两遍，
               而标题栏的宽度要留给用户正在做的事。 */
            <ShellBrand
              label="RUYIN"
              tag="Intelligent Workbench"
              href="#home"
              logoSrc="/logo.svg"
              logoAlt="RUYIN"
              className="app-brand cursor-pointer"
            />
          )}
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
          {/* 当前工作区常驻。**此前它一个字都没有出现在项目面板上**，而项目、
              订阅、权益、数据边界全按工作区划分，跨工作区访问会被服务端拒绝
              —— 用户看着屏幕却不知道自己在哪个工作区，那句拒绝就无从理解。 */}
          {workspaceName && (
            // 原来这里是一个光秃秃的词，「这是什么」只写在 title 里 —— 而 title
            // 要悬停才看得到，等于没说。加个图标和「工作区」二字，它才自己说明
            // 自己是什么。
            <span className="app-workspace" title={`当前工作区：${workspaceName}`}>
              <Icon name="buildings" size="xs" />
              <span className="app-workspace-label">工作区</span>
              <span className="app-workspace-name">{workspaceName}</span>
            </span>
          )}
          {/* 常驻：未决确认在哪个视图都看得见。放进某个页面里等于又要求
              用户先找对地方，而那正是这条要修的问题。 */}
          <PendingInbox
            rows={pending}
            onOpen={(id) => setView({ kind: "workspace", id, tab: "overview" })}
          />
          <StatusBadge tone={health.ok ? "success" : "danger"} dot>
            {health.ok ? `Runtime ${health.version ?? ""}` : "未连接"}
          </StatusBadge>
          {/* 「安装桌面应用」（PWA）已移除，理由见 login.tsx 同处注释。 */}
          <ShellIconButton
            icon="settings"
            label="设置"
            active={view.kind === "settings"}
            onClick={() => navigate("#settings/account")}
          />
          {chrome === "electron" && <span className="caption-spacer" aria-hidden />}
        </div>
      }
    />
  );

  /* 产品态的侧栏：**这个项目自己的分区**，加上同产品的其他项目。
   * 原本那条 32px 的横 tab 条就此消失 —— 它本来就是产品的导航，属于源列表。 */
  const productSections: ShellNavSection[] = useMemo(() => {
    if (view.kind !== "workspace") return [];
    const siblings = workspaces.filter(
      (w) => w.productId === openProjectMeta?.productId && w.id !== view.id,
    );
    const list: ShellNavSection[] = [
      {
        title: openProjectMeta?.name ?? "项目",
        items: PROJECT_TABS.map((t) => ({
          href: `#ws/${view.id}/${t.id}`,
          // 未决数挂在「任务」上：徽章跟着它要指向的东西走，才省得下那条
          // 32px 的横条。
          label:
            t.id === "tasks" && projectPending > 0
              ? `${t.label}（${projectPending}）`
              : t.label,
          icon: TAB_ICON[t.id],
        })),
      },
    ];
    if (siblings.length > 0) {
      list.push({
        title: "同产品的其他项目",
        dividerBefore: true,
        items: siblings.map((w) => ({
          href: `#ws/${w.id}/overview`,
          label: w.name,
          icon: "cube" as const,
        })),
      });
    }
    return list;
  }, [view, workspaces, openProjectMeta, projectPending]);

  /** 设置的分区。和产品态同一套道理：它是设置自己的导航，所以它在侧栏 ——
   *  页面里再放一根竖直导航，屏幕上就并排站着两根。 */
  const settingsSections: ShellNavSection[] = useMemo(
    () => [
      {
        title: "设置",
        items: SETTINGS_SECTIONS.map((x) => ({
          href: `#settings/${x.id}`,
          label: x.label,
          icon: x.icon as "settings",
        })),
      },
    ],
    [],
  );

  const sidebar = (
    <ShellSidebarNav
      domainName={
        view.kind === "workspace"
          ? (openProductName ?? "产品")
          : view.kind === "settings"
            ? "设置"
            : "工作台"
      }
      sections={
        view.kind === "workspace"
          ? productSections
          : view.kind === "settings"
            ? settingsSections
            : sections
      }
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
            onOpenSettings={() => navigate("#settings/account")}
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
        <Suspense
          fallback={
            <p className="text-body-md text-muted-foreground">加载中……</p>
          }
        >
          {view.kind === "settings" ? (
            <SettingsView api={api} section={view.section} />
          ) : view.kind === "workspace" ? (
            <ProjectPanel
              key={view.id}
              api={api}
              id={view.id}
              tab={view.tab}
              onPending={setProjectPending}
            />
          ) : (
            <HomePage
              api={api}
              products={products}
              workspaces={workspaces}
              health={health}
              onOpen={(id) => setView({ kind: "workspace", id, tab: "overview" })}
              onCreated={openProject}
              onRefresh={refreshSidebar}
              onError={setError}
            />
          )}
        </Suspense>
      </ShellPageContainer>
    </ShellViewport>
  );
}
