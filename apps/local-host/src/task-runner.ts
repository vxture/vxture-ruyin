/**
 * Drives task instances outside the request that created them.
 *
 * A real capability provider takes tens of seconds per turn (ADR-002: the
 * runtime owns the loop, so a task is several round trips). Running one inside
 * its HTTP request would hold the connection open for minutes - the mock
 * returned instantly, which is the only reason the synchronous version looked
 * fine. The request now records the instance and returns 202; this drives it
 * to the next resting point.
 *
 * This is also where recovery will hook in (50-harness section 8): the same
 * `advance()` entry point, called on startup for every non-terminal instance.
 */

import type { WorkspaceRuntime } from "@vxture/ruyin-core";

export class TaskRunner {
  /** Instances currently being driven, so a retry does not double-drive. */
  private readonly inFlight = new Set<string>();

  /**
   * Shared with the runtime's cancellation check. In memory rather than on the
   * record because the running loop holds its own copy and would overwrite a
   * persisted flag on its next write; the persisted state is set by
   * `Harness.cancel` for durability and audit.
   */
  constructor(
    private readonly runtime: WorkspaceRuntime,
    private readonly cancelled: Set<string> = new Set(),
  ) {}

  /** True while this runner is driving the instance. */
  isRunning(taskInstanceId: string): boolean {
    return this.inFlight.has(taskInstanceId);
  }

  /**
   * Ask a task to stop. A running one stops at its next safe point; an idle
   * one is marked immediately by the harness.
   */
  async cancel(workspaceId: string, taskInstanceId: string): Promise<unknown> {
    this.cancelled.add(taskInstanceId);
    const harness = await this.runtime.createHarness(workspaceId);
    return harness.cancel(taskInstanceId);
  }

  /**
   * Fire-and-forget: the caller has already answered its request. Harness
   * `advance()` is itself claim-guarded, so a duplicate call is a no-op even
   * across processes; this set only avoids the pointless work locally.
   */
  start(workspaceId: string, taskInstanceId: string): void {
    this.spawn(workspaceId, taskInstanceId, "advance");
  }

  /**
   * Startup sweep: re-arm and drive every task a previous process died
   * holding. Without it an interrupted task stays mid-flight forever - the
   * user sees one that never finishes and cannot be restarted either, because
   * the runtime still believes it is running.
   *
   * Returns how many were picked up, so the daemon can say so on startup
   * rather than recovering silently.
   */
  async recoverAll(): Promise<number> {
    let picked = 0;
    for (const workspace of await this.runtime.listWorkspaces()) {
      const interrupted = await this.runtime.listInterruptedTasks(workspace.id);
      for (const task of interrupted) {
        picked += 1;
        this.spawn(workspace.id, task.id, "recover");
      }
    }
    return picked;
  }

  private spawn(
    workspaceId: string,
    taskInstanceId: string,
    mode: "advance" | "recover",
  ): void {
    if (this.inFlight.has(taskInstanceId)) return;
    this.inFlight.add(taskInstanceId);
    void this.drive(workspaceId, taskInstanceId, mode).finally(() => {
      this.inFlight.delete(taskInstanceId);
    });
  }

  private async drive(
    workspaceId: string,
    taskInstanceId: string,
    mode: "advance" | "recover",
  ): Promise<void> {
    try {
      const harness = await this.runtime.createHarness(workspaceId);
      await (mode === "recover"
        ? harness.recover(taskInstanceId)
        : harness.advance(taskInstanceId));
    } catch (cause) {
      // advance() records failures it can attribute to the task itself. This
      // catches the ones it cannot - the store or contract being unreadable -
      // where there is no durable place left to write the reason.
      console.error(
        `[ruyin] task ${taskInstanceId} could not be advanced:`,
        cause instanceof Error ? cause.message : cause,
      );
    }
  }
}
