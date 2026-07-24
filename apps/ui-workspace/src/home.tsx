/**
 * Home - the work entry point. Subscribed products fill a 3-column grid
 * (installed products are live; the rest are subscription placeholders
 * until entitlement lands, liaison L3(b)). A compact recommended rail sits
 * below without competing with the main grid (catalog/subscribe deep links
 * come with the platform integration, product_200 section 3.2).
 */

import { useState } from "react";
import { Api, type ProductInfo, type WorkspaceMeta } from "./api";

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

export function HomePage({
  api,
  products,
  workspaces,
  onOpen,
  onCreated,
  onError,
}: {
  api: Api;
  products: ProductInfo[];
  workspaces: WorkspaceMeta[];
  onOpen: (wsId: string) => void;
  onCreated: (wsId: string) => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const installedIds = new Set(products.map((p) => p.id));
  const placeholders = SUBSCRIBED_PLACEHOLDERS.filter(
    (p) => !installedIds.has(p.id),
  ).slice(0, Math.max(0, GRID_TARGET - products.length));

  return (
    <>
      <div className="home-hero">
        <h1>开始工作</h1>
        <p className="muted">
          从已订阅的产品进入业务工作空间；本地数据不出设备，是否上云由你决定。
        </p>
      </div>

      <h2>已订阅产品</h2>
      <div className="home-grid">
        {products.map((p) => (
          <SubscribedCard
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
          <div key={p.id} className="product-card placeholder">
            <div className="product-head">
              <div className="product-icon dim">{p.name.slice(0, 1)}</div>
              <div style={{ minWidth: 0 }}>
                <div className="ws-name">{p.name}</div>
                <div className="ws-meta-line">{p.id}</div>
              </div>
              <span className="pill" style={{ marginLeft: "auto" }}>
                待开通
              </span>
            </div>
            <div className="muted product-blurb">{p.blurb}</div>
            <div className="row" style={{ marginTop: "auto" }}>
              <button disabled>开通后可用</button>
            </div>
          </div>
        ))}
      </div>

      <h2>为你推荐</h2>
      <div className="home-grid compact">
        {RECOMMENDED.map((r) => (
          <div key={r.id} className="product-card compact">
            <div className="product-icon dim small">{r.name.slice(5, 6) || r.name.slice(0, 1)}</div>
            <div style={{ minWidth: 0 }}>
              <div className="ws-name">{r.name}</div>
              <div className="muted ellipsis">{r.blurb}</div>
            </div>
            <span className="pill" style={{ marginLeft: "auto", flexShrink: 0 }}>
              敬请期待
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

function SubscribedCard({
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
    <div className="product-card">
      <div className="product-head">
        <div className="product-icon">{product.name.slice(0, 1)}</div>
        <div style={{ minWidth: 0 }}>
          <div className="ws-name">{product.name}</div>
          <div className="ws-meta-line">
            {product.id}@{product.version}
          </div>
        </div>
      </div>
      <div className="muted product-blurb">
        {BLURBS[product.id] ?? "AI 原生业务产品"}
      </div>

      {workspaces.length > 0 && (
        <div className="product-ws-list">
          {workspaces.slice(0, 3).map((w) => (
            <button key={w.id} className="ws-chip" onClick={() => onOpen(w.id)}>
              {w.name}
            </button>
          ))}
          {workspaces.length > 3 && (
            <span className="muted">等 {workspaces.length} 个</span>
          )}
        </div>
      )}

      {creating ? (
        <div className="row" style={{ marginTop: "auto" }}>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="工作空间名称"
            onKeyDown={(e) => e.key === "Escape" && setCreating(false)}
          />
          <button
            className="primary"
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
          </button>
        </div>
      ) : (
        <div className="row" style={{ marginTop: "auto" }}>
          <button className="primary" onClick={() => setCreating(true)}>
            新建工作空间
          </button>
          {workspaces.length === 0 && (
            <span className="muted">从这里开始第一个项目</span>
          )}
        </div>
      )}
    </div>
  );
}
