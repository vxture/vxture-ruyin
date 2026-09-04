/**
 * 运行时事件总线（TD-027）。
 *
 * 在此之前界面和壳各自轮询：项目面板 1–5 秒，待办 / 用户 / 工作台各 5 秒，
 * 壳里还有待确认与更新意图两个。静止时是纯浪费，跑动时又慢得能被看出来 ——
 * 一个刚落定的任务要等最多一秒才在屏幕上变样。
 *
 * **单向、进程内、只说「什么变了」，不说「变成了什么」。** 事件里不带业务
 * 数据：带了就等于开出第二条数据通路，而那条路上的护栏（授权、工作区边界、
 * 审计）要重新写一遍。收到事件的人回头照常查一次，走的还是原来那条路。
 */

export type RuntimeEvent =
  /** 某个任务实例动了（起来了、落定了、停在等人那一刻）。 */
  | { kind: "task"; projectId: string; taskInstance: string }
  /** 「在等我」的清单变了。 */
  | { kind: "pending" }
  /**
   * 界面的生效主题变了（深 / 浅）。**壳是唯一的消费者**：Windows 的三个窗口
   * 按钮由系统画、颜色由壳定，而壳看不见页面 —— 窗口是纯 Web 客户端，没有
   * preload。收到之后壳自己去 `GET /ui/theme` 取值，照本总线的规矩：只说
   * 什么变了，不说变成了什么。
   */
  | { kind: "ui-theme" }
  /**
   * 请壳重启应用。**壳是唯一的消费者**，也是唯一有能力做这件事的人（界面是纯
   * Web 客户端）。用在数据目录搬家上：搬家必须在开库之前做，所以只能是「下次
   * 启动时搬」，而用户按下确认之后总得有人真的把应用重开一次。
   */
  | { kind: "app-restart" }
  /**
   * 请壳在资源管理器里打开数据目录。**事件不带路径** —— 照本总线的规矩：只说
   * 什么发生了，不说是什么。壳收到之后自己去 `GET /system` 取 `dataDir`。
   *
   * 这不只是为了守规矩：路径要是跟着事件走，界面就成了「让壳打开任意目录」的
   * 一条通路。而界面是纯 Web 客户端 —— 同一个页面在浏览器里也开着。
   */
  | { kind: "app-open-data-dir" }
  /**
   * 请壳弹一个系统目录选择框。**壳是唯一能弹它的人** —— 窗口是纯 Web 客户端，
   * 浏览器里的 file input 只给得到文件名，给不到目录的绝对路径。
   *
   * 同样不带数据：壳收到之后弹框，把用户选的路径 POST 回
   * `/ui/pick-folder/result`；那条请求会唤醒正在等的那个界面调用。
   */
  | { kind: "app-pick-folder" };

type Listener = (event: RuntimeEvent) => void;

export class EventBus {
  private readonly listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(event: RuntimeEvent): void {
    // 复制一份再遍历：监听者在回调里退订是正常操作（连接断了就该退），
    // 边遍历边删会漏掉后面的人。
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // 一个订阅者炸了不该带走别人。它自己的连接会在下一次写入时收摊。
      }
    }
  }

  get subscriberCount(): number {
    return this.listeners.size;
  }
}
