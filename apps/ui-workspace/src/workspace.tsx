/**
 * Workspace panel - sectioned into functional tabs (概览 / 上下文 / 任务 /
 * 审计) per the runtime-owned control surfaces of
 * docs/40-implementation/10-product-integration-guide.md section 6.3.
 * Pending checkpoints stay pinned above the tabs: human decisions outrank
 * navigation (50-harness section 6). Presentation is DS-native: SectionHeader
 * ladder, SegmentedControl tab switch, StatusBadge tones, Table family.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  EmptyState,
  Input,
  NativeSelect,
  PanelCard,
  SectionHeader,
  SegmentedControl,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  type StatusBadgeTone,
} from "@vxture/design-system";
import {
  Api,
  pendingCheckpoint,
  type AuditEvent,
  type Binding,
  type ContextItemMeta,
  type FolderGrant,
  type TaskInstance,
  type WorkspaceView,
} from "./api";
import { verifyChain } from "./chain";

type TabId = "overview" | "context" | "tasks" | "audit";

/** Task states that will never change again on their own. */
const TERMINAL_TASK_STATES = new Set(["completed", "failed", "cancelled"]);

/** Business/task states → tone. Severity mapping is the product's judgment
 *  (DS tone doc): waiting on a human is a warning-grade signal here. */
function stateTone(state: string): StatusBadgeTone {
  if (state === "completed" || state === "passed") return "success";
  if (state === "failed") return "danger";
  if (state === "waiting_human" || state === "pending_human") return "warning";
  // Parked on someone else's outage, not a failure of this task - it will be
  // picked up again, so it reads as "waiting", not "broken".
  if (state === "suspended") return "warning";
  if (state === "running" || state === "selecting" || state === "executing")
    return "info";
  return "neutral";
}

/** What the user is actually looking at, in their words. */
const TASK_STATE_LABEL: Record<string, string> = {
  created: "待启动",
  selecting: "选取资料中",
  executing: "执行中",
  verifying: "校验中",
  finalizing: "收尾中",
  waiting_human: "等待确认",
  suspended: "已暂停（服务暂时不可用）",
  completed: "已完成",
  failed: "已失败",
  cancelled: "已取消",
};

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

  // Tasks now run outside the request that started them, so the only way to
  // see progress is to ask. Poll fast while something is actually moving,
  // slowly when nothing is - a five-second lag on a running task reads as
  // "nothing happened".
  const active = useMemo(
    () =>
      instances.some(
        (t) => !TERMINAL_TASK_STATES.has(t.state) && t.state !== "waiting_human",
      ),
    [instances],
  );

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), active ? 1000 : 5000);
    return () => clearInterval(timer);
  }, [refresh, active]);

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

  if (!view) return <p className="text-body-md text-muted-foreground">加载中……</p>;
  return (
    <div className="flex flex-col gap-lg">
      <SectionHeader
        level={1}
        icon="cube"
        title={view.meta.name}
        titleSuffix={
          <StatusBadge tone={stateTone(view.businessState)}>
            {view.businessState}
          </StatusBadge>
        }
        description={`${view.product.name} ${view.product.version} · ${view.meta.id}`}
      />
      {error && <div className="error-box">{error}</div>}

      {pending.map((t) => (
        <CheckpointCard
          key={t.id}
          instance={t}
          onDecide={(approve) => void guard(() => api.decide(id, t.id, approve))}
        />
      ))}

      <SegmentedControl<TabId>
        ariaLabel="工作空间板块"
        items={[
          { value: "overview", label: "概览" },
          { value: "context", label: "上下文" },
          {
            value: "tasks",
            label: "任务",
            ...(pending.length > 0 ? { count: pending.length } : {}),
          },
          { value: "audit", label: "审计" },
        ]}
        value={tab}
        onChange={setTab}
      />

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
    </div>
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
      <SectionHeader level={2} title="业务阶段" icon="workflow" />
      <StateStepper view={view} onTransition={onTransition} />
      <SectionHeader level={2} title="最近任务" icon="clock-counter-clockwise" />
      {recent.length === 0 && (
        <EmptyState icon="list-checks" title="尚无任务执行记录" />
      )}
      {recent.map((t) => (
        <div key={t.id} className="card">
          <b>{t.taskId}</b>{" "}
          <StatusBadge tone={stateTone(t.state)}>
            {TASK_STATE_LABEL[t.state] ?? t.state}
          </StatusBadge>
          <span className="text-body-sm text-muted-foreground ml-sm">
            {t.updatedAt}
          </span>
        </div>
      ))}
      <SectionHeader level={2} title="产品" icon="package" />
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
          <span className="text-body-sm text-muted-foreground">推进：</span>
          {transitions.map((t) => (
            <Button
              variant="outline"
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
            </Button>
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
      <SectionHeader level={2} title="文件授权 · Grants" icon="folder-open" />
      {grants.length === 0 && (
        <EmptyState
          icon="lock"
          title="尚未授权任何文件夹"
          description="Runtime 只能访问你显式授权的目录。"
        />
      )}
      {grants.map((g) => (
        <div key={g.id} className="card mono">
          {g.path}{" "}
          <span className="text-body-sm text-muted-foreground">({g.mode})</span>
        </div>
      ))}
      <div className="row">
        <Input
          value={grantPath}
          onChange={(e) => setGrantPath(e.target.value)}
          placeholder="文件夹绝对路径"
        />
        <Button
          disabled={!grantPath}
          onClick={() => {
            onAddGrant(grantPath);
            setGrantPath("");
          }}
        >
          授权
        </Button>
      </div>

      <SectionHeader level={2} title="类型绑定 · Bindings" icon="plugs-connected" />
      {bindings.map((b) => (
        <BindingCard key={b.type} api={api} wsId={wsId} binding={b} />
      ))}
      <div className="row">
        <NativeSelect
          value={effectiveType}
          onChange={(e) => setBindType(e.target.value)}
          wrapperClassName="sel-narrow"
        >
          {contextTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </NativeSelect>
        <Input
          value={bindRoot}
          onChange={(e) => setBindRoot(e.target.value)}
          placeholder="已授权文件夹内的路径"
        />
        <Button
          variant="outline"
          disabled={!effectiveType || !bindRoot}
          onClick={() => {
            onBind(effectiveType, bindRoot);
            setBindRoot("");
          }}
        >
          绑定并索引
        </Button>
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
          <span className="text-body-sm text-muted-foreground mono">
            ← {binding.root}
          </span>
        </span>
        <span className="text-body-sm text-muted-foreground">
          {open ? "收起" : "查看条目"}
        </span>
      </div>
      {open && items !== null && (
        <Table className="mt-sm">
          <TableBody>
            {items.length === 0 && (
              <TableRow>
                <TableCell className="text-muted-foreground">
                  （该绑定当前未发现任何条目）
                </TableCell>
              </TableRow>
            )}
            {items.map((i) => (
              <TableRow key={i.id}>
                <TableCell>{i.name}</TableCell>
                <TableCell className="text-muted-foreground">
                  {(i.bytes / 1024).toFixed(1)} KB
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {i.modifiedAt.slice(0, 10)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
      {/* 智能在这里：业务契约声明的 AI 任务（Harness 执行 + 人工检查点），
          不是壳级助手（20-specs/10 §1.3 定位）。 */}
      <SectionHeader level={2} title="任务定义" icon="sparkles" />
      {view.tasks.map((t) => (
        <TaskLauncher key={t.id} def={t} onLaunch={(inputs) => onLaunch(t.id, inputs)} />
      ))}
      <SectionHeader level={2} title="任务实例" icon="list-checks" />
      {instances.length === 0 && (
        <EmptyState icon="circle-dashed" title="尚无任务实例" />
      )}
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
      <div className="text-body-sm text-muted-foreground">
        {def.objective} · 输入类型: {def.input_types.join(", ") || "（无）"}
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <Button onClick={() => onLaunch(undefined)}>
          启动（自动选择上下文）
        </Button>
        <Button variant="outline" onClick={() => setManual(!manual)}>
          {manual ? "收起手动模式" : "手动提供输入"}
        </Button>
      </div>
      {manual && (
        <>
          <Textarea rows={3} value={json} onChange={(e) => setJson(e.target.value)} />
          {jsonError && <div className="error-box">{jsonError}</div>}
          <Button
            variant="outline"
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
          </Button>
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
          <StatusBadge tone={stateTone(instance.state)}>
            {instance.state}
          </StatusBadge>
        </span>
        <span className="text-body-sm text-muted-foreground">
          {instance.updatedAt}
        </span>
      </div>
      {instance.error && <div className="error-box">{instance.error}</div>}
      {open && (
        <div style={{ marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
          {instance.verification.length > 0 && (
            <Table className="mb-sm">
              <TableHeader>
                <TableRow>
                  <TableHead>验证规则</TableHead>
                  <TableHead>方式</TableHead>
                  <TableHead>结论</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {instance.verification.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell>{v.id}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {v.kind}
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={stateTone(v.status)}>
                        {v.status}
                      </StatusBadge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {instance.result &&
            Object.entries(instance.result.content).map(([cap, text]) => (
              <div key={cap} style={{ marginBottom: 6 }}>
                <div className="text-body-sm text-muted-foreground">{cap}</div>
                <div className="mono">{text}</div>
              </div>
            ))}
          {instance.result && (
            <div className="text-body-sm text-muted-foreground">
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
  const kind = pendingCheckpoint(instance)?.kind ?? "verification_review";
  return (
    <PanelCard
      tone="warning"
      icon="shield-warning"
      title={
        kind === "context_confirm"
          ? `任务「${instance.taskId}」请求使用以下上下文`
          : kind === "tool_ask"
            ? `任务「${instance.taskId}」请求执行一个工具`
            : `任务「${instance.taskId}」的成果等待人工评审`
      }
      description={
        kind === "context_confirm"
          ? "含高敏感项，执行前需要你确认（context_confirm 门）"
          : "验证结论如下，批准后任务继续"
      }
      action={
        <div className="flex items-center gap-xs">
          <Button onClick={() => onDecide(true)}>批准</Button>
          <Button
            variant="destructive"
            confirmExempt="Checkpoint 决策本身就是人工确认步骤（50-harness §6），无需二次弹窗"
            onClick={() => onDecide(false)}
          >
            拒绝
          </Button>
        </div>
      }
    >
      {kind === "context_confirm" ? (
        <Table>
          <TableBody>
            {(instance.contextSet ?? []).map((i) => (
              <TableRow key={i.id}>
                <TableCell>{i.name}</TableCell>
                <TableCell className="text-muted-foreground">{i.type}</TableCell>
                <TableCell className="text-muted-foreground">
                  {(i.bytes / 1024).toFixed(1)} KB
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <Table>
          <TableBody>
            {instance.verification.map((v) => (
              <TableRow key={v.id}>
                <TableCell>{v.id}</TableCell>
                <TableCell>
                  <StatusBadge tone={stateTone(v.status)}>{v.status}</StatusBadge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {v.note ?? ""}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </PanelCard>
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
      <SectionHeader
        level={2}
        icon="fingerprint"
        title={`审计轨迹 · ${audit.length} 条`}
        titleSuffix={
          <StatusBadge
            tone={chainOk === true ? "success" : chainOk === false ? "danger" : "neutral"}
          >
            {chainOk === null
              ? "校验中…"
              : chainOk
                ? "哈希链完整（本地重算）"
                : "哈希链断裂"}
          </StatusBadge>
        }
      />
      <div className="row">
        <NativeSelect
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          wrapperClassName="sel-audit"
        >
          <option value="">全部事件（{audit.length}）</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="card audit-scroll">
        <Table className="audit-table">
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>kind</TableHead>
              <TableHead>actor</TableHead>
              <TableHead>payload</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((e, i) => (
              <TableRow key={e.event_id}>
                <TableCell>{i + 1}</TableCell>
                <TableCell>{e.kind}</TableCell>
                <TableCell>{e.actor}</TableCell>
                <TableCell>{JSON.stringify(e.payload)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
