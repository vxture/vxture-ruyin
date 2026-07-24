/**
 * Home - the work entry point: subscribed products (locally loaded products
 * stand in for the subscription until entitlement lands, liaison L3(b)) and
 * a recommended-products placeholder rail (catalog/subscribe deep links come
 * with the platform integration, product_200 section 3.2).
 */

import { useState } from "react";
import { Api, type ProductInfo, type WorkspaceMeta } from "./api";

const RECOMMENDED: Array<{ id: string; name: string; blurb: string }> = [
  // Placeholder catalog drawn from the product family in the design docs
  // (docs/20-specs/10-product-strategy.md). Replaced by the platform catalog
  // + subscribe deep links once entitlement integration lands.
  { id: "vxture.crm", name: "客户销售", blurb: "客户生命周期 · 跟进 · 商机" },
  { id: "vxture.document", name: "文档编写", blurb: "长文档 · 模板 · 版本与审核" },
  { id: "vxture.energy", name: "如影 · 能源", blurb: "行业版：投标 / 数据分析 / 经营" },
  { id: "vxture.water", name: "如影 · 水务", blurb: "行业版：水情 / 应急 / 项目" },
];

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
  return (
    <>
      <div className="home-hero">
        <h1>开始工作</h1>
        <p className="muted">
          从已订阅的产品进入业务工作空间；本地数据不出设备，是否上云由你决定。
        </p>
      </div>

      <h2>已订阅产品</h2>
      {products.length === 0 && (
        <div className="empty">未发现已安装的产品（检查 products 目录或订阅状态）</div>
      )}
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
      </div>

      <h2>推荐产品</h2>
      <div className="home-grid">
        {RECOMMENDED.map((r) => (
          <div key={r.id} className="product-card disabled">
            <div className="product-icon dim">{r.name.slice(0, 1)}</div>
            <div>
              <div className="ws-name">{r.name}</div>
              <div className="muted">{r.blurb}</div>
            </div>
            <span className="pill" style={{ marginLeft: "auto" }}>
              敬请期待
            </span>
          </div>
        ))}
      </div>
      <p className="muted">
        订阅与产品目录将在平台对接后接入（当前为占位展示）。
      </p>
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
        <div className="row" style={{ marginTop: 8 }}>
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
        <div className="row" style={{ marginTop: 8 }}>
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
