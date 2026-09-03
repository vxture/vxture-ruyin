/**
 * Home - the work entry point of a CLIENT WORK RUNTIME (20-specs/10 §1.1/§5.2).
 *
 * 产品主体在平台：平台订阅了 → 本地可用；平台 0 订阅 → 本地无可用产品，但运行
 * 环境仍在，并据此引导用户到平台订阅（console 深链）。因此**「我的智能体」这一栏
 * 由订阅状态 + 本地已装运行时共同决定，绝不硬编码**——编造的产品会让用户以为
 * 自己拥有并不存在的订阅。
 *
 * 「热门智能体」是另一句话：「平台上有这些」，不声称所有权，动作只有外链。它的
 * 数据是平台目录的静态快照（catalog.ts，有出处有日期），接上目录端点后即删。
 *
 * 订阅数据面（C2 entitlements）尚无桌面可达端点（liaison L3-b）：未接通时诚实
 * 降级——展示本地运行时已装的产品，并标明订阅状态未接通，而不是虚构一份清单。
 *
 * **页面只到「进入产品」为止。** 新建/停用/版本回滚这些具体操作都不在这里——
 * 进了产品就是进了另一套框架，让产品自己设计它的构建流程（与 workbench.tsx
 * 的 chrome 三态同一条道理）。首页负责的是：环境可不可用、我有什么、能去哪。
 */

import { useEffect, useRef, useState } from "react";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Icon,
  ListCardGrid,
  Section,
  StatusBadge,
} from "@vxture/design-system";
import {
  Api,
  type InstalledPackage,
  type RegistryCatalog,
  type ProductInfo,
  type SessionInfo,
  type ProjectMeta,
} from "./api";
import { CATALOG_SOURCE, RECOMMENDED } from "./catalog";

/** x.y.z 比较（与 installer.ts 同一口径）；用于「有没有比生效版本更新的已装版本」。 */
function compareVersions(a: string, b: string): number {
  const pa = a.split(".");
  const pb = b.split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = Number.parseInt(pa[i] ?? "0", 10) || 0;
    const nb = Number.parseInt(pb[i] ?? "0", 10) || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

/**
 * 装一个 .ruyinpkg（§18.2）。
 *
 * 用 file input 而不是壳里的原生对话框：**同一个页面在浏览器和壳里都要能用**
 * （Local Web 访问模式从第一天起就成立）。壳里 file input 一样弹系统选择框，
 * 少一条只有壳能走的路。
 */
/**
 * 静态产品库（流 C，MVP 形态）。点开才去问 —— 首页每次加载都去拉 index 是把
 * 一个可有可无的目录变成首屏的依赖。三种回答各说各的：查不到（不是「没有产品」）、
 * 有但这台机器装不了（未签名，生产拒装）、有且能装。
 */
function RegistryList({
  api,
  open,
  onDone,
  onError,
}: {
  api: Api;
  /** 由标题行的「从产品库安装」开关；关着时什么都不渲染、也不去问。 */
  open: boolean;
  onDone: () => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [catalog, setCatalog] = useState<RegistryCatalog | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = async () => {
    setBusy("__catalog");
    try {
      setCatalog(await api.registry());
    } catch (e) {
      onError(String((e as Error).message));
    } finally {
      setBusy(null);
    }
  };
  const install = async (id: string, version: string) => {
    setBusy(`${id}@${version}`);
    try {
      await api.installFromRegistry(id, version);
      await onDone();
      await load();
    } catch (e) {
      onError(String((e as Error).message));
    } finally {
      setBusy(null);
    }
  };
  useEffect(() => {
    if (open && catalog === null) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!open) return null;
  return (
    <div className="install-row" style={{ flexDirection: "column", alignItems: "flex-start" }}>
      {busy === "__catalog" && catalog === null && (
        <span className="text-body-sm text-muted-foreground">正在读取产品库…</span>
      )}
      {open && catalog?.status === "unreachable" && (
        <span className="text-body-sm text-muted-foreground">
          产品库没查到 —— {catalog.reason}。这不代表产品库是空的，只代表这次没问到。
        </span>
      )}
      {open && catalog?.status === "ok" && catalog.items.length === 0 && (
        <span className="text-body-sm text-muted-foreground">产品库里目前没有产品包</span>
      )}
      {open && catalog?.status === "ok" && catalog.items.length > 0 && (
        <ul className="row-list" aria-label="产品库">
          {catalog.items.map((item) => (
            <li key={`${item.id}@${item.version}`} className="row-item">
              <span className="row-main">
                {item.name}{" "}
                <span className="mono text-muted-foreground">
                  {item.id} v{item.version}
                </span>
              </span>
              {/* 签没签名照实说：今天静态库里的包都未签名，生产拒装。 */}
              <span className="row-tag">{item.signed ? "已副署" : "未签名"}</span>
              {item.installed ? (
                <span className="text-body-sm text-muted-foreground">已安装</span>
              ) : catalog.installable ? (
                <Button
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void install(item.id, item.version)}
                >
                  {busy === `${item.id}@${item.version}` ? "正在安装……" : "安装"}
                </Button>
              ) : (
                <span className="text-body-sm text-muted-foreground" title="正式版拒绝安装未经 Vxture Registry 副署的包（TD-012 / TD-037）">
                  本机不装未签名包
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * 「安装 ▾」：两条安装通道收进一个次级下拉（owner 2026-09-04 定）。订阅了就能
 * 同步，装包只有产品随附本地资产 / 本地技能时才需要 —— 日常用户不该在标题行
 * 看见两个安装按钮，开发者又得找得到侧载入口。
 */
function InstallMenu({
  api,
  onDone,
  onError,
  registryOpen,
  onToggleRegistry,
}: {
  api: Api;
  onDone: () => void | Promise<void>;
  onError: (msg: string) => void;
  registryOpen: boolean;
  onToggleRegistry: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<InstalledPackage | null>(null);
  const pick = useRef<HTMLInputElement>(null);
  return (
    <span className="install-inline">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={busy}>
            {busy ? "正在安装……" : "安装"}
            <Icon name="caret-up-down" size="xs" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {/* 原生 file input 藏起来，由菜单项代打开。藏它不是为了好看：那个控件由
              浏览器渲染，按**浏览器的语言**显示「Choose File / No file chosen」——
              一句改不掉的英文夹在中文界面里。功能照旧走这个 input（同一个页面在
              浏览器和壳里都要能用，不走只有壳能走的原生对话框）。 */}
          <DropdownMenuItem onSelect={() => pick.current?.click()}>安装本地包…</DropdownMenuItem>
          <DropdownMenuItem onSelect={onToggleRegistry}>
            {registryOpen ? "收起产品库" : "从产品库安装"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
          ref={pick}
          type="file"
          accept=".ruyinpkg"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            // 选完就清掉输入框：同一个文件连选两次也要能触发。
            e.target.value = "";
            if (!file) return;
            setBusy(true);
            setDone(null);
            void api
              .installPackage(file)
              .then(async (r: InstalledPackage) => {
                setDone(r);
                await onDone();
              })
              .catch((err: Error) => onError(err.message))
              .finally(() => setBusy(false));
          }}
        />
      {/* 签没签名要照实说：未签名的包是另一回事，不该和签过的长一个样。 */}
      {done && (
        <span className="text-body-sm text-muted-foreground">
          已安装 {done.productId}@{done.version}
          {done.signed ? "（已副署）" : "（未签名）"}
        </span>
      )}
    </span>
  );
}

const BLURBS: Record<string, string> = {
  "vxture.bid": "招标解析 · 需求矩阵 · 方案生成 · 覆盖校验",
};

/**
 * Console 的应用中心 —— 「在线使用」的落点。
 *
 * 平台还没有 per-product 深链，所以只能落到应用中心这一层。**不拼一个猜出来的
 * 产品 URL** —— 猜错的深链比多点一步糟得多。
 */
const APPCENTER_URL = (consoleBase: string) => `${consoleBase}/zh-CN/appcenter`;

type StripTone = "ok" | "warn" | "danger" | "muted";

/**
 * 运行状态 —— **三张卡，并排占一行**。
 *
 * 不用 MetricCard：那是给要被读的读数准备的（图标、大字、装饰条形图），一张
 * 就一百多像素高。而这三条平时都对，属于「不出事就不必看」的一类，占位大小该
 * 按出问题时需要多醒目来定，不是按平时占多少地方来定。
 *
 * 所以是压扁的卡，不是合并成一根条：三件事本来就是三件事，挤进同一个框里读者
 * 得自己去数分隔点在哪。卡片边界替他分好。
 *
 * 状态点是唯一的颜色出口 —— 出问题时它变红，三张卡里那一个红点比放大的读数
 * 更快被扫到。
 */
function StatusCards({
  items,
}: {
  items: ReadonlyArray<{
    id: string;
    icon: React.ComponentProps<typeof Icon>["name"];
    label: string;
    value: string;
    /** 可见的一小截事实：版本号、工作区名。**不是解释**。 */
    detail: string;
    /** 解释放这里 —— 悬停才出现。要用一句话说清的东西不该常年占着版面。 */
    hint: string;
    tone: StripTone;
  }>;
}) {
  return (
    <ul className="status-cards" aria-label="运行时概况">
      {items.map((it) => (
        /* 图标占两行、左边一列；右边名称一行、结论一行，左对齐（owner 2026-09-03 定）。 */
        <li key={it.id} className={`status-card status-card--${it.tone}`} title={it.hint}>
          <span className="status-card-icon" aria-hidden>
            <Icon name={it.icon} size="md" />
          </span>
          <span className="status-card-text">
            <span className="status-label">{it.label}</span>
            <span className="status-card-body">
              <span className={`status-dot status-dot--${it.tone}`} aria-hidden />
              <span className="status-value">{it.value}</span>
              {it.detail && <span className="status-detail">{it.detail}</span>}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function HomePage({
  api,
  products,
  workspaces,
  health,
  onOpen,
  onCreated,
  onRefresh,
  onError,
  selectedProductId = null,
  onSelectProduct = () => {},
}: {
  api: Api;
  products: ProductInfo[];
  workspaces: ProjectMeta[];
  health: { ok: boolean; version?: string };
  onOpen: (projectId: string) => void;
  onCreated: (projectId: string) => void | Promise<void>;
  /** 重新拉一遍产品与项目。改了本机生效态之后要用它。 */
  onRefresh: () => void | Promise<void>;
  onError: (msg: string) => void;
  /** 卡片选中态与侧栏「最近工作」联动；null = 一个都不选，侧栏显示全部。 */
  selectedProductId?: string | null;
  onSelectProduct?: (id: string | null) => void;
}) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [registryOpen, setRegistryOpen] = useState(false);
  /**
   * 同步产品版本：对每个产品拉一次契约（一级供给，ADR-012）。拉到新版本的落进
   * 产品库，卡上随即出现「更新版本」；这里**不自动切换**生效版本 —— 切版本是
   * 用户看着卡片按一下的事，不是同步顺手做掉的事。
   */
  const syncVersions = async (ids: string[]) => {
    setSyncing(true);
    try {
      let fetched = 0;
      let firstError: string | null = null;
      for (const id of ids) {
        try {
          const r = await api.fetchProduct(id);
          if (r.status === "fetched") fetched += 1;
        } catch (e) {
          firstError ??= String((e as Error).message);
        }
      }
      if (firstError) onError(firstError);
      if (fetched > 0) await onRefresh();
    } finally {
      setSyncing(false);
    }
  };
  const [system, setSystem] = useState<{
    keyProtection: string;
    capabilitySurface?: string;
  } | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .session()
      .then((s) => alive && setSession(s))
      .catch(() => {});
    api
      .system()
      .then((s) => alive && setSystem(s))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [api]);

  const consoleBase = session?.consoleBase ?? "https://vxture.com";
  // 主体在平台：订阅动作一律回 console，**仅显式点击触发，永不自动跳转**。
  // intent 由 daemon 依 C2 信封判定 —— 从未订阅是首购，曾有已失效是续费。
  // 写死 intent=subscribe 会把续费的用户引去首购页（TD-014 D4）。
  // 深链不带工作区 id：console 从会话解析。
  const subscribeUrl = (
    productId?: string,
    intent: "subscribe" | "renew" = "subscribe",
  ) =>
    productId
      ? `${consoleBase}/subscribe?product=${encodeURIComponent(productId)}&intent=${intent}`
      : `${consoleBase}/subscribe`;

  const subscriptionKnown = products.some((p) => p.entitled !== null);
  const encrypted = system?.keyProtection === "dpapi";
  // 能力面没接时，任务拿到的是 MockAIGateway 的字面量占位输出，而它会一路走到
  // 用户面前当成工作成果（TD-033）。守护进程日志已如实播报，但日志到不了用户
  // 眼前 —— 所以产品卡要说。**只在 daemon 明确说 mock 时才标**：/system 还没回
  // 来是「不知道」，把「不知道」标成「没接上」是同一类错，方向相反。
  const capabilityMock = system?.capabilitySurface === "mock";
  const signedIn = session?.signedIn === true;

  return (
    <div className="home">
      {/* 「开始工作」那行标题去掉了：用户打开首页就是来工作的，一句标题重复
          他已经知道的事，只是把内容往下推了一屏。 */}

      {/* 运行状态是**提示性**信息，不是展示性的：它平时都对，只在出问题的
          那天需要被看见。三张压扁的卡并排占一行 —— 不用 MetricCard，那个自带
          图标、大字读数和装饰性条形图，三张并排要占掉首屏近四分之一。 */}
      <StatusCards
        items={[
          {
            id: "runtime",
            icon: "cpu",
            label: "运行环境",
            value: health.ok ? "已就绪" : "未连接",
            detail: health.ok ? `Runtime ${health.version ?? ""}`.trim() : "",
            hint: health.ok
              ? `本地守护进程 ${health.version ?? ""} 正在运行`
              : "守护进程未响应，正在等待它起来",
            tone: health.ok ? "ok" : "danger",
          },
          {
            id: "protection",
            icon: "shield-check",
            label: "数据加密",
            value: encrypted ? "已加密" : "开发态",
            detail: encrypted ? "DPAPI" : "明文",
            hint: encrypted
              ? "主密钥由 Windows DPAPI 保护，业务库整库加密"
              : "主密钥以明文存放，仅供开发，不可用于真实数据",
            tone: encrypted ? "ok" : "warn",
          },
          {
            // 第三件框架层面的事：产品与数据边界都由平台侧决定 —— 订阅决定
            // 本地有什么产品，工作区决定数据归谁。看不见这一条，用户就无从
            // 理解「为什么这里是空的」和「跨工作区为什么被拒」。
            id: "platform",
            icon: "buildings",
            label: "平台连接",
            value: signedIn ? "已连接" : "未登录",
            detail: signedIn ? (session?.workspace?.name ?? "") : "",
            hint: signedIn
              ? `已登录；当前工作区「${session?.workspace?.name ?? "未选定"}」决定了本地可用的产品与数据归属`
              : "登录 Vxture 账号后，你订阅的产品和工作区才会同步到本地",
            tone: signedIn ? "ok" : "muted",
          },
        ]}
      />

      <Section
        title="我的智能体"
        icon="package"
        level={2}
        description={
          subscriptionKnown
            ? undefined
            : "订阅状态尚未接通，以下为本地运行时已安装的产品。"
        }
        action={
          /* 三个动作排在标题行右侧，主按钮在最右（owner 2026-09-04 定）：
             同步产品版本 · 安装 ▾（本地包 / 产品库）· 在线使用。 */
          <span className="section-actions">
            {products.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                disabled={syncing}
                onClick={() => void syncVersions(products.map((p) => p.id))}
              >
                {syncing ? "正在同步……" : "同步产品版本"}
              </Button>
            )}
            <InstallMenu
              api={api}
              onDone={onRefresh}
              onError={onError}
              registryOpen={registryOpen}
              onToggleRegistry={() => setRegistryOpen((v) => !v)}
            />
            {products.length > 0 && (
              <Button
                size="sm"
                onClick={() =>
                  window.open(APPCENTER_URL(consoleBase), "_blank", "noopener")
                }
              >
                在线使用
                <Icon name="external-link" size="xs" />
              </Button>
            )}
          </span>
        }
      >
        {products.length === 0 ? (
          // 0 订阅：环境仍在，引导到平台订阅（主体在平台）。
          <EmptyState
            icon="package"
            title={
              signedIn
                ? "当前账号没有可用的智能体"
                : "登录后同步你的智能体"
            }
            description={
              signedIn
                ? "运行环境已就绪。智能体由 Vxture 平台订阅提供——在平台订阅后即可在这里使用。"
                : "运行环境已就绪。登录 Vxture 账号后，你订阅的智能体会出现在这里。"
            }
            action={
              <Button
                onClick={() => window.open(subscribeUrl(), "_blank", "noopener")}
              >
                到 Vxture 平台订阅
                <Icon name="external-link" size="xs" />
              </Button>
            }
          />
        ) : (
          <ListCardGrid>
            {products.map((p) => (
              <ProductCard
                key={p.id}
                api={api}
                product={p}
                projects={workspaces.filter((w) => w.productId === p.id)}
                subscribeUrl={subscribeUrl}
                consoleBase={consoleBase}
                capabilityMock={capabilityMock}
                selected={selectedProductId === p.id}
                onToggleSelect={() => onSelectProduct(selectedProductId === p.id ? null : p.id)}
                onOpen={onOpen}
                onCreated={onCreated}
                onRefresh={onRefresh}
                onError={onError}
              />
            ))}
          </ListCardGrid>
        )}
        <RegistryList api={api} open={registryOpen} onDone={onRefresh} onError={onError} />
      </Section>

      {/* 靠底：订阅少时推荐区贴着页面底部，订阅多时随内容顺延向下（.home 撑满
          视口、这一段 margin-top:auto）。 */}
      <div className="home-catalog">
      <Section
        title="热门智能体"
        icon="sparkles"
        level={2}
        description="平台上排在前面的三个智能体。这里只作了解，订阅在平台完成。"
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              window.open(CATALOG_SOURCE.url, "_blank", "noopener")
            }
          >
            浏览全部
            <Icon name="external-link" size="xs" />
          </Button>
        }
      >
        {/* 与「我的智能体」同一种卡（pcard）：图标同样大、文字同样对齐，扫过去
            是一个页面而不是两套控件。差别只在动作：这里永远没有「打开」。 */}
        <ListCardGrid>
          {RECOMMENDED.map((c) => (
            <article key={c.name} className="pcard pcard--catalog">
              <header className="pcard-head">
                <span className="pcard-icon" aria-hidden>
                  <Icon name="agent" size="lg" />
                </span>
                <span className="pcard-titles">
                  <h3 className="pcard-title">{c.name}</h3>
                  <p className="pcard-ident">
                    {c.category}
                    {c.version && <span className="pcard-ver"> v{c.version}</span>}
                  </p>
                </span>
                <span className="pcard-badges">
                  <StatusBadge tone={c.status === "released" ? "success" : "neutral"}>
                    {c.status === "released" ? "正式版" : "开发中"}
                  </StatusBadge>
                </span>
              </header>
              <div className="pcard-body">
                <p className="pcard-desc">{c.summary}</p>
                <div className="catalog-caps">
                  {c.capabilities.map((cap) => (
                    <Badge key={cap} variant="secondary">
                      {cap}
                    </Badge>
                  ))}
                </div>
              </div>
              <footer className="pcard-foot">
                <span className="pcard-count" />
                <span className="pcard-actions">
                  {/* 统一「了解详情」，**不写「订阅」**：这个链接落在目录页，
                      不是某个产品的订阅流程；写成「去平台订阅」是拿一个做不到
                      的动作骗点击。上没上线由状态徽章说，不必再让按钮说第二遍。 */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      window.open(CATALOG_SOURCE.url, "_blank", "noopener")
                    }
                  >
                    了解详情
                  </Button>
                </span>
              </footer>
            </article>
          ))}
        </ListCardGrid>
        {/* 出处要写明：这份清单不是实时的，用户有权知道自己在看一份快照。 */}
        <p className="text-body-sm text-muted-foreground">
          取自 Vxture 平台目录（{CATALOG_SOURCE.capturedAt} 快照）。
        </p>
      </Section>
      </div>
    </div>
  );
}

/**
 * 产品卡 —— **一种卡片，兼容项目型产品与持续型工作**。
 *
 * 读数行是它的骨架：项目型报「项目（本地/总）」，持续型报它自己的连续读数
 * （处理量、在办数一类）。两者共用同一张卡、同一对动作，用户不必先分辨
 * 「这是哪种产品」再去认界面。
 *
 * 动作只有两个，且**主次分明**：
 *   打开（主）—— 进本地运行时，这是这个应用存在的理由。
 *   在线（辅）—— 去平台上的同一个产品。桌面装不上、或者临时换台机器时的退路。
 *
 * 新建项目 / 停用 / 版本回滚都不在这里：进了产品就交给产品自己。
 */
function ProductCard({
  api,
  product,
  projects,
  subscribeUrl,
  consoleBase,
  capabilityMock,
  onOpen,
  onCreated,
  onRefresh,
  onError,
  selected,
  onToggleSelect,
}: {
  api: Api;
  product: ProductInfo;
  projects: ProjectMeta[];
  subscribeUrl: (id?: string, intent?: "subscribe" | "renew") => string;
  /** 「智能体介绍」落到平台应用中心（智能体广场）（还没有 per-product 深链，不拼猜出来的地址）。 */
  consoleBase: string;
  /** daemon 说能力面是 mock（TD-033）。运行环境层面的事实，每张卡都受影响。 */
  capabilityMock: boolean;
  onOpen: (projectId: string) => void;
  onCreated: (projectId: string) => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
  onError: (msg: string) => void;
  /** 选中态（与侧栏「最近工作」联动）：点卡片空白处切换，再点一次取消。 */
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const [opening, setOpening] = useState(false);
  const usable = product.availability === "available";

  /**
   * 库里有没有比生效版本更新的版本 —— 「同步产品版本」拉下来的，或装包装进来的。
   * 有才显示「更新版本」（owner 2026-09-03 定），按一下就把生效版本钉过去。
   */
  const newer = [...product.versions]
    .filter((v) => compareVersions(v, product.version) > 0)
    .sort(compareVersions)
    .pop();
  const updateTo = async (version: string) => {
    setOpening(true);
    try {
      await api.pinProductVersion(product.id, version);
      await onRefresh();
    } catch (e) {
      onError(String((e as Error).message));
    } finally {
      setOpening(false);
    }
  };

  // 本地/总：本地是这台机器上真有的，总数要等平台给出跨设备口径。**两者相等
  // 时只报一个数** —— 「3/3」在没有第二个来源时是噪音，不是信息。
  const local = projects.length;
  const total = local;

  /**
   * 打开产品。有项目就进最近那个；一个都没有就替他建第一个，名字用产品名。
   *
   * 首页不放「新建项目」表单是有意的：让人在还没进门时就先取个名字，是把
   * 产品的第一步搬到了框架里。进去之后产品自己会问该问的。
   */
  const open = async () => {
    setOpening(true);
    try {
      const latest = [...projects].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      )[0];
      if (latest) {
        onOpen(latest.id);
        return;
      }
      const meta = await api.createProject(product.id, product.name);
      await onCreated(meta.id);
    } catch (e) {
      onError(String((e as Error).message));
    } finally {
      setOpening(false);
    }
  };

  /**
   * 状态徽章。**可用性先于订阅** —— 一个订阅还在、但本机停用了的产品要说
   * 「已停用」；先判 entitled 会让它显示成「已订阅」，把那条真正决定他能不能
   * 用的状态盖掉，而他看着一个「已订阅」的卡片却没有打开按钮。
   */
  const badge =
    product.availability === "not_entitled" ? (
      <StatusBadge tone="warning">未订阅</StatusBadge>
    ) : product.availability === "disabled" ? (
      <StatusBadge tone="neutral">已停用</StatusBadge>
    ) : product.entitled === true ? (
      <StatusBadge tone="success">已订阅</StatusBadge>
    ) : (
      <StatusBadge tone="neutral">本地已装</StatusBadge>
    );

  return (
    <article
      className={`pcard${usable ? "" : " pcard--blocked"}${selected ? " pcard--selected" : ""}`}
      aria-pressed={selected}
      onClick={(e) => {
        // 按钮与链接各干各的；只有点在卡片空白处才算「选中这个智能体」。
        if ((e.target as HTMLElement).closest("button, a")) return;
        onToggleSelect();
      }}
    >
      {/* 一、身份。图标 + 标题一行，徽章是这一行唯一靠右的东西 —— 标题行右端
          是状态的固定位置，扫一列卡片时不必每张重新找。 */}
      {/* 图标占两行；右边名称一行、标识 + 版本一行（行距收紧）；徽章靠右
          （owner 2026-09-03 定）。 */}
      <header className="pcard-head">
        <span className="pcard-icon" aria-hidden>
          <Icon name="cube" size="lg" />
        </span>
        <span className="pcard-titles">
          <h3 className="pcard-title">{product.name}</h3>
          <p className="pcard-ident" title={`产品标识 ${product.id}，当前生效版本 ${product.version}`}>
            {product.id} <span className="pcard-ver">v{product.version}</span>
          </p>
        </span>
        <span className="pcard-badges">
          {badge}
          {/* 「未接通」与订阅徽章并列而不是替换：「已订阅」和「能力面没接」是两件
              都成立的事。只标在能打开的卡上 —— 打不开的卡不会跑任务，也就没有
              「拿到占位输出当成果」这回事。 */}
          {usable && capabilityMock && <StatusBadge tone="warning">未接通</StatusBadge>}
        </span>
      </header>

      <div className="pcard-body">
        <p className="pcard-desc">{BLURBS[product.id] ?? "Vxture 智能体"}</p>
        {/* 警示与说明要分得开：说明是灰字，警示走 DS 的 warning 语气（色 + 图标 +
            浅底），扫一眼就知道这是「要留意」而不是「介绍」。 */}
        {!usable && product.reason && (
          <p className="pcard-alert pcard-alert--warning" role="note">
            <Icon name="info" size="xs" />
            <span>{product.reason}</span>
          </p>
        )}
        {usable && capabilityMock && (
          <p className="pcard-alert pcard-alert--warning" role="note">
            <Icon name="info" size="xs" />
            <span>能力面未接通：现在发起任务只会得到占位输出，不是真实成果</span>
          </p>
        )}
      </div>

      {/* 三、横线下这一行：左边一句项目数，右边动作。
          「3 项目」就够了 —— 之前是读数和标签上下叠成两行、标签还写着
          「项目（本地/总）」，一个个位数配一行解释文字，说的比要说的事还多。 */}
      <footer className="pcard-foot">
        {/* 「11/22」不写成「本地项目/总计项目」—— 那行标签比它解释的数字还长。
            口径进 tooltip：要用一句话说清的东西，不该常年占着版面。 */}
        <span
          className="pcard-count"
          title={
            total > local
              ? `本地项目 ${local} / 总计 ${total}`
              : `本机上属于该产品的项目：${local}`
          }
        >
          <b>{total > local ? `${local}/${total}` : local}</b> 项目
        </span>
        <span className="pcard-actions">
          {usable ? (
            <>
              {/* 主按钮「打开」放最右且加宽；左侧一条「智能体介绍」文字链（落平台
                  应用中心）；库里有更新的版本时多一个「更新版本」。在线使用仍只在
                  板块标题行出现一次。 */}
              <a
                className="pcard-link"
                href={APPCENTER_URL(consoleBase)}
                target="_blank"
                rel="noopener noreferrer"
              >
                智能体介绍
              </a>
              {newer && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={opening}
                  onClick={() => void updateTo(newer)}
                >
                  更新版本 v{newer}
                </Button>
              )}
              <Button className="pcard-open" size="sm" disabled={opening} onClick={() => void open()}>
                {opening ? "打开中……" : "打开"}
              </Button>
            </>
          ) : (
            <>
              {/* §18.5：退订/停用的产品不可打开，但数据仍在、仍可导出。
                  本机停用的可以就地启用；未订阅的不行 —— 那不是这台机器能解决
                  的事，按钮给了也只会失败。 */}
              {product.commercialIntent && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    window.open(
                      subscribeUrl(product.id, product.commercialIntent!),
                      "_blank",
                      "noopener",
                    )
                  }
                >
                  {product.commercialIntent === "renew" ? "去平台续费" : "去平台订阅"}
                  <Icon name="external-link" size="xs" />
                </Button>
              )}
              {product.availability === "disabled" && (
                <Button
                  size="sm"
                  onClick={() =>
                    void api
                      .activateProduct(product.id)
                      .then(() => onRefresh())
                      .catch((e: Error) => onError(e.message))
                  }
                >
                  启用
                </Button>
              )}
            </>
          )}
        </span>
      </footer>
    </article>
  );
}
