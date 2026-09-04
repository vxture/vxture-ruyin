/**
 * 系统目录选择框的中转（TD-039）。
 *
 * 为什么要中转：窗口是纯 Web 客户端（无 preload，契约边界是 HTTP），而浏览器里
 * 的 file input 只给得到文件名，给不到目录的绝对路径 —— 系统目录框只有壳弹得
 * 出来。所以界面请求 → 守护进程发事件 → 壳弹框 → 壳把结果送回 → 唤醒界面那次
 * 请求。与主题、重启、打开目录同一条既有通路。
 *
 * 这个类只管「一次询问的等待与唤醒」，不碰 Electron，也不碰文件系统 —— 所以它
 * 能被单独测出来，而这正是它值得单独成一个文件的理由。
 */

export interface PickOutcome {
  path?: string;
  cancelled?: boolean;
}

export class FolderPick {
  /** 正在等答复的那一个。**只允许一个** —— 见 ask() 的注释。 */
  private waiting?: {
    resolve: (outcome: PickOutcome) => void;
    timer: ReturnType<typeof setTimeout>;
    start?: string;
  };

  constructor(
    /** 等多久算没人管了。用户可能把框放着不动，也可能壳压根没接这条事件。 */
    private readonly timeoutMs = 5 * 60_000,
    /** 通知壳「去弹框」。注入是为了测试时不必真起一条事件总线。 */
    private readonly notify: () => void = () => {},
  ) {}

  /**
   * 发起一次询问，挂着等结果。
   *
   * **只允许一个人在等**：第二次询问会把前一个顶掉（并告诉它 cancelled）。不这样
   * 做的话，一次误触就能在服务端攒下一串永远等不到答复的挂起请求 —— 而每个都占
   * 着一条 HTTP 连接。
   */
  ask(start?: string): Promise<PickOutcome> {
    this.waiting?.resolve({ cancelled: true });
    if (this.waiting) clearTimeout(this.waiting.timer);
    return new Promise<PickOutcome>((resolve) => {
      const timer = setTimeout(() => {
        // 超时按「取消」处理：界面那边该回到原状，而不是显示一个错误 —— 用户
        // 什么也没做错。
        this.waiting = undefined;
        resolve({ cancelled: true });
      }, this.timeoutMs);
      timer.unref?.();
      this.waiting = { resolve, timer, ...(start === undefined ? {} : { start }) };
      this.notify();
    });
  }

  /** 壳送回结果。没有人在等时安静地丢掉（框可能是上一次留下的）。 */
  settle(path?: string): void {
    const w = this.waiting;
    if (!w) return;
    this.waiting = undefined;
    clearTimeout(w.timer);
    w.resolve(path ? { path } : { cancelled: true });
  }

  /** 壳要问的起始目录。 */
  start(): string | undefined {
    return this.waiting?.start;
  }
}
