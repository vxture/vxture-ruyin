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
 * This is also where recovery hooks in (50-harness section 8): the same
 * `advance()` entry point, called on startup for every non-terminal instance.
 *
 * ## 并发有上限（TD-045）
 *
 * 在此之前这里只有一个去重集合：它保证同一个任务不被驱动两遍，**不约束同时驱动
 * 几个**。而「在一台机器上承载多个业务超级智能体」是本产品定位的一部分 —— 定位里
 * 有，机制里没有。多个任务同时开工就同时打模型，速率与成本都没有边界，而这台机器
 * 是用户自己的。
 *
 * 现在超过上限的排队（见 `task-queue.ts`，那里写了为什么排队归宿主、为什么不新增
 * 一个 `queued` 状态）。
 */

import type { ProjectRuntime } from "@vxture/ruyin-core";
import type { EventBus } from "./events.js";
import { TaskQueue, type TaskPriority } from "./task-queue.js";

/**
 * 同时驱动的任务数上限。
 *
 * **3 是一个没有依据的起点，这里就这么写着。** 真正的约束不在本机 CPU（任务绝大
 * 多数时间在等模型回话，不是在算），而在能力面的速率与成本 —— 而那两样我们现在
 * 一个数字都没有。等有人同时跑起多个真实任务、量出速率与账单之后，这个默认值才
 * 谈得上有依据。
 *
 * 在此之前它可被 `RUYIN_MAX_CONCURRENT_TASKS` 覆盖：**一个拍脑袋的默认值至少要能
 * 被改**。非正整数一律回落到 3，不接受 0（0 会让每个任务都排队且永不出队 ——
 * 一个把应用变成砖头的配置错，不该静默生效）。
 */
export const DEFAULT_MAX_CONCURRENT_TASKS = 3;

export function maxConcurrentFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env["RUYIN_MAX_CONCURRENT_TASKS"];
  if (raw === undefined) return DEFAULT_MAX_CONCURRENT_TASKS;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_CONCURRENT_TASKS;
}

export interface TaskRunnerOptions {
  /** 同时驱动几个；缺省见 `maxConcurrentFromEnv`。 */
  maxConcurrent?: number;
}

export class TaskRunner {
  /** Instances currently being driven, so a retry does not double-drive. */
  private readonly inFlight = new Set<string>();
  /** 超过上限的排在这里。**不持久化** —— 理由见 task-queue.ts 的头注释。 */
  private readonly queue = new TaskQueue();
  private readonly maxConcurrent: number;

  /**
   * Shared with the runtime's cancellation check. In memory rather than on the
   * record because the running loop holds its own copy and would overwrite a
   * persisted flag on its next write; the persisted state is set by
   * `Harness.cancel` for durability and audit.
   */
  constructor(
    private readonly runtime: ProjectRuntime,
    private readonly cancelled: Set<string> = new Set(),
    /** 任务动了就说一声（TD-027）；不接也能跑，只是回到轮询。 */
    private readonly events?: EventBus,
    options: TaskRunnerOptions = {},
  ) {
    this.maxConcurrent = options.maxConcurrent ?? maxConcurrentFromEnv();
  }

  /**
   * 现在有几个任务真的在跑。
   *
   * **更正一处旧注释（2026-09-07）**：这里此前写着「更新安装的闸门读它（TD-021
   * 策略 1：有任务在跑就不装）」—— 全仓核过，**这个 getter 一个调用者都没有**，
   * 那个闸门不存在（TD-021 定的是 MVP 阶段只检查不安装，所以它也没机会存在）。
   * 一句描述着不存在机制的注释，读起来和真的一模一样。
   *
   * 闸门哪天真做出来，要读的是 `activeCount` 而不是这一个：排队中的任务同样会被
   * 重启打断。
   */
  get runningCount(): number {
    return this.inFlight.size;
  }

  /** 排队等着的数量。 */
  get queuedCount(): number {
    return this.queue.size;
  }

  /** 在跑的 + 在等的。**「现在能不能重启」要问的是这一个。** */
  get activeCount(): number {
    return this.inFlight.size + this.queue.size;
  }

  get concurrencyLimit(): number {
    return this.maxConcurrent;
  }

  isRunning(taskInstanceId: string): boolean {
    return this.inFlight.has(taskInstanceId);
  }

  isQueued(taskInstanceId: string): boolean {
    return this.queue.has(taskInstanceId);
  }

  /** 它排第几（从 1 起）；不在队里返回 0。 */
  queuePosition(taskInstanceId: string): number {
    return this.queue.positionOf(taskInstanceId);
  }

  /**
   * Ask a task to stop. A running one stops at its next safe point; an idle
   * one is marked immediately by the harness.
   *
   * **排队中的先从队里拿掉**（TD-045）：留在队里的话，前面那个跑完时它会被启动
   * —— 用户点了取消，然后眼看着它开始跑。
   */
  async cancel(projectId: string, taskInstanceId: string): Promise<unknown> {
    this.cancelled.add(taskInstanceId);
    if (this.queue.remove(taskInstanceId)) {
      this.announce(projectId, taskInstanceId);
    }
    const harness = await this.runtime.createHarness(projectId);
    return harness.cancel(taskInstanceId);
  }

  /**
   * Fire-and-forget: the caller has already answered its request. Harness
   * `advance()` is itself claim-guarded, so a duplicate call is a no-op even
   * across processes; this set only avoids the pointless work locally.
   */
  start(projectId: string, taskInstanceId: string): void {
    this.admit(projectId, taskInstanceId, "advance");
  }

  /**
   * Startup sweep: re-arm and drive every task a previous process died
   * holding. Without it an interrupted task stays mid-flight forever - the
   * user sees one that never finishes and cannot be restarted either, because
   * the runtime still believes it is running.
   *
   * Returns how many were picked up, so the daemon can say so on startup
   * rather than recovering silently.
   *
   * **它们排在用户随后点的任务后面**（`recover` 档）：上次死的时候有多少跑着，
   * 这里就可能一次排进多少，而用户启动后点的第一个任务不该在它们后面等。
   */
  async recoverAll(): Promise<number> {
    let picked = 0;
    for (const workspace of await this.runtime.listProjects()) {
      const interrupted = await this.runtime.listInterruptedTasks(workspace.id);
      for (const task of interrupted) {
        picked += 1;
        this.admit(workspace.id, task.id, "recover");
      }
    }
    return picked;
  }

  /** 有名额就跑，没名额就排队。 */
  private admit(
    projectId: string,
    taskInstanceId: string,
    priority: TaskPriority,
  ): void {
    if (this.inFlight.has(taskInstanceId) || this.queue.has(taskInstanceId)) return;
    if (this.inFlight.size < this.maxConcurrent) {
      this.spawn(projectId, taskInstanceId, priority);
      return;
    }
    this.queue.enqueue({ projectId, taskInstanceId, priority });
    // 入队也要说一声 —— 否则界面上它看起来和「没反应」一模一样。
    this.announce(projectId, taskInstanceId);
  }

  private spawn(
    projectId: string,
    taskInstanceId: string,
    mode: TaskPriority,
  ): void {
    this.inFlight.add(taskInstanceId);
    this.announce(projectId, taskInstanceId);
    void this.drive(projectId, taskInstanceId, mode).finally(() => {
      this.inFlight.delete(taskInstanceId);
      // 落定时再说一次 —— 起来和停下是两个时刻，只报一个，另一个就得靠等。
      this.announce(projectId, taskInstanceId);
      this.drain();
    });
  }

  /**
   * 一个位置空出来了，放下一个进来。
   *
   * **在 `finally` 里调**：一个失败的任务同样要腾出它的名额，否则队列会被一次
   * 失败卡死 —— 而卡死的样子是「后面的任务永远排着」，不是一条错误。
   */
  private drain(): void {
    while (this.inFlight.size < this.maxConcurrent) {
      const next = this.queue.take();
      if (!next) return;
      this.spawn(next.projectId, next.taskInstanceId, next.priority);
    }
  }

  /** 任务动了；「在等我」的清单也可能因此变了。 */
  private announce(projectId: string, taskInstance: string): void {
    this.events?.publish({ kind: "task", projectId, taskInstance });
    this.events?.publish({ kind: "pending" });
  }

  private async drive(
    projectId: string,
    taskInstanceId: string,
    mode: TaskPriority,
  ): Promise<void> {
    try {
      const harness = await this.runtime.createHarness(projectId);
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
