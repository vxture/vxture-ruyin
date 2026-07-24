/**
 * Ruyin Workspace UI. Control surfaces owned by the runtime per
 * docs/40-implementation/10-product-integration-guide.md section 6.3:
 * workspace lifecycle, grants/bindings, business-state transitions with
 * human confirmation, task launch, checkpoint decisions (context_confirm /
 * verification_review), and the audit trail.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Api,
  type AuditEvent,
  type Binding,
  type FolderGrant,
  type ProductInfo,
  type TaskInstance,
  type WorkspaceMeta,
  type WorkspaceView,
} from "./api";

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
          {workspaces.length === 0 && (
            <div className="empty">尚无工作空间</div>
          )}
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
              const meta = await api.createWorkspace(
                effective,
                name || effective,
              );
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

function WorkspacePanel({ api, id }: { api: Api; id: string }) {
  const [view, setView] = useState<WorkspaceView | null>(null);
  const [instances, setInstances] = useState<TaskInstance[]>([]);
  const [grants, setGrants] = useState<FolderGrant[]>([]);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [v, ti, g, b, a] = await Promise.all([
        api.workspace(id),
        api.taskInstances(id),
        api.grants(id),
        api.bindings(id),
        api.audit(id),
      ]);
      setView(v);
      setInstances(ti);
      setGrants(g);
      setBindings(b);
      setAudit(a);
      setError(null);
    } catch (e) {
      setError(String((e as Error).message));
    }
  }, [api, id]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const guard = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        await refresh();
      } catch (e) {
        setError(String((e as Error).message));
      }
    },
    [refresh],
  );

  const pendingCheckpoints = useMemo(
    () => instances.filter((t) => t.state === "waiting_human"),
    [instances],
  );

  if (!view) return <p className="muted">加载中……</p>;
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>
          {view.meta.name}{" "}
          <span className="pill">{view.businessState}</span>
        </h1>
        <span className="muted">
          {view.product.name} {view.product.version} · {view.meta.id}
        </span>
      </div>
      {error && <div className="error-box">{error}</div>}

      {pendingCheckpoints.length > 0 && (
        <>
          <h2>待确认（{pendingCheckpoints.length}）</h2>
          {pendingCheckpoints.map((t) => (
            <CheckpointCard
              key={t.id}
              instance={t}
              onDecide={(approve) =>
                void guard(() => api.decide(id, t.id, approve))
              }
            />
          ))}
        </>
      )}

      <StateControls view={view} onTransition={(to, confirmed) => void guard(() => api.transition(id, to, confirmed))} />

      <h2>文件授权与绑定</h2>
      <GrantsAndBindings
        grants={grants}
        bindings={bindings}
        contextTypes={Array.from(new Set(view.tasks.flatMap((t) => t.input_types)))}
        onAddGrant={(p) => void guard(() => api.addGrant(id, p))}
        onBind={(type, root) => void guard(() => api.setBinding(id, type, root))}
      />

      <h2>任务</h2>
      {view.tasks.map((t) => (
        <TaskLauncher
          key={t.id}
          def={t}
          onLaunch={(inputs) => void guard(() => api.startTask(id, t.id, inputs))}
        />
      ))}

      <h2>任务实例</h2>
      {instances.length === 0 && <div className="empty">尚无任务实例</div>}
      {[...instances].reverse().map((t) => (
        <InstanceCard key={t.id} instance={t} />
      ))}

      <h2>审计轨迹 · {audit.length} 条 · 哈希链</h2>
      <div className="card audit-scroll">
        <table className="audit-table">
          <thead>
            <tr>
              <th>#</th>
              <th>kind</th>
              <th>actor</th>
              <th>payload</th>
            </tr>
          </thead>
          <tbody>
            {audit.map((e, i) => (
              <tr key={e.event_id}>
                <td>{i + 1}</td>
                <td>{e.kind}</td>
                <td>{e.actor}</td>
                <td>{JSON.stringify(e.payload)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function CheckpointCard({
  instance,
  onDecide,
}: {
  instance: TaskInstance;
  onDecide: (approve: boolean) => void;
}) {
  const kind = instance.checkpoint?.kind ?? "verification_review";
  return (
    <div className="checkpoint">
      <div className="checkpoint-title">
        {kind === "context_confirm"
          ? `任务「${instance.taskId}」请求使用以下上下文（含高敏感项，需你确认）`
          : `任务「${instance.taskId}」的成果等待人工评审`}
      </div>
      {kind === "context_confirm" && (
        <table>
          <tbody>
            {(instance.contextSet ?? []).map((i) => (
              <tr key={i.id}>
                <td>{i.name}</td>
                <td className="muted">{i.type}</td>
                <td className="muted">{(i.bytes / 1024).toFixed(1)} KB</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {kind === "verification_review" && (
        <table>
          <tbody>
            {instance.verification.map((v) => (
              <tr key={v.id}>
                <td>{v.id}</td>
                <td>
                  <span className={`pill ${v.status === "pending_human" ? "waiting_human" : v.status}`}>
                    {v.status}
                  </span>
                </td>
                <td className="muted">{v.note ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="row" style={{ marginTop: 8 }}>
        <button className="primary" onClick={() => onDecide(true)}>
          批准
        </button>
        <button className="danger" onClick={() => onDecide(false)}>
          拒绝
        </button>
      </div>
    </div>
  );
}

function StateControls({
  view,
  onTransition,
}: {
  view: WorkspaceView;
  onTransition: (to: string, humanConfirmed: boolean) => void;
}) {
  const current = view.states?.items.find(
    (s) => s.name === view.businessState,
  );
  if (!current || current.transitions.length === 0) return null;
  return (
    <>
      <h2>业务状态</h2>
      <div className="row">
        {current.transitions.map((t) => (
          <button
            key={t.to}
            onClick={() => {
              if (t.confirm === "human") {
                if (
                  window.confirm(
                    `状态转换 ${view.businessState} → ${t.to} 需要人工确认，确定执行？`,
                  )
                ) {
                  onTransition(t.to, true);
                }
              } else {
                onTransition(t.to, false);
              }
            }}
          >
            → {t.to}
            {t.confirm === "human" ? "（需确认）" : ""}
          </button>
        ))}
      </div>
    </>
  );
}

function GrantsAndBindings({
  grants,
  bindings,
  contextTypes,
  onAddGrant,
  onBind,
}: {
  grants: FolderGrant[];
  bindings: Binding[];
  contextTypes: string[];
  onAddGrant: (path: string) => void;
  onBind: (type: string, root: string) => void;
}) {
  const [grantPath, setGrantPath] = useState("");
  const [bindType, setBindType] = useState("");
  const [bindRoot, setBindRoot] = useState("");
  const effectiveType = bindType || contextTypes[0] || "";
  return (
    <div className="card">
      {grants.map((g) => (
        <div key={g.id} className="mono">
          授权 {g.path} <span className="muted">({g.mode})</span>
        </div>
      ))}
      <div className="row">
        <input
          value={grantPath}
          onChange={(e) => setGrantPath(e.target.value)}
          placeholder="文件夹绝对路径"
        />
        <button
          disabled={!grantPath}
          onClick={() => {
            onAddGrant(grantPath);
            setGrantPath("");
          }}
        >
          授权
        </button>
      </div>
      {bindings.map((b) => (
        <div key={b.type} className="mono">
          绑定 {b.type} ← {b.root}
        </div>
      ))}
      <div className="row">
        <select value={effectiveType} onChange={(e) => setBindType(e.target.value)}>
          {contextTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          value={bindRoot}
          onChange={(e) => setBindRoot(e.target.value)}
          placeholder="已授权文件夹内的路径"
        />
        <button
          disabled={!effectiveType || !bindRoot}
          onClick={() => {
            onBind(effectiveType, bindRoot);
            setBindRoot("");
          }}
        >
          绑定并索引
        </button>
      </div>
    </div>
  );
}

function TaskLauncher({
  def,
  onLaunch,
}: {
  def: { id: string; objective: string; input_types: string[] };
  onLaunch: (inputs?: Record<string, unknown>) => void;
}) {
  const [manual, setManual] = useState(false);
  const [json, setJson] = useState("{}");
  const [jsonError, setJsonError] = useState<string | null>(null);
  return (
    <div className="card">
      <div style={{ fontWeight: 600 }}>{def.id}</div>
      <div className="muted">
        {def.objective} · 输入类型: {def.input_types.join(", ") || "（无）"}
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <button className="primary" onClick={() => onLaunch(undefined)}>
          启动（自动选择上下文）
        </button>
        <button onClick={() => setManual(!manual)}>
          {manual ? "收起手动模式" : "手动提供输入"}
        </button>
      </div>
      {manual && (
        <>
          <textarea
            rows={3}
            value={json}
            onChange={(e) => setJson(e.target.value)}
          />
          {jsonError && <div className="error-box">{jsonError}</div>}
          <button
            onClick={() => {
              try {
                onLaunch(JSON.parse(json) as Record<string, unknown>);
                setJsonError(null);
              } catch (e) {
                setJsonError(String((e as Error).message));
              }
            }}
          >
            以手动输入启动
          </button>
        </>
      )}
    </div>
  );
}

function InstanceCard({ instance }: { instance: TaskInstance }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card clickable" onClick={() => setOpen(!open)}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span>
          <b>{instance.taskId}</b>{" "}
          <span className={`pill ${instance.state}`}>{instance.state}</span>
        </span>
        <span className="muted">{instance.updatedAt}</span>
      </div>
      {instance.error && <div className="error-box">{instance.error}</div>}
      {open && instance.result && (
        <div style={{ marginTop: 8 }}>
          {Object.entries(instance.result.content).map(([cap, text]) => (
            <div key={cap}>
              <div className="muted">{cap}</div>
              <div className="mono">{text}</div>
            </div>
          ))}
          <div className="muted" style={{ marginTop: 4 }}>
            来源: {instance.result.sources.join(", ")}
          </div>
        </div>
      )}
    </div>
  );
}
