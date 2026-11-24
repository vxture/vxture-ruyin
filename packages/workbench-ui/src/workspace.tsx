import {ProjectLibrary} from './project-library.js';
import {PRODUCT_REVIEW_EVENT} from './product-navigation.js';
/**
 * 项目面板 —— 运行时自持的那几个控制面（概览 / 上下文 / 任务 / 审计，见
 * docs/40-implementation/10-product-integration-guide.md section 6.3）。
 *
 * **分区导航不在这里。** 它是产品自己的导航，所以它在侧栏（产品态 chrome，
 * 见 workbench.tsx）—— 页面里再放一根，屏幕上就并排站着两根。这个文件只按
 * 传进来的 `tab` 渲染对应的分区。
 *
 * 确认权归宿主：业务页通过独立确认面板处理待办，不把运行时卡片铺在正文上方。
 * 配置页面保留运行详情；移动呈现位置不替人批准任何操作。
 *
 * 呈现全部走 DS：SectionHeader、StatusBadge、Table 族。
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
  type ToolPolicyRow,
  type ProjectFile,
  type ProjectView,
  type StateRequest,
} from "./api.js";
import { ProductTab } from "./product-surface.js";
import type { SurfaceInfo } from "./product-surface-info.js";
import { verifyChain } from "./chain.js";
import { useT, type MessageKey, type TFn } from "./i18n.js";
// TabId/PROJECT_TABS live in their own module (workspace-tabs.ts) so the
// sidebar can know the tab list without pulling in this file's DS-heavy
// ProjectPanel - see that file's header comment (TD-011②).
export { PROJECT_TABS, type TabId } from "./workspace-tabs.js";
import { PROJECT_TABS, type TabId } from "./workspace-tabs.js";

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
const OUTCOME_KEY: Record<string, MessageKey> = {
  success: "ws.outcome.success",
  rejected: "ws.outcome.rejected",
  failed: "ws.outcome.failed",
  unknown: "ws.outcome.unknown",
};
/** 认得的结果给它那句话；不认得的原样显示 —— **不知道就是不知道**。 */
function outcomeLabel(t: TFn, outcome: string): string {
  const key = OUTCOME_KEY[outcome];
  return key ? t(key) : outcome;
}

/** 同上：没见过的状态原样显示，不悄悄吞掉。 */
export function taskStateLabel(t: TFn, state: string): string {
  const key = TASK_STATE_KEY[state];
  return key ? t(key) : state;
}

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
const TASK_STATE_KEY: Record<string, MessageKey> = {
  created: "ws.task.created",
  selecting: "ws.task.selecting",
  executing: "ws.task.executing",
  verifying: "ws.task.verifying",
  finalizing: "ws.task.finalizing",
  waiting_human: "ws.task.waiting_human",
  suspended: "ws.task.suspended",
  completed: "ws.task.completed",
  failed: "ws.task.failed",
  cancelled: "ws.task.cancelled",
};

export function ProjectPanel({
  api,
  id,
  tab,
  onPending,
  surface,
  onReloadSurface,
  productView,
  contextView,
  exportView,
}: {
  api: Api;
  productView?: ReactNode;
  contextView?: ReactNode;
  exportView?: ReactNode;
  id: string;
  tab: TabId;
  /** 未决数上报给侧栏：徽章挂在导航条目上，不再另开一条横条。 */
  onPending?: (count: number) => void;
  /**
   * 产品有没有自己的界面 —— 侧栏已经问过一次（列不列那一格、默认进哪），这里用
   * 同一份回答，不再各问各的：两份回答不一致时，侧栏列着那一格、点进去却说没有。
   */
  surface?: SurfaceInfo | null | undefined;
  /** 「重新获取」之后让上层再问一次。 */
  onReloadSurface?: () => void;
}) {
  const t = useT();
  const [view, setView] = useState<ProjectView | null>(null);
  const [instances, setInstances] = useState<TaskInstance[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [audit, setAudit] = useState<StoredAuditEvent[]>([]);
  const [chainOk, setChainOk] = useState<boolean | null>(null);
  /** 产品界面提出、等人确认的推进（ADR-022 片四）。 */
  const [stateRequest, setStateRequest] = useState<StateRequest | null>(null);
  const [batchJobs,setBatchJobs]=useState<Awaited<ReturnType<Api["backgroundJobs"]>>>([]);
  const [reviewRequest,setReviewRequest]=useState<{taskInstanceId:string;serial:number}|null>(null);
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
      const [v, ti, g, b, a, sr, jobs] = await Promise.all([
        api.workspace(id),
        api.taskInstances(id),
        api.grants(id),
        api.bindings(id),
        api.audit(id),
        // 问不到就当没有：这张卡是附加的，不该因为它把整个项目面板拖成错误。
        api.stateRequest(id).then((r) => r.pending, () => null),
        api.backgroundJobs?.(id).catch(()=>[])??Promise.resolve([]),
      ]);
      setView(v);
      setInstances(ti);
      setGrants(g);
      setBindings(b);
      setAudit(a);
      setStateRequest(sr);
      setBatchJobs(jobs);
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
      if ((event.kind === "task" || event.kind === "project") && event.projectId !== id) return;
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
    () => instances.filter(task => {
      if (task.state !== "waiting_human") return false;
      const checkpoint = pendingCheckpoint(task);
      if (checkpoint?.kind !== "context_confirm") return true;
      // Only the host's exact task/checkpoint pair can consolidate this prompt.
      // No ownership is guessed from a product/task label or a shared context type.
      return !batchJobs.some(job => job.approvable && ["running", "waiting", "paused"].includes(job.state) &&
        (job.contextConfirmations ?? []).some(pair => pair.taskInstanceId === task.id && pair.checkpointId === checkpoint.id));
    }),
    [instances, batchJobs],
  );
  const confirmationCount = pending.length + batchJobs.filter(needsBatchApproval).length + (stateRequest ? 1 : 0);
  useEffect(() => onPending?.(confirmationCount), [onPending, confirmationCount]);
  useEffect(() => {
    let active = true;
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{projectId:string;taskInstanceId:string}>).detail;
      if (detail.projectId !== id) return;
      void api.taskInstances(id).then(items => {
        if (!active) return;
        const task = items.find(item => item.id === detail.taskInstanceId && item.state === "waiting_human" && pendingCheckpoint(item)?.kind === "verification_review");
        if (!task) {setActionError(t("ws.actions.reviewUnavailable"));return;}
        setInstances(items);
        setReviewRequest(previous => ({taskInstanceId:task.id,serial:(previous?.serial ?? 0)+1}));
      }).catch(() => {if (active) setActionError(t("ws.actions.reviewUnavailable"));});
    };
    window.addEventListener(PRODUCT_REVIEW_EVENT,receive);
    return () => {active=false;window.removeEventListener(PRODUCT_REVIEW_EVENT,receive);};
  },[api,id,t]);

  // 首次加载失败时 view 永远是 null——错误盒子在下面 view 非空的分支里，
  // 之前这条路一直卡在"加载中……"，错误说了也白说（`error` 一直有值，用户
  // 却永远看不到）。这里补一条出口：加载不出来就说清，不再无限转圈。
  if (!view) {
    return error ? (
      <div className="error-box">{error}</div>
    ) : (
      <p className="text-body-md text-muted-foreground">{t("ws.loading")}</p>
    );
  }
  const confirmations = <>
    {stateRequest && <StateRequestCard
      productName={view.product.name} request={stateRequest} current={view.businessState}
      onDecide={approve => void guard(() => api.decideStateRequest(id, stateRequest.to, approve))}
    />}
    <BatchContextApproval jobs={batchJobs} onApprove={j => void guard(() => api.approveJobContext(id, j.id, j.requestHash))}/>
    {[...pending].sort((a,b)=>Number(b.id===reviewRequest?.taskInstanceId)-Number(a.id===reviewRequest?.taskInstanceId)).map(instance => <CheckpointCard key={instance.id} instance={instance} taskName={view.tasks.find(task=>task.id===instance.taskId)?.name} businessAdoption={instance.id===reviewRequest?.taskInstanceId}
      onDecide={approve => void guard(() => api.decide(id, instance.id, approve))}/>) }
  </>;
  return (
    <div className="flex flex-col gap-lg">
      {/* 项目名与产品名已经在标题栏和侧栏里常驻，这里不再重复一遍 —— 重复的
          身份信息不提供任何东西，只占掉首屏。留下的是**只有这里才说得清**的
          那部分：现在处在哪个业务阶段，以及这个项目的标识。 */}
      {chainOk === false && <strong className="error-box">{t("ws.integrityWarning")}</strong>}
      {error && <div className="error-box">{error}</div>}

      {/* 归属为空 = attribution 之前写下的记录。这不是一种受支持的状态，所以
          说清它是什么、以及怎么了结它，而不是让它安静地一直待在列表里。 */}
      {!view.meta.workspaceId && (
        <div className="notice-box">
          <div className="flex flex-col gap-2xs">
            <strong>{t("ws.unattributed.title")}</strong>
            <span className="text-body-sm text-muted-foreground">
              {t("ws.unattributed.body")}
            </span>
          </div>
          <Button
            // guard() 本身成功后就会 refresh()——这里不用再手动追加一次，
            // 不然一次点击悄悄拉两遍全部五个端点。
            onClick={() => void guard(() => api.importProject(id))}
          >
            {t("ws.unattributed.import")}
          </Button>
        </div>
      )}

      {/* 智能体有新版本、但它删了本项目在用的东西：项目留在旧版（ADR-024）。如实说一行 ——
          不说的话，用户会以为新版本的功能坏了。 */}
      {view.upgradeBlocked && (
        <div className="notice-box">
          <span className="text-body-sm">
            {t("ws.upgradeBlocked", {
              version: view.upgradeBlocked.version,
              breaks: describeBreaks(view.upgradeBlocked.breaks, t),
              current: view.meta.productVersion,
            })}
          </span>
        </div>
      )}

      {/* 归档的项目：只读。说清楚是什么、能做什么，恢复入口就在这里（契约声明了 restore 时）。 */}
      {view.meta.archivedAt && (
        <div className="notice-box">
          <div className="flex flex-col gap-2xs">
            <strong>{t("ws.archived.title", { at: shortTime(view.meta.archivedAt) })}</strong>
            <span className="text-body-sm text-muted-foreground">
              {t("ws.archived.body")}
            </span>
          </div>
          {view.operations.includes("restore") && (
            <Button onClick={() => void guard(() => api.restoreProject(id))}>
              {t("ws.archived.restore")}
            </Button>
          )}
        </div>
      )}

      {tab === "product"
        ? <ProjectActionPanel count={confirmationCount} error={actionError} openRequest={reviewRequest}>{confirmations}</ProjectActionPanel>
        : confirmations}

      {tab !== "product" && (
        <section className="project-settings-header"><h1 className="project-settings-title">{t('flow.settings')}</h1><nav aria-label={t('flow.settings')} className="project-config-nav">
          {PROJECT_TABS.map(item => <a key={item.id} href={'#ws/'+id+'/'+item.id} aria-current={tab === item.id ? 'page' : undefined}>{t(item.labelKey)}</a>)}
        </nav></section>
      )}
      {tab === "overview" && <ProjectLibrary api={api} projectId={id} productId={view.meta.productId} archived={!!view.meta.archivedAt}/> }
      {tab === "overview" && <ProjectSummary view={view} instances={instances} grants={grants} bindings={bindings} audit={audit} chainOk={chainOk}/>}
      {tab === "overview" && (
        <OverviewTab
          contextView={contextView}
          exportView={exportView}
          api={api}
          projectId={id}
          view={view}
          instances={instances}
          onTransition={(to, c) => void guard(() => api.transition(id, to, c))}
          onArchive={() => void guard(() => api.archiveProject(id))}
        />
      )}
      {/* 产品占完整画布；确认面板由宿主在 iframe 外管理，产品不能自行批准或隐藏待办。 */}
      {tab === "product" && (productView ?? (
        <ProductTab
          api={api}
          projectId={id}
          productId={view.meta.productId}
          surface={surface}
          onReload={() => onReloadSurface?.()}
        />
      ))}
      {tab === "context" && (
        <ReadOnlyWhenArchived archived={!!view.meta.archivedAt}>
        {contextView ?? <ContextTab
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
        />}
        </ReadOnlyWhenArchived>
      )}
      {tab === "tasks" && (
        <ReadOnlyWhenArchived archived={!!view.meta.archivedAt}>
        <TasksTab
          view={view}
          instances={instances}
          businessUi={!!surface?.available}
          onLaunch={(task, inputs) =>
            void guard(() => api.startTask(id, task, inputs))
          }
        />
        </ReadOnlyWhenArchived>
      )}
      {tab === "audit" && <AuditTab audit={audit} chainOk={chainOk} />}
    </div>
  );
}

/** Runtime-owned controls stay available without displacing the business canvas. */
function ProjectActionPanel({count, error, openRequest, children}: {count: number; error: string | null; openRequest: object | null; children: ReactNode}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  useEffect(()=>{if(openRequest)setOpen(true);},[openRequest]);
  if (!count && !open) return null;
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button className="project-actions-trigger">
      {t("ws.actions.open", {count})}
    </Button></DialogTrigger>
    <DialogContent className="project-actions-dialog">
      <DialogHeader>
        <DialogTitle>{t("ws.actions.title")}</DialogTitle>
        <DialogDescription>{t("ws.actions.description")}</DialogDescription>
      </DialogHeader>
      <div className="project-actions-body">
        {error && <p role="alert" className="error-box">{error}</p>}
        {count ? children : <p role="status">{t("ws.actions.empty")}</p>}
      </div>
    </DialogContent>
  </Dialog>;
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
  const t = useT();
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
        <span className="proj-summary-k">{t("ws.summary.stage")}</span>
        <StatusBadge tone={stateTone(view.businessState)}>
          {view.businessState}
        </StatusBadge>
      </div>
      <div className="proj-summary-cell">
        <span className="proj-summary-k">{t("ws.summary.tasks")}</span>
        <span className="proj-summary-v">
          {instances.length}
          {waiting > 0 && (
            <em className="proj-summary-flag">{t("ws.summary.waiting", { n: waiting })}</em>
          )}
          {running > 0 && (
            <em className="proj-summary-run">{t("ws.summary.running", { n: running })}</em>
          )}
        </span>
      </div>
      <div className="proj-summary-cell">
        <span className="proj-summary-k">{t("ws.summary.materials")}</span>
        <span className="proj-summary-v">
          {t("ws.summary.bindings", { types: bindings.length, folders })}
          {/* 连接器授权只在有的时候才说：没有就不占字。 */}
          {connectorGrants > 0 && <>{t("ws.summary.connectors", { n: connectorGrants })}</>}
        </span>
      </div>
      <div className="proj-summary-cell">
        <span className="proj-summary-k">{t("ws.summary.audit")}</span>
        <span className="proj-summary-v">
          {t("ws.summary.auditCount", { n: audit.length })}
          {/* 链状态就摆在条数旁边：一个数字不说自己可不可信，等于没说。 */}
          <em className={chainOk === false ? "proj-summary-flag" : "proj-summary-ok"}>
            {t(
              chainOk === null
                ? "ws.summary.verifying"
                : chainOk
                  ? "ws.summary.chainOk"
                  : "ws.summary.chainBroken",
            )}
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
        <span>{t("ws.summary.createdAt", { date: view.meta.createdAt.slice(0, 10) })}</span>
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
  onArchive,
  contextView,
  exportView,
}: {
  api: Api;
  projectId: string;
  view: ProjectView;
  instances: TaskInstance[];
  contextView?: ReactNode;
  exportView?: ReactNode;
  onTransition: (to: string, humanConfirmed: boolean) => void;
  onArchive: () => void;
}) {
  const t = useT();
  const recent = [...instances].reverse().slice(0, 5);
  const archived = !!view.meta.archivedAt;
  return (
    <>
      {/* 没有标题：阶段名就写在阶梯上，再加一行「业务阶段」四个字是纯损耗。 */}
      <ReadOnlyWhenArchived archived={archived}>
        <StateStepper view={view} onTransition={onTransition} />
      </ReadOnlyWhenArchived>
      <SectionHeader level={2} title={t("ws.recentTasks")} icon="clock-counter-clockwise" />
      {recent.length === 0 && (
        <EmptyState icon="list-checks" title={t("ws.recentTasks.empty")} />
      )}
      {/* map 的参数原先叫 `t`，会盖住翻译函数；改叫 `run`（一次任务执行）。 */}
      {recent.map((run) => (
        <div key={run.id} className="card">
          <b>{view.tasks.find(task=>task.id===run.taskId)?.name || run.taskId}</b>{" "}
          <StatusBadge tone={stateTone(run.state)}>
            {taskStateLabel(t, run.state)}
          </StatusBadge>
          <span className="text-body-sm text-muted-foreground ml-sm">
            {run.updatedAt}
          </span>
        </div>
      ))}
      <SectionHeader level={2} title={t("ws.export.title")} icon="folder-open" />
      {exportView ?? <ExportCard api={api} projectId={projectId} />}
      {contextView}
      {/* 归档入口：契约声明了 archive 才有（容器能做什么由产品的契约定）。 */}
      {!archived && view.operations.includes("archive") && (
        <>
          <SectionHeader level={2} title={t("ws.archive.title")} icon="archive" />
          <div className="card flex items-center justify-between gap-md">
            <span className="text-body-sm text-muted-foreground">
              {t(
                view.operations.includes("restore")
                  ? "ws.archive.descRestorable"
                  : "ws.archive.descOneWay",
              )}
            </span>
            <Button onClick={onArchive}>{t("ws.archive.run")}</Button>
          </div>
        </>
      )}
    </>
  );
}

/** 契约里各段的叫法（给人看的，不是给机器看的）。 */
const BREAK_SECTION_KEY: Record<string, MessageKey> = {
  objects: "ws.break.objects",
  states: "ws.break.states",
  context: "ws.break.context",
  capabilities: "ws.break.capabilities",
  tools: "ws.break.tools",
  tasks: "ws.break.tasks",
  project: "ws.break.project",
};

/**
 * 新版本删了 / 改窄了什么，压成一句：前三处点名，其余说「等 N 处」。
 * `tasks.generate_proposal` → 「任务 generate_proposal」；`context.types.x` → 「资料类型 x」。
 */
export function describeBreaks(
  breaks: ReadonlyArray<{ path: string; change: string }>,
  t: TFn,
): string {
  const sep = t("common.listSep");
  const named = breaks.slice(0, 3).map(({ path }) => {
    const [section = "", ...rest] = path.split(".");
    const tail = (section === "context" ? rest.slice(1) : rest)[0] ?? "";
    const head = BREAK_SECTION_KEY[section] ? t(BREAK_SECTION_KEY[section]) : section;
    return `${head} ${tail}`.trim();
  });
  return breaks.length > 3
    ? t("ws.break.more", { named: named.join(sep), count: breaks.length })
    : named.join(sep);
}

/**
 * 归档时把这一块里的每个控件都禁掉 —— `<fieldset disabled>` 原生地禁用它里面所有的按钮
 * 与输入框，不必给每个分区挨个传「只读」。守护进程与内核照样会拒（这里只是不让人去点
 * 一个注定被拒的按钮）；导出与恢复不在这一块里。
 */
function ReadOnlyWhenArchived({ archived, children }: { archived: boolean; children: ReactNode }) {
  const t = useT();
  return (
    <fieldset disabled={archived} className="flex flex-col gap-lg border-0 p-0 m-0 min-w-0">
      {children}
    </fieldset>
  );
}

/**
 * 导出项目记录（TD-020）。
 *
 * §18.5 承诺「本地数据仍可访问、可导出」，而在此之前**可导出的那一半界面上
 * 无处可点**：端点在，用户够不着，等于没有。
 */
function ExportCard({ api, projectId }: { api: Api; projectId: string }) {
  const t = useT();
  const [dir, setDir] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<ProjectExport | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="card flex flex-col gap-sm">
      <div className="text-body-sm text-muted-foreground">
        {t("ws.export.desc")}
      </div>
      <div className="row">
        <Input
          value={dir}
          placeholder={t("ws.export.placeholder")}
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
          {t(busy ? "ws.export.running" : "ws.export.run")}
        </Button>
      </div>
      {error && <div className="error-box">{error}</div>}
      {done && (
        <div className="notice-box">
          <div className="flex flex-col gap-2xs">
            <strong>{t("ws.export.done", { count: done.files.length, path: done.path })}</strong>
            <span className="text-body-sm text-muted-foreground">
              {t("ws.export.auditCount", { n: done.chain.events })}
            </span>
            {/* 照实说：客户端零密钥，签不了。可验篡改，不可归属 —— 两件事
                分开说，别让人以为这份导出已经带了身份。 */}
            <span className="text-body-sm text-muted-foreground">
              {done.signed
                ? t("ws.export.signed")
                : t("ws.export.unsigned")}
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
  const t = useT();
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
          <span className="text-body-sm text-muted-foreground">{t("ws.advance.label")}</span>
          {/* 这个 map 的参数原先也叫 `t` —— 翻译函数一进来就被它盖住了。
              改叫 `tr`（transition）。 */}
          {transitions.map((tr) => (
            <Button
              variant="outline"
              key={tr.to}
              onClick={() => {
                if (tr.confirm === "human") {
                  if (
                    window.confirm(
                      t("ws.advance.confirm", { from: view.businessState, to: tr.to }),
                    )
                  ) {
                    onTransition(tr.to, true);
                  }
                } else {
                  onTransition(tr.to, false);
                }
              }}
            >
              → {tr.to}
              {tr.confirm === "human" ? t("ws.advance.needsConfirm") : ""}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- Context ---------------- */

/** 字节数说人话。文件区里最大的那些是 GB 级的，全用 KB 说没人读得下去。 */
function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * 项目文件区（TD-041）。
 *
 * 和上面的「文件授权」「类型绑定」放在同一页，但讲的是**相反的一件事**：授权与
 * 绑定是「指着你自己的位置去读」，收进项目是「复制一份进来，从此与你那份无关」。
 * 两者挨着摆，用户才看得出该用哪一个 —— 分到两个页面去，他会以为它们是一回事。
 */
export function ProjectFilesSection({
  api,
  projectId,
  grants,
  uploadFile,
}: {
  api: Api;
  projectId: string;
  grants: Grant[];
  uploadFile?: (file: File) => Promise<void>;
}) {
  const t = useT();
  const [files, setFiles] = useState<ProjectFile[] | null>(null);
  const [path, setPath] = useState("");
  const [notice, setNotice] = useState("");
  const [uploading, setUploading] = useState(false);

  const reload = useCallback(() => {
    void api
      .files(projectId)
      .then((r) => setFiles(r.items))
      .catch(() => setFiles(null));
  }, [api, projectId]);
  useEffect(reload, [reload]);

  const folders = grants.filter((g): g is FolderGrant => !isConnectorGrant(g));

  const add = (): void => {
    setNotice("");
    void api
      .addFile(projectId, path)
      .then(() => {
        setPath("");
        reload();
      })
      .catch((cause: unknown) => {
        // 未授权的路径会被守护进程拒（FILE_NOT_GRANTED）。**把原话给用户** ——
        // 它说清了下一步是「先授权那个文件夹」。
        const body = (cause as { body?: { message?: string } })?.body;
        setNotice(body?.message ?? t("ws.files.cannotIngest"));
      });
  };

  const download = (file: ProjectFile): void => {
    setNotice("");
    void api
      .fileBytes(projectId, file.id)
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => setNotice(t("ws.files.cannotFetch", { name: file.name })));
  };

  return (
    <>
      <SectionHeader level={2} title={t("ws.files.title")} icon="archive" />
      <p className="hint">
        {/* 这是渲染出去的正文，不是注释 —— 别在这儿用 Markdown 的星号，JSX
            不解析它，用户会看见两个星号。要加重就用 <strong>。 */}
        {t(uploadFile ? "ws.files.uploadDesc" : "ws.files.desc")}
        {!uploadFile && <><br />
        {/* 提醒在前、拦截在后（TD-051）：常见的几家会被拒，但挂成盘符的那些认不
            出来 —— 而从云盘里收进来的可能只是一个占位存根，看起来和收好了一样。 */}
        {t("ws.files.cloudWarning")}</>}
      </p>
      {notice && (
        <p className="hint" role="alert">
          {notice}
        </p>
      )}
      {files && files.length === 0 && (
        <EmptyState
          icon="archive"
          title={t("ws.files.empty.title")}
          description={t(uploadFile ? "ws.files.uploadEmpty" : "ws.files.empty.desc")}
        />
      )}
      {files && files.length > 0 && (
        <ul className="row-list" aria-label={t("ws.files.aria")}>
          {files.map((f) => (
            <li key={f.id} className="row-item">
              <code className="row-main">{f.name}</code>
              <span className="row-tag">{humanBytes(f.bytes)}</span>
              {/* 来源只是记录，那个路径现在可能已经不在了 —— 所以不做成链接。 */}
              {f.sourceRef && (
                <span className="row-tag" title={f.sourceRef}>
                  {t("ws.files.fromLocal")}
                </span>
              )}
              <Button variant="outline" onClick={() => download(f)}>
                {t("ws.files.fetchBack")}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  void api.removeFile(projectId, f.id).then(reload);
                }}
              >
                {t("ws.files.remove")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {uploadFile ? <label className="row">{t("ws.files.upload")}
        <input type="file" accept=".pdf,.docx,.md,.markdown" disabled={uploading}
          onChange={async event => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setUploading(true); setNotice("");
            try { await uploadFile(file); reload(); }
            catch (error) { setNotice(error instanceof Error ? error.message : t("ws.files.cannotIngest")); }
            finally { setUploading(false); }
          }} />
      </label> : <div className="row">
        <Input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder={
            folders.length > 0
              ? t("ws.files.placeholderExample", { example: `${folders[0]!.path}\\tender.pdf` })
              : t("ws.files.placeholderNoGrant")
          }
        />
        <Button disabled={!path || folders.length === 0} onClick={add}>
          {t("ws.files.ingest")}
        </Button>
      </div>}
    </>
  );
}

/** 三个权限值给人看的说法。`allow` 不写成「允许」——「直接执行」才说清了没人会被问。 */
const PERMISSION_KEY: Record<"allow" | "ask" | "deny", MessageKey> = {
  allow: "ws.perm.allow",
  ask: "ws.perm.ask",
  deny: "ws.perm.deny",
};

/** 这一行现在是谁说了算。**要说得出来**：一个只显示结果的开关无法回答「我明明设过」。 */
const SOURCE_KEY: Record<ToolPolicyRow["source"], MessageKey> = {
  hard_floor: "ws.permSource.hard_floor",
  user_policy: "ws.permSource.user_policy",
  contract_default: "ws.permSource.contract_default",
  ask_cache: "ws.permSource.ask_cache",
};

/**
 * 工具权限（TD-050）。
 *
 * 放在「上下文」这一页而不是另开一个 tab：它和文件授权、连接器授权是同一件事的
 * 三个面 —— **这个项目允许运行时碰什么**。分到别处去，用户就得在两个地方回答同
 * 一个问题。
 *
 * 每一行显示的是**此刻实际生效的**权限，不是用户设过什么：三层合成之后的答案才
 * 是他真正要问的（这个工具现在到底能不能动我的文件），而「谁说了算」那一列让他
 * 看得出为什么。
 */
function ToolPolicySection({
  api,
  projectId,
}: {
  api: Api;
  projectId: string;
}) {
  const t = useT();
  const [rows, setRows] = useState<ToolPolicyRow[] | null>(null);
  /** 被拒的那句话照原样显示 —— 它写清了能改到哪儿为止。 */
  const [refusal, setRefusal] = useState("");

  useEffect(() => {
    let alive = true;
    api
      .toolPolicy(projectId)
      .then((r) => alive && setRows(r.items))
      .catch(() => alive && setRows(null));
    return () => {
      alive = false;
    };
  }, [api, projectId]);

  if (!rows || rows.length === 0) return null;

  const change = (tool: string, raw: string): void => {
    setRefusal("");
    const value = raw === "" ? null : (raw as "allow" | "ask" | "deny");
    void api
      .setToolPolicy(projectId, tool, value)
      .then((r) => setRows(r.items))
      .catch((cause: unknown) => {
        // 底线之下的放宽会被拒（POLICY_DENIED）。**把原话给用户** —— 它说明了
        // 为什么不行、以及还能改到哪儿。一句「操作失败」在这里等于没说。
        const body = (cause as { body?: { message?: string } })?.body;
        setRefusal(body?.message ?? t("ws.tools.cannotChange"));
      });
  };

  return (
    <>
      <SectionHeader level={2} title={t("ws.tools.title")} icon="shield-check" />
      <p className="hint">
        {t("ws.tools.desc")}
      </p>
      {refusal && (
        <p className="hint" role="alert">
          {refusal}
        </p>
      )}
      <ul className="row-list" aria-label={t("ws.tools.aria")}>
        {rows.map((row) => (
          <li key={row.tool} className="row-item">
            {/* **不要给这里加 title**：title 会顶掉 `<code>` 的无障碍名，于是读屏
                读出来的是类别而不是工具名 —— 而这一行讲的就是这个工具。类别单独
                一个标签，它也确实要露出来：有没有底线是按类别定的。 */}
            <code className="row-main">{row.tool}</code>
            <span className="row-tag">{row.category}</span>
            <span className="row-tag">{t(SOURCE_KEY[row.source])}</span>
            {row.floor && (
              <span className="row-tag">
                {t("ws.tools.floorTag", { permission: t(PERMISSION_KEY[row.floor]) })}
              </span>
            )}
            <NativeSelect
              aria-label={t("ws.tools.rowAria", { tool: row.tool })}
              value={row.userPolicy ?? ""}
              onChange={(e) => change(row.tool, e.target.value)}
              wrapperClassName="sel-narrow"
            >
              {/* 空选项 = 交给产品默认。与「设成默认此刻的那个值」不是一回事：
                  契约会升级，而一条钉死的记录不会跟着变。 */}
              <option value="">
                {t("ws.tools.followContract", {
                  permission: t(PERMISSION_KEY[row.contractDefault]),
                })}
              </option>
              <option value="allow">{t("ws.perm.allow")}</option>
              <option value="ask">{t("ws.perm.ask")}</option>
              <option value="deny">{t("ws.perm.deny")}</option>
            </NativeSelect>
          </li>
        ))}
      </ul>
    </>
  );
}

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
  const t = useT();
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
      <SectionHeader level={2} title={t("ws.grants.title")} icon="folder-open" />
      {folderGrants.length === 0 && (
        <EmptyState
          icon="lock"
          title={t("ws.grants.empty.title")}
          description={t("ws.grants.empty.desc")}
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
          placeholder={t("ws.grants.placeholder")}
        />
        <Button
          disabled={!grantPath}
          onClick={() => {
            onAddGrant(grantPath);
            setGrantPath("");
          }}
        >
          {t("ws.grants.grant")}
        </Button>
      </div>

      {/* 连接器授权（ADR-005）：与文件夹授权同级，但只在这台机器装了连接器时才
          出现 —— 一个永远空着的板块是在解释一件用户没有的东西。 */}
      {(installed?.length ?? 0) + connectorGrants.length > 0 && (
        <>
          <SectionHeader level={2} title={t("ws.connectors.title")} icon="plugs-connected" />
          {connectorGrants.length > 0 && (
            <ul className="row-list" aria-label={t("ws.connectors.aria")}>
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
                aria-label={t("ws.connectors.pickAria")}
                value={effectiveGrantConnector}
                onChange={(e) => setGrantConnector(e.target.value)}
                wrapperClassName="sel-narrow"
              >
                {grantable.map((c) => (
                  <option key={c.id} value={c.id}>
                    {t(c.health.ok ? "ws.connectors.option" : "ws.connectors.optionStopped", {
                  id: c.id,
                  source: c.source,
                })}
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
                {t("ws.connectors.grant")}
              </Button>
            </div>
          )}
        </>
      )}

      <ProjectFilesSection api={api} projectId={projectId} grants={grants} />

      <ToolPolicySection api={api} projectId={projectId} />

      <SectionHeader level={2} title={t("ws.bindings.title")} icon="plugs-connected" />
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
            aria-label={t("ws.bindings.viaAria")}
            value={bindVia}
            onChange={(e) => setBindVia(e.target.value)}
            wrapperClassName="sel-narrow"
          >
            <option value="">{t("ws.bindings.viaLocal")}</option>
            {connectorGrants.map((g) => (
              <option key={g.id} value={g.connector}>
                {t("ws.bindings.viaConnector", { id: g.connector })}
              </option>
            ))}
          </NativeSelect>
        )}
        <Input
          value={bindRoot}
          onChange={(e) => setBindRoot(e.target.value)}
          placeholder={t(bindVia ? "ws.bindings.placeholderUri" : "ws.bindings.placeholderPath")}
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
          {t("ws.bindings.bind")}
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
  const t = useT();
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
              {t("ws.bindings.fromConnector", {
                connector: binding.connector,
                source: binding.source,
              })}
            </span>
          )}
        </span>
        <span className="text-body-sm text-muted-foreground">
          {t(open ? "ws.bindings.collapse" : "ws.bindings.expand")}
        </span>
      </div>
      {open && items !== null && (
        <Table className="mt-sm">
          <TableBody>
            {items.length === 0 && (
              <TableRow>
                <TableCell className="text-muted-foreground">
                  {t("ws.bindings.noEntries")}
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

function needsBatchApproval(job: Awaited<ReturnType<Api["backgroundJobs"]>>[number]) {
  return job.approvable && !job.approved && ["running", "waiting", "paused"].includes(job.state);
}

function BatchContextApproval({jobs,onApprove}:{jobs:Awaited<ReturnType<Api["backgroundJobs"]>>;onApprove:(job:Awaited<ReturnType<Api["backgroundJobs"]>>[number])=>void}) {
  const t=useT();
  return <>{jobs.filter(needsBatchApproval).map(j=><section className="card" key={j.id}>
    <h2>{t("ws.batchApproval.title")}</h2><p>{j.label}</p><p>{t("ws.batchApproval.description",{count:j.steps,kb:Math.ceil(j.bytes/1024)})}</p>
    <p className="text-body-sm text-muted-foreground">{t("ws.batchApproval.scope")}</p>
    <Button onClick={()=>onApprove(j)}>{t("ws.batchApproval.approve")}</Button>
  </section>)}</>;
}

function TasksTab({
  view,
  instances,
  businessUi=false,
  onLaunch,
}: {
  view: ProjectView;
  instances: TaskInstance[];
  businessUi?: boolean;
  onLaunch: (task: string, inputs?: Record<string, unknown>) => void;
}) {
  const t = useT();
  return (
    <>
      {/* 智能在这里：业务契约声明的 AI 任务（Harness 执行 + 人工检查点），
          不是壳级助手（20-specs/10 §1.3 定位）。 */}
      {businessUi ? <p>{t("ws.taskDefs.businessFlow")}</p> : <SectionHeader level={2} title={t("ws.taskDefs.title")} icon="sparkles" />}
      {!businessUi && view.tasks.map((t) => (
        <TaskLauncher key={t.id} def={t} onLaunch={(inputs) => onLaunch(t.id, inputs)} />
      ))}
      <SectionHeader level={2} title={t("ws.instances.title")} icon="list-checks" />
      {instances.length === 0 && (
        <EmptyState icon="circle-dashed" title={t("ws.instances.empty")} />
      )}
      {[...instances].reverse().map((t) => (
        <InstanceCard key={t.id} instance={t} taskName={view.tasks.find(task=>task.id===t.taskId)?.name} />
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
  const t = useT();
  const [manual, setManual] = useState(false);
  const [json, setJson] = useState("{}");
  const [jsonError, setJsonError] = useState<string | null>(null);
  // 运行时会当场拒绝这个任务；那就别把「启动」摆在这里等人去点。
  const blocked = def.unrunnable.length > 0;
  return (
    <div className="card">
      <div style={{ fontWeight: 600 }}>{def.name || def.id}</div>
      <div className="text-body-sm text-muted-foreground">
        {t("ws.taskDef.inputs", {
          objective: def.objective,
          types: def.input_types.join(", ") || t("ws.taskDef.noInputs"),
        })}
      </div>
      {blocked && (
        <div className="error-box">
          {t("ws.taskDef.unrunnable", { missing: def.unrunnable.join(t("common.listSep")) })}
        </div>
      )}
      <div className="row" style={{ marginTop: 6 }}>
        <Button disabled={blocked} onClick={() => onLaunch(undefined)}>
          {t("ws.taskDef.start")}
        </Button>
        <Button
          variant="outline"
          disabled={blocked}
          onClick={() => setManual(!manual)}
        >
          {t(manual ? "ws.taskDef.hideManual" : "ws.taskDef.showManual")}
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
            {t("ws.taskDef.startManual")}
          </Button>
        </>
      )}
    </div>
  );
}

function InstanceCard({ instance,taskName }: { instance: TaskInstance;taskName?:string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="card clickable" onClick={() => setOpen(!open)}>
      <div className="row" style={{ justifyContent: "space-between", margin: 0 }}>
        <span>
          <b>{taskName || instance.taskId}</b>{" "}
          <StatusBadge tone={stateTone(instance.state)}>
            {taskName && TASK_STATE_KEY[instance.state] ? t(TASK_STATE_KEY[instance.state]!) : instance.state}
          </StatusBadge>{" "}
          {/* 排队是**宿主此刻的调度情况**，不是任务状态，所以它是状态徽标旁边
              另一枚，而不是把状态改写成「排队中」—— 那个任务的状态确实还是
              created / suspended，改写会让状态机的记录与界面对不上。
              不显示位置就等于不告诉用户「还要多久」，而那正是他此刻唯一想知道的。 */}
          {instance.queued && (
            <StatusBadge tone="neutral">
              {instance.queuePosition
            ? t("ws.instance.queuedAt", { position: instance.queuePosition })
            : t("ws.instance.queued")}
            </StatusBadge>
          )}
        </span>
        <span className="text-body-sm text-muted-foreground">
          {instance.updatedAt}
        </span>
      </div>
      {instance.error && <div className="error-box">{instance.error}</div>}
      {open && (
        <div style={{ marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
          {taskName && <code>{instance.taskId}</code>}
          {instance.verification.length > 0 && (
            <Table className="mb-sm">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("ws.instance.col.rule")}</TableHead>
                  <TableHead>{t("ws.instance.col.method")}</TableHead>
                  <TableHead>{t("ws.instance.col.verdict")}</TableHead>
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
              {t("ws.instance.sources", {
                list: instance.result.sources.join(t("common.listSep")),
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 产品界面提出的「请把项目推进到 X」（ADR-022 片四，owner 2026-09-11 方案 A）。
 *
 * **产品只能提，只有人能批** —— 批准的那一下由这里发出，带着卡片上写的那个目标：请求
 * 若已经变了，守护进程不认（409），人的「确认」不会挪给他没看见的那一个。
 */
function StateRequestCard({
  productName,
  request,
  current,
  onDecide,
}: {
  productName: string;
  request: StateRequest;
  current: string;
  onDecide: (approve: boolean) => void;
}) {
  const t = useT();
  return (
    <PanelCard
      tone="warning"
      icon="shield-warning"
      title={t("ws.confirm.stageTitle", { product: productName, to: request.to })}
      description={t("ws.confirm.stageDesc", { current })}
      action={
        <div className="flex items-center gap-xs">
          <Button onClick={() => onDecide(true)}>{t("ws.confirm.stageAccept")}</Button>
          <Button
            variant="destructive"
            confirmExempt={t("ws.confirm.exempt")}
            onClick={() => onDecide(false)}
          >
            {t("ws.confirm.reject")}
          </Button>
        </div>
      }
    >
      <p className="text-body-sm text-muted-foreground">
        {t("ws.confirm.stageFoot", {
          current,
          to: request.to,
          at: shortTime(request.requestedAt),
        })}
      </p>
    </PanelCard>
  );
}

function CheckpointCard({
  instance,
  taskName,
  businessAdoption=false,
  onDecide,
}: {
  instance: TaskInstance;
  taskName?: string;
  businessAdoption?: boolean;
  onDecide: (approve: boolean) => void;
}) {
  const t = useT();
  const kind = pendingCheckpoint(instance)?.kind ?? "verification_review";
  return (
    <PanelCard
      tone="warning"
      icon="shield-warning"
      title={
        kind === "context_confirm"
          ? t("ws.confirm.contextTitle", { task: taskName || instance.taskId })
          : kind === "tool_ask"
            ? t("ws.confirm.toolTitle", { task: taskName || instance.taskId })
            : t("ws.confirm.reviewTitle", { task: taskName || instance.taskId })
      }
      /* 上下文那一档要说清用户在批准什么：资料作为「材料」送出去做推理，而其中
         任何看起来像指示的文字都不会被当作指示执行。 */
      description={
        kind === "context_confirm"
          ? t("ws.confirm.contextDesc")
          : kind === "tool_ask"
            ? t("ws.confirm.toolDesc")
            : t(businessAdoption ? "ws.confirm.adoptDesc" : "ws.confirm.reviewDesc")
      }
      action={
        <div className="flex items-center gap-xs">
          <Button onClick={() => onDecide(true)}>{t(businessAdoption && kind === "verification_review" ? "ws.confirm.adopt" : "ws.confirm.approve")}</Button>
          <Button
            variant="destructive"
            confirmExempt={t("ws.confirm.exempt")}
            onClick={() => onDecide(false)}
          >
            {t("ws.confirm.reject")}
          </Button>
        </div>
      }
    >
      {taskName && <p className="text-body-sm">{t(kind === "context_confirm" ? "ws.confirm.materialCount" : "ws.confirm.checkCount",{count:kind === "context_confirm" ? (instance.contextSet?.length ?? 0) : instance.verification.length})}</p>}
      <details open={!taskName}>
      <summary>{t("ws.confirm.execution")}</summary>
      {taskName && <code>{instance.taskId}</code>}
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
      </details>
      {kind === "verification_review" && Object.keys(instance.capabilityOutputs).length > 0 && (
        <details className="mt-sm" open={!!taskName}>
          <summary>{t("ws.confirm.preview")}</summary>
          {Object.entries(instance.capabilityOutputs).map(([capability, content]) => (
            <section key={capability}>
              {!taskName && <p className="text-body-sm text-muted-foreground">{capability}</p>}
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-body-sm">{reviewText(content)}</pre>
            </section>
          ))}
        </details>
      )}
    </PanelCard>
  );
}

function reviewText(content: string): string {
  try {
    const parsed: unknown = JSON.parse(content);
    if (parsed && typeof parsed === "object" && "markdown" in parsed && typeof parsed.markdown === "string") return parsed.markdown;
    if (parsed && typeof parsed === "object" && "chapters" in parsed && Array.isArray(parsed.chapters)) {
      return parsed.chapters.map((chapter,index)=>`${index+1}. ${typeof chapter?.title === "string" ? chapter.title : ""}\n${typeof chapter?.purpose === "string" ? chapter.purpose : ""}`).join("\n\n");
    }
  } catch { /* Plain text is already a reviewable result. */ }
  return content;
}

/* ---------------- Audit ---------------- */

function AuditTab({
  audit,
  chainOk,
}: {
  audit: StoredAuditEvent[];
  chainOk: boolean | null;
}) {
  const t = useT();
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
        title={t("ws.audit.title", { n: audit.length })}
        titleSuffix={
          <StatusBadge
            tone={chainOk === true ? "success" : chainOk === false ? "danger" : "neutral"}
          >
            {chainOk === null
              ? t("ws.audit.verifying")
              : chainOk
                ? t("ws.summary.chainOk")
                : t("ws.summary.chainBroken")}
          </StatusBadge>
        }
      />
      <div className="row">
        <NativeSelect
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          wrapperClassName="sel-audit"
        >
          <option value="">{t("ws.audit.allEvents", { n: audit.length })}</option>
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
              <TableHead>{t("ws.audit.col.time")}</TableHead>
                              <TableHead>{t("ws.audit.col.action")}</TableHead>
                              <TableHead>{t("ws.audit.col.result")}</TableHead>
                              <TableHead>{t("ws.audit.col.actor")}</TableHead>
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
                    {outcomeLabel(t, e.outcome)}
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
