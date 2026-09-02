/**
 * Home - the work entry point of a CLIENT WORK RUNTIME (20-specs/10 §1.1/§5.2).
 *
 * 产品主体在平台：平台订阅了 → 本地可用；平台 0 订阅 → 本地无可用产品，但运行
 * 环境仍在，并据此引导用户到平台订阅（console 深链）。因此**「我的产品」这一栏
 * 由订阅状态 + 本地已装运行时共同决定，绝不硬编码**——编造的产品会让用户以为
 * 自己拥有并不存在的订阅。
 *
 * 「热门推荐」是另一句话：「平台上有这些」，不声称所有权，动作只有外链。它的
 * 数据是平台目录的静态快照（catalog.ts，有出处有日期），接上目录端点后即删。
 *
 * 订阅数据面（C2 entitlements）尚无桌面可达端点（liaison L3-b）：未接通时诚实
 * 降级——展示本地运行时已装的产品，并标明订阅状态未接通，而不是虚构一份清单。
 *
 * **页面只到「进入产品」为止。** 新建/停用/版本回滚这些具体操作都不在这里——
 * 进了产品就是进了另一套框架，让产品自己设计它的构建流程（与 workbench.tsx
 * 的 chrome 三态同一条道理）。首页负责的是：环境可不可用、我有什么、能去哪。
 */

import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  EmptyState,
  ListCard,
  ListCardGrid,
  MetricGrid,
  MetricListCard,
  Section,
  SectionHeader,
  StatusBadge,
} from "@vxture/design-system";
import {
  Api,
  type InstalledPackage,
  type ProductInfo,
  type SessionInfo,
  type ProjectMeta,
} from "./api";
import { CATALOG, CATALOG_SOURCE } from "./catalog";

/**
 * 装一个 .ruyinpkg（§18.2）。
 *
 * 用 file input 而不是壳里的原生对话框：**同一个页面在浏览器和壳里都要能用**
 * （Local Web 访问模式从第一天起就成立）。壳里 file input 一样弹系统选择框，
 * 少一条只有壳能走的路。
 */
function InstallPackageRow({
  api,
  onDone,
  onError,
}: {
  api: Api;
  onDone: () => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<InstalledPackage | null>(null);
  return (
    <div className="install-row">
      <label className="install-row-label">
        <span className="text-body-sm text-muted-foreground">安装本地产品包</span>
        <input
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
              .then(async (r) => {
                setDone(r);
                await onDone();
              })
              .catch((err: Error) => onError(err.message))
              .finally(() => setBusy(false));
          }}
        />
      </label>
      {busy && (
        <span className="text-body-sm text-muted-foreground">正在安装……</span>
      )}
      {done && (
        <span className="text-body-sm text-muted-foreground">
          已安装 {done.productId}@{done.version}
          {/* 签没签名要照实说：未签名的包是另一回事，不该和签过的长一个样。 */}
          {done.signed ? "（已副署）" : "（未签名）"}
        </span>
      )}
    </div>
  );
}

const BLURBS: Record<string, string> = {
  "vxture.bid": "招标解析 · 需求矩阵 · 方案生成 · 覆盖校验",
};

export function HomePage({
  api,
  products,
  workspaces,
  health,
  onOpen,
  onCreated,
  onRefresh,
  onError,
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
}) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [system, setSystem] = useState<{ keyProtection: string } | null>(null);

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
  const signedIn = session?.signedIn === true;

  return (
    <div className="home">
      {/* 一行就够。原来这里是 level=1 + 图标 + 两行说明，占掉首屏近三分之一，
          而它全是提示性信息 —— 提示不该比它提示的东西还大。 */}
      <SectionHeader
        level={3}
        title="开始工作"
        description="业务产品由 Vxture 平台订阅提供；本地数据不出设备。"
      />

      {/* 三张卡是**框架自己的三件事**：跑得起来吗、数据安全吗、产品从哪来。
          原来还有「可用产品」「项目」两张 —— 那是下面列表的计数，把同一份
          事实说两遍，占的是首屏最贵的位置。 */}
      <MetricGrid
        aria-label="运行时概况"
        columns={3}
        items={[
          {
            id: "runtime",
            label: "运行环境",
            value: health.ok ? "就绪" : "未连接",
            description: health.ok
              ? `本地守护进程 ${health.version ?? ""}`
              : "等待守护进程",
            icon: "cpu",
            trend: health.ok ? "在线" : "离线",
            trendTone: health.ok ? "success" : "danger",
          },
          {
            id: "protection",
            label: "数据加密",
            value: encrypted ? "已加密" : "开发态",
            description: encrypted
              ? "DPAPI + 全库加密"
              : "明文主密钥（仅开发）",
            icon: "shield-check",
            trend: encrypted ? "DPAPI" : "DEV",
            trendTone: encrypted ? "success" : "warning",
          },
          {
            // 第三件框架层面的事：产品与数据边界都由平台侧决定 —— 订阅决定
            // 本地有什么产品，工作区决定数据归谁。看不见这一条，用户就无从
            // 理解「为什么这里是空的」和「跨工作区为什么被拒」。
            id: "platform",
            label: "平台连接",
            value: signedIn ? "已连接" : "未登录",
            description: signedIn
              ? (session?.workspace?.name ?? "订阅与工作区已同步")
              : "登录后同步你的订阅",
            icon: "plugs-connected",
            trend: signedIn ? "工作区" : "离线",
            trendTone: signedIn ? "success" : "neutral",
          },
        ]}
      />

      <Section
        title="我的产品"
        icon="package"
        level={2}
        description={
          subscriptionKnown
            ? undefined
            : "订阅状态尚未接通，以下为本地运行时已安装的产品。"
        }
        action={
          products.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(subscribeUrl(), "_blank", "noopener")}
            >
              在平台管理订阅 ↗
            </Button>
          ) : undefined
        }
      >
        {products.length === 0 ? (
          // 0 订阅：环境仍在，引导到平台订阅（主体在平台）。
          <EmptyState
            icon="package"
            title={
              signedIn
                ? "当前账号没有可用的业务产品"
                : "登录后同步你的业务产品"
            }
            description={
              signedIn
                ? "运行环境已就绪。业务产品由 Vxture 平台订阅提供——在平台订阅后即可在这里使用。"
                : "运行环境已就绪。登录 Vxture 账号后，你订阅的业务产品会出现在这里。"
            }
            action={
              <Button
                onClick={() => window.open(subscribeUrl(), "_blank", "noopener")}
              >
                到 Vxture 平台订阅 ↗
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
                consoleBase={consoleBase}
                subscribeUrl={subscribeUrl}
                onOpen={onOpen}
                onCreated={onCreated}
                onRefresh={onRefresh}
                onError={onError}
              />
            ))}
          </ListCardGrid>
        )}
        <InstallPackageRow api={api} onDone={onRefresh} onError={onError} />
      </Section>

      <Section
        title="热门推荐"
        icon="sparkles"
        level={2}
        description="平台上已上线和在建的智能体。这里只作了解，订阅在平台完成。"
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              window.open(CATALOG_SOURCE.url, "_blank", "noopener")
            }
          >
            浏览全部 ↗
          </Button>
        }
      >
        <ListCardGrid>
          {CATALOG.map((c) => (
            <ListCard
              key={c.name}
              icon="agent"
              title={c.name}
              description={c.summary}
              status={
                <StatusBadge tone={c.status === "released" ? "success" : "neutral"}>
                  {c.status === "released" ? "正式版" : "开发中"}
                </StatusBadge>
              }
              meta={
                <div className="catalog-meta">
                  <span className="catalog-category">{c.category}</span>
                  <div className="catalog-caps">
                    {c.capabilities.map((cap) => (
                      <Badge key={cap} variant="secondary">
                        {cap}
                      </Badge>
                    ))}
                    {c.version && (
                      <span className="product-ident">v{c.version}</span>
                    )}
                  </div>
                  {/* 统一「了解详情」，**不写「订阅」**：这个链接落在目录页，
                      不是某个产品的订阅流程；写成「去平台订阅」是拿一个做不到
                      的动作骗点击。真要订阅走本栏顶上的「浏览全部」，或者产品
                      已经在「我的产品」里时用那张卡自己的商业入口。
                      上没上线由状态徽章说，不必再让按钮说第二遍。 */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      window.open(CATALOG_SOURCE.url, "_blank", "noopener")
                    }
                  >
                    了解详情 ↗
                  </Button>
                </div>
              }
            />
          ))}
        </ListCardGrid>
        {/* 出处要写明：这份清单不是实时的，用户有权知道自己在看一份快照。 */}
        <p className="text-body-sm text-muted-foreground">
          取自 Vxture 平台目录（{CATALOG_SOURCE.capturedAt} 快照）。
        </p>
      </Section>
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
  consoleBase,
  subscribeUrl,
  onOpen,
  onCreated,
  onRefresh,
  onError,
}: {
  api: Api;
  product: ProductInfo;
  projects: ProjectMeta[];
  consoleBase: string;
  subscribeUrl: (id?: string, intent?: "subscribe" | "renew") => string;
  onOpen: (projectId: string) => void;
  onCreated: (projectId: string) => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [opening, setOpening] = useState(false);
  const usable = product.availability === "available";

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

  return (
    <MetricListCard
      icon="cube"
      title={product.name}
      description={BLURBS[product.id] ?? "Vxture 业务产品"}
      tone={usable ? "brand" : "neutral"}
      badges={
        // **可用性先于订阅。** 一个订阅还在、但本机停用了的产品要说「已停用」——
        // 先判 entitled 会让它显示成「已订阅」，把那条真正决定他能不能用的状态
        // 盖掉，而他看着一个「已订阅」的卡片却没有打开按钮。
        <>
          {product.availability === "not_entitled" ? (
            <StatusBadge tone="warning">未订阅</StatusBadge>
          ) : product.availability === "disabled" ? (
            <StatusBadge tone="neutral">已停用</StatusBadge>
          ) : product.entitled === true ? (
            <StatusBadge tone="success">已订阅</StatusBadge>
          ) : (
            <StatusBadge tone="neutral">本地已装</StatusBadge>
          )}
        </>
      }
      metrics={[
        { key: "version", value: product.version, label: "版本" },
        {
          key: "projects",
          value: total > local ? `${local}/${total}` : String(local),
          label: total > local ? "项目（本地/总）" : "本地项目",
        },
      ]}
      note={
        <span className="product-note">
          <span className="product-ident">{product.id}</span>
          {/* 不可用的要说清为什么。「打不开」和「因为退订所以打不开」在用户
              那里是两件事，后者他知道该去哪解决。 */}
          {!usable && product.reason && (
            <span className="product-reason">{product.reason}</span>
          )}
        </span>
      }
      footer={
        <div className="card-actions">
          {usable ? (
            <>
              {/* 辅：平台上的同一个产品。没有 per-product 深链之前先落到目录页
                  —— 给一个猜出来的 URL 比给目录页更糟。 */}
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  window.open(
                    `${consoleBase}/zh-CN/appcenter`,
                    "_blank",
                    "noopener",
                  )
                }
              >
                在线 ↗
              </Button>
              {/* 主 */}
              <Button size="sm" disabled={opening} onClick={() => void open()}>
                {opening ? "打开中……" : "打开"}
              </Button>
            </>
          ) : (
            <>
              {/* §18.5：退订/停用的产品不可打开，但数据仍在、仍可导出。
                  本机停用的可以就地启用；未订阅的不行 —— 那不是这台机器能
                  解决的事，按钮给了也只会失败。 */}
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
              {/* 商业入口由 daemon 的 commercialIntent 决定：被捆绑覆盖的产品
                  没有属于他的商业动作，就不显示按钮（TD-014 D4）。 */}
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
                  {product.commercialIntent === "renew"
                    ? "去平台续费 ↗"
                    : "去平台订阅 ↗"}
                </Button>
              )}
            </>
          )}
        </div>
      }
    />
  );
}
