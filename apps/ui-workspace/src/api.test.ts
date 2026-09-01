import { afterEach, beforeEach, expect, test, vi } from "vitest";
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

function checkpoint(over: Partial<Checkpoint> = {}): Checkpoint {
  return {
    id: "cp_1",
    kind: "tool_ask",
    subject: {},
    options: ["approve", "reject"],
    raisedAt: "2026-09-01T00:00:00Z",
    ...over,
  };
}

function instance(checkpoints: Checkpoint[]): TaskInstance {
  return {
    id: "ti_1",
    taskId: "run",
    state: "waiting_human",
    checkpoints,
    verification: [],
    capabilityOutputs: {},
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
  };
}

void test("pendingCheckpoint: the first undecided checkpoint, not the last", () => {
  const decided = checkpoint({ id: "cp_1", decision: { by: "u1", choice: "approve", at: "" } });
  const waiting = checkpoint({ id: "cp_2" });
  expect(pendingCheckpoint(instance([decided, waiting]))?.id).toBe("cp_2");
});

void test("pendingCheckpoint: undefined when every checkpoint is decided", () => {
  const decided = checkpoint({ decision: { by: "u1", choice: "approve", at: "" } });
  expect(pendingCheckpoint(instance([decided]))).toBeUndefined();
});

void test("pendingCheckpoint: undefined when there are no checkpoints at all", () => {
  expect(pendingCheckpoint(instance([]))).toBeUndefined();
  const noArray = { ...instance([]), checkpoints: undefined as unknown as Checkpoint[] };
  expect(pendingCheckpoint(noArray)).toBeUndefined();
});

void test("isLegacyAuditEvent: distinguishes the two stored shapes", () => {
  const modern: AuditEvent = {
    eventId: "e1",
    occurredAt: "",
    actorId: "u1",
    actorConsole: null,
    actor: "user",
    objectType: "project",
    objectId: "p1",
    action: "project.created",
    outcome: "success",
    workspace: "p1",
    prevHash: "x",
    hash: "y",
    payload: {},
  };
  const legacy: LegacyAuditEvent = {
    event_id: "e1",
    workspace: "p1",
    kind: "project.created",
    actor: "user",
    timestamp: "",
    prev_hash: "x",
    hash: "y",
    payload: {},
  };
  expect(isLegacyAuditEvent(modern)).toBe(false);
  expect(isLegacyAuditEvent(legacy)).toBe(true);
});

void test("auditView: a modern event passes through unchanged", () => {
  const modern: AuditEvent = {
    eventId: "e1",
    occurredAt: "2026-09-01T00:00:00Z",
    actorId: "u1",
    actorConsole: null,
    actor: "user",
    objectType: "project",
    objectId: "p1",
    action: "project.created",
    outcome: "success",
    workspace: "p1",
    prevHash: "x",
    hash: "y",
    payload: { a: 1 },
  };
  expect(auditView(modern)).toEqual(modern);
});

void test("auditView: a legacy event maps field names, and its outcome is 'unknown' - never guessed", () => {
  const legacy: LegacyAuditEvent = {
    event_id: "e1",
    workspace: "p1",
    kind: "project.created",
    actor: "user",
    timestamp: "2026-08-01T00:00:00Z",
    prev_hash: "x",
    hash: "y",
    payload: { a: 1 },
  };
  const view = auditView(legacy);
  expect(view.eventId).toBe("e1");
  expect(view.occurredAt).toBe("2026-08-01T00:00:00Z");
  expect(view.action).toBe("project.created");
  expect(view.actor).toBe("user");
  expect(view.hash).toBe("y");
  expect(view.payload).toEqual({ a: 1 });
  // 旧记录不知道真实结果 —— 标成 unknown，不是默认成功。
  expect(view.outcome).toBe("unknown");
});

// --- Api class: fetch is mocked, no real network ---------------------------

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

void test("Api: sends the bearer token on every call, and GET has no body", async () => {
  const fetchMock = vi.mocked(globalThis.fetch);
  fetchMock.mockResolvedValueOnce(jsonResponse(200, [{ id: "vxture.bid" }]));

  const api = new Api("tok-123");
  await api.products();

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [path, init] = fetchMock.mock.calls[0]!;
  expect(path).toBe("/products");
  expect((init as RequestInit).headers).toMatchObject({ authorization: "Bearer tok-123" });
  expect((init as RequestInit).body).toBeUndefined();
});

void test("Api: a POST call sends a JSON body and content-type", async () => {
  const fetchMock = vi.mocked(globalThis.fetch);
  fetchMock.mockResolvedValueOnce(
    jsonResponse(201, { id: "prj_1", productId: "vxture.bid", name: "x" }),
  );

  const api = new Api("tok-123");
  await api.createProject("vxture.bid", "投标项目");

  const [path, init] = fetchMock.mock.calls[0]!;
  expect(path).toBe("/projects");
  const req = init as RequestInit;
  expect(req.method).toBe("POST");
  expect(req.headers).toMatchObject({ "content-type": "application/json" });
  expect(JSON.parse(req.body as string)).toEqual({
    product: "vxture.bid",
    name: "投标项目",
  });
});

void test("Api: a non-ok response becomes an ApiError, not a silently-accepted body", async () => {
  const fetchMock = vi.mocked(globalThis.fetch);
  fetchMock.mockResolvedValueOnce(
    jsonResponse(403, { code: "POLICY_DENIED", message: "该项目属于另一个工作区" }),
  );

  const api = new Api("tok-123");
  await expect(api.products()).rejects.toThrow(ApiError);
  fetchMock.mockResolvedValueOnce(
    jsonResponse(403, { code: "POLICY_DENIED", message: "该项目属于另一个工作区" }),
  );
  await expect(api.products()).rejects.toMatchObject({
    status: 403,
    message: "该项目属于另一个工作区",
  });
});
