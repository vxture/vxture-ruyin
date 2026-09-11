/**
 * 产品界面提出的「请把项目推进到 X」—— 那种**要人确认**的推进（ADR-022 片四，
 * owner 2026-09-11 定方案 A）。
 *
 * **产品只能提，只有人能批。** Runtime 自己的界面推进时带一个「人已确认」的标记；
 * 那个标记绝不能让产品来带 —— 带得了，产品就能自己伪造你的决定。所以桥上的推进
 * 遇到 `confirm: human`，守护进程只**记下这个请求**，由 Runtime 在产品界面上方钉一张
 * 确认卡；人点了，才真的推进。
 *
 * 两条规矩，各防一种坏法：
 *
 * 1. **一个项目同时只挂一个请求，挂着时新的拒收**（不是顶替）。顶替的话，产品能在
 *    人伸手去点「确认」的那一刻把目标换掉 —— 人批的是他看见的那一个，推进的却是
 *    另一个。
 * 2. **决定要带着人看见的那个目标来**（`take(projectId, to)`）。目标对不上就不认 ——
 *    同一条坏法的另一半：卡片是旧的、请求已经换了，照样不能把人的「确认」挪给新请求。
 *
 * **只放内存，不落盘。** 守护进程重启，挂着的请求就没了 —— 这是可以接受的失败方向：
 * 丢的是一个**请求**，不是一个决定；什么都没被推进，产品再提一次即可。落盘则要给
 * 发布出去的存储端口加方法（云端也实现它），为一个「丢了也安全」的东西不值得。
 */

export interface StateRequest {
  projectId: string;
  /** 谁提的：产品码（凭据里来的，不是请求里说的）。 */
  productId: string;
  to: string;
  requestedAt: string;
}

export class StateRequests {
  private readonly pending = new Map<string, StateRequest>();

  /** 记下一个请求。已有一个挂着 → 拒收，把挂着的那个交回去（见文件头第 1 条）。 */
  request(req: StateRequest): { ok: true } | { ok: false; pending: StateRequest } {
    const existing = this.pending.get(req.projectId);
    if (existing) return { ok: false, pending: existing };
    this.pending.set(req.projectId, req);
    return { ok: true };
  }

  get(projectId: string): StateRequest | undefined {
    return this.pending.get(projectId);
  }

  /**
   * 人做了决定：取走这个请求。**目标对不上就不取**（见文件头第 2 条），返回 undefined，
   * 挂着的那个原样留着。
   */
  take(projectId: string, to: string): StateRequest | undefined {
    const existing = this.pending.get(projectId);
    if (!existing || existing.to !== to) return undefined;
    this.pending.delete(projectId);
    return existing;
  }
}
