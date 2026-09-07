/**
 * 任务排队（TD-045）。
 *
 * ## 为什么排队这件事在宿主，不在内核
 *
 * 内核是宿主无关的（ADR-008：一个内核两个宿主）。**同时能跑几个任务**是这台机器
 * 的事 —— 桌面上受用户的机器与能力面速率约束，云端受集群与配额约束，两边的答案
 * 不可能相同。内核只管一个任务怎么跑完，不管几个一起跑。
 *
 * ## 为什么不新增一个 `queued` 状态
 *
 * 任务实例的状态集是**规范的一部分**（`30-design/50-harness` §3.1，十个状态），
 * 一致性套件按它比对两个宿主的行为。排队**不是任务的属性，是此刻这台宿主的调度
 * 情况**：同一个任务在云端可能立刻就跑。
 *
 * 还有一条更硬的理由：**队列不持久化**。守护进程一重启，队列就没了（重启后由
 * 恢复扫描重新排）。一个持久化下来的 `queued` 状态在下次启动时会是一句谎 ——
 * 记录说它在排队，而那个队列已经不存在了。
 *
 * 所以排队状态只经**宿主的运行期视图**报出去（API 上的 `queued` / `queuePosition`），
 * 不进状态机、不落库。
 *
 * ## 优先级只有两档，且理由具体
 *
 * `advance`（用户刚点的）排在 `recover`（重启后扫出来的）前面。
 * 理由不是「用户更重要」这种空话，而是一个真实场景：**启动扫描可能一次排进几十
 * 个**（上次进程死的时候有多少跑着就有多少），而用户在启动后点的第一个任务不该
 * 在它们后面等。同档之内先来先服务 —— 可预期比聪明重要。
 */

export type TaskPriority = "advance" | "recover";

export interface QueuedTask {
  projectId: string;
  taskInstanceId: string;
  priority: TaskPriority;
}

/** 数字小的先出。只有两档，写成表而不是散在比较函数里。 */
const RANK: Record<TaskPriority, number> = { advance: 0, recover: 1 };

/**
 * 一条先进先出、分两档的队列。
 *
 * 没有用堆或优先队列库：两档 + 先来先服务用一个数组表达得完，而**队列的顺序要能
 * 被一眼读懂** —— 这是用户会问「为什么它还没开始」的东西。
 */
export class TaskQueue {
  private readonly items: QueuedTask[] = [];

  get size(): number {
    return this.items.length;
  }

  has(taskInstanceId: string): boolean {
    return this.items.some((t) => t.taskInstanceId === taskInstanceId);
  }

  /**
   * 入队。**已经在队里的不重复入**，返回 false —— 重复入队会让同一个任务被驱动
   * 两次，而两次驱动同一个实例正是 `inFlight` 那个集合当初要防的事。
   */
  enqueue(task: QueuedTask): boolean {
    if (this.has(task.taskInstanceId)) return false;
    this.items.push(task);
    return true;
  }

  /** 取下一个：先按档，档内先来先服务。队空时返回 undefined。 */
  take(): QueuedTask | undefined {
    if (this.items.length === 0) return undefined;
    let best = 0;
    for (let i = 1; i < this.items.length; i++) {
      // 严格小于：相等时保留更早入队的那个 —— 这就是档内的先来先服务。
      if (RANK[this.items[i]!.priority] < RANK[this.items[best]!.priority]) best = i;
    }
    return this.items.splice(best, 1)[0];
  }

  /**
   * 从队里拿掉一个（取消时用）。
   *
   * **这条不是可选的**：一个在队里等着的任务被取消之后如果还留在队里，它会在前面
   * 的任务跑完时被启动 —— 用户点了取消，然后眼看着它开始跑。
   */
  remove(taskInstanceId: string): boolean {
    const at = this.items.findIndex((t) => t.taskInstanceId === taskInstanceId);
    if (at < 0) return false;
    this.items.splice(at, 1);
    return true;
  }

  /**
   * 它排第几（从 1 起）；不在队里返回 0。
   *
   * 按**真实出队顺序**算，不是按数组下标 —— 否则一个排在恢复任务后面的用户任务
   * 会被报成「第 20 位」，而它其实下一个就轮到。**一个错的位置比不报位置更糟**：
   * 用户会据它决定要不要等。
   */
  positionOf(taskInstanceId: string): number {
    const me = this.items.find((t) => t.taskInstanceId === taskInstanceId);
    if (!me) return 0;
    let ahead = 0;
    for (const other of this.items) {
      if (other === me) continue;
      const rank = RANK[other.priority] - RANK[me.priority];
      if (rank < 0) ahead += 1;
      else if (rank === 0 && this.items.indexOf(other) < this.items.indexOf(me)) ahead += 1;
    }
    return ahead + 1;
  }

  /** 队里的全部，按出队顺序 —— 给「谁在等」这类展示用。 */
  snapshot(): QueuedTask[] {
    return [...this.items].sort(
      (a, b) => RANK[a.priority] - RANK[b.priority] || this.items.indexOf(a) - this.items.indexOf(b),
    );
  }
}
