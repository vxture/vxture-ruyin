/**
 * App shell: token gate, top bar (custom title bar), sidebar with workspace
 * list/creation, and the sectioned workspace panel (./workspace.tsx).
 */

import { useCallback, useEffect, useState } from "react";
import { Api, type ProductInfo, type WorkspaceMeta } from "./api";
import { WorkspacePanel } from "./workspace";
import { HomePage } from "./home";
import { SettingsView } from "./settings";

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

function TopBar({
  crumb,
  onSettings,
  settingsActive,
}: {
  crumb?: string;
  onSettings: () => void;
  settingsActive: boolean;
}) {
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
        <button
          className={`icon-btn${settingsActive ? " active" : ""}`}
          title="设置"
          onClick={onSettings}
        >
          ⚙
        </button>
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

  const [showSettings, setShowSettings] = useState(false);
  const current = workspaces.find((w) => w.id === currentId);
  const openWorkspace = useCallback(
    async (id: string) => {
      await refreshSidebar();
      setCurrentId(id);
      setShowSettings(false);
    },
    [refreshSidebar],
  );
  return (
    <>
      <TopBar
        crumb={showSettings ? "设置" : current?.name}
        settingsActive={showSettings}
        onSettings={() => setShowSettings(!showSettings)}
      />
      <div className="layout">
        <aside className="sidebar">
          <div
            className={`card clickable nav-home${currentId === null && !showSettings ? " selected" : ""}`}
            onClick={() => {
              setCurrentId(null);
              setShowSettings(false);
            }}
          >
            <span className="nav-home-icon" aria-hidden>
              ⌂
            </span>
            首页
          </div>
          <h2>工作空间</h2>
          {workspaces.length === 0 && (
            <div className="empty">从首页的产品入口创建</div>
          )}
          {workspaces.map((w) => (
            <div
              key={w.id}
              className={`card clickable${w.id === currentId && !showSettings ? " selected" : ""}`}
              onClick={() => {
                setCurrentId(w.id);
                setShowSettings(false);
              }}
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
          {showSettings ? (
            <SettingsView api={api} />
          ) : currentId ? (
            <WorkspacePanel key={currentId} api={api} id={currentId} />
          ) : (
            <HomePage
              api={api}
              products={products}
              workspaces={workspaces}
              onOpen={(id) => {
                setCurrentId(id);
                setShowSettings(false);
              }}
              onCreated={openWorkspace}
              onError={setError}
            />
          )}
        </main>
      </div>
    </>
  );
}
