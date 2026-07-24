/**
 * App shell: token gate, top bar (custom title bar), sidebar with workspace
 * list/creation, and the sectioned workspace panel (./workspace.tsx).
 */

import { useCallback, useEffect, useState } from "react";
import { Api, type ProductInfo, type WorkspaceMeta } from "./api";
import { WorkspacePanel } from "./workspace";

export default function App() {
  const fromQuery = new URLSearchParams(location.search).get("token");
  const [token, setToken] = useState<string | null>(fromQuery);
  if (!token) {
    return <TokenGate onSubmit={setToken} />;
  }
  return <Workbench api={new Api(token)} />;
}

function LogoBlock() {
  return (
    <div className="logo">
      <span className="logo-mark" aria-hidden />
      <span>
        <span className="logo-cn">如影</span>{" "}
        <span className="logo-en">RUYIN</span>
      </span>
    </div>
  );
}

function TokenGate({ onSubmit }: { onSubmit: (t: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="token-gate">
      <LogoBlock />
      <p className="muted">
        本地智能工作环境 · 粘贴 Runtime 会话 token（daemon 启动日志中打印）以连接。
      </p>
      <div className="row">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="session token"
          onKeyDown={(e) => e.key === "Enter" && value && onSubmit(value)}
        />
        <button className="primary" onClick={() => value && onSubmit(value)}>
          连接
        </button>
      </div>
    </div>
  );
}

function TopBar({ crumb }: { crumb?: string }) {
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
  return (
    <header className="topbar">
      <LogoBlock />
      <div className="topbar-crumb">
        <span className="crumb-sep">/</span>
        {crumb ? <b>{crumb}</b> : <span>工作空间</span>}
      </div>
      <div className="topbar-right">
        <span className="conn">
          <span className={`conn-dot${health.ok ? "" : " off"}`} />
          {health.ok ? `Runtime ${health.version ?? ""}` : "未连接"}
        </span>
      </div>
    </header>
  );
}

function Workbench({ api }: { api: Api }) {
  const [products, setProducts] = useState<ProductInfo[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceMeta[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const current = workspaces.find((w) => w.id === currentId);
  return (
    <>
      <TopBar crumb={current?.name} />
      <div className="layout">
        <aside className="sidebar">
          <CreateWorkspace
            api={api}
            products={products}
            onCreated={async (id) => {
              await refreshSidebar();
              setCurrentId(id);
            }}
            onError={setError}
          />
          <h2>工作空间</h2>
          {workspaces.length === 0 && <div className="empty">尚无工作空间</div>}
          {workspaces.map((w) => (
            <div
              key={w.id}
              className={`card clickable${w.id === currentId ? " selected" : ""}`}
              onClick={() => setCurrentId(w.id)}
            >
              <div className="ws-name">{w.name}</div>
              <div className="ws-meta-line">
                {w.productId} · {w.workspaceType}
              </div>
            </div>
          ))}
          {error && <div className="error-box">{error}</div>}
        </aside>
        <main className="main">
          {currentId ? (
            <WorkspacePanel key={currentId} api={api} id={currentId} />
          ) : (
            <div className="empty" style={{ marginTop: 40 }}>
              选择或创建一个工作空间开始业务工作
            </div>
          )}
        </main>
      </div>
    </>
  );
}

function CreateWorkspace({
  api,
  products,
  onCreated,
  onError,
}: {
  api: Api;
  products: ProductInfo[];
  onCreated: (id: string) => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [product, setProduct] = useState("");
  const [name, setName] = useState("");
  const effective = product || products[0]?.id || "";
  return (
    <>
      <h2>新建工作空间</h2>
      <select value={effective} onChange={(e) => setProduct(e.target.value)}>
        {products.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}（{p.id}）
          </option>
        ))}
      </select>
      <div className="row">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="名称"
        />
        <button
          className="primary"
          disabled={!effective}
          onClick={async () => {
            try {
              const meta = await api.createWorkspace(effective, name || effective);
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
    </>
  );
}
