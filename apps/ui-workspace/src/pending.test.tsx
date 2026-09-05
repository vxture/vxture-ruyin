import { afterEach, expect, test, vi } from "vitest";
import { render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PendingInbox, usePending } from "./pending";
import { Api, type PendingConfirmation } from "./api";

function row(over: Partial<PendingConfirmation> = {}): PendingConfirmation {
  return {
    projectId: "prj_1",
    projectName: "某储能电站 EPC 投标",
    productId: "bidproposal",
    taskInstanceId: "ti_1",
    taskId: "run",
    checkpointId: "cp_1",
    kind: "tool_ask",
    raisedAt: "2026-09-01T00:00:00Z",
    ...over,
  };
}

async function openInbox(): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /等待你确认|没有待确认/ }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

void test("PendingInbox: nothing pending shows the empty state, not a list", async () => {
  render(<PendingInbox rows={[]} onOpen={() => {}} />);
  await openInbox();
  expect(await screen.findByText("没有在等你的事")).toBeInTheDocument();
});

void test("PendingInbox: pending rows render, and the trigger's label says how many", async () => {
  render(
    <PendingInbox
      rows={[
        row(),
        row({ checkpointId: "cp_2", projectName: "城市轨道信号系统投标", kind: "context_confirm" }),
      ]}
      onOpen={() => {}}
    />,
  );
  expect(screen.getByRole("button", { name: "2 项等待你确认" })).toBeInTheDocument();
  await openInbox();
  expect(await screen.findByText("某储能电站 EPC 投标")).toBeInTheDocument();
  expect(screen.getByText("批准一次工具调用")).toBeInTheDocument();
  expect(screen.getByText("城市轨道信号系统投标")).toBeInTheDocument();
  expect(screen.getByText("确认要送出的资料")).toBeInTheDocument();
});

void test("PendingInbox: clicking a row calls onOpen with that row's project id", async () => {
  const onOpen = vi.fn();
  render(<PendingInbox rows={[row({ projectId: "prj_target" })]} onOpen={onOpen} />);
  await openInbox();
  const user = userEvent.setup();
  await user.click(await screen.findByText("某储能电站 EPC 投标"));
  expect(onOpen).toHaveBeenCalledWith("prj_target");
});

void test("PendingInbox: waitedFor buckets the elapsed time - just now / minutes / hours / days", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-05T12:00:00Z"));
  try {
    render(
      <PendingInbox
        rows={[
          row({ checkpointId: "cp_now", raisedAt: "2026-09-05T11:59:30Z" }), // 30s ago
          row({ checkpointId: "cp_min", raisedAt: "2026-09-05T11:45:00Z" }), // 15min ago
          row({ checkpointId: "cp_hr", raisedAt: "2026-09-05T09:00:00Z" }), // 3h ago
          row({ checkpointId: "cp_day", raisedAt: "2026-09-02T12:00:00Z" }), // 3d ago
        ]}
        onOpen={() => {}}
      />,
    );
  } finally {
    vi.useRealTimers();
  }
  // Popover 展开走的是 Radix 的 pointer 事件，跟假时钟同框会卡住——先用假时钟
  // 把行渲染出来，再切回真时钟去点开它。
  await openInbox();

  expect(await screen.findByText("刚刚")).toBeInTheDocument();
  expect(screen.getByText("已等 15 分钟")).toBeInTheDocument();
  expect(screen.getByText("已等 3 小时")).toBeInTheDocument();
  expect(screen.getByText("已等 3 天")).toBeInTheDocument();
});

void test("PendingInbox: a raisedAt in the future (clock skew) reads as 刚刚, not a negative duration", async () => {
  render(<PendingInbox rows={[row({ raisedAt: "2099-01-01T00:00:00Z" })]} onOpen={() => {}} />);
  await openInbox();
  expect(await screen.findByText("刚刚")).toBeInTheDocument();
});

// --- usePending: polling + event-driven refresh, never clears on a failed fetch ---
//
// POLL_MS is 30s - well outside any of these tests' real running time, so the
// setInterval it schedules never actually fires here. No fake timers needed;
// they fight userEvent's own internal timing when shared across a file.

function fakeApi(overrides: Partial<Api> = {}): Api {
  return {
    pending: vi.fn().mockResolvedValue([]),
    subscribe: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  } as unknown as Api;
}

void test("usePending: polls once on mount", async () => {
  const pending = vi.fn().mockResolvedValue([row()]);
  const api = fakeApi({ pending });
  const { result } = renderHook(() => usePending(api));
  await vi.waitFor(() => expect(result.current).toHaveLength(1));
  expect(pending).toHaveBeenCalledTimes(1);
});

void test("usePending: a failed poll keeps the previous rows instead of clearing them", async () => {
  const pending = vi
    .fn()
    .mockResolvedValueOnce([row()])
    .mockRejectedValue(new Error("network down"));
  let onEvent: ((event: { kind: "pending" }) => void) | undefined;
  const api = fakeApi({
    pending,
    subscribe: vi.fn().mockImplementation((cb) => {
      onEvent = cb;
      return () => {};
    }),
  });
  const { result } = renderHook(() => usePending(api));
  await vi.waitFor(() => expect(result.current).toHaveLength(1));

  // 事件驱动的第二次拉取失败：清单不该凭空清空 —— 那比暂时旧一点危险得多。
  onEvent?.({ kind: "pending" });
  await vi.waitFor(() => expect(pending).toHaveBeenCalledTimes(2));
  expect(result.current).toHaveLength(1);
});

void test("usePending: unsubscribes on unmount", () => {
  const stop = vi.fn();
  const api = fakeApi({ subscribe: vi.fn().mockReturnValue(stop) });
  const { unmount } = renderHook(() => usePending(api));
  unmount();
  expect(stop).toHaveBeenCalledTimes(1);
});
