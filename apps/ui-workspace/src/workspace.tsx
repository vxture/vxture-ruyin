/**
 * Workspace panel - sectioned into functional tabs (概览 / 上下文 / 任务 /
 * 审计) per the runtime-owned control surfaces of
 * docs/40-implementation/10-product-integration-guide.md section 6.3.
 * Pending checkpoints stay pinned above the tabs: human decisions outrank
 * navigation (50-harness section 6).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Api,
  type AuditEvent,
  type Binding,
  type ContextItemMeta,
  type FolderGrant,
  type TaskInstance,
  type WorkspaceView,
} from "./api";
import { verifyChain } from "./chain";

type TabId = "overview" | "context" | "tasks" | "audit";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "概览" },
  { id: "context", label: "上下文" },
  { id: "tasks", label: "任务" },
  { id: "audit", label: "审计" },
];

export function WorkspacePanel({ api, id }: { api: Api; id: string }) {
  const [tab, setTab] = useState<TabId>("overview");
  const [view, setView] = useState<WorkspaceView | null>(null);
  const [instances, setInstances] = useState<TaskInstance[]>([]);
  const [grants, setGrants] = useState<FolderGrant[]>([]);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [chainOk, setChainOk] = useState<boolean | null>(null);
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
      setChainOk(await verifyChain(id, a));
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

  const pending = useMemo(
    () => instances.filter((t) => t.state === "waiting_human"),
    [instances],
  );

  if (!view) return <p className="muted">加载中……</p>;
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>
          {view.meta.name} <span className="pill">{view.businessState}</span>
        </h1>
        <span className="muted mono">
          {view.product.name} {view.product.version} · {view.meta.id}
        </span>
      </div>
      {error && <div className="error-box">{error}</div>}

      {pending.map((t) => (
        <CheckpointCard
          key={t.id}
          instance={t}
          onDecide={(approve) => void guard(() => api.decide(id, t.id, approve))}
        />
      ))}

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab${tab === t.id ? " active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === "tasks" && pending.length > 0 && (
              <span className="badge">{pending.length}</span>
            )}
          </button>
        ))}
      </nav>

      {tab === "overview" && (
        <OverviewTab
          view={view}
          instances={instances}
          onTransition={(to, c) => void guard(() => api.transition(id, to, c))}
        />
      )}
      {tab === "context" && (
        <ContextTab
          api={api}
          wsId={id}
          view={view}
          grants={grants}
          bindings={bindings}
          onAddGrant={(p) => void guard(() => api.addGrant(id, p))}
          onBind={(type, root) => void guard(() => api.setBinding(id, type, root))}
        />
      )}
      {tab === "tasks" && (
        <TasksTab
          view={view}
          instances={instances}
          onLaunch={(task, inputs) =>
            void guard(() => api.startTask(id, task, inputs))
          }
        />
      )}
      {tab === "audit" && <AuditTab audit={audit} chainOk={chainOk} />}
    </>
  );
}

/* ---------------- Overview ---------------- */

function OverviewTab({
  view,
  instances,
  onTransition,
}: {
  view: WorkspaceView;
  instances: TaskInstance[];
  onTransition: (to: string, humanConfirmed: boolean) => void;
}) {
  const recent = [...instances].reverse().slice(0, 5);
  return (
    <>
      <h2>业务阶段</h2>
      <StateStepper view={view} onTransition={onTransition} />
      <h2>最近任务</h2>
      {recent.length === 0 && <div className="empty">尚无任务执行记录</div>}
      {recent.map((t) => (
        <div key={t.id} className="card">
          <b>{t.taskId}</b>{" "}
          <span className={`pill ${t.state}`}>{t.state}</span>
          <span className="muted" style={{ marginLeft: 10 }}>
            {t.updatedAt}
          </span>
        </div>
      ))}
      <h2>产品</h2>
      <div className="card">
        <div className="ws-name">{view.product.name}</div>
        <div className="ws-meta-line">
          {view.product.id}@{view.product.version} · workspace 类型{" "}
          {view.meta.workspaceType} · 创建于 {view.meta.createdAt}
        </div>
      </div>
    </>
  );
}

function StateStepper({
  view,
  onTransition,
}: {
  view: WorkspaceView;
  onTransition: (to: string, humanConfirmed: boolean) => void;
}) {
  const items = view.states?.items ?? [];
  const currentIndex = items.findIndex((s) => s.name === view.businessState);
  const current = items[currentIndex];
  const transitions = current?.transitions ?? [];
  return (
    <div className="card">
      <div className="stepper">
        {items.map((s, i) => (
          <div
            key={s.name}
            className={`step${i < currentIndex ? " done" : ""}${i === currentIndex ? " current" : ""}`}
          >
            {i > 0 && <span className="step-line" />}
            <span className="step-dot" />
            <span className="step-label">{s.name}</span>
          </div>
        ))}
      </div>
      {transitions.length > 0 && (
        <div className="row">
          <span className="muted">推进：</span>
          {transitions.map((t) => (
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
      )}
    </div>
  );
}

/* ---------------- Context ---------------- */

function ContextTab({
  api,
  wsId,
  view,
  grants,
  bindings,
  onAddGrant,
  onBind,
}: {
  api: Api;
  wsId: string;
  view: WorkspaceView;
  grants: FolderGrant[];
  bindings: Binding[];
  onAddGrant: (path: string) => void;
  onBind: (type: string, root: string) => void;
}) {
  const [grantPath, setGrantPath] = useState("");
  const [bindType, setBindType] = useState("");
  const [bindRoot, setBindRoot] = useState("");
  const contextTypes = useMemo(
    () => Array.from(new Set(view.tasks.flatMap((t) => t.input_types))),
    [view.tasks],
  );
  const effectiveType = bindType || contextTypes[0] || "";
  return (
    <>
      <h2>文件授权 · Grants</h2>
      {grants.length === 0 && (
        <div className="empty">
          尚未授权任何文件夹——Runtime 只能访问你显式授权的目录
        </div>
      )}
      {grants.map((g) => (
        <div key={g.id} className="card mono">
          {g.path} <span className="muted">({g.mode})</span>
        </div>
      ))}
      <div className="row">
        <input
          value={grantPath}
          onChange={(e) => setGrantPath(e.target.value)}
          placeholder="文件夹绝对路径"
        />
        <button
          className="primary"
          disabled={!grantPath}
          onClick={() => {
            onAddGrant(grantPath);
            setGrantPath("");
          }}
        >
          授权
        </button>
      </div>

      <h2>类型绑定 · Bindings</h2>
      {bindings.map((b) => (
        <BindingCard key={b.type} api={api} wsId={wsId} binding={b} />
      ))}
      <div className="row">
        <select
          value={effectiveType}
          onChange={(e) => setBindType(e.target.value)}
          style={{ maxWidth: 220 }}
        >
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
    </>
  );
}

function BindingCard({
  api,
  wsId,
  binding,
}: {
  api: Api;
  wsId: string;
  binding: Binding;
}) {
  const [items, setItems] = useState<ContextItemMeta[] | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <div className="card">
      <div
        className="row"
        style={{ justifyContent: "space-between", cursor: "pointer", margin: 0 }}
        onClick={async () => {
          const next = !open;
          setOpen(next);
          if (next && items === null) {
            try {
              setItems(await api.contextItems(wsId, binding.type));
            } catch {
              setItems([]);
            }
          }
        }}
      >
        <span>
          <b>{binding.type}</b>{" "}
          <span className="muted mono">← {binding.root}</span>
        </span>
        <span className="muted">{open ? "收起" : "查看条目"}</span>
      </div>
      {open && items !== null && (
        <table style={{ marginTop: 8 }}>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td className="muted">（该绑定当前未发现任何条目）</td>
              </tr>
            )}
            {items.map((i) => (
              <tr key={i.id}>
                <td>{i.name}</td>
                <td className="muted">{(i.bytes / 1024).toFixed(1)} KB</td>
                <td className="muted">{i.modifiedAt.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ---------------- Tasks ---------------- */

function TasksTab({
  view,
  instances,
  onLaunch,
}: {
  view: WorkspaceView;
  instances: TaskInstance[];
  onLaunch: (task: string, inputs?: Record<string, unknown>) => void;
}) {
  return (
    <>
      <h2>任务定义</h2>
      {view.tasks.map((t) => (
        <TaskLauncher key={t.id} def={t} onLaunch={(inputs) => onLaunch(t.id, inputs)} />
      ))}
      <h2>任务实例</h2>
      {instances.length === 0 && <div className="empty">尚无任务实例</div>}
      {[...instances].reverse().map((t) => (
        <InstanceCard key={t.id} instance={t} />
      ))}
    </>
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
          <textarea rows={3} value={json} onChange={(e) => setJson(e.target.value)} />
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
      <div className="row" style={{ justifyContent: "space-between", margin: 0 }}>
        <span>
          <b>{instance.taskId}</b>{" "}
          <span className={`pill ${instance.state}`}>{instance.state}</span>
        </span>
        <span className="muted">{instance.updatedAt}</span>
      </div>
      {instance.error && <div className="error-box">{instance.error}</div>}
      {open && (
        <div style={{ marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
          {instance.verification.length > 0 && (
            <table style={{ marginBottom: 10 }}>
              <thead>
                <tr>
                  <th>验证规则</th>
                  <th>方式</th>
                  <th>结论</th>
                </tr>
              </thead>
              <tbody>
                {instance.verification.map((v) => (
                  <tr key={v.id}>
                    <td>{v.id}</td>
                    <td className="muted">{v.kind}</td>
                    <td>
                      <span
                        className={`pill ${v.status === "pending_human" ? "waiting_human" : v.status === "passed" ? "completed" : "failed"}`}
                      >
                        {v.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {instance.result &&
            Object.entries(instance.result.content).map(([cap, text]) => (
              <div key={cap} style={{ marginBottom: 6 }}>
                <div className="muted">{cap}</div>
                <div className="mono">{text}</div>
              </div>
            ))}
          {instance.result && (
            <div className="muted">
              来源（Provenance）: {instance.result.sources.join(", ")}
            </div>
          )}
        </div>
      )}
    </div>
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
                  <span
                    className={`pill ${v.status === "pending_human" ? "waiting_human" : v.status === "passed" ? "completed" : "failed"}`}
                  >
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

/* ---------------- Audit ---------------- */

function AuditTab({
  audit,
  chainOk,
}: {
  audit: AuditEvent[];
  chainOk: boolean | null;
}) {
  const [kindFilter, setKindFilter] = useState("");
  const kinds = useMemo(
    () => Array.from(new Set(audit.map((e) => e.kind))).sort(),
    [audit],
  );
  const rows = kindFilter ? audit.filter((e) => e.kind === kindFilter) : audit;
  return (
    <>
      <h2>
        审计轨迹 · {audit.length} 条
        <span
          className={`chain-badge${chainOk === true ? " ok" : chainOk === false ? " bad" : ""}`}
        >
          {chainOk === null
            ? "校验中…"
            : chainOk
              ? "✓ 哈希链完整（本地重算）"
              : "✗ 哈希链断裂"}
        </span>
      </h2>
      <div className="row">
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          style={{ maxWidth: 260 }}
        >
          <option value="">全部事件（{audit.length}）</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
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
            {rows.map((e, i) => (
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
