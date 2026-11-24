/**
 * Home - the work entry point of a CLIENT WORK RUNTIME (20-specs/10 §1.1/§5.2).
 *
 * 产品主体在平台：平台订阅了 → 本地可用；平台 0 订阅 → 本地无可用产品，但运行
 * 环境仍在，并据此引导用户到平台订阅（console 深链）。因此**「我的智能体」这一栏
 * 由订阅状态 + 本地已装运行时共同决定，绝不硬编码**——编造的产品会让用户以为
 * 自己拥有并不存在的订阅。
 *
 * 「热门智能体」是另一句话：「平台上有这些」，不声称所有权，动作只有外链。它的
 * 数据来自平台实时目录，与订阅清单共用产品展示和 Logo 读取逻辑。
 *
 * 「我的智能体」以平台订阅为准（owner 2026-09-15）：登录后向守护进程要本工作区的
 * 订阅清单（console `/api/subscription/subscribed-products`），本机已装的出本地卡片，
 * 订了没装的出「本机未安装」卡。问不到（没登录、失败）时诚实降级——展示本地运行时
 * 已装的产品，并标明订阅状态未接通，而不是虚构一份清单。
 *
 * **页面只到「进入产品」为止。** 新建/停用/版本回滚这些具体操作都不在这里——
 * 进了产品就是进了另一套框架，让产品自己设计它的构建流程（与 workbench.tsx
 * 的 chrome 三态同一条道理）。首页负责的是：环境可不可用、我有什么、能去哪。
 */

import { useEffect, useRef, useState } from "react";
import {
  Button,
  EmptyState,
  Icon,
  ListCardGrid,
  Section,
  StatusBadge,
} from "@vxture/design-system";
import {
  Api,
  type RegistryCatalog,
  type RegistryItem,
  type ProductInfo,
  type SessionInfo,
  type ProjectMeta,
  type SubscribedProduct,
  type PublicProduct,
  type SystemInfo,
} from "./api";
import { consoleBaseOf } from "./platform-base";
import { RUYIN_WEB_URL, agentSubscriptions, compareVersions, packageFor, productHomeUrl, recommendedAgents, tierAbbreviation } from "./agent-catalog";
import { useT, type MessageKey, type TFn } from "./i18n";
import {InstallMenu,RegistryList} from "./agent-install-controls";

/** 库里比生效版本更新的那一版（没有就是 undefined）。卡片与标题行读同一份判断。 */
export function newerVersionOf(product: {
  version: string;
  versions: string[];
}): string | undefined {
  return [...product.versions]
    .filter((v) => compareVersions(v, product.version) > 0)
    .sort(compareVersions)
    .pop();
}


/** Localized descriptions for known agents; distribution remains package based. */
const BLURB_KEYS: Record<string, MessageKey> = {
  bidproposal: "home.blurb.bidproposal",
};

/** 认得的产品给它那句简介；不认得的给一句通用的，绝不留空。 */
function blurbOf(t: TFn, productCode: string): string {
  const key = BLURB_KEYS[productCode];
  return key ? t(key) : t("home.card.blurbFallback");
}

function ProductLogo({api,code,version,url}:{api:Api;code:string;version?:string|null;url?:string|null}){
  const src=productHomeUrl(url);
  const [hosted,setHosted]=useState<string>();
  useEffect(()=>{
    if(!version)return;let alive=true,objectUrl:string|undefined;
    void api.productIcon(code,version).then(blob=>{
      if(!alive||!blob)return;objectUrl=URL.createObjectURL(blob);setHosted(objectUrl);
    }).catch(()=>{});
    return()=>{alive=false;if(objectUrl)URL.revokeObjectURL(objectUrl);setHosted(undefined);};
  },[api,code,version]);
  return <ProductLogoImage key={hosted??src??"default"} src={hosted??src}/>;
}
function ProductLogoImage({src}:{src?:string}){
  const [failed,setFailed]=useState(false);
  return src&&!failed?<img className="pcard-product-logo" src={src} alt="" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>:<Icon name="cube" size="lg"/>;
}

function ReleaseBadge({stage}:{stage?:string|null}){
  const t=useT();const labels:Record<string,MessageKey>={preview:"home.release.preview",beta:"home.release.beta",stable:"home.release.stable",sunset:"home.release.sunset"};
  const label=stage?labels[stage]:undefined;
  return label?<StatusBadge tone={stage==="stable"?"success":stage==="sunset"?"warning":"neutral"}>{t(label)}</StatusBadge>:null;
}
const knownRelease=(stage?:string|null)=>!!stage&&["preview","beta","stable","sunset"].includes(stage);

/** Package installation is secondary metadata, never a subscription warning. */
function InstallationState({installed}:{installed:boolean}){
  const t=useT();
  return <span className="pcard-install-state"><Icon name="desktop" size="xs" aria-hidden/>{t(installed?"home.badge.localOnly":"home.badge.notInstalled")}</span>;
}

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
  const t = useT();
  return (
    <ul className="status-cards" aria-label={t("home.cards.aria")}>
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
  products: suppliedProducts,
  workspaces,
  projectsReady = true,
  health,
  onOpen,
  onCreated,
  onEnterProduct,
  onRefresh,
  onError,
  selectedProductId = null,
  onSelectProduct = () => {},
}: {
  api: Api;
  products: ProductInfo[];
  workspaces: ProjectMeta[];
  projectsReady?: boolean;
  health: { ok: boolean; version?: string };
  onOpen: (projectId: string) => void;
  onEnterProduct?: (productId: string) => void;
  onCreated: (projectId: string) => void | Promise<void>;
  /** 重新拉一遍产品与项目。改了本机生效态之后要用它。 */
  onRefresh: () => void | Promise<void>;
  onError: (msg: string) => void;
  /** 卡片选中态与侧栏「最近工作」联动；null = 一个都不选，侧栏显示全部。 */
  selectedProductId?: string | null;
  onSelectProduct?: (id: string | null) => void;
}) {
  const t = useT();
  const products = suppliedProducts.filter(product => product.supply !== "builtin");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [recommendations,setRecommendations]=useState<PublicProduct[]|null>(null);
  const [catalogFailed,setCatalogFailed]=useState(false);
  const [syncing, setSyncing] = useState(false);
  const [registryOpen, setRegistryOpen] = useState(false);
  const [packageCatalog, setPackageCatalog] = useState<RegistryCatalog | null>(null);
  /**
   * 检查已发布的安装包和平台元数据；不自动下载安装或切换生效版本。
   *
   * `silent` 给启动时那一次用：**没人按过的检查，失败了不该弹错误条**。用户点
   * 「更新」是他问了一句，答不上来要如实说；启动自检答不上来只是没答上来。
   */
  const checkUpdates = async (silent = false) => {
    // 静默那次连忙碌态都不显示：启动自检把按钮翻成「正在检查……」，是让每次
    // 开应用都闪一下，而那一下不对应任何人的动作。
    if (!silent) setSyncing(true);
    try {
      const catalog = await api.registry();
      setPackageCatalog(catalog);
      if (catalog.status === "unreachable" && !silent) onError(t("home.install.catalogUnreachable"));
      if (!silent) { await reloadSubscriptions(); await onRefresh(); }
    } catch {
      if (!silent) onError(t("home.install.catalogUnreachable"));
    } finally {
      if (!silent) setSyncing(false);
    }
  };
  /** 有没有产品攒着一版没切过去 —— 「更新」按钮的 new 标记就看它。 */
  const hasUpdates = products.some((p) => newerVersionOf(p) !== undefined ||
    compareVersions(packageFor(packageCatalog,p.id)?.version ?? p.version,p.version)>0);
  const [system, setSystem] = useState<SystemInfo | null>(null);

  /**
   * 启动检查一次（owner 2026-09-04 定）。ref 守着：产品列表每刷新一次都重跑，
   * 就变成了每次刷新都打一轮网络 —— 那不是「启动时检查一次」。
   */
  const checkedOnce = useRef(false);
  useEffect(() => {
    if (checkedOnce.current || products.length === 0) return;
    checkedOnce.current = true;
    void checkUpdates(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products.length]);

  /**
   * 平台上本工作区的订阅清单。null = 不知道（没登录、没问到、问失败了）——
   * 与「问到了、是空的」是两件事，前者不能渲染成「你没有订阅」。
   */
  const [subscribed, setSubscribed] = useState<SubscribedProduct[] | null>(null);
  const metadataRequest = useRef(0);
  const metadataScope = useRef<string | undefined>(undefined);
  const [metadataPending, setMetadataPending] = useState(true);
  const reloadSubscriptions = async () => {
    const request = ++metadataRequest.current;
    setMetadataPending(true);
    try {
      const s = await api.session();
      if (request !== metadataRequest.current) return;
      const scope = JSON.stringify([s?.profile?.sub,s?.org?.id,s?.workspace?.id,s?.signedIn]);
      if (scope !== metadataScope.current) { setSubscribed(null);setRecommendations(null);setCatalogFailed(false);metadataScope.current = scope; }
      setSession(s);
      void (s?.signedIn?api.recommendedProducts():api.productCatalog()).then(rows=>{
        if(request===metadataRequest.current){setRecommendations(rows);setCatalogFailed(false);}
      }).catch(()=>{if(request===metadataRequest.current)setCatalogFailed(true);});
      if (!s?.signedIn) return;
      const rows = await api.subscribedProducts();
      if (request !== metadataRequest.current) return;
      if (Array.isArray(rows)) setSubscribed(rows);
      if (!checkedOnce.current) { checkedOnce.current = true; void checkUpdates(true); }
    } catch { /* A transient refresh keeps this account's existing view. */ }
    finally { if (request === metadataRequest.current) setMetadataPending(false); }
  };

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void reloadSubscriptions();
    const onFocus = () => void reloadSubscriptions();
    window.addEventListener("focus", onFocus);
    const refreshSystem = async () => {
      try {
        const s = await api.system();
        if (!alive) return;
        setSystem(s);
        if (s?.startupState === "initializing") timer = setTimeout(() => void refreshSystem(), 1000);
      } catch { /* A failed read is not proof that the runtime is ready. */ }
    };
    void refreshSystem();
    return () => {
      alive = false;
      clearTimeout(timer);
      metadataRequest.current++;
      window.removeEventListener("focus", onFocus);
    };
  }, [api]);

  // The desktop starts at product pricing; the platform owns plan/cycle selection and checkout.
  const websiteBase = consoleBaseOf(session);
  const subscribeUrl = (
    productId?: string,
    _intent: "subscribe" | "renew" = "subscribe",
  ) =>
    productId
      ? `${websiteBase}/pricing?product=${encodeURIComponent(productId)}`
      : `${websiteBase}/pricing`;

  // 平台订阅清单问到了，或者任何一个本地产品有了订阅事实，都算「订阅状态已知」。
  const subscriptionKnown =
    subscribed !== null || products.some((p) => p.entitled !== null);
  /**
   * 平台上订了、本机还没有的智能体。首页以平台订阅为准（owner 2026-09-15）：
   * 它们不能因为本机没装就从「我的智能体」里消失 —— 那等于告诉用户他没订。
   * 本机已装的由本地卡片承载，这里不重复。
   */
  const localIds = new Set(products.map((p) => p.id));
  const subscriptions = agentSubscriptions(subscribed ?? []);
  const remoteOnly = subscriptions.filter(r => !localIds.has(r.productCode));
  const suggested = recommendations === null ? null : recommendedAgents(recommendations,[...localIds,...subscriptions.map(row=>row.productCode)]);
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
            label: t("home.card.runtime"),
            value: t(!health.ok ? "home.card.runtime.off" : system?.startupState === "initializing" ? "home.card.runtime.initializing" : system?.startupState === "failed" ? "home.card.runtime.failed" : "home.card.runtime.ok"),
            // 版本号前加 Runtime（owner 2026-09-18）：孤零零一个 0.2.0-beta.1 不说明它是
            // **谁**的版本 —— 这台机器上还有产品、技能、工具各自的版本。
            detail: health.ok && health.version ? `Runtime ${health.version}` : "",
            hint: health.ok
              ? t(system?.startupState === "initializing" ? "home.card.runtime.hintInitializing" : system?.startupState === "failed" ? "home.card.runtime.hintFailed" : "home.card.runtime.hintOk")
              : t("home.card.runtime.hintOff"),
            tone: !health.ok || system?.startupState === "failed" ? "danger" : system?.startupState === "initializing" ? "warn" : "ok",
          },
          {
            id: "protection",
            icon: "shield-check",
            label: t("home.card.encryption"),
            value: t(encrypted ? "home.card.encryption.on" : "home.card.encryption.dev"),
            // 首页这张卡是**一眼扫过去的状态**，不是加密说明书。完整的三层
            // 逐条写在「设置 › 数据加密」，那里才是要看细节的人去的地方 ——
            // 同一套事实抄两份，迟早两份各自漂（owner 2026-09-17）。
            detail: "",
            hint: encrypted
              ? t("home.card.encryption.hintOn")
              : t("home.card.encryption.hintDev"),
            tone: encrypted ? "ok" : "warn",
          },
          {
            // 第三件框架层面的事：产品与数据边界都由平台侧决定 —— 订阅决定
            // 本地有什么产品，工作区决定数据归谁。看不见这一条，用户就无从
            // 理解「为什么这里是空的」和「跨工作区为什么被拒」。
            id: "platform",
            icon: "buildings",
            label: t("home.card.platform"),
            value: t(signedIn ? "home.card.platform.on" : "home.card.platform.off"),
            detail: signedIn ? (session?.workspace?.name ?? "") : "",
            hint: signedIn
              ? t("home.card.platform.hintOn", {
                  workspace: session?.workspace?.name ?? t("home.workspace.unset"),
                })
              : t("home.card.platform.hintOff"),
            tone: signedIn ? "ok" : "muted",
          },
        ]}
      />

      <Section
        title={t("home.mine.title")}
        icon="squares-four"
        level={2}
        description={
          subscriptionKnown
            ? undefined
            : t("home.mine.subscriptionUnknown")
        }
        action={
          /* 三个动作排在标题行右侧，主按钮在最右（owner 2026-09-04 定）：
             更新{new} · 安装 ▾（本地包 / 产品库）· 在线使用。 */
          <span className="section-actions">
            {products.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                disabled={syncing}
                onClick={() => void checkUpdates()}
              >
                {t(syncing ? "home.mine.checking" : "home.mine.update")}
                {/* 有可切的新版本才挂 new：一个常年亮着的标记等于没有标记。
                    这一条与能力面无关 —— 它看的是本机已装的版本，本地装了新版
                    照样该亮。 */}
                {!syncing && hasUpdates && <span className="dot-new">new</span>}
              </Button>
            )}
            <InstallMenu
              api={api}
              onDone={onRefresh}
              onError={onError}
              registryOpen={registryOpen}
              onToggleRegistry={() => setRegistryOpen((v) => !v)}
              onManage={()=>{window.location.hash="agents";}}
            />
              <Button
                size="sm"
                onClick={() =>
                  window.open(RUYIN_WEB_URL, "_blank", "noopener")
                }
              >
                {t("home.card.useOnline")}
                <Icon name="external-link" size="xs" />
              </Button>
          </span>
        }
      >
        {products.length === 0 && remoteOnly.length === 0 ? (
          metadataPending ? <p className="text-body-sm text-muted-foreground" role="status">{t("home.mine.loading")}</p> :
          signedIn && subscribed === null ? <EmptyState icon="package" title={t("home.mine.unavailable")}
            action={<Button variant="outline" onClick={() => void reloadSubscriptions()}>{t("ph.retry")}</Button>} /> :
          // 0 订阅：环境仍在，引导到平台订阅（主体在平台）。
          <EmptyState
            icon="package"
            title={
              signedIn
                ? t("home.empty.signedIn")
                : t("home.empty.signedOut")
            }
            description={
              signedIn
                ? t("home.empty.descSignedIn")
                : t("home.empty.descSignedOut")
            }
            action={
              <Button
                onClick={() => window.open(`${websiteBase}/appcenter`, "_blank", "noopener")}
              >
                {t("home.empty.subscribe")}
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
                onlineUrl={productHomeUrl(subscriptions.find(row => row.productCode === p.id)?.homeUrl)}
                packageUpdate={packageFor(packageCatalog,p.id)}
                unsignedAllowed={packageCatalog?.status === "ok" && packageCatalog.installable}
                projects={workspaces.filter((w) => w.productId === p.id)}
                subscribeUrl={subscribeUrl}
                capabilityMock={capabilityMock}
                selected={selectedProductId === p.id}
                onToggleSelect={() => onSelectProduct(selectedProductId === p.id ? null : p.id)}
                platformMetadata={subscriptions.find(row=>row.productCode===p.id)}
                onEnterProduct={onEnterProduct}
                projectsReady={projectsReady}
                onOpen={onOpen}
                onCreated={onCreated}
                onRefresh={onRefresh}
                onError={onError}
              />
            ))}
            {remoteOnly.map((row) => (
              <SubscribedElsewhereCard
                key={row.subscriptionId}
                row={row}
                packageEntry={packageFor(packageCatalog,row.productCode)}
                unsignedAllowed={packageCatalog?.status === "ok" && packageCatalog.installable}
                api={api}
                onRefresh={onRefresh}
                onError={onError}
                subscribeUrl={subscribeUrl}
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
        title={t("home.catalog.title")}
        icon="sparkles"
        level={2}
        description={t("home.catalog.desc")}
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              window.open(`${websiteBase}/appcenter`, "_blank", "noopener")
            }
          >
            {t("home.catalog.browseAll")}
            <Icon name="external-link" size="xs" />
          </Button>
        }
      >
        {/* 与「我的智能体」同一种卡（pcard）：图标同样大、文字同样对齐，扫过去
            是一个页面而不是两套控件。差别只在动作：这里永远没有「打开」。 */}
        <ListCardGrid>
          {suggested?.map((c) => (
            <article key={c.productCode} className="pcard pcard--catalog">
              <header className="pcard-head">
                <span className="pcard-icon" aria-hidden>
                  <ProductLogo api={api} code={c.productCode} version={c.iconVersion??"current"} url={c.iconUrl}/>
                </span>
                <span className="pcard-titles">
                  <h3 className="pcard-title">{c.productName}</h3>
                  <p className="pcard-ident">{c.productNick||c.productCode}</p>
                </span>
                <span className="pcard-badges">
                  <ReleaseBadge stage={c.releaseStage}/>
                </span>
              </header>
              <div className="pcard-body">
                <p className="pcard-desc">{c.description}</p>
              </div>
              <footer className="pcard-foot">
                <span className="pcard-meta">
                  {c.releaseVersion && <span className="pcard-version">v{c.releaseVersion}</span>}
                </span>
                <span className="pcard-actions">
                  {/* 统一「了解详情」，**不写「订阅」**：这个链接落在目录页，
                      不是某个产品的订阅流程；写成「去平台订阅」是拿一个做不到
                      的动作骗点击。上没上线由状态徽章说，不必再让按钮说第二遍。 */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      window.open(`${websiteBase}/appcenter`, "_blank", "noopener")
                    }
                  >
                    {t("home.catalog.learnMore")}
                  </Button>
                </span>
              </footer>
            </article>
          ))}
        </ListCardGrid>
        {recommendations===null&&<p className="text-body-sm text-muted-foreground" role="status">{t(catalogFailed?"home.catalog.unavailable":"home.catalog.loading")}</p>}
        {suggested?.length===0&&<p className="text-body-sm text-muted-foreground">{t("home.catalog.empty")}</p>}
      </Section>
      </div>
    </div>
  );
}

/**
 * Platform subscriptions without a local installation. Local supply comes from
 * the package registry; online addresses come from platform metadata.
 */
function SubscribedElsewhereCard({
  row,
  subscribeUrl,
  api, packageEntry, unsignedAllowed, onRefresh, onError,
}: {
  row: SubscribedProduct & { productCode: string };
  subscribeUrl: (id?: string, intent?: "subscribe" | "renew") => string;
  api: Api;
  packageEntry?: RegistryItem;
  unsignedAllowed: boolean;
  onRefresh: () => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const t = useT();
  const [installing, setInstalling] = useState(false);
  const onlineUrl = productHomeUrl(row.homeUrl);
  const install = async () => {
    setInstalling(true);
    try { await api.installFromRegistry(row.productCode, packageEntry!.version); await onRefresh(); }
    catch (error) { onError((error as Error).message); }
    finally { setInstalling(false); }
  };
  const expired = row.status === "expired";
  const title = row.productName ?? row.productNick ?? row.productCode;
  const version = packageEntry?.version ?? row.releaseVersion;
  return (
    <article className="pcard">
      <header className="pcard-head">
        <span className="pcard-icon" aria-hidden>
          <ProductLogo api={api} code={row.productCode} version={row.iconVersion} url={row.iconUrl}/>
        </span>
        <span className="pcard-titles">
          <h3 className="pcard-title">{title}</h3>
          <p className="pcard-ident" title={t("home.card.identTitle", { id: row.productCode })}>
          {row.productNick&&row.productNick!==title?row.productNick:row.productCode}
        </p>
        </span>
        <span className="pcard-badges">
          {row.tier && <StatusBadge tone="neutral" title={row.tier}>{tierAbbreviation(row.tier)}</StatusBadge>}
          {expired ? (
            <StatusBadge tone="warning">{t("home.badge.expired")}</StatusBadge>
          ) : knownRelease(row.releaseStage)?<ReleaseBadge stage={row.releaseStage}/>: (
            <StatusBadge tone="success">{t("home.badge.subscribed")}</StatusBadge>
          )}
        </span>
      </header>
      <div className="pcard-body">
        <p className="pcard-desc">{row.description?.trim()||blurbOf(t, row.productCode)}</p>
      </div>
      <footer className="pcard-foot">
        <span className="pcard-meta">
          {packageEntry && <InstallationState installed={false}/>}
          {version && (
            <span className="pcard-version" title={t(packageEntry ? "home.card.packageVersion" : "home.card.platformVersion", { version })}>
              v{version}
            </span>
          )}
        </span>
        <span className="pcard-actions">
          {expired ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(subscribeUrl(row.productCode, "renew"), "_blank", "noopener")}
            >
              {t("home.card.renew")}
            </Button>
          ) : <>
            {packageEntry && <Button size="sm" variant={onlineUrl ? "outline" : "default"} disabled={installing || !unsignedAllowed && !packageEntry.signed}
              title={!unsignedAllowed && !packageEntry.signed ? t("home.install.unsignedBlockedTitle") : undefined}
              onClick={() => void install()}>{t(installing ? "home.install.installing" : "home.install.install")}</Button>}
            {onlineUrl && <Button
              size="sm"
              onClick={() => window.open(onlineUrl, "_blank", "noopener")}
            >
              {t("home.card.useOnline")}
              <Icon name="external-link" size="xs" />
            </Button>}
            {!packageEntry && !onlineUrl && <span className="pcard-entry-note" title={t("home.card.entryUnavailableHint")}>{t("home.card.entryUnavailable")}</span>}
          </>}
        </span>
      </footer>
    </article>
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
 *   在线（辅）—— 有平台在线地址时保留，与本地运行并行可用。
 *
 * 新建项目 / 停用 / 版本回滚都不在这里：进了产品就交给产品自己。
 */
function ProductCard({
  api,
  product,
  projects,
  projectsReady,
  subscribeUrl,
  onlineUrl, packageUpdate, unsignedAllowed,
  capabilityMock,
  onOpen,
  onCreated,
  onEnterProduct,
  onRefresh,
  onError,
  selected,
  onToggleSelect,
  platformMetadata,
}: {
  api: Api;
  product: ProductInfo;
  projects: ProjectMeta[];
  projectsReady: boolean;
  subscribeUrl: (id?: string, intent?: "subscribe" | "renew") => string;
  onlineUrl?: string;
  packageUpdate?: RegistryItem;
  unsignedAllowed: boolean;
  /** daemon 说能力面是 mock（TD-033）。运行环境层面的事实，每张卡都受影响。 */
  capabilityMock: boolean;
  onOpen: (projectId: string) => void;
  onEnterProduct?: (productId: string) => void;
  onCreated: (projectId: string) => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
  onError: (msg: string) => void;
  /** 选中态（与侧栏「最近工作」联动）：点卡片空白处切换，再点一次取消。 */
  selected: boolean;
  onToggleSelect: () => void;
  platformMetadata?: SubscribedProduct;
}) {
  const t = useT();
  const [opening, setOpening] = useState(false);
  const usable = product.availability === "available";

  /**
   * 库里有没有比生效版本更新的版本 —— 「更新」拉下来的，或装包装进来的。
   * 有才显示「更新版本」（owner 2026-09-03 定），按一下就把生效版本钉过去。
   */
  const newer = newerVersionOf({ version: product.version, versions: [...product.versions, ...(packageUpdate ? [packageUpdate.version] : [])] });
  const requiresDownload = !!newer && !product.versions.includes(newer);
  const updateBlocked = requiresDownload && !unsignedAllowed && !packageUpdate?.signed;
  const updateTo = async (version: string) => {
    setOpening(true);
    try {
      if (!product.versions.includes(version)) await api.installFromRegistry(product.id, version);
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
    if (onEnterProduct) { onEnterProduct(product.id); return; }
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
      <StatusBadge tone="warning">{t("home.badge.notEntitled")}</StatusBadge>
    ) : product.availability === "disabled" ? (
      <StatusBadge tone="neutral">{t("home.badge.disabled")}</StatusBadge>
    ) : product.entitled === true ? (
      <StatusBadge tone="success">{t("home.badge.subscribed")}</StatusBadge>
    ) : null;

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
          <ProductLogo api={api} code={product.id} version={platformMetadata?.iconVersion} url={platformMetadata?.iconUrl}/>
        </span>
        <span className="pcard-titles">
          <h3 className="pcard-title">{product.name}</h3>
          <p className="pcard-ident" title={t("home.card.identTitle", { id: product.id })}>
          {platformMetadata?.productNick||product.id}
        </p>
        </span>
        <span className="pcard-badges">
          {product.subscription?.tier&&<StatusBadge tone="neutral" title={product.subscription.tier}>{tierAbbreviation(product.subscription.tier)}</StatusBadge>}
          {product.availability==="available"&&knownRelease(platformMetadata?.releaseStage)?<ReleaseBadge stage={platformMetadata?.releaseStage}/>:badge}
          {/* 「未接通」与订阅徽章并列而不是替换：「已订阅」和「能力面没接」是两件
              都成立的事。只标在能打开的卡上 —— 打不开的卡不会跑任务，也就没有
              「拿到占位输出当成果」这回事。 */}
          {usable && capabilityMock && (
            <StatusBadge tone="warning">{t("home.badge.notWired")}</StatusBadge>
          )}
        </span>
      </header>

      <div className="pcard-body">
        <p className="pcard-desc">{platformMetadata?.description?.trim()||blurbOf(t, product.id)}</p>
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
            <span>{t("home.alert.notWired")}</span>
          </p>
        )}
      </div>

      {/* 三、横线下这一行：左边一句项目数，右边动作。
          「3 项目」就够了 —— 之前是读数和标签上下叠成两行、标签还写着
          「项目（本地/总）」，一个个位数配一行解释文字，说的比要说的事还多。 */}
      <footer className="pcard-foot">
        {/* 「11/22」不写成「本地项目/总计项目」—— 那行标签比它解释的数字还长。
            口径进 tooltip：要用一句话说清的东西，不该常年占着版面。 */}
        {/* 左下角顶头对齐图标：版本（淡，hover 亮）→ 关键数字 → 单位（小、淡）。 */}
        <span className="pcard-meta">
          <InstallationState installed/>
          <span className="pcard-version" title={t("home.card.activeVersion", { version: product.version })}>
            v{product.version}
          </span>
          <span
            className="pcard-count"
            title={
              !projectsReady ? t("ph.listUnavailable") : total > local
                ? t("home.card.projectsTitleBoth", { local, total })
                : t("home.card.projectsTitleLocal", { local })
            }
          >
            {projectsReady ? <><b>{total > local ? `${local}/${total}` : local}</b> <span className="pcard-unit">{t("home.card.projects")}</span></> : <span>{t("ph.listUnavailable")}</span>}
          </span>
        </span>
        <span className="pcard-actions">
          {usable ? (
            <>
              {onlineUrl && <Button variant="outline" size="sm"
                onClick={() => window.open(onlineUrl, "_blank", "noopener")}>
                {t("home.card.useOnline")}<Icon name="external-link" size="xs" />
              </Button>}
              {newer && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={opening || updateBlocked}
                  title={updateBlocked ? t("home.install.unsignedBlockedTitle") : undefined}
                  onClick={() => void updateTo(newer)}
                >
                  {t("home.card.upgradeTo", { version: newer })}
                </Button>
              )}
              <Button className="pcard-open" size="sm" disabled={opening} onClick={() => void open()}>
                {t(opening ? "home.card.opening" : "home.card.open")}
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
                  {t(product.commercialIntent === "renew" ? "home.card.goRenew" : "home.card.goSubscribe")}
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
                  {t("home.card.enable")}
                </Button>
              )}
            </>
          )}
        </span>
      </footer>
    </article>
  );
}
