/**
 * Api (api.ts): the real HTTP client. Every other test file in this app
 * builds a fakeApi() and never touches this class - this is the one place
 * call()'s auth/body/error handling, installPackage()'s binary upload path,
 * subscribe()'s SSE wiring, and the pure helper functions (pendingCheckpoint/
 * isLegacyAuditEvent/auditView) actually run for real.
 */

import { afterEach, expect, test, vi } from "vitest";
import {
  Api,
  ApiError,
  auditView,
  isLegacyAuditEvent,
  pendingCheckpoint,
  type AuditEvent,
  type Checkpoint,
  type LegacyAuditEvent,
  type TaskInstance,
} from "./api";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

/* ---------------- call() - the core every wrapper method goes through ---------------- */

void test("Api: a GET sends the bearer token and no body", async () => {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
  globalThis.fetch = fetchMock;
  const api = new Api("tok_123");

  await api.products();

  expect(fetchMock).toHaveBeenCalledWith("/products", {
    method: "GET",
    headers: { authorization: "Bearer tok_123" },
    body: undefined,
  });
});

void test("Api: a POST with a body sends it as JSON with a content-type header", async () => {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ businessState: "reviewing" }));
  globalThis.fetch = fetchMock;
  const api = new Api("tok_123");

  await api.transition("prj_1", "reviewing", true);

  expect(fetchMock).toHaveBeenCalledWith("/projects/prj_1/state", {
    method: "POST",
    headers: {
      authorization: "Bearer tok_123",
      "content-type": "application/json",
    },
    body: JSON.stringify({ to: "reviewing", humanConfirmed: true }),
  });
});

void test("Api: a non-ok response throws ApiError carrying the status and parsed body", async () => {
  // mockImplementation, not mockResolvedValue: a Response body can only be
  // read once, and this test awaits the rejection twice.
  globalThis.fetch = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve(jsonResponse({ code: "POLICY_DENIED", message: "本机已停用" }, 403)),
    );
  const api = new Api("tok_123");

  await expect(api.products()).rejects.toMatchObject({
    status: 403,
    body: { code: "POLICY_DENIED", message: "本机已停用" },
    message: "本机已停用",
  });
  await expect(api.products()).rejects.toBeInstanceOf(ApiError);
});

void test("Api: a fetch-level rejection (network down) propagates, not swallowed", async () => {
  globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
  const api = new Api("tok_123");
  await expect(api.products()).rejects.toThrow("ECONNREFUSED");
});

/* ---------------- ApiError's message fallback chain ---------------- */

void test("ApiError: prefers body.message, then body.error, then a generic HTTP status line", () => {
  expect(new ApiError(400, { message: "字段缺失" }).message).toBe("字段缺失");
  expect(new ApiError(400, { error: "REQUEST_MALFORMED" }).message).toBe("REQUEST_MALFORMED");
  expect(new ApiError(500, {}).message).toBe("HTTP 500");
});

/* ---------------- Every thin wrapper: the right method/path/body, not a typo ---------------- */

type WrapperCase = {
  name: string;
  call: (api: Api) => Promise<unknown>;
  method: string;
  path: string;
  body?: unknown;
};

const WRAPPER_CASES: WrapperCase[] = [
  { name: "pending", call: (api) => api.pending(), method: "GET", path: "/pending" },
  {
    name: "refreshEntitlements",
    call: (api) => api.refreshEntitlements(),
    method: "POST",
    path: "/entitlements/refresh",
  },
  {
    name: "activateProduct",
    call: (api) => api.activateProduct("vxture.bid"),
    method: "POST",
    path: "/products/vxture.bid/activate",
  },
  {
    name: "deactivateProduct",
    call: (api) => api.deactivateProduct("vxture.bid"),
    method: "POST",
    path: "/products/vxture.bid/deactivate",
  },
  {
    name: "pinProductVersion",
    call: (api) => api.pinProductVersion("vxture.bid", "1.2.0"),
    method: "POST",
    path: "/products/vxture.bid/pin-version",
    body: { version: "1.2.0" },
  },
  { name: "checkUpdate", call: (api) => api.checkUpdate(), method: "GET", path: "/updates/check" },
  { name: "products", call: (api) => api.products(), method: "GET", path: "/products" },
  { name: "projects", call: (api) => api.projects(), method: "GET", path: "/projects" },
  {
    name: "createProject",
    call: (api) => api.createProject("vxture.bid", "投标项目"),
    method: "POST",
    path: "/projects",
    body: { product: "vxture.bid", name: "投标项目" },
  },
  {
    name: "importProject",
    call: (api) => api.importProject("prj_1"),
    method: "POST",
    path: "/projects/prj_1/import",
  },
  {
    name: "exportProject",
    call: (api) => api.exportProject("prj_1", "D:\\out"),
    method: "POST",
    path: "/projects/prj_1/export",
    body: { path: "D:\\out" },
  },
  { name: "workspace", call: (api) => api.workspace("prj_1"), method: "GET", path: "/projects/prj_1" },
  {
    name: "taskInstances",
    call: (api) => api.taskInstances("prj_1"),
    method: "GET",
    path: "/projects/prj_1/tasks",
  },
  {
    name: "startTask (no inputs)",
    call: (api) => api.startTask("prj_1", "draft_section"),
    method: "POST",
    path: "/projects/prj_1/tasks",
    body: { task: "draft_section" },
  },
  {
    name: "startTask (with inputs)",
    call: (api) => api.startTask("prj_1", "draft_section", { section: "intro" }),
    method: "POST",
    path: "/projects/prj_1/tasks",
    body: { task: "draft_section", inputs: { section: "intro" } },
  },
  {
    name: "cancelTask",
    call: (api) => api.cancelTask("prj_1", "ti_1"),
    method: "POST",
    path: "/projects/prj_1/tasks/ti_1/cancel",
  },
  {
    name: "decide",
    call: (api) => api.decide("prj_1", "ti_1", true),
    method: "POST",
    path: "/projects/prj_1/tasks/ti_1/decision",
    body: { approve: true },
  },
  {
    name: "transition",
    call: (api) => api.transition("prj_1", "reviewing", false),
    method: "POST",
    path: "/projects/prj_1/state",
    body: { to: "reviewing", humanConfirmed: false },
  },
  { name: "grants", call: (api) => api.grants("prj_1"), method: "GET", path: "/projects/prj_1/grants" },
  {
    name: "addGrant",
    call: (api) => api.addGrant("prj_1", "C:\\docs"),
    method: "POST",
    path: "/projects/prj_1/grants",
    body: { path: "C:\\docs" },
  },
  {
    name: "bindings",
    call: (api) => api.bindings("prj_1"),
    method: "GET",
    path: "/projects/prj_1/bindings",
  },
  {
    name: "setBinding",
    call: (api) => api.setBinding("prj_1", "tender_doc", "docs/tender"),
    method: "POST",
    path: "/projects/prj_1/bindings",
    body: { type: "tender_doc", root: "docs/tender" },
  },
  {
    name: "setBinding via connector",
    call: (api) => api.setBinding("prj_1", "enterprise_capability", "crm://accounts/", { connector: "crm", source: "lan" }),
    method: "POST",
    path: "/projects/prj_1/bindings",
    body: { type: "enterprise_capability", root: "crm://accounts/", connector: "crm", source: "lan" },
  },
  {
    name: "addConnectorGrant",
    call: (api) => api.addConnectorGrant("prj_1", "crm"),
    method: "POST",
    path: "/projects/prj_1/grants",
    body: { connector: "crm" },
  },
  { name: "connectors", call: (api) => api.connectors(), method: "GET", path: "/connectors" },
  { name: "fetchProduct", call: (api) => api.fetchProduct("vxture.bid"), method: "POST", path: "/products/vxture.bid/fetch" },
  { name: "registry", call: (api) => api.registry(), method: "GET", path: "/registry" },
  {
    name: "installFromRegistry",
    call: (api) => api.installFromRegistry("vxture.bid", "1.0.0"),
    method: "POST",
    path: "/registry/install",
    body: { id: "vxture.bid", version: "1.0.0" },
  },
  {
    name: "installConnector",
    call: (api) => api.installConnector({ id: "crm", command: "node", args: ["crm.js"], source: "lan" }),
    method: "POST",
    path: "/connectors",
    body: { id: "crm", command: "node", args: ["crm.js"], source: "lan" },
  },
  {
    name: "testConnector",
    call: (api) => api.testConnector({ id: "crm", command: "node", args: ["crm.js"] }),
    method: "POST",
    path: "/connectors/test",
    body: { id: "crm", command: "node", args: ["crm.js"] },
  },
  {
    name: "activateConnector",
    call: (api) => api.activateConnector("crm"),
    method: "POST",
    path: "/connectors/crm/activate",
  },
  { name: "removeConnector", call: (api) => api.removeConnector("crm"), method: "DELETE", path: "/connectors/crm" },
  {
    // 数据目录搬家（TD-039）：校验、排队、撤销、请壳重启，四个各一条路。
    name: "checkDataDir",
    call: (api) => api.checkDataDir("D:\RuyinData"),
    method: "POST",
    path: "/system/data-dir/check",
    body: { target: "D:\RuyinData" },
  },
  {
    name: "requestDataDir",
    call: (api) => api.requestDataDir("D:\RuyinData"),
    method: "POST",
    path: "/system/data-dir",
    body: { target: "D:\RuyinData" },
  },
  { name: "cancelDataDir", call: (api) => api.cancelDataDir(), method: "DELETE", path: "/system/data-dir" },
  { name: "restartApp", call: (api) => api.restartApp(), method: "POST", path: "/ui/restart" },
  { name: "audit", call: (api) => api.audit("prj_1"), method: "GET", path: "/projects/prj_1/audit" },
  {
    name: "contextItems",
    call: (api) => api.contextItems("prj_1", "tender_doc"),
    method: "GET",
    path: "/projects/prj_1/context/tender_doc",
  },
  { name: "system", call: (api) => api.system(), method: "GET", path: "/system" },
  { name: "session", call: (api) => api.session(), method: "GET", path: "/auth/session" },
  { name: "login", call: (api) => api.login(), method: "POST", path: "/auth/login" },
  { name: "logout", call: (api) => api.logout(), method: "POST", path: "/auth/logout" },
  {
    name: "entitlements",
    call: (api) => api.entitlements(["vxture.bid", "vxture.crm"]),
    method: "GET",
    path: "/entitlements?products=vxture.bid%2Cvxture.crm",
  },
];

for (const c of WRAPPER_CASES) {
  void test(`Api.${c.name}: calls ${c.method} ${c.path}`, async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    globalThis.fetch = fetchMock;
    const api = new Api("tok_123");

    await c.call(api);

    expect(fetchMock).toHaveBeenCalledWith(c.path, {
      method: c.method,
      headers: {
        authorization: "Bearer tok_123",
        ...(c.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: c.body !== undefined ? JSON.stringify(c.body) : undefined,
    });
  });
}

/* ---------------- installPackage(): a different upload path entirely ---------------- */

void test("Api.installPackage: uploads raw bytes with an octet-stream content-type, not JSON", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(jsonResponse({ productId: "vxture.bid", version: "1.2.0", signed: false }));
  globalThis.fetch = fetchMock;
  const api = new Api("tok_123");
  const bytes = new Uint8Array([1, 2, 3]);
  const file = new File([bytes], "vxture.bid.ruyinpkg");

  const result = await api.installPackage(file);

  expect(result).toEqual({ productId: "vxture.bid", version: "1.2.0", signed: false });
  const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(path).toBe("/products/install");
  expect(init.method).toBe("POST");
  expect(init.headers).toMatchObject({
    authorization: "Bearer tok_123",
    "content-type": "application/octet-stream",
  });
  expect(new Uint8Array(init.body as ArrayBuffer)).toEqual(bytes);
});

void test("Api.installPackage: a rejected package (bad signature/shape) throws ApiError, not a silent success", async () => {
  globalThis.fetch = vi
    .fn()
    .mockResolvedValue(jsonResponse({ code: "PACKAGE_REJECTED", message: "签名校验失败" }, 400));
  const api = new Api("tok_123");
  await expect(api.installPackage(new File([], "bad.ruyinpkg"))).rejects.toMatchObject({
    status: 400,
    message: "签名校验失败",
  });
});

/* ---------------- subscribe(): the SSE stream ---------------- */

function sseResponse(text: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

void test("Api.subscribe: delivers events parsed from the stream to onEvent", async () => {
  globalThis.fetch = vi
    .fn()
    .mockResolvedValue(sseResponse('data: {"kind":"task","projectId":"prj_1","taskInstance":"ti_1"}\n\n'));
  const api = new Api("tok_123");
  const onEvent = vi.fn();

  api.subscribe(onEvent);
  await vi.waitFor(() =>
    expect(onEvent).toHaveBeenCalledWith({ kind: "task", projectId: "prj_1", taskInstance: "ti_1" }),
  );
});

void test("Api.subscribe: the request carries the bearer token, same as every other endpoint", async () => {
  const fetchMock = vi.fn().mockResolvedValue(sseResponse(""));
  globalThis.fetch = fetchMock;
  const api = new Api("tok_123");

  api.subscribe(() => {});
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(path).toBe("/events");
  expect(init.headers).toMatchObject({ authorization: "Bearer tok_123" });
});

void test("Api.subscribe: calling the returned unsubscribe aborts the request", async () => {
  const fetchMock = vi.fn().mockResolvedValue(sseResponse(""));
  globalThis.fetch = fetchMock;
  const api = new Api("tok_123");

  const unsubscribe = api.subscribe(() => {});
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  const signal = init.signal as AbortSignal;
  expect(signal.aborted).toBe(false);

  unsubscribe();
  expect(signal.aborted).toBe(true);
});

void test("Api.subscribe: a non-ok response is swallowed, not thrown (polling fallback covers it)", async () => {
  globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ error: "unauthorized" }, 401));
  const api = new Api("tok_123");
  const onEvent = vi.fn();
  expect(() => api.subscribe(onEvent)).not.toThrow();
  await new Promise((r) => setTimeout(r, 20));
  expect(onEvent).not.toHaveBeenCalled();
});

void test("Api.subscribe: a rejected fetch (network down) is swallowed, not an unhandled rejection", async () => {
  globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
  const api = new Api("tok_123");
  expect(() => api.subscribe(() => {})).not.toThrow();
  await new Promise((r) => setTimeout(r, 20));
  // 走到这里没有抛未处理的 rejection，就是这条用例要证的事——兜底轮询还在，
  // 界面不会因为一次连接失败就崩。
});

/* ---------------- pendingCheckpoint / isLegacyAuditEvent / auditView ---------------- */

function checkpoint(over: Partial<Checkpoint> = {}): Checkpoint {
  return {
    id: "cp1",
    kind: "verification_review",
    subject: null,
    options: ["approve", "reject"],
    raisedAt: "2026-06-01T00:00:00.000Z",
    ...over,
  };
}

function taskInstance(over: Partial<TaskInstance> = {}): TaskInstance {
  return {
    id: "ti_1",
    taskId: "draft_section",
    state: "waiting_human",
    checkpoints: [],
    verification: [],
    capabilityOutputs: {},
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...over,
  };
}

void test("pendingCheckpoint: the first undecided checkpoint, decided ones skipped", () => {
  const decided = checkpoint({
    id: "cp_old",
    decision: { by: "yh", choice: "approve", at: "2026-06-01T00:00:00.000Z" },
  });
  const undecided = checkpoint({ id: "cp_new" });
  expect(pendingCheckpoint(taskInstance({ checkpoints: [decided, undecided] }))?.id).toBe(
    "cp_new",
  );
});

void test("pendingCheckpoint: undefined when every checkpoint is already decided", () => {
  const decided = checkpoint({ decision: { by: "u1", choice: "approve", at: "" } });
  expect(pendingCheckpoint(taskInstance({ checkpoints: [decided] }))).toBeUndefined();
});

void test("pendingCheckpoint: no checkpoints at all is undefined, not a throw", () => {
  expect(pendingCheckpoint(taskInstance({ checkpoints: [] }))).toBeUndefined();
  // instance.checkpoints?.find(...) 里的 ?. 防的正是这个：字段本身缺失
  // （不是空数组）时同样不该抛。
  const noArray = {
    ...taskInstance({ checkpoints: [] }),
    checkpoints: undefined as unknown as TaskInstance["checkpoints"],
  };
  expect(pendingCheckpoint(noArray)).toBeUndefined();
});

void test("isLegacyAuditEvent: distinguishes by the presence of event_id (snake_case)", () => {
  const current: AuditEvent = {
    eventId: "ae_1",
    occurredAt: "2026-06-01T00:00:00.000Z",
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
    payload: {},
  };
  const legacy: LegacyAuditEvent = {
    event_id: "ae_legacy",
    workspace: "wsp_1",
    kind: "workspace.created",
    actor: "yh",
    timestamp: "2026-06-01T00:00:00.000Z",
    prev_hash: "genesis",
    hash: "h1",
    payload: {},
  };
  expect(isLegacyAuditEvent(current)).toBe(false);
  expect(isLegacyAuditEvent(legacy)).toBe(true);
});

void test("auditView: a current-shape event passes through unchanged", () => {
  const event: AuditEvent = {
    eventId: "ae_1",
    occurredAt: "2026-06-01T00:00:00.000Z",
    actorId: "u1",
    actorConsole: null,
    actor: "yh",
    objectType: "project",
    objectId: "prj_1",
    action: "project.created",
    outcome: "success",
    workspace: "wsp_1",
    taskId: "ti_1",
    prevHash: "genesis",
    hash: "h1",
    payload: { note: "x" },
  };
  expect(auditView(event)).toBe(event);
});

void test("auditView: a legacy event maps to the current field names, and its outcome reads as unknown, never guessed", () => {
  const legacy: LegacyAuditEvent = {
    event_id: "ae_legacy",
    workspace: "wsp_1",
    task_instance: "ti_old",
    kind: "workspace.created",
    actor: "yh",
    timestamp: "2026-06-01T00:00:00.000Z",
    prev_hash: "genesis",
    hash: "h1",
    payload: { note: "旧记录" },
  };
  expect(auditView(legacy)).toEqual({
    eventId: "ae_legacy",
    occurredAt: "2026-06-01T00:00:00.000Z",
    action: "workspace.created",
    actor: "yh",
    outcome: "unknown",
    taskId: "ti_old",
    hash: "h1",
    payload: { note: "旧记录" },
  });
});

void test("auditView: a legacy event with no task_instance omits taskId rather than inventing undefined", () => {
  const legacy: LegacyAuditEvent = {
    event_id: "ae_legacy",
    workspace: "wsp_1",
    kind: "workspace.created",
    actor: "yh",
    timestamp: "2026-06-01T00:00:00.000Z",
    prev_hash: "genesis",
    hash: "h1",
    payload: {},
  };
  expect("taskId" in auditView(legacy)).toBe(false);
});
