/**
 * 项目面板 —— 运行时自持的那几个控制面（概览 / 上下文 / 任务 / 审计，见
 * docs/40-implementation/10-product-integration-guide.md section 6.3）。
 *
 * **分区导航不在这里。** 它是产品自己的导航，所以它在侧栏（产品态 chrome，
 * 见 workbench.tsx）—— 页面里再放一根，屏幕上就并排站着两根。这个文件只按
 * 传进来的 `tab` 渲染对应的分区。
 *
 * 未决确认钉在分区之上：人的决定压过导航（50-harness section 6）。摘要带在
 * 最顶上，把散在四个分区里的事实并成一行。
 *
 * 呈现全部走 DS：SectionHeader、StatusBadge、Table 族。
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
  auditView,
  type StoredAuditEvent,
  type Binding,
  type ConnectorView,
  type ContextItemMeta,
  type FolderGrant,
  type Grant,
  isConnectorGrant,
  type ProjectExport,
  type TaskDef,
  type TaskInstance,
  type ProjectView,
} from "./api";
import { verifyChain } from "./chain";
// TabId/PROJECT_TABS live in their own module (workspace-tabs.ts) so the
// sidebar can know the tab list without pulling in this file's DS-heavy
// ProjectPanel - see that file's header comment (TD-011②).
export { PROJECT_TABS, type TabId } from "./workspace-tabs";
import type { TabId } from "./workspace-tabs";

/**
 * 审计时间的短形式：`MM-DD HH:mm:ss`。
 *
 * 存的是完整 ISO（带毫秒、带时区），那是**记录**该有的样子，不动。这里只改
 * 呈现：毫秒在人读的时候没有用，年份在同一个项目里也不承载信息，而完整串会
 * 把表格行撑到三行高。全量值仍在 title 里。
 */
function shortTime(iso: string): string {
  const m = /^\d{4}-(\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/.exec(iso);
  return m ? `${m[1]} ${m[2]}` : iso;
}

/** 审计结果的呈现。`unknown` 是 X-3 之前的记录，**不知道就是不知道**。 */
const OUTCOME_LABEL: Record<string, string> = {
  success: "成功",
  rejected: "被拒",
  failed: "失败",
  unknown: "结果未记录",
};
const OUTCOME_TONE: Record<string, StatusBadgeTone> = {
  success: "success",
  rejected: "warning",
  failed: "danger",
  unknown: "neutral",
};

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

export function ProjectPanel({
  api,
  id,
  tab,
  onPending,
}: {
  api: Api;
  id: string;
  tab: TabId;
  /** 未决数上报给侧栏：徽章挂在导航条目上，不再另开一条横条。 */
  onPending?: (count: number) => void;
}) {
  const [view, setView] = useState<ProjectView | null>(null);
  const [instances, setInstances] = useState<TaskInstance[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [audit, setAudit] = useState<StoredAuditEvent[]>([]);
  const [chainOk, setChainOk] = useState<boolean | null>(null);
  /**
   * 两种错误分开存，因为它们的寿命不一样。
   *
   * 轮询每 1–5 秒跑一次，成功时清掉自己的错误是对的；但如果它同时清掉**用户
   * 刚点那一下**的失败，那条错误活不过一秒——按钮看起来就是「点了没反应」，
   * 比没有按钮更糟。
   */
  const [pollError, setPollError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const error = actionError ?? pollError;

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
      setPollError(null);
    } catch (e) {
      setPollError(String((e as Error).message));
    }
  }, [api, id]);

  // 任务在请求之外推进，所以进度要靠运行时告诉我们（TD-027）。事件到了就refresh，
  // 于是一个刚落定的任务立刻在屏幕上变样，而不是等下一次轮询。
  //
  // **轮询没有删掉，降成了兜底**：流断掉的样子是「一直没有事件」，而那和
  // 「一切正常」长得一模一样。30 秒一次，静止时几乎不花什么，流断了也不会
  // 让界面停在旧数据上。
  useEffect(() => {
    void refresh();
    const stop = api.subscribe((event) => {
      if (event.kind === "task" && event.projectId !== id) return;
      void refresh();
    });
    const timer = setInterval(() => void refresh(), 30_000);
    return () => {
      stop();
      clearInterval(timer);
    };
  }, [api, id, refresh]);

  const guard = useCallback(
    async (fn: () => Promise<unknown>) => {
      // 上一次动作的结果到此为止：新动作开始时清掉，成功就不再显示，失败则被
      // 下面那条新的替换。
      setActionError(null);
      try {
        await fn();
        await refresh();
      } catch (e) {
        setActionError(String((e as Error).message));
      }
    },
    [refresh],
  );

  const pending = useMemo(
    () => instances.filter((t) => t.state === "waiting_human"),
    [instances],
  );
  useEffect(() => onPending?.(pending.length), [onPending, pending.length]);

  // 首次加载失败时 view 永远是 null——错误盒子在下面 view 非空的分支里，
  // 之前这条路一直卡在"加载中……"，错误说了也白说（`error` 一直有值，用户
  // 却永远看不到）。这里补一条出口：加载不出来就说清，不再无限转圈。
  if (!view) {
    return error ? (
      <div className="error-box">{error}</div>
    ) : (
      <p className="text-body-md text-muted-foreground">加载中……</p>
    );
  }
  return (
    <div className="flex flex-col gap-lg">
      {/* 项目名与产品名已经在标题栏和侧栏里常驻，这里不再重复一遍 —— 重复的
          身份信息不提供任何东西，只占掉首屏。留下的是**只有这里才说得清**的
          那部分：现在处在哪个业务阶段，以及这个项目的标识。 */}
      <ProjectSummary
        view={view}
        instances={instances}
        grants={grants}
        bindings={bindings}
        audit={audit}
        chainOk={chainOk}
      />
      {error && <div className="error-box">{error}</div>}

      {/* 归属为空 = attribution 之前写下的记录。这不是一种受支持的状态，所以
          说清它是什么、以及怎么了结它，而不是让它安静地一直待在列表里。 */}
      {!view.meta.workspaceId && (
        <div className="notice-box">
          <div className="flex flex-col gap-2xs">
            <strong>该项目尚未归属工作区</strong>
            <span className="text-body-sm text-muted-foreground">
              它建于工作区归属启用之前。订阅、权益与数据边界都按工作区划分，
              导入后它才会随工作区一起呈现。
            </span>
          </div>
          <Button
            // guard() 本身成功后就会 refresh()——这里不用再手动追加一次，
            // 不然一次点击悄悄拉两遍全部五个端点。
            onClick={() => void guard(() => api.importProject(id))}
          >
            导入当前工作区
          </Button>
        </div>
      )}

      {pending.map((t) => (
        <CheckpointCard
          key={t.id}
          instance={t}
          onDecide={(approve) => void guard(() => api.decide(id, t.id, approve))}
        />
      ))}

      {tab === "overview" && (
        <OverviewTab
          api={api}
          projectId={id}
          view={view}
          instances={instances}
          onTransition={(to, c) => void guard(() => api.transition(id, to, c))}
        />
      )}
      {tab === "context" && (
        <ContextTab
          api={api}
          projectId={id}
          view={view}
          grants={grants}
          bindings={bindings}
          onAddGrant={(p) => void guard(() => api.addGrant(id, p))}
          onGrantConnector={(c) => void guard(() => api.addConnectorGrant(id, c))}
          onBind={(type, root, via) =>
            void guard(() =>
              via ? api.setBinding(id, type, root, via) : api.setBinding(id, type, root),
            )
          }
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

/**
 * 项目摘要带。
 *
 * 概览页原本最空：真正要看的事实散在四个 tab 后面 —— 有几个任务、几个在等我、
 * 绑了几类资料、授权了几个目录、审计多少条、链完不完整。要知道这些得点四次。
 *
 * 一行讲完。**每一格都是可点的**，点进去就是那个分区 —— 摘要不是一个只能看的
 * 装饰条，它同时是入口。
 */
function ProjectSummary({
  view,
  instances,
  grants,
  bindings,
  audit,
  chainOk,
}: {
  view: ProjectView;
  instances: TaskInstance[];
  grants: Grant[];
  bindings: Binding[];
  audit: StoredAuditEvent[];
  chainOk: boolean | null;
}) {
  const folders = grants.filter((g) => !isConnectorGrant(g)).length;
  const connectorGrants = grants.length - folders;
  const waiting = instances.filter((t) => t.state === "waiting_human").length;
  const running = instances.filter(
    (t) => !TERMINAL_TASK_STATES.has(t.state) && t.state !== "waiting_human",
  ).length;
  return (
    <div className="proj-summary">
      <div className="proj-summary-row">
      <div className="proj-summary-cell">
        <span className="proj-summary-k">阶段</span>
        <StatusBadge tone={stateTone(view.businessState)}>
          {view.businessState}
        </StatusBadge>
      </div>
      <div className="proj-summary-cell">
        <span className="proj-summary-k">任务</span>
        <span className="proj-summary-v">
          {instances.length}
          {waiting > 0 && <em className="proj-summary-flag">{waiting} 待确认</em>}
          {running > 0 && <em className="proj-summary-run">{running} 运行中</em>}
        </span>
      </div>
      <div className="proj-summary-cell">
        <span className="proj-summary-k">资料</span>
        <span className="proj-summary-v">
          {bindings.length} 类 · {folders} 个授权目录
          {/* 连接器授权只在有的时候才说：没有就不占字。 */}
          {connectorGrants > 0 && <> · {connectorGrants} 个连接器</>}
        </span>
      </div>
      <div className="proj-summary-cell">
        <span className="proj-summary-k">审计</span>
        <span className="proj-summary-v">
          {audit.length} 条
          {/* 链状态就摆在条数旁边：一个数字不说自己可不可信，等于没说。 */}
          <em className={chainOk === false ? "proj-summary-flag" : "proj-summary-ok"}>
            {chainOk === null ? "校验中" : chainOk ? "链完整" : "链断裂"}
          </em>
        </span>
      </div>
      </div>
      {/* 第二行是**不需要一眼看到、但需要能看到**的那些：产品与版本（决定契约
          与能力）、容器类型、建于何时、项目标识（报障时要用）。原本它们各占
          一个 45px 的标题加一张 74px 的卡。 */}
      <div className="proj-summary-meta">
        <span>
          {view.product.name} {view.product.version}
        </span>
        <span>{view.meta.projectType}</span>
        <span>建于 {view.meta.createdAt.slice(0, 10)}</span>
        <code>{view.meta.id}</code>
      </div>
    </div>
  );
}

/* ---------------- Overview ---------------- */

function OverviewTab({
  api,
  projectId,
  view,
  instances,
  onTransition,
}: {
  api: Api;
  projectId: string;
  view: ProjectView;
  instances: TaskInstance[];
  onTransition: (to: string, humanConfirmed: boolean) => void;
}) {
  const recent = [...instances].reverse().slice(0, 5);
  return (
    <>
      {/* 没有标题：阶段名就写在阶梯上，再加一行「业务阶段」四个字是纯损耗。 */}
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
      <SectionHeader level={2} title="导出项目记录" icon="folder-open" />
      <ExportCard api={api} projectId={projectId} />
    </>
  );
}

/**
 * 导出项目记录（TD-020）。
 *
 * §18.5 承诺「本地数据仍可访问、可导出」，而在此之前**可导出的那一半界面上
 * 无处可点**：端点在，用户够不着，等于没有。
 */
function ExportCard({ api, projectId }: { api: Api; projectId: string }) {
  const [dir, setDir] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<ProjectExport | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="card flex flex-col gap-sm">
      <div className="text-body-sm text-muted-foreground">
        导出项目档案、契约、业务状态、任务实例与完整审计链。产出文档不在其中
        —— 那些本来就写在你自己的目录里。目录须已授权。
      </div>
      <div className="row">
        <Input
          value={dir}
          placeholder="导出到（已授权的目录）"
          onChange={(e) => setDir(e.target.value)}
        />
        <Button
          disabled={!dir || busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            setDone(null);
            void api
              .exportProject(projectId, dir)
              .then(setDone)
              .catch((e: Error) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "导出中……" : "导出"}
        </Button>
      </div>
      {error && <div className="error-box">{error}</div>}
      {done && (
        <div className="notice-box">
          <div className="flex flex-col gap-2xs">
            <strong>已导出 {done.files.length} 个文件到 {done.path}</strong>
            <span className="text-body-sm text-muted-foreground">
              审计链 {done.chain.events} 条记录，链头 {done.chain.head.slice(0, 12)}…
            </span>
            {/* 照实说：客户端零密钥，签不了。可验篡改，不可归属 —— 两件事
                分开说，别让人以为这份导出已经带了身份。 */}
            <span className="text-body-sm text-muted-foreground">
              {done.signed
                ? "已签名。"
                : "尚未签名：收件人可以验出它有没有被改过，但无法据此确认它出自谁。"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function StateStepper({
  view,
  onTransition,
}: {
  view: ProjectView;
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
  projectId,
  view,
  grants,
  bindings,
  onAddGrant,
  onGrantConnector,
  onBind,
}: {
  api: Api;
  projectId: string;
  view: ProjectView;
  grants: Grant[];
  bindings: Binding[];
  onAddGrant: (path: string) => void;
  onGrantConnector: (connector: string) => void;
  onBind: (type: string, root: string, via?: { connector: string; source: string }) => void;
}) {
  const [grantPath, setGrantPath] = useState("");
  const [bindType, setBindType] = useState("");
  const [bindRoot, setBindRoot] = useState("");
  /** "" = 本地文件夹（local-fs）；否则是一个已授权连接器的 id。 */
  const [bindVia, setBindVia] = useState("");
  const [grantConnector, setGrantConnector] = useState("");
  /**
   * 机器上装了哪些连接器（null = 还没问到 / 这套装配没有）。装是机器级的事，
   * 授权是项目级的事 —— 这里列前者，好让用户把其中的某个授给这个项目。
   */
  const [installed, setInstalled] = useState<ConnectorView[] | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .connectors()
      .then((r) => alive && setInstalled(r.items))
      .catch(() => alive && setInstalled(null));
    return () => {
      alive = false;
    };
  }, [api]);

  const folderGrants = grants.filter((g): g is FolderGrant => !isConnectorGrant(g));
  const connectorGrants = grants.filter(isConnectorGrant);
  const grantable = (installed ?? []).filter(
    (c) => !connectorGrants.some((g) => g.connector === c.id),
  );
  const effectiveGrantConnector = grantConnector || grantable[0]?.id || "";

  const contextTypes = useMemo(
    () => Array.from(new Set(view.tasks.flatMap((t) => t.input_types))),
    [view.tasks],
  );
  const effectiveType = bindType || contextTypes[0] || "";
  const viaConnector = bindVia
    ? (installed ?? []).find((c) => c.id === bindVia)
    : undefined;
  return (
    <>
      <SectionHeader level={2} title="文件授权 · Grants" icon="folder-open" />
      {folderGrants.length === 0 && (
        <EmptyState
          icon="lock"
          title="尚未授权任何文件夹"
          description="Runtime 只能访问你显式授权的目录。"
        />
      )}
      {/* 一条授权是一行字（路径 + 读写模式）。一条一张卡，等于给一行字配
          16px 内边距和一道边框 —— 三条授权就吃掉小半屏。 */}
      {folderGrants.length > 0 && (
        <ul className="row-list">
          {folderGrants.map((g) => (
            <li key={g.id} className="row-item">
              <code className="row-main" title={g.path}>{g.path}</code>
              <span className="row-tag">{g.mode}</span>
            </li>
          ))}
        </ul>
      )}
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

      {/* 连接器授权（ADR-005）：与文件夹授权同级，但只在这台机器装了连接器时才
          出现 —— 一个永远空着的板块是在解释一件用户没有的东西。 */}
      {(installed?.length ?? 0) + connectorGrants.length > 0 && (
        <>
          <SectionHeader level={2} title="连接器授权 · Connectors" icon="plugs-connected" />
          {connectorGrants.length > 0 && (
            <ul className="row-list" aria-label="已授权的连接器">
              {connectorGrants.map((g) => (
                <li key={g.id} className="row-item">
                  <code className="row-main">{g.connector}</code>
                  <span className="row-tag">{g.mode}</span>
                </li>
              ))}
            </ul>
          )}
          {grantable.length > 0 && (
            <div className="row">
              <NativeSelect
                aria-label="要授权的连接器"
                value={effectiveGrantConnector}
                onChange={(e) => setGrantConnector(e.target.value)}
                wrapperClassName="sel-narrow"
              >
                {grantable.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id}（{c.source}{c.health.ok ? "" : "，未运行"}）
                  </option>
                ))}
              </NativeSelect>
              <Button
                disabled={!effectiveGrantConnector}
                onClick={() => {
                  onGrantConnector(effectiveGrantConnector);
                  setGrantConnector("");
                }}
              >
                授权连接器
              </Button>
            </div>
          )}
        </>
      )}

      <SectionHeader level={2} title="类型绑定 · Bindings" icon="plugs-connected" />
      {bindings.map((b) => (
        <BindingCard key={b.type} api={api} projectId={projectId} binding={b} />
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
        {/* 经由什么：只在有已授权连接器时才多出这个选择 —— 没有的话就是本地
            文件夹，和从前一样，不多问一句。 */}
        {connectorGrants.length > 0 && (
          <NativeSelect
            aria-label="经由"
            value={bindVia}
            onChange={(e) => setBindVia(e.target.value)}
            wrapperClassName="sel-narrow"
          >
            <option value="">本地文件夹</option>
            {connectorGrants.map((g) => (
              <option key={g.id} value={g.connector}>
                连接器 {g.connector}
              </option>
            ))}
          </NativeSelect>
        )}
        <Input
          value={bindRoot}
          onChange={(e) => setBindRoot(e.target.value)}
          placeholder={bindVia ? "资源 URI 前缀（如 crm://accounts/）" : "已授权文件夹内的路径"}
        />
        <Button
          variant="outline"
          disabled={!effectiveType || !bindRoot}
          onClick={() => {
            onBind(
              effectiveType,
              bindRoot,
              // 连接器装了又卸了、授权还在：来源种类不知道，交给内核拒绝，
              // 而不是在这里猜一个。
              bindVia
                ? { connector: bindVia, source: viaConnector?.source ?? "lan" }
                : undefined,
            );
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
  projectId,
  binding,
}: {
  api: Api;
  projectId: string;
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
              setItems(await api.contextItems(projectId, binding.type));
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
          {/* 经连接器的绑定说明经的是谁：「crm://accounts/」这样的地址本身不说
              它从哪个连接器来，而两个连接器可以暴露同一个地址。 */}
          {binding.connector !== "local-fs" && (
            <span className="row-tag" style={{ marginLeft: 8 }}>
              连接器 {binding.connector} · {binding.source}
            </span>
          )}
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
  view: ProjectView;
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
  def: TaskDef;
  onLaunch: (inputs?: Record<string, unknown>) => void;
}) {
  const [manual, setManual] = useState(false);
  const [json, setJson] = useState("{}");
  const [jsonError, setJsonError] = useState<string | null>(null);
  // 运行时会当场拒绝这个任务；那就别把「启动」摆在这里等人去点。
  const blocked = def.unrunnable.length > 0;
  return (
    <div className="card">
      <div style={{ fontWeight: 600 }}>{def.id}</div>
      <div className="text-body-sm text-muted-foreground">
        {def.objective} · 输入类型: {def.input_types.join(", ") || "（无）"}
      </div>
      {blocked && (
        <div className="error-box">
          本机跑不了这个任务：还没有实现 {def.unrunnable.join("、")}
        </div>
      )}
      <div className="row" style={{ marginTop: 6 }}>
        <Button disabled={blocked} onClick={() => onLaunch(undefined)}>
          启动（自动选择上下文）
        </Button>
        <Button
          variant="outline"
          disabled={blocked}
          onClick={() => setManual(!manual)}
        >
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
          ? // 说清用户在批准什么：资料会作为「材料」送出去做推理，而其中
            // 任何看起来像指示的文字都不会被当作指示执行。
            "含高敏感项，执行前需要你确认。这些文件将作为资料送出用于推理——其中任何看起来像指令的文字都不会被执行"
          : kind === "tool_ask"
            ? "该调用由模型在读过下列资料之后提出，请据此判断"
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
  audit: StoredAuditEvent[];
  chainOk: boolean | null;
}) {
  const [kindFilter, setKindFilter] = useState("");
  // 显示走投影，重算走原样 —— 链的哈希是按存进去时的字段名算的。
  const views = useMemo(() => audit.map(auditView), [audit]);
  const kinds = useMemo(
    () => Array.from(new Set(views.map((e) => e.action))).sort(),
    [views],
  );
  const rows = kindFilter
    ? views.filter((e) => e.action === kindFilter)
    : views;
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
              <TableHead>时间</TableHead>
              <TableHead>动作</TableHead>
              <TableHead>结果</TableHead>
              <TableHead>操作者</TableHead>
              <TableHead>payload</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((e, i) => (
              <TableRow key={e.eventId} className="audit-row">
                <TableCell className="audit-idx">{i + 1}</TableCell>
                {/* 完整 ISO 带毫秒会换到三行，而毫秒在这里没有用；同一个项目里
                    年份也不承载信息。鼠标悬停仍给全量值。 */}
                <TableCell className="audit-time" title={e.occurredAt}>
                  {shortTime(e.occurredAt)}
                </TableCell>
                <TableCell className="audit-action">{e.action}</TableCell>
                <TableCell>
                  {/* 旧记录的结果是 unknown —— 显示成 unknown，不显示成成功。 */}
                  <StatusBadge tone={OUTCOME_TONE[e.outcome] ?? "neutral"}>
                    {OUTCOME_LABEL[e.outcome] ?? e.outcome}
                  </StatusBadge>
                </TableCell>
                <TableCell className="audit-action">{e.actor}</TableCell>
                {/* payload 是原始 JSON，长度无上限。一行显示、溢出省略，全量在
                    title 里 —— 让它撑开行高，等于让八条记录占满一屏。 */}
                <TableCell className="audit-payload" title={JSON.stringify(e.payload)}>
                  {JSON.stringify(e.payload)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
