/**
 * Home - the work entry point, tech-console style: a metric band (runtime /
 * spaces / protection / AI channel), the subscribed-product grid (installed
 * products are live ListCards; the rest are EntryCard deep links into the
 * console subscribe flow, explicit click only), and a recommended rail.
 */

import { useEffect, useState } from "react";
import {
  Button,
  EntryCard,
  Input,
  ListCard,
  MetricGrid,
  Section,
  SectionHeader,
  StatusBadge,
} from "@vxture/design-system";
import {
  Api,
  type ProductInfo,
  type SessionInfo,
  type WorkspaceMeta,
} from "./api";

const BLURBS: Record<string, string> = {
  "vxture.bid": "招标解析 · 需求矩阵 · 方案生成 · 覆盖校验",
};

/** Subscription placeholders (design-doc product family, 20-specs/10). */
const SUBSCRIBED_PLACEHOLDERS: Array<{ id: string; name: string; blurb: string }> = [
  { id: "vxture.crm", name: "客户销售", blurb: "客户生命周期 · 拜访跟进 · 商机与签约" },
  { id: "vxture.document", name: "文档编写", blurb: "长文档 · 企业模板 · 版本与审核流程" },
  { id: "vxture.analysis", name: "经营分析", blurb: "经营数据 · 指标洞察 · 决策支持" },
  { id: "vxture.knowledge", name: "知识库管理", blurb: "企业知识沉淀 · 案例库 · 资产复用" },
  { id: "vxture.project", name: "项目管理", blurb: "项目计划 · 进度协同 · 复盘归档" },
];

const RECOMMENDED: Array<{ id: string; name: string; blurb: string }> = [
  { id: "vxture.energy", name: "如影 · 能源", blurb: "行业版 · 投标与经营" },
  { id: "vxture.water", name: "如影 · 水务", blurb: "行业版 · 水情与应急" },
  { id: "vxture.emergency", name: "如影 · 应急", blurb: "行业版 · 事件与指挥" },
];

const GRID_TARGET = 6;

/**
 * 产品标识行（vxture.bid@1.0.0 一类）。作为 description 的第二行传入，天然落在
 * DS 卡片「标题列」内、左缘对齐标题；display:block 让它在单行 description 里另
 * 起一行；颜色比描述再淡一档。三种产品卡统一用它。
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
  workspaces: WorkspaceMeta[];
  health: { ok: boolean; version?: string };
  onOpen: (wsId: string) => void;
  onCreated: (wsId: string) => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const installedIds = new Set(products.map((p) => p.id));
  const placeholders = SUBSCRIBED_PLACEHOLDERS.filter(
    (p) => !installedIds.has(p.id),
  ).slice(0, Math.max(0, GRID_TARGET - products.length));

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

  // Console deep links open only on an explicit click, never automatically.
  const subscribeUrl = (productId: string) =>
    `${session?.consoleBase ?? "https://vxture.com"}/subscribe?product=${encodeURIComponent(productId)}&intent=subscribe`;

  return (
    <div className="home">
      <SectionHeader
        level={1}
        icon="squares-four"
        title="开始工作"
        description="从已订阅的产品进入业务工作空间；本地数据不出设备，是否上云由你决定。"
      />

      <MetricGrid
        aria-label="运行时概况"
        columns={4}
        items={[
          {
            id: "runtime",
            label: "Runtime",
            value: health.ok ? "运行中" : "未连接",
            description: health.ok ? `本地守护进程 ${health.version ?? ""}` : "等待守护进程",
            icon: "cpu",
            trend: health.ok ? "在线" : "离线",
            trendTone: health.ok ? "success" : "danger",
          },
          {
            id: "spaces",
            label: "工作空间",
            value: String(workspaces.length),
            description: "本地业务空间",
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
          {
            id: "ai",
            label: "智能通道",
            value: "待接通",
            description: "AI Gateway · liaison L3-c",
            icon: "sparkles",
          },
        ]}
      />

      <Section title="已订阅产品" icon="package" level={2}>
        <div className="grid gap-md md:grid-cols-2 xl:grid-cols-3">
          {products.map((p) => (
            <InstalledProductCard
              key={p.id}
              api={api}
              product={p}
              workspaces={workspaces.filter((w) => w.productId === p.id)}
              onOpen={onOpen}
              onCreated={onCreated}
              onError={onError}
            />
          ))}
          {placeholders.map((p) => (
            <EntryCard
              key={p.id}
              icon="package"
              title={p.name}
              meta={<StatusBadge tone="neutral">待开通</StatusBadge>}
              description={
                <>
                  {p.blurb}
                  <ProductIdent code={p.id} />
                </>
              }
              href={subscribeUrl(p.id)}
              target="_blank"
              rel="noopener noreferrer"
            />
          ))}
        </div>
      </Section>

      <Section title="为你推荐" icon="rocket" level={2}>
        <div className="grid gap-md md:grid-cols-3">
          {RECOMMENDED.map((r) => (
            <EntryCard
              key={r.id}
              icon="lightning"
              title={r.name}
              meta={<StatusBadge tone="brand">敬请期待</StatusBadge>}
              description={
                <>
                  {r.blurb}
                  <ProductIdent code={r.id} />
                </>
              }
              aria-disabled="true"
              onClick={(e) => e.preventDefault()}
            />
          ))}
        </div>
      </Section>
    </div>
  );
}

function InstalledProductCard({
  api,
  product,
  workspaces,
  onOpen,
  onCreated,
  onError,
}: {
  api: Api;
  product: ProductInfo;
  workspaces: WorkspaceMeta[];
  onOpen: (wsId: string) => void;
  onCreated: (wsId: string) => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  return (
    <ListCard
      icon="cube"
      title={product.name}
      description={BLURBS[product.id] ?? "AI 原生业务产品"}
      status={<StatusBadge tone="success">已安装</StatusBadge>}
      meta={
        <div className="flex flex-col gap-xs">
          {/* ListCard 的 description 是单行，标识改放 meta 区、缩进对齐标题 */}
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
                placeholder="工作空间名称"
                onKeyDown={(e) => e.key === "Escape" && setCreating(false)}
              />
              <Button
                onClick={async () => {
                  try {
                    const meta = await api.createWorkspace(
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
              <Button onClick={() => setCreating(true)}>新建工作空间</Button>
              {workspaces.length === 0 && (
                <span className="text-body-sm text-muted-foreground">
                  从这里开始第一个项目
                </span>
              )}
            </div>
          )}
        </div>
      }
    />
  );
}
