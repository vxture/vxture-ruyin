/**
 * 产品界面能收到哪些事件（ADR-022 片四：事件投影）—— **由守护进程决定，不由桥决定**。
 *
 * 工作台自己的界面订的是整条事件总线（`GET /events`，会话令牌）。产品界面**不能**
 * 拿同一条流、再由工作台的桥按项目筛一遍：那样筛子就在渲染进程里，闸门不是最后一站
 * （ADR-022 §2）。所以产品走自己的一条流（`GET /bridge/events`，产品级凭据），在这里
 * 映射：凭据限定的那个项目的事，按下面的形状给；**别的一律不给**。
 *
 * 形状照总线的规矩：**只说什么变了，不说变成了什么**。产品收到之后回头照常问一次
 * （`GET /tasks`、`GET /project`）—— 走的还是那几个已经裁剪过的面。事件里要是带了
 * 数据，就等于开出第二条数据通路，而那条路上的裁剪得重写一遍。
 */

import type { RuntimeEvent } from "./events.js";

export type BridgeEvent =
  /** 这个项目里某个任务动了（起来了、落定了、停在等人那一刻）。 */
  | { topic: "task"; payload: { taskInstance: string } }
  /** 这个项目的业务阶段、或挂着的推进请求变了。 */
  | { topic: "project"; payload: Record<string, never> };

/**
 * 一条总线事件，对这个项目的产品界面意味着什么。`undefined` = 不给它看。
 *
 * 白名单写法：新加的事件类型默认**不**给产品看 —— 默认给的话，下一个人往总线上加
 * 一种事件（比如「请壳打开数据目录」），它就悄悄流进了每一个产品界面。
 */
export function bridgeEventOf(event: RuntimeEvent, projectId: string): BridgeEvent | undefined {
  switch (event.kind) {
    case "task":
      return event.projectId === projectId ? { topic: "task", payload: { taskInstance: event.taskInstance } } : undefined;
    case "project":
      return event.projectId === projectId ? { topic: "project", payload: {} } : undefined;
    default:
      return undefined;
  }
}
