/**
 * Home - the work entry point of a CLIENT WORK RUNTIME (20-specs/10 §1.1/§5.2).
 *
 * 产品主体在平台：平台订阅了 → 本地可用；平台 0 订阅 → 本地无可用产品，但运行
 * 环境仍在，并据此引导用户到平台订阅（console 深链）。因此本页的产品列表由
 * **订阅状态 + 本地已装运行时产品**共同决定，绝不硬编码产品或推荐——编造的产品
 * 会让用户以为自己拥有并不存在的订阅。
 *
 * 订阅数据面（C2 entitlements）尚无桌面可达端点（liaison L3-b）：未接通时诚实
 * 降级——展示本地运行时已装的产品，并标明订阅状态未接通，而不是虚构一份清单。
 */

import { useEffect, useState } from "react";
import {
  Button,
  EmptyState,
  Input,
  ListCard,
  MetricGrid,
  Section,
  SectionHeader,
  StatusBadge,
} from "@vxture/design-system";
import {
  Api,
  type EntitlementsBatch,
  type ProductInfo,
  type SessionInfo,
  type ProjectMeta,
} from "./api";

const BLURBS: Record<string, string> = {
  "vxture.bid": "招标解析 · 需求矩阵 · 方案生成 · 覆盖校验",
};

/**
 * 产品标识行（vxture.bid@1.0.0 一类）。作为 description 的第二行传入，天然落在
 * DS 卡片「标题列」内、左缘对齐标题；display:block 让它在单行 description 里另
 * 起一行；颜色比描述再淡一档。
 */
function ProductIdent({ code, inset }: { code: string; inset?: boolean }) {
  return (
    <span className={`product-ident${inset ? " product-ident--inset" : ""}`}>
      {code}
    </span>
  );
}

export function HomePage({
  api,
  products,
  workspaces,
  health,
  onOpen,
  onCreated,
  onError,
}: {
  api: Api;
  products: ProductInfo[];
  workspaces: ProjectMeta[];
  health: { ok: boolean; version?: string };
  onOpen: (projectId: string) => void;
  onCreated: (projectId: string) => void | Promise<void>;
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

  // 可用性由 runtime 判定（daemon 的 ProductRegistry，§18.5）——UI 不重算规则。
  const usable = products.filter((p) => p.availability === "available");
  const blocked = products.filter((p) => p.availability !== "available");
  const subscriptionKnown = products.some((p) => p.entitled !== null);

  return (
    <div className="home">
      <SectionHeader
        level={1}
        icon="squares-four"
        title="开始工作"
        description="业务产品由 Vxture 平台订阅提供，如影负责把它们放进你的本地工作环境；本地数据不出设备。"
      />

      <MetricGrid
        aria-label="运行时概况"
        columns={4}
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
            id: "products",
            label: "可用产品",
            value: String(usable.length),
            description: subscriptionKnown ? "按平台订阅" : "订阅状态未接通",
            icon: "package",
          },
          {
            id: "spaces",
            label: "项目",
            value: String(workspaces.length),
            description: "本地业务项目",
            icon: "cube",
          },
          {
            id: "protection",
            label: "数据保护",
            value: system?.keyProtection === "dpapi" ? "已加密" : "开发态",
            description:
              system?.keyProtection === "dpapi"
                ? "DPAPI + 全库加密"
                : "明文主密钥（仅开发）",
            icon: "shield-check",
            trendTone: system?.keyProtection === "dpapi" ? "success" : "warning",
            trend: system?.keyProtection === "dpapi" ? "DPAPI" : "DEV",
          },
        ]}
      />

      <Section title="业务产品" icon="package" level={2}>
        {usable.length === 0 ? (
          // 0 订阅：环境仍在，引导到平台订阅（主体在平台）。
          <EmptyState
            icon="package"
            title={
              session?.signedIn
                ? "当前账号没有可用的业务产品"
                : "登录后同步你的业务产品"
            }
            description={
              session?.signedIn
                ? "运行环境已就绪。业务产品由 Vxture 平台订阅提供——在平台订阅后即可在这里使用。"
                : "运行环境已就绪。登录 Vxture 账号后，你订阅的业务产品会出现在这里。"
            }
            action={
              <Button
                onClick={() =>
                  window.open(subscribeUrl(), "_blank", "noopener")
                }
              >
                到 Vxture 平台订阅 ↗
              </Button>
            }
          />
        ) : (
          <>
            {!subscriptionKnown && (
              <p className="text-body-sm text-muted-foreground">
                订阅状态尚未接通，以下为本地运行时已安装的产品。
              </p>
            )}
            <div className="grid gap-md md:grid-cols-2 xl:grid-cols-3">
              {usable.map((p) => (
                <InstalledProductCard
                  key={p.id}
                  api={api}
                  product={p}
                  workspaces={workspaces.filter((w) => w.productId === p.id)}
                  workspaceName={session?.workspace?.name}
                  onOpen={onOpen}
                  onCreated={onCreated}
                  onError={onError}
                />
              ))}
            </div>
            <div className="row">
              <Button
                variant="outline"
                onClick={() => window.open(subscribeUrl(), "_blank", "noopener")}
              >
                在平台管理订阅 ↗
              </Button>
            </div>
          </>
        )}
      </Section>

      {/* §18.5：退订/停用的产品不可打开，但仍列出——本地数据可访问。
          （导出是 §18.5 的另一半，实现未落地，见 TD-020。） */}
      {blocked.length > 0 && (
        <Section title="不可用的产品" icon="lock" level={2}>
          <div className="grid gap-md md:grid-cols-2 xl:grid-cols-3">
            {blocked.map((p) => (
              <ListCard
                key={p.id}
                icon="lock"
                title={p.name}
                description={p.reason ?? "当前不可打开"}
                status={
                  <StatusBadge
                    tone={p.availability === "not_entitled" ? "warning" : "neutral"}
                  >
                    {p.availability === "not_entitled" ? "未订阅" : "已停用"}
                  </StatusBadge>
                }
                meta={
                  <div className="flex flex-col gap-xs">
                    <ProductIdent code={`${p.id}@${p.version}`} inset />
                    {/* 商业入口由 daemon 的 commercialIntent 决定：被捆绑覆盖
                        的产品没有属于他的商业动作，就不显示按钮。 */}
                    {p.commercialIntent && (
                      <div className="flex items-center gap-xs">
                        <Button
                          variant="outline"
                          onClick={() =>
                            window.open(
                              subscribeUrl(p.id, p.commercialIntent!),
                              "_blank",
                              "noopener",
                            )
                          }
                        >
                          {p.commercialIntent === "renew"
                            ? "去平台续费 ↗"
                            : "去平台订阅 ↗"}
                        </Button>
                      </div>
                    )}
                  </div>
                }
              />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function InstalledProductCard({
  api,
  product,
  workspaces,
  workspaceName,
  onOpen,
  onCreated,
  onError,
}: {
  api: Api;
  product: ProductInfo;
  workspaces: ProjectMeta[];
  /** 当前平台工作区名；未登录为 undefined，此时不能新建项目。 */
  workspaceName?: string | undefined;
  onOpen: (projectId: string) => void;
  onCreated: (projectId: string) => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  return (
    <ListCard
      icon="cube"
      title={product.name}
      description={BLURBS[product.id] ?? "Vxture 业务产品"}
      status={
        product.entitled === true ? (
          <StatusBadge tone="success">已订阅</StatusBadge>
        ) : (
          <StatusBadge tone="neutral">本地已装</StatusBadge>
        )
      }
      meta={
        <div className="flex flex-col gap-xs">
          <ProductIdent code={`${product.id}@${product.version}`} inset />
          {workspaces.length > 0 && (
            <div className="flex flex-wrap items-center gap-xs">
              {workspaces.slice(0, 3).map((w) => (
                <Button
                  key={w.id}
                  variant="secondary"
                  onClick={() => onOpen(w.id)}
                >
                  {w.name}
                </Button>
              ))}
              {workspaces.length > 3 && (
                <span className="text-body-sm text-muted-foreground">
                  等 {workspaces.length} 个
                </span>
              )}
            </div>
          )}
          {creating ? (
            <div className="flex items-center gap-xs">
              <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="项目名称"
                onKeyDown={(e) => e.key === "Escape" && setCreating(false)}
              />
              <Button
                onClick={async () => {
                  try {
                    const meta = await api.createProject(
                      product.id,
                      name || product.name,
                    );
                    setCreating(false);
                    setName("");
                    await onCreated(meta.id);
                  } catch (e) {
                    onError(String((e as Error).message));
                  }
                }}
              >
                创建
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-xs">
              {/* 项目须归属工作区（ADR-015）。没有登录态就没有工作区，也就
                  无从新建 —— 说清缺的是什么，而不是让按钮没反应。 */}
              <Button disabled={!workspaceName} onClick={() => setCreating(true)}>
                新建项目
              </Button>
              <span className="text-body-sm text-muted-foreground">
                {!workspaceName
                  ? "登录并选择工作区后可新建——项目须归属于一个工作区"
                  : workspaces.length === 0
                    ? `将建在「${workspaceName}」，从这里开始第一个项目`
                    : `将建在「${workspaceName}」`}
              </span>
            </div>
          )}
        </div>
      }
    />
  );
}
