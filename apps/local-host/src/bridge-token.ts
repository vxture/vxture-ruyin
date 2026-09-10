/**
 * 产品级凭据（ADR-022 §3.2）—— 产品界面用来打 `/bridge/*` 的那把钥匙。
 *
 * **为什么不能让产品界面用会话令牌。** 会话令牌是「连本地运行时」的宿主凭据，
 * 除 `/health` 外**所有端点一视同仁**。产品的界面代码拿到它，就等于拿到整台守护
 * 进程 —— Tool Gate、目录授权、上下文确认全部形同虚设。
 *
 * **为什么裁剪不能只放在桥里。** 设计正文 §8.2 原本把裁剪放在 Workspace UI 的
 * 桥接层，对下游携带会话令牌；那样守护进程分不出「这次是产品界面发的」还是
 * 「工作台自己发的」，于是「UI 不可能越出 Tool Gate」这句保障的强度就等于桥那
 * 几百行前端代码。对照本仓自己的判据 —— **闸门必须是最后一站**
 * （`40-implementation/30` §9）。ADR-022 据此修订了 §8.2。
 *
 * **不落库，是有意的。** 一张跨重启还活着的桥凭据，是在替一个已经不存在的会话
 * 说话：那一头的 iframe 早没了，而钥匙还开得了门。同一条道理见任务队列
 * （TD-045：排队状态不落库，落了在下次启动时就是一句谎）。
 */

import { randomBytes, timingSafeEqual } from "node:crypto";

/** 一张凭据管多久。短 —— 它随手可换，而长命的凭据要有人负责作废。 */
export const BRIDGE_TOKEN_TTL_MS = 10 * 60 * 1000;

/** 凭据认下来之后，守护进程据此裁剪的那两件事实。 */
export interface BridgeScope {
  projectId: string;
  productId: string;
}

interface Issued extends BridgeScope {
  expiresAt: number;
}

/**
 * 已签发的凭据。**进程内，不落盘**（见文件头）。
 *
 * 用 `Map` 而不是 JWT 之类的自证凭据：自证凭据签出去就收不回来了，而这里恰恰要
 * 「项目一关就作废」。可撤销是这套东西存在的一半理由。
 */
export class BridgeTokens {
  private readonly issued = new Map<string, Issued>();

  /** 为「这个项目里的这个产品」签一张。每次调用都是新的一张，不复用。 */
  mint(scope: BridgeScope, now: number = Date.now()): { token: string; expiresAt: number } {
    this.sweep(now);
    const token = randomBytes(32).toString("hex");
    const expiresAt = now + BRIDGE_TOKEN_TTL_MS;
    this.issued.set(token, { ...scope, expiresAt });
    return { token, expiresAt };
  }

  /**
   * 认一张凭据。认不出、过期、或者压根不是这套凭据 —— 一律 `undefined`，
   * **不区分**：区分了就等于告诉调用方「这张存在过但过期了」，那是一条免费的
   * 探测通道。
   *
   * 比较用 `timingSafeEqual`：这把钥匙是随机 32 字节，逐字节早退的比较在理论上
   * 可被计时区分。代价是一次遍历，而这张表只有个位数条目。
   */
  verify(token: string | undefined, now: number = Date.now()): BridgeScope | undefined {
    if (!token) return undefined;
    this.sweep(now);
    const probe = Buffer.from(token, "utf8");
    for (const [candidate, scope] of this.issued) {
      const known = Buffer.from(candidate, "utf8");
      if (known.length !== probe.length) continue;
      if (!timingSafeEqual(known, probe)) continue;
      return { projectId: scope.projectId, productId: scope.productId };
    }
    return undefined;
  }

  /**
   * 项目关掉 / 删掉时，把它名下的凭据全部作废。
   *
   * **这一条是可撤销的那一半。** 少了它，一个项目关了之后它的产品界面还能继续
   * 读它 —— 而用户以为自己已经把那扇门带上了。
   */
  revokeProject(projectId: string): number {
    let n = 0;
    for (const [token, scope] of this.issued) {
      if (scope.projectId === projectId) {
        this.issued.delete(token);
        n++;
      }
    }
    return n;
  }

  /** 当前还活着的张数 —— 只给用例与诊断用。 */
  size(now: number = Date.now()): number {
    this.sweep(now);
    return this.issued.size;
  }

  private sweep(now: number): void {
    for (const [token, scope] of this.issued) {
      if (scope.expiresAt <= now) this.issued.delete(token);
    }
  }
}
