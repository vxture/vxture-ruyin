/**
 * ProjectPanel (workspace.tsx): the project detail panel - summary strip,
 * unattributed-project notice, pending checkpoints, and the four tabs
 * (overview/context/tasks/audit). `tab` is owned by the parent (workbench.tsx
 * swaps it via re-render, there's no in-component tab nav), so tab-routing
 * tests just render with a different `tab` prop rather than clicking a nav.
 *
 * `./chain`'s verifyChain does a real WebCrypto SHA-256 walk over the audit
 * list - correct, but it means every fixture with audit events would need a
 * genuinely valid hash chain to read as intact. Mocked here so tests control
 * chainOk directly; chain.ts isn't part of this task's six-component scope.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectPanel } from "./workspace";
import {
  Api,
  type AuditEvent,
  type Binding,
  type FolderGrant,
  type ProjectView,
  type TaskDef,
  type TaskInstance,
} from "./api";

vi.mock("./chain", () => ({
  verifyChain: vi.fn().mockResolvedValue(true),
}));

function projectView(over: Partial<ProjectView> = {}): ProjectView {
  return {
    meta: {
      id: "prj_1",
      productId: "vxture.bid",
      productVersion: "1.0.0",
      name: "投标项目",
      projectType: "project",
      createdAt: "2026-06-01T00:00:00.000Z",
      workspaceId: "wsp_1",
    },
    businessState: "drafting",
    product: { id: "vxture.bid", name: "标书编写", version: "1.0.0" },
    tasks: [],
    states: {
      object: "bid",
      initial: "drafting",
      items: [
        { name: "drafting", transitions: [{ to: "reviewing" }] },
        { name: "reviewing", transitions: [{ to: "submitted", confirm: "human" }] },
        { name: "submitted", transitions: [] },
      ],
    },
    ...over,
  };
}

function taskDef(over: Partial<TaskDef> = {}): TaskDef {
  return {
    id: "draft_section",
    objective: "起草标书章节",
    input_types: ["tender_doc"],
    unrunnable: [],
    ...over,
  };
}

function taskInstance(over: Partial<TaskInstance> = {}): TaskInstance {
  return {
    id: "ti_1",
    taskId: "draft_section",
    state: "completed",
    checkpoints: [],
    verification: [],
    capabilityOutputs: {},
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:10:00.000Z",
    ...over,
  };
}

function grant(over: Partial<FolderGrant> = {}): FolderGrant {
  return {
    id: "g1",
    path: "C:\\proj\\docs",
    mode: "rw",
    createdAt: "2026-06-01T00:00:00.000Z",
    ...over,
  };
}

function binding(over: Partial<Binding> = {}): Binding {
  return { type: "tender_doc", source: "local", root: "docs/tender", connector: "fs", ...over };
}

function auditEvent(over: Partial<AuditEvent> = {}): AuditEvent {
  return {
    eventId: "ae_1",
    occurredAt: "2026-06-01T08:00:00.000Z",
    actorId: "u1",
    actorConsole: null,
    actor: "yh",
    objectType: "project",
    objectId: "prj_1",
    action: "project.created",
    outcome: "success",
    workspace: "wsp_1",
    prevHash: "genesis",
    hash: "h1",
    payload: { note: "x" },
    ...over,
  };
}

function fakeApi(over: Partial<Api> = {}): Api {
  return {
    workspace: vi.fn().mockResolvedValue(projectView()),
    taskInstances: vi.fn().mockResolvedValue([]),
    grants: vi.fn().mockResolvedValue([]),
    bindings: vi.fn().mockResolvedValue([]),
    audit: vi.fn().mockResolvedValue([]),
    subscribe: vi.fn().mockReturnValue(() => {}),
    importProject: vi.fn().mockResolvedValue({}),
    decide: vi.fn().mockResolvedValue({}),
    transition: vi.fn().mockResolvedValue({}),
    addGrant: vi.fn().mockResolvedValue({}),
    setBinding: vi.fn().mockResolvedValue({}),
    startTask: vi.fn().mockResolvedValue({}),
    exportProject: vi.fn().mockResolvedValue({}),
    contextItems: vi.fn().mockResolvedValue([]),
    connectors: vi.fn().mockResolvedValue({ items: [] }),
    addConnectorGrant: vi.fn().mockResolvedValue({}),
    ...over,
  } as unknown as Api;
}

afterEach(() => {
  vi.restoreAllMocks();
});

/* ---------------- Loading / summary / errors ---------------- */

void test("ProjectPanel: shows a loading placeholder before the first load resolves", () => {
  const api = fakeApi({ workspace: vi.fn(() => new Promise<ProjectView>(() => {})) });
  render(<ProjectPanel api={api} id="prj_1" tab="overview" />);
  expect(screen.getByText("加载中……")).toBeInTheDocument();
});

void test("ProjectPanel: the summary strip reports phase, task counts, resources, and audit/chain status", async () => {
  const api = fakeApi({
    taskInstances: vi.fn().mockResolvedValue([
      taskInstance({ id: "t1", state: "waiting_human" }),
      taskInstance({ id: "t2", state: "executing" }),
      taskInstance({ id: "t3", state: "completed" }),
    ]),
    grants: vi.fn().mockResolvedValue([grant()]),
    bindings: vi.fn().mockResolvedValue([binding()]),
    audit: vi.fn().mockResolvedValue([auditEvent()]),
  });
  render(<ProjectPanel api={api} id="prj_1" tab="overview" />);
  await screen.findByText("标书编写 1.0.0");

  // "drafting"同时出现在摘要带的阶段徽章与下面的阶梯当前步——都是预期
  // 行为，这里只钉摘要带那一处（.proj-summary，阶梯在它之外）。
  const summary = document.querySelector(".proj-summary") as HTMLElement;
  expect(within(summary).getByText("drafting")).toBeInTheDocument();
  expect(screen.getByText("1 待确认")).toBeInTheDocument();
  expect(screen.getByText("1 运行中")).toBeInTheDocument();
  expect(screen.getByText("1 类 · 1 个授权目录")).toBeInTheDocument();
  expect(await screen.findByText("链完整")).toBeInTheDocument();
  expect(screen.getByText("标书编写 1.0.0")).toBeInTheDocument();
  expect(screen.getByText("project")).toBeInTheDocument();
  expect(screen.getByText("建于 2026-06-01")).toBeInTheDocument();
  expect(screen.getByText("prj_1")).toBeInTheDocument();
});

void test("ProjectPanel: a broken hash chain reads as 链断裂 in the summary and 哈希链断裂 in the audit tab", async () => {
  const { verifyChain } = await import("./chain");
  vi.mocked(verifyChain).mockResolvedValueOnce(false);
  const api = fakeApi({ audit: vi.fn().mockResolvedValue([auditEvent()]) });
  render(<ProjectPanel api={api} id="prj_1" tab="audit" />);
  expect(await screen.findByText("链断裂")).toBeInTheDocument();
  expect(screen.getByText("哈希链断裂")).toBeInTheDocument();
});

void test("ProjectPanel: chain verification starts as 校验中 and resolves to 链完整/哈希链完整 in both the summary and audit tab", async () => {
  let resolveChain: (ok: boolean) => void = () => {};
  const { verifyChain } = await import("./chain");
  vi.mocked(verifyChain).mockReturnValueOnce(
    new Promise<boolean>((resolve) => {
      resolveChain = resolve;
    }),
  );
  const api = fakeApi({ audit: vi.fn().mockResolvedValue([auditEvent()]) });
  render(<ProjectPanel api={api} id="prj_1" tab="audit" />);
  await screen.findByText("标书编写 1.0.0");

  expect(screen.getAllByText("校验中")).toHaveLength(1);
  expect(screen.getByText("校验中…")).toBeInTheDocument();

  resolveChain(true);
  expect(await screen.findByText("链完整")).toBeInTheDocument();
  expect(screen.getByText("哈希链完整（本地重算）")).toBeInTheDocument();
});

void test("ProjectPanel: a load failure surfaces as an error box, not a silent blank panel", async () => {
  const api = fakeApi({
    workspace: vi.fn().mockRejectedValue(new Error("守护进程未响应")),
  });
  render(<ProjectPanel api={api} id="prj_1" tab="overview" />);
  expect(await screen.findByText("守护进程未响应")).toBeInTheDocument();
});

void test("ProjectPanel: an unattributed project (no workspaceId) shows the import notice; importing refreshes", async () => {
  const api = fakeApi({
    workspace: vi.fn().mockResolvedValue(projectView({ meta: { ...projectView().meta, workspaceId: undefined } })),
  });
  render(<ProjectPanel api={api} id="prj_1" tab="overview" />);
  expect(await screen.findByText("该项目尚未归属工作区")).toBeInTheDocument();

  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "导入当前工作区" }));
  expect(api.importProject).toHaveBeenCalledWith("prj_1");
  await vi.waitFor(() => expect(api.workspace).toHaveBeenCalledTimes(2));
});

void test("ProjectPanel: an attributed project shows no import notice", async () => {
  const api = fakeApi();
  render(<ProjectPanel api={api} id="prj_1" tab="overview" />);
  await screen.findByText("标书编写 1.0.0");
  expect(screen.queryByText("该项目尚未归属工作区")).not.toBeInTheDocument();
});

/* ---------------- Checkpoints ---------------- */

void test("ProjectPanel: a context_confirm checkpoint shows the context table and approves via api.decide", async () => {
  const api = fakeApi({
    taskInstances: vi.fn().mockResolvedValue([
      taskInstance({
        id: "ti_ctx",
        state: "waiting_human",
        checkpoints: [
          { id: "cp1", kind: "context_confirm", subject: null, options: ["approve", "reject"], raisedAt: "2026-06-01T00:00:00.000Z" },
        ],
        contextSet: [
          { id: "c1", type: "tender_doc", source: "local", connector: "fs", ref: "docs/tender/招标文件.pdf", name: "招标文件.pdf", bytes: 2048, modifiedAt: "2026-06-01T00:00:00.000Z" },
        ],
      }),
    ]),
  });
  render(<ProjectPanel api={api} id="prj_1" tab="overview" />);

  expect(await screen.findByText('任务「draft_section」请求使用以下上下文')).toBeInTheDocument();
  expect(screen.getByText("招标文件.pdf")).toBeInTheDocument();

  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "批准" }));
  expect(api.decide).toHaveBeenCalledWith("prj_1", "ti_ctx", true);
});

void test("ProjectPanel: a waiting_human instance with no checkpoint defaults to a verification review; rejecting calls api.decide(false)", async () => {
  const api = fakeApi({
    taskInstances: vi.fn().mockResolvedValue([
      taskInstance({
        id: "ti_verify",
        state: "waiting_human",
        checkpoints: [],
        verification: [{ id: "v1", kind: "schema", status: "failed", note: "字段缺失" }],
      }),
    ]),
  });
  render(<ProjectPanel api={api} id="prj_1" tab="overview" />);

  expect(await screen.findByText('任务「draft_section」的成果等待人工评审')).toBeInTheDocument();
  expect(screen.getByText("字段缺失")).toBeInTheDocument();

  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "拒绝" }));
  expect(api.decide).toHaveBeenCalledWith("prj_1", "ti_verify", false);
});

void test("ProjectPanel: a tool_ask checkpoint asks the user to judge a proposed tool call", async () => {
  const api = fakeApi({
    taskInstances: vi.fn().mockResolvedValue([
      taskInstance({
        id: "ti_tool",
        state: "waiting_human",
        checkpoints: [
          { id: "cp1", kind: "tool_ask", subject: null, options: ["approve", "reject"], raisedAt: "2026-06-01T00:00:00.000Z" },
        ],
      }),
    ]),
  });
  render(<ProjectPanel api={api} id="prj_1" tab="overview" />);
  expect(await screen.findByText('任务「draft_section」请求执行一个工具')).toBeInTheDocument();
  expect(screen.getByText("该调用由模型在读过下列资料之后提出，请据此判断")).toBeInTheDocument();
});

void test("ProjectPanel: a decide() failure shows as an action error, and survives the refresh it skipped", async () => {
  const api = fakeApi({
    taskInstances: vi.fn().mockResolvedValue([
      taskInstance({ id: "ti_x", state: "waiting_human", checkpoints: [] }),
    ]),
    decide: vi.fn().mockRejectedValue(new Error("任务已不在等待状态")),
  });
  render(<ProjectPanel api={api} id="prj_1" tab="overview" />);
  await screen.findByText('任务「draft_section」的成果等待人工评审');

  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "批准" }));
  expect(await screen.findByText("任务已不在等待状态")).toBeInTheDocument();
});

/* ---------------- Overview tab ---------------- */

void test("ProjectPanel/Overview: the state stepper marks the current step and lists reachable transitions", async () => {
  const api = fakeApi();
  render(<ProjectPanel api={api} id="prj_1" tab="overview" />);
  await screen.findByText("标书编写 1.0.0");

  const steps = document.querySelectorAll(".step");
  expect(steps).toHaveLength(3);
  expect(steps[0]?.className).toContain("current");
  expect(screen.getByRole("button", { name: "→ reviewing" })).toBeInTheDocument();
});

void test("ProjectPanel/Overview: a project with no declared state machine shows an empty stepper, not a crash", async () => {
  const api = fakeApi({ workspace: vi.fn().mockResolvedValue(projectView({ states: undefined })) });
  render(<ProjectPanel api={api} id="prj_1" tab="overview" />);
  await screen.findByText("标书编写 1.0.0");
  expect(document.querySelectorAll(".step")).toHaveLength(0);
  expect(screen.queryByText("推进：")).not.toBeInTheDocument();
});

void test("ProjectPanel/Overview: a plain transition fires immediately, no confirm dialog", async () => {
  const api = fakeApi();
  render(<ProjectPanel api={api} id="prj_1" tab="overview" />);
  await screen.findByText("标书编写 1.0.0");

  const confirmSpy = vi.spyOn(window, "confirm");
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "→ reviewing" }));
  expect(confirmSpy).not.toHaveBeenCalled();
  expect(api.transition).toHaveBeenCalledWith("prj_1", "reviewing", false);
});

void test("ProjectPanel/Overview: a human-confirm transition asks first, and does nothing if declined", async () => {
  const api = fakeApi({
    workspace: vi.fn().mockResolvedValue(projectView({ businessState: "reviewing" })),
  });
  render(<ProjectPanel api={api} id="prj_1" tab="overview" />);
  await screen.findByText("标书编写 1.0.0");

  vi.spyOn(window, "confirm").mockReturnValue(false);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "→ submitted（需确认）" }));
  expect(api.transition).not.toHaveBeenCalled();

  vi.spyOn(window, "confirm").mockReturnValue(true);
  await user.click(screen.getByRole("button", { name: "→ submitted（需确认）" }));
  expect(api.transition).toHaveBeenCalledWith("prj_1", "submitted", true);
});

void test("ProjectPanel/Overview: recent tasks show the newest 5, most recent first; none shows an empty state", async () => {
  const api = fakeApi({
    taskInstances: vi.fn().mockResolvedValue(
      Array.from({ length: 6 }, (_, i) => taskInstance({ id: `t${i}`, taskId: `task_${i}` })),
    ),
  });
  render(<ProjectPanel api={api} id="prj_1" tab="overview" />);
  await screen.findByText("标书编写 1.0.0");

  expect(screen.getByText("task_5")).toBeInTheDocument();
  expect(screen.queryByText("task_0")).not.toBeInTheDocument();
});

void test("ProjectPanel/Overview: a suspended task reads as paused-not-broken; an unmapped state shows its raw name, not silently dropped", async () => {
  const api = fakeApi({
    taskInstances: vi.fn().mockResolvedValue([
      taskInstance({ id: "t1", taskId: "paused_task", state: "suspended" }),
      taskInstance({ id: "t2", taskId: "weird_task", state: "some_new_state" }),
    ]),
  });
  render(<ProjectPanel api={api} id="prj_1" tab="overview" />);
  await screen.findByText("paused_task");
  expect(screen.getByText("已暂停（服务暂时不可用）")).toBeInTheDocument();
  expect(screen.getByText("some_new_state")).toBeInTheDocument();
});

void test("ProjectPanel/Overview: no task instances shows the empty state", async () => {
  const api = fakeApi();
  render(<ProjectPanel api={api} id="prj_1" tab="overview" />);
  expect(await screen.findByText("尚无任务执行记录")).toBeInTheDocument();
});

void test("ProjectPanel/Overview: exporting reports the file count, chain head, and unsigned notice", async () => {
  const api = fakeApi({
    exportProject: vi.fn().mockResolvedValue({
      path: "D:\\exports\\prj_1",
      files: ["manifest.json", "audit.json"],
      chain: { genesis: "g", head: "0123456789abcdef", events: 3 },
      signed: false,
    }),
  });
  render(<ProjectPanel api={api} id="prj_1" tab="overview" />);
  await screen.findByText("标书编写 1.0.0");

  const user = userEvent.setup();
  const exportButton = screen.getByRole("button", { name: "导出" });
  expect(exportButton).toBeDisabled();
  await user.type(screen.getByPlaceholderText("导出到（已授权的目录）"), "D:\\exports\\prj_1");
  await user.click(exportButton);

  expect(await screen.findByText("已导出 2 个文件到 D:\\exports\\prj_1")).toBeInTheDocument();
  expect(screen.getByText(/尚未签名/)).toBeInTheDocument();
  expect(api.exportProject).toHaveBeenCalledWith("prj_1", "D:\\exports\\prj_1");
});

void test("ProjectPanel/Overview: a signed export says so plainly, not the unsigned caveat", async () => {
  const api = fakeApi({
    exportProject: vi.fn().mockResolvedValue({
      path: "D:\\exports\\prj_1",
      files: ["manifest.json"],
      chain: { genesis: "g", head: "abc", events: 1 },
      signed: true,
    }),
  });
  render(<ProjectPanel api={api} id="prj_1" tab="overview" />);
  await screen.findByText("标书编写 1.0.0");

  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText("导出到（已授权的目录）"), "D:\\exports\\prj_1");
  await user.click(screen.getByRole("button", { name: "导出" }));

  expect(await screen.findByText("已签名。")).toBeInTheDocument();
  expect(screen.queryByText(/尚未签名/)).not.toBeInTheDocument();
});

void test("ProjectPanel/Overview: an export failure shows the error inline", async () => {
  const api = fakeApi({
    exportProject: vi.fn().mockRejectedValue(new Error("目录未授权")),
  });
  render(<ProjectPanel api={api} id="prj_1" tab="overview" />);
  await screen.findByText("标书编写 1.0.0");

  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText("导出到（已授权的目录）"), "C:\\nope");
  await user.click(screen.getByRole("button", { name: "导出" }));
  expect(await screen.findByText("目录未授权")).toBeInTheDocument();
});

/* ---------------- Context tab ---------------- */

void test("ProjectPanel/Context: lists grants, and adding one calls api.addGrant and clears the input", async () => {
  const api = fakeApi({ grants: vi.fn().mockResolvedValue([grant({ path: "C:\\proj\\a" })]) });
  render(<ProjectPanel api={api} id="prj_1" tab="context" />);
  expect(await screen.findByText("C:\\proj\\a")).toBeInTheDocument();

  const user = userEvent.setup();
  const input = screen.getByPlaceholderText("文件夹绝对路径") as HTMLInputElement;
  await user.type(input, "C:\\proj\\b");
  await user.click(screen.getByRole("button", { name: "授权" }));
  expect(api.addGrant).toHaveBeenCalledWith("prj_1", "C:\\proj\\b");
  expect(input.value).toBe("");
});

void test("ProjectPanel/Context: no grants shows the empty state", async () => {
  const api = fakeApi();
  render(<ProjectPanel api={api} id="prj_1" tab="context" />);
  expect(await screen.findByText("尚未授权任何文件夹")).toBeInTheDocument();
});

void test("ProjectPanel/Context: binding a type+root calls api.setBinding and clears only the root input", async () => {
  const api = fakeApi({
    workspace: vi.fn().mockResolvedValue(projectView({ tasks: [taskDef({ input_types: ["tender_doc"] })] })),
  });
  render(<ProjectPanel api={api} id="prj_1" tab="context" />);
  await screen.findByText("类型绑定 · Bindings");

  const user = userEvent.setup();
  const rootInput = screen.getByPlaceholderText("已授权文件夹内的路径") as HTMLInputElement;
  await user.type(rootInput, "docs/tender");
  await user.click(screen.getByRole("button", { name: "绑定并索引" }));
  expect(api.setBinding).toHaveBeenCalledWith("prj_1", "tender_doc", "docs/tender");
  expect(rootInput.value).toBe("");
});

void test("ProjectPanel/Context: choosing a non-default context type in the binding selector is honored", async () => {
  const api = fakeApi({
    workspace: vi.fn().mockResolvedValue(
      projectView({ tasks: [taskDef({ input_types: ["tender_doc", "budget_sheet"] })] }),
    ),
  });
  render(<ProjectPanel api={api} id="prj_1" tab="context" />);
  await screen.findByText("类型绑定 · Bindings");

  const user = userEvent.setup();
  await user.selectOptions(screen.getByRole("combobox"), "budget_sheet");
  await user.type(screen.getByPlaceholderText("已授权文件夹内的路径"), "docs/budget");
  await user.click(screen.getByRole("button", { name: "绑定并索引" }));
  expect(api.setBinding).toHaveBeenCalledWith("prj_1", "budget_sheet", "docs/budget");
});

void test("ProjectPanel/Context: expanding a binding fetches and lists its context items, then collapses", async () => {
  const api = fakeApi({
    bindings: vi.fn().mockResolvedValue([binding({ type: "tender_doc", root: "docs/tender" })]),
    contextItems: vi.fn().mockResolvedValue([
      { id: "c1", type: "tender_doc", source: "local", connector: "fs", ref: "docs/tender/招标文件.pdf", name: "招标文件.pdf", bytes: 4096, modifiedAt: "2026-06-01T00:00:00.000Z" },
    ]),
  });
  render(<ProjectPanel api={api} id="prj_1" tab="context" />);
  const toggle = await screen.findByText("查看条目");

  const user = userEvent.setup();
  await user.click(toggle);
  expect(await screen.findByText("招标文件.pdf")).toBeInTheDocument();
  expect(api.contextItems).toHaveBeenCalledWith("prj_1", "tender_doc");

  await user.click(screen.getByText("收起"));
  expect(screen.queryByText("招标文件.pdf")).not.toBeInTheDocument();
  // 折叠再展开不重新拉取——items 已经拿到过一次就缓存住了。
  await user.click(screen.getByText("查看条目"));
  expect(await screen.findByText("招标文件.pdf")).toBeInTheDocument();
  expect(api.contextItems).toHaveBeenCalledTimes(1);
});

void test("ProjectPanel/Context: a failed context-items fetch reads as no items, not stuck loading forever", async () => {
  const api = fakeApi({
    bindings: vi.fn().mockResolvedValue([binding({ type: "tender_doc", root: "docs/tender" })]),
    contextItems: vi.fn().mockRejectedValue(new Error("索引损坏")),
  });
  render(<ProjectPanel api={api} id="prj_1" tab="context" />);
  const toggle = await screen.findByText("查看条目");

  const user = userEvent.setup();
  await user.click(toggle);
  expect(await screen.findByText("（该绑定当前未发现任何条目）")).toBeInTheDocument();
});

/* ---------------- Tasks tab ---------------- */

void test("ProjectPanel/Tasks: a blocked task disables launch and explains why", async () => {
  const api = fakeApi({
    workspace: vi.fn().mockResolvedValue(
      projectView({ tasks: [taskDef({ unrunnable: ["pdf-render"] })] }),
    ),
  });
  render(<ProjectPanel api={api} id="prj_1" tab="tasks" />);
  expect(await screen.findByText(/本机跑不了这个任务/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "启动（自动选择上下文）" })).toBeDisabled();
});

void test("ProjectPanel/Tasks: a task with no declared input types shows （无）, not a dangling label", async () => {
  const api = fakeApi({
    workspace: vi.fn().mockResolvedValue(projectView({ tasks: [taskDef({ input_types: [] })] })),
  });
  render(<ProjectPanel api={api} id="prj_1" tab="tasks" />);
  expect(await screen.findByText(/输入类型: （无）/)).toBeInTheDocument();
});

void test("ProjectPanel/Tasks: launching without manual input calls startTask with undefined inputs", async () => {
  const api = fakeApi({ workspace: vi.fn().mockResolvedValue(projectView({ tasks: [taskDef()] })) });
  render(<ProjectPanel api={api} id="prj_1" tab="tasks" />);
  await screen.findByText("draft_section");

  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "启动（自动选择上下文）" }));
  expect(api.startTask).toHaveBeenCalledWith("prj_1", "draft_section", undefined);
});

void test("ProjectPanel/Tasks: manual mode launches with the parsed JSON, and a parse error blocks the call", async () => {
  const api = fakeApi({ workspace: vi.fn().mockResolvedValue(projectView({ tasks: [taskDef()] })) });
  render(<ProjectPanel api={api} id="prj_1" tab="tasks" />);
  await screen.findByText("draft_section");

  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "手动提供输入" }));
  const textarea = screen.getByRole("textbox");
  await user.clear(textarea);
  await user.type(textarea, "not json");
  await user.click(screen.getByRole("button", { name: "以手动输入启动" }));
  expect(api.startTask).not.toHaveBeenCalled();
  // JSON.parse 的报错原文随 Node 版本变化，不钉死措辞——只认这个错误盒子
  // 真的出现了且不是空的。
  await vi.waitFor(() => {
    const box = document.querySelector(".card .error-box");
    expect(box).toBeInTheDocument();
    expect(box?.textContent).toBeTruthy();
  });

  await user.clear(textarea);
  // userEvent.type 只把 { 当特殊键序列的起始符（{{ 转义成字面 {）；} 本身
  // 不触发任何东西，字面写一个就够，写 }} 会多打出一个 }。
  await user.type(textarea, '{{"section":"intro"}');
  await user.click(screen.getByRole("button", { name: "以手动输入启动" }));
  expect(api.startTask).toHaveBeenCalledWith("prj_1", "draft_section", { section: "intro" });
});

void test("ProjectPanel/Tasks: instances list newest-first; expanding one reveals verification and provenance", async () => {
  const api = fakeApi({
    taskInstances: vi.fn().mockResolvedValue([
      taskInstance({ id: "t_old", taskId: "old_task", error: "工具执行失败：连接超时" }),
      taskInstance({
        id: "t_new",
        taskId: "new_task",
        verification: [{ id: "v1", kind: "schema", status: "passed" }],
        result: { content: { summary: "完成起草" }, sources: ["招标文件.pdf"] },
      }),
    ]),
  });
  render(<ProjectPanel api={api} id="prj_1" tab="tasks" />);
  await screen.findByText("new_task");

  // 实例自己的失败原因常驻显示，不需要展开——不是只有摘要带才说得清出了
  // 什么问题。
  expect(screen.getByText("工具执行失败：连接超时")).toBeInTheDocument();

  const cards = document.querySelectorAll(".card.clickable");
  expect(cards[0]).toHaveTextContent("new_task");

  const user = userEvent.setup();
  await user.click(screen.getByText("new_task"));
  expect(await screen.findByText("完成起草")).toBeInTheDocument();
  expect(screen.getByText(/来源（Provenance）: 招标文件\.pdf/)).toBeInTheDocument();

  // 详情区自己的 onClick 会 stopPropagation——点详情区内部不应该冒泡到卡片
  // 头部，把刚展开的面板又收起来。
  await user.click(screen.getByText("完成起草"));
  expect(screen.getByText("完成起草")).toBeInTheDocument();
});

void test("ProjectPanel/Tasks: no instances shows the empty state", async () => {
  const api = fakeApi({ workspace: vi.fn().mockResolvedValue(projectView({ tasks: [taskDef()] })) });
  render(<ProjectPanel api={api} id="prj_1" tab="tasks" />);
  expect(await screen.findByText("尚无任务实例")).toBeInTheDocument();
});

/* ---------------- Audit tab ---------------- */

void test("ProjectPanel/Audit: lists events and filters by kind; an unparseable timestamp shows as-is rather than vanishing", async () => {
  const api = fakeApi({
    audit: vi.fn().mockResolvedValue([
      auditEvent({ eventId: "a1", action: "project.created" }),
      auditEvent({ eventId: "a2", action: "task.started", actor: "sys" }),
      auditEvent({ eventId: "a3", action: "legacy.note", occurredAt: "not-a-timestamp" }),
    ]),
  });
  render(<ProjectPanel api={api} id="prj_1" tab="audit" />);
  expect(await screen.findByText("审计轨迹 · 3 条")).toBeInTheDocument();
  // 事件名同时出现在筛选下拉的 <option> 里和表格行里——都是预期行为，这里
  // 只钉表格那一处。
  const rows = () => within(document.querySelector(".audit-table") as HTMLElement);
  expect(rows().getByText("project.created")).toBeInTheDocument();
  expect(rows().getByText("task.started")).toBeInTheDocument();
  // shortTime 的正则认不出这个时间戳时照原样显示，不是崩溃或吞掉这一行。
  expect(rows().getByText("not-a-timestamp")).toBeInTheDocument();

  const user = userEvent.setup();
  await user.selectOptions(screen.getByRole("combobox"), "task.started");
  expect(rows().queryByText("project.created")).not.toBeInTheDocument();
  expect(rows().getByText("task.started")).toBeInTheDocument();
});

void test("ProjectPanel/Audit: an unknown outcome reads as 结果未记录, not silently as success", async () => {
  const api = fakeApi({
    audit: vi.fn().mockResolvedValue([auditEvent({ outcome: "unknown" as AuditEvent["outcome"] })]),
  });
  render(<ProjectPanel api={api} id="prj_1" tab="audit" />);
  expect(await screen.findByText("结果未记录")).toBeInTheDocument();
});

void test("ProjectPanel/Audit: a genuinely unmapped outcome falls back to the raw string with a neutral tone", async () => {
  const api = fakeApi({
    audit: vi.fn().mockResolvedValue([auditEvent({ outcome: "partial" as AuditEvent["outcome"] })]),
  });
  render(<ProjectPanel api={api} id="prj_1" tab="audit" />);
  expect(await screen.findByText("partial")).toBeInTheDocument();
});

/* ---------------- Live updates ---------------- */

void test("ProjectPanel: a task event for this project triggers a refresh; a different project's event does not", async () => {
  let onEvent: ((e: { kind: "task"; projectId: string; taskInstance: string }) => void) | undefined;
  const api = fakeApi({
    subscribe: vi.fn((cb) => {
      onEvent = cb;
      return () => {};
    }),
  });
  render(<ProjectPanel api={api} id="prj_1" tab="overview" />);
  await screen.findByText("标书编写 1.0.0");
  expect(api.workspace).toHaveBeenCalledTimes(1);

  onEvent?.({ kind: "task", projectId: "prj_other", taskInstance: "x" });
  await new Promise((r) => setTimeout(r, 0));
  expect(api.workspace).toHaveBeenCalledTimes(1);

  onEvent?.({ kind: "task", projectId: "prj_1", taskInstance: "x" });
  await vi.waitFor(() => expect(api.workspace).toHaveBeenCalledTimes(2));
});

void test("ProjectPanel: reports the waiting_human count upward via onPending", async () => {
  const onPending = vi.fn();
  const api = fakeApi({
    taskInstances: vi.fn().mockResolvedValue([
      taskInstance({ id: "t1", state: "waiting_human" }),
      taskInstance({ id: "t2", state: "waiting_human" }),
      taskInstance({ id: "t3", state: "completed" }),
    ]),
  });
  render(<ProjectPanel api={api} id="prj_1" tab="overview" onPending={onPending} />);
  await vi.waitFor(() => expect(onPending).toHaveBeenCalledWith(2));
});

/* ---------------- Connectors (ADR-005 path two) ---------------- */

const crm = {
  id: "crm",
  transport: "stdio" as const,
  command: "node",
  args: ["crm.js"],
  source: "lan" as const,
  installedAt: "2026-09-03T00:00:00.000Z",
  health: { ok: true, checkedAt: "2026-09-03T00:00:00.000Z" },
};

void test("ProjectPanel/Context: no connectors installed -> the connector section does not exist, the binding form has no 经由 select", async () => {
  const api = fakeApi({ grants: vi.fn().mockResolvedValue([grant()]) });
  render(<ProjectPanel api={api} id="prj_1" tab="context" />);
  await screen.findByText("C:\\proj\\docs");
  expect(screen.queryByText("连接器授权 · Connectors")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("经由")).not.toBeInTheDocument();
});

void test("ProjectPanel/Context: an installed, ungranted connector can be granted to this project", async () => {
  const api = fakeApi({
    grants: vi.fn().mockResolvedValue([grant()]),
    connectors: vi.fn().mockResolvedValue({ items: [crm] }),
  });
  render(<ProjectPanel api={api} id="prj_1" tab="context" />);
  expect(await screen.findByText("连接器授权 · Connectors")).toBeInTheDocument();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "授权连接器" }));
  expect(api.addConnectorGrant).toHaveBeenCalledWith("prj_1", "crm");
  // Folder count stays folder-only in the summary.
  expect(screen.getByText("0 类 · 1 个授权目录")).toBeInTheDocument();
});

void test("ProjectPanel/Context: a granted connector is listed, counted apart from folders, and binding 经由 it sends connector+source", async () => {
  const api = fakeApi({
    workspace: vi.fn().mockResolvedValue(projectView({ tasks: [taskDef({ input_types: ["tender_doc"] })] })),
    grants: vi.fn().mockResolvedValue([
      grant(),
      { id: "g2", kind: "connector", connector: "crm", mode: "read", createdAt: "2026-09-03T00:00:00.000Z" },
    ]),
    connectors: vi.fn().mockResolvedValue({ items: [crm] }),
  });
  render(<ProjectPanel api={api} id="prj_1" tab="context" />);
  await screen.findByText("连接器授权 · Connectors");
  expect(within(screen.getByLabelText("已授权的连接器")).getByText("crm")).toBeInTheDocument();
  // Already granted -> nothing left to grant, the control is gone.
  expect(screen.queryByRole("button", { name: "授权连接器" })).not.toBeInTheDocument();
  expect(screen.getByText(/1 个授权目录 · 1 个连接器/)).toBeInTheDocument();

  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("经由"), "crm");
  const root = screen.getByPlaceholderText("资源 URI 前缀（如 crm://accounts/）");
  await user.type(root, "crm://accounts/");
  await user.click(screen.getByRole("button", { name: "绑定并索引" }));
  expect(api.setBinding).toHaveBeenCalledWith("prj_1", "tender_doc", "crm://accounts/", {
    connector: "crm",
    source: "lan",
  });
});

void test("ProjectPanel/Context: a binding through a connector says which one; a local-fs one does not", async () => {
  const api = fakeApi({
    bindings: vi.fn().mockResolvedValue([
      binding({ type: "tender_doc", root: "docs/tender", connector: "local-fs" }),
      binding({ type: "enterprise_capability", root: "crm://accounts/", connector: "crm", source: "lan" }),
    ]),
  });
  render(<ProjectPanel api={api} id="prj_1" tab="context" />);
  expect(await screen.findByText("连接器 crm · lan")).toBeInTheDocument();
  expect(screen.getAllByText(/^连接器 /)).toHaveLength(1);
});

void test("ProjectPanel/Context: when /connectors cannot be reached the connector section is simply absent (unknown is not none)", async () => {
  const api = fakeApi({
    grants: vi.fn().mockResolvedValue([grant()]),
    connectors: vi.fn().mockRejectedValue(new Error("503")),
  });
  render(<ProjectPanel api={api} id="prj_1" tab="context" />);
  await screen.findByText("rw");
  expect(screen.queryByText("连接器授权 · Connectors")).not.toBeInTheDocument();
});

void test("ProjectPanel/Context: with two grantable connectors the chosen one is granted, and an unhealthy one says so in the option", async () => {
  const api = fakeApi({
    connectors: vi.fn().mockResolvedValue({
      items: [crm, { ...crm, id: "erp", source: "private" as const, health: { ok: false, checkedAt: "x" } }],
    }),
  });
  render(<ProjectPanel api={api} id="prj_1" tab="context" />);
  const select = await screen.findByLabelText("要授权的连接器");
  expect(within(select).getByText("erp（private，未运行）")).toBeInTheDocument();
  const user = userEvent.setup();
  await user.selectOptions(select, "erp");
  await user.click(screen.getByRole("button", { name: "授权连接器" }));
  expect(api.addConnectorGrant).toHaveBeenCalledWith("prj_1", "erp");
});

void test("ProjectPanel/Context: a connector granted but no longer installed still offers 经由, and the source falls back to lan for the kernel to judge", async () => {
  const api = fakeApi({
    workspace: vi.fn().mockResolvedValue(projectView({ tasks: [taskDef({ input_types: ["tender_doc"] })] })),
    grants: vi.fn().mockResolvedValue([
      { id: "g2", kind: "connector", connector: "gone", mode: "read", createdAt: "2026-09-03T00:00:00.000Z" },
    ]),
    connectors: vi.fn().mockResolvedValue({ items: [] }),
  });
  render(<ProjectPanel api={api} id="prj_1" tab="context" />);
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByLabelText("经由"), "gone");
  await user.type(screen.getByPlaceholderText("资源 URI 前缀（如 crm://accounts/）"), "x://");
  await user.click(screen.getByRole("button", { name: "绑定并索引" }));
  expect(api.setBinding).toHaveBeenCalledWith("prj_1", "tender_doc", "x://", { connector: "gone", source: "lan" });
});
