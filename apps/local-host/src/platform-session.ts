/**
 * 平台会话（rpsid）—— 桌面端走浏览器走的那一条路。
 *
 * @package @vxture/ruyin-local-host
 *
 * ── 为什么不再自己持令牌 ──
 * ruyin 是 RFC 8252 公共客户端：它**持不住密钥**，所以向平台证明「我是 ruyin」
 * 这件事它做不到。平台据此禁止公共客户端铸 S2S 票（有意立的规矩，写了理由）。
 *
 * 这不是要绕开的障碍，是在指路：**公共客户端从不持令牌，机密后端替它持**。
 * 浏览器就是这么跑的——它拿一个不透明的 `rpsid`，令牌留在 console-bff 的服务端。
 * 桌面端与浏览器在这件事上形态完全相同（都在用户机器上，抠得出来），所以拿同一
 * 个东西、走同一条中间件、同一批路由。
 *
 * ── 秘密不穿过浏览器 ──
 * 常见做法是回跳 `http://127.0.0.1:<port>/cb?code=…`，本地监听收码。那条码会进
 * 浏览器历史、可能进日志、本机其他程序在某些平台上看得见。自定义协议
 * （`ruyin://`）更糟——RFC 8252 自己点名：同机任何程序都能注册同一个协议截走回调。
 *
 * 所以反过来：**秘密由本机生成，只把它的哈希送出去**。
 *
 *   ① 生成 `deviceSecret`（32 字节随机数的 hex），算 `handle = sha256(deviceSecret)`
 *   ② 打开系统浏览器到 console 的登录，带上 `surface=native&handle=<handle>`
 *   ③ 用户正常登录；平台把会话绑到那个 handle，浏览器停在一个提示页
 *      ——**浏览器全程没拿到任何可用凭据**
 *   ④ 本机直接 HTTPS 轮询 `claim`，出示 `deviceSecret` 原文换回 `rpsid`
 *
 * `deviceSecret` 只在本机与平台之间走过 TLS，从未进过 URL、浏览器或操作系统。
 *
 * ── 落盘的是 rpsid，不是 refresh token ──
 * 仍然用 `KeyManager.seal()` 封存（win32 下主密钥受 DPAPI 保护），但**封的东西变了**：
 * 从一张能自己续命、能换 access token 的 refresh token，变成一个不透明会话号。
 * 泄漏后果因此小一个量级——rpsid 受服务端 TTL 约束，而且**服务端删一行就失效**。
 * 那正是「设备远程吊销」成立的前提：令牌一旦发出去就收不回，会话不是。
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { KeyManager } from "./keys.js";

// ============================================================================
// Types
// ============================================================================

export interface PlatformSessionConfig {
  /** console-bff 的公网基址，例如 https://console.vxture.com */
  consoleBase: string;
}

/** 封存在磁盘上的东西。**只有会话号**——没有任何令牌。 */
interface PersistedSession {
  rpsid: string;
  /** 本地记的过期时刻（epoch 毫秒），到点前不必问服务端。只是省一次往返，不是判据。 */
  expiresAt: number;
}

export class NotSignedInError extends Error {
  constructor(message = "not signed in") {
    super(message);
    this.name = "NotSignedInError";
  }
}

// ============================================================================
// Constants
// ============================================================================

/**
 * 轮询节奏。
 *
 * 覆盖「打开浏览器 → 用户看清 → 输密码/过 MFA → 回来」这一段，与平台侧待领绑定的
 * 5 分钟 TTL 对齐：**本地先放弃没有意义**（平台还留着，用户回来时应用却不认了）；
 * **本地后放弃也没有意义**（平台早删了，再问也是 404）。两侧同一个数。
 */
export const CLAIM_POLL_INTERVAL_MS = 1500;
export const CLAIM_TIMEOUT_MS = 300_000;

/**
 * console-bff 上的会话端点。**注意没有 `/api` 前缀。**
 *
 * console-bff 的 `AuthMiddleware` 挂在 `api/*path` 上，而会话端点必须在它之外：
 * 它们是**用来拿会话的**，不可能自带会话。平台侧为此把整个 RP 族放在 `/auth/*`，
 * 并在 `oidc-auth.router.ts` 的文件头写明了这一点。
 *
 * 第一版这三条各自内联，并且都多带了一个 `/api`。后果不是「404 找不到」——
 * 是 **401**：请求落进 `api/*` 被中间件挡下，于是
 *
 *   · `/api/auth/login`        → 401，登录根本起不来
 *   · `/api/auth/native/claim` → 401，轮询把它当成「凭据错了」当场放弃
 *
 * 而单元测试全绿：mock server 注册的是同一个写错的常量，**两边一样地错**，
 * 比对型断言看不见这种错。集中到一处不能防住写错前缀，但至少让它只错一次、
 * 只需改一处——真正拦住它的是下面 `completeLogin` 里对 401 的判读。
 */
export const PLATFORM_PATHS = {
  login: "/auth/login",
  claim: "/auth/native/claim",
  logout: "/auth/logout",
} as const;

// ============================================================================
// Service
// ============================================================================

export class PlatformSession {
  private rpsidValue?: string;
  private expiresAt = 0;
  private readonly sessionPath: string;
  /** 正在进行的登录：`deviceSecret` 留在内存，**绝不落盘**。 */
  private pending?: { deviceSecret: string; startedAt: number };
  /** C2 读缓存。**只在内存里**——product_220 §3：权益不落盘。 */
  private readCache = new Map<string, { body: unknown; expiresAt: number }>();

  constructor(
    private readonly config: PlatformSessionConfig,
    private readonly keys: KeyManager,
    dataDir: string,
  ) {
    this.sessionPath = join(dataDir, "platform", "session.bin");
    this.restore();
  }

  // --------------------------------------------------------------------------
  // 持久化
  // --------------------------------------------------------------------------

  private restore(): void {
    if (!existsSync(this.sessionPath)) return;
    try {
      const raw = this.keys.open(readFileSync(this.sessionPath));
      const saved = JSON.parse(raw.toString("utf8")) as PersistedSession;
      /* 过期的直接丢，不留着试。留着只会让第一次调用拿到 401 —— 那时用户已经在
         界面上了，报错比启动时静默重登录更打断人。 */
      if (saved.expiresAt > Date.now()) {
        this.rpsidValue = saved.rpsid;
        this.expiresAt = saved.expiresAt;
      } else {
        rmSync(this.sessionPath, { force: true });
      }
    } catch (cause) {
      console.warn(
        `[ruyin] platform session restore failed (dropping it): ${
          cause instanceof Error ? cause.message : cause
        }`,
      );
      rmSync(this.sessionPath, { force: true });
    }
  }

  private persist(): void {
    if (!this.rpsidValue) return;
    const value: PersistedSession = {
      rpsid: this.rpsidValue,
      expiresAt: this.expiresAt,
    };
    mkdirSync(dirname(this.sessionPath), { recursive: true });
    writeFileSync(
      this.sessionPath,
      this.keys.seal(Buffer.from(JSON.stringify(value), "utf8")),
    );
  }

  // --------------------------------------------------------------------------
  // 登录
  // --------------------------------------------------------------------------

  /**
   * 开始登录：返回要在系统浏览器里打开的地址。
   *
   * `prompt=select_account` 让「退出后再点登录」至少有一屏——桌面应用按工作区/组织
   * 隔离，**换账号是真实用例**。选它而不是 `prompt=login`：后者每次都逼着重输密码，
   * 对个人桌面应用是纯摩擦。
   *
   * 这个参数平台侧原本**只认 `none`、其余静默忽略**（我们为此记过 TD-057，因为
   * 未登录状态下任何 prompt 值的回应都一样，探针判定不了）。平台已在同批实现并
   * 公布 `prompt_values_supported`，所以现在它真的生效。
   */
  beginLogin(): string {
    const deviceSecret = randomBytes(32).toString("hex");
    const handle = createHash("sha256").update(deviceSecret).digest("hex");
    this.pending = { deviceSecret, startedAt: Date.now() };

    const u = new URL(PLATFORM_PATHS.login, this.config.consoleBase);
    u.searchParams.set("surface", "native");
    u.searchParams.set("handle", handle);
    u.searchParams.set("prompt", "select_account");
    return u.toString();
  }

  /**
   * 领取会话。打开浏览器之后调它，内部轮询到成功或超时。
   *
   * @throws {NotSignedInError} 没有进行中的登录，或用户没在超时内完成
   */
  async completeLogin(): Promise<void> {
    const pending = this.pending;
    if (!pending) throw new NotSignedInError("no login in progress");

    const deadline = pending.startedAt + CLAIM_TIMEOUT_MS;
    const url = new URL(PLATFORM_PATHS.claim, this.config.consoleBase);

    while (Date.now() < deadline) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceSecret: pending.deviceSecret }),
      }).catch(() => undefined);

      if (res?.ok) {
        const body = (await res.json()) as {
          rpsid: string;
          expiresInSec: number;
        };
        this.rpsidValue = body.rpsid;
        this.expiresAt = Date.now() + body.expiresInSec * 1000;
        this.pending = undefined;
        this.persist();
        return;
      }
      /* 404 = 还没登录完，继续等。其余状态码（400 参数错、5xx）**不重试**：
         重试一个已经判定为错的请求只是把同一个错误重复 200 次，而真实症状
         （比如 secret 太短）会被埋在轮询日志里看不见。 */
      if (res && res.status !== 404) {
        this.pending = undefined;
        /*
         * 401 要单独说。claim 是**公开**端点——它就是用来拿会话的，不可能要求
         * 先有会话。所以它回 401 不表示「凭据错了」，只表示这个请求根本没打到
         * 它身上：基址指错了主机，或者路径落进了带鉴权的前缀。
         *
         * 不区分的话，用户看到的是「登录失败」，然后去查密码、查 MFA、查平台，
         * 唯独查不到真正的原因——那正是这个缺陷第一次发生时的样子。
         */
        throw new NotSignedInError(
          res.status === 401
            ? `claim 收到 401。它是公开端点，401 只可能是请求没打到它身上——` +
              `检查 RUYIN_CONSOLE_API_BASE（当前 ${this.config.consoleBase}）` +
              `以及路径 ${PLATFORM_PATHS.claim} 是否落进了带鉴权的前缀。`
            : `claim failed (HTTP ${res.status})`,
        );
      }
      await new Promise((r) => setTimeout(r, CLAIM_POLL_INTERVAL_MS));
    }
    this.pending = undefined;
    throw new NotSignedInError("login timed out");
  }

  // --------------------------------------------------------------------------
  // 使用
  // --------------------------------------------------------------------------

  /**
   * 当前会话号，放进 `X-Vxture-Session`。
   *
   * **刻意不叫 `session()`。** 旧的 `PlatformService.session()` 返回的是给 UI 看的
   * 登录状态（claims），两者重名会让接线时一手滑就把 rpsid 送进 UI——正好毁掉这个
   * 仓一直坚持的 browser-zero-token。叫 `rpsid()` 之后，没人会把它接到一个渲染
   * 用户信息的端点上。
   *
   * 给 UI 的东西走 {@link status}。
   */
  rpsid(): string | undefined {
    if (this.rpsidValue && Date.now() < this.expiresAt) return this.rpsidValue;
    return undefined;
  }

  /**
   * 给 UI 的登录状态。**只有布尔与过期时刻，没有会话号。**
   *
   * 用户资料（名字、邮箱…）不在这里——那些要向平台现拉（`GET /api/me`），
   * 不该由桌面端缓存一份。缓存一份的代价是它会过期而没人知道，
   * 而「显示的是三天前的名字」这种缺陷不报错。
   */
  status(): { signedIn: boolean; expiresAt: number | null } {
    const live = this.rpsid() !== undefined;
    return { signedIn: live, expiresAt: live ? this.expiresAt : null };
  }

  signedIn(): boolean {
    return this.rpsid() !== undefined;
  }

  /**
   * 带会话调 console-bff。
   *
   * 401 时**就地清掉本地会话**：服务端说不认，本地再留着只会让下一次调用重复失败。
   * 这也是「设备远程吊销」在客户端的落点——服务端删了那一行，下一次调用就掉线。
   */
  async fetch(path: string, init?: RequestInit): Promise<Response> {
    const rpsid = this.rpsid();
    if (!rpsid) throw new NotSignedInError();
    const res = await fetch(new URL(path, this.config.consoleBase), {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        "x-vxture-session": rpsid,
      },
    });
    if (res.status === 401) {
      this.signOutLocal();
      throw new NotSignedInError("session rejected by platform");
    }
    return res;
  }

  // --------------------------------------------------------------------------
  // 权益（C2）
  // --------------------------------------------------------------------------

  /**
   * 本工作区的订阅与权益。
   *
   * ── 为什么不再调 platform-api ──
   * `platform-api` 绑在 tailnet 上，最终用户的桌面不在 tailnet 里——我们为此开了
   * issue（平台 #272），请求「一个用户设备够得着的基址」。
   *
   * 答案是那个基址早就存在：**console-bff**。而且它给的比我们请求的多——我们当时
   * 还请求了「查本工作区全部订阅」的口径（因为旧接口只回答调用方已经知道 code 的
   * 产品，而首页要问的恰恰是「这个工作区还订了什么我不知道的」），那个口径也在
   * 同一个 router 里：`GET /api/subscription/subscribed-products`。
   *
   * 工作区**不再由我们声明**：会话在服务端，服务端从会话里知道是哪个工作区。
   * 这比旧路径更严——调用方自陈的工作区，平台无从核对。
   *
   * ── C2 纪律原样保留 ──
   * 只读、遵 `Cache-Control`（缺省 45 秒）、**只在内存里、不落盘**。那一段与换不换
   * 凭据无关，是 product_220 §3 的要求。
   */
  async subscribedProducts(): Promise<unknown> {
    return this.cachedGet("/api/subscription/subscribed-products");
  }

  /** 本工作区的权益概览（档位 / 状态 / 限额）。 */
  async entitlements(): Promise<unknown> {
    return this.cachedGet("/api/subscription/entitlements");
  }

  /**
   * 带缓存的读。
   *
   * 缓存键就是路径——这些端点**不带参数**（工作区来自会话）。旧实现要把
   * workspace 与 product 列表拼进键里，那是因为工作区靠调用方声明；现在不必了。
   */
  private async cachedGet(path: string): Promise<unknown> {
    const hit = this.readCache.get(path);
    if (hit && Date.now() < hit.expiresAt) return hit.body;

    const res = await this.fetch(path);
    if (!res.ok) throw new Error(`${path} failed: HTTP ${res.status}`);
    const body = (await res.json()) as unknown;
    const maxAge = /max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "")?.[1];
    this.readCache.set(path, {
      body,
      expiresAt: Date.now() + (maxAge ? Number(maxAge) : 45) * 1000,
    });
    return body;
  }

  // --------------------------------------------------------------------------
  // 登出
  // --------------------------------------------------------------------------

  /**
   * 登出。
   *
   * 只清本机这一份，**不去动浏览器里 accounts 的 cookie**——那是浏览器级、跨应用的
   * 公共资产，退出一个桌面应用就把它杀掉，等于顺手登出这台机器上同账号的所有网站，
   * 那是个比「没退干净」更意外的副作用。
   *
   * 缓解放在**下一次登录**那一端：`beginLogin()` 带 `prompt=select_account`，
   * 让它至少有一屏、且能换人。
   */
  async logout(): Promise<void> {
    const rpsid = this.rpsid();
    this.signOutLocal();
    if (!rpsid) return;
    /* 通知服务端销毁那条会话。收不掉也不该让登出失败——本地已经清了，
       服务端那份到 TTL 自己会走。 */
    await fetch(new URL(PLATFORM_PATHS.logout, this.config.consoleBase), {
      method: "POST",
      headers: { "x-vxture-session": rpsid },
    }).catch(() => undefined);
  }

  private signOutLocal(): void {
    this.rpsidValue = undefined;
    this.expiresAt = 0;
    /* 清缓存：换账号后还留着上一个人的权益就是串号，而它不报错。 */
    this.readCache.clear();
    this.pending = undefined;
    rmSync(this.sessionPath, { force: true });
  }
}
