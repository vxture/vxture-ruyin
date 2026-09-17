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

/**
 * console-bff 上**带会话**的读接口。与上面那张表相反：它们全在 `/api/` 下，
 * 全要求会话——鉴权中间件就挂在那个前缀上，工作区也由它从会话里解出来。
 *
 * 身份这三条（`me` / `tenantContext` / `myWorkspaces`）是 #232 之后漏接的那一半：
 * 登录换成了会话，界面要的用户、租户、工作区却还在读旧 OIDC 路径的 claims，而
 * 那条路径上已经没有令牌——于是界面一律显示兜底文案，当前工作区恒为空，建项目、
 * 开项目全被 ADR-015 拒掉。
 */
export const PLATFORM_READS = {
  me: "/api/me",
  tenantContext: "/api/tenant-context",
  myWorkspaces: "/api/me/workspaces",
  subscribedProducts: "/api/subscription/subscribed-products",
  entitlements: "/api/subscription/entitlements",
  quotaUsage: "/api/subscription/quota-usage",
  /** 当前租户的自定义 logo（console-bff `me.router.ts`）；404 = 没传过，是
   *  正常状态,不是错误。 */
  orgLogo: "/api/me/organization/logo",
  /**
   * 本工作区被授权的模型（console-bff `atlas.router.ts`，经 S2S 代理 Atlas
   * `/tenancy/models`）。**只展示，不调用**（RY-001 #24）：模型由产品直接对接 Atlas
   * （ADR-026 §2 第 3 条）。平台只授租户所有者 `tenant.model.read`，其余角色 403。
   */
  atlasModels: "/api/atlas/models",
} as const;

/**
 * 平台读接口回了非 2xx。带着状态码：调用方要分得清「平台拒绝这个角色」（403）与
 * 「这次没取到」（其余），前者重试没有用。消息沿用原来的 `<path> failed: HTTP <n>`。
 */
export class PlatformReadError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
  ) {
    super(`${path} failed: HTTP ${status}`);
    this.name = "PlatformReadError";
  }
}

/** 界面要的模型字段。端点地址、密钥引用、运维配置**不出守护进程**。 */
export interface AtlasModelView {
  modelCode: string;
  modelName: string;
  provider: string;
  capabilities: string[];
  isActive: boolean;
}

/** 平台一条模型记录 → 展示字段；缺 `modelCode` / `modelName` 的条目不列。 */
export function projectAtlasModels(raw: unknown): AtlasModelView[] {
  if (!Array.isArray(raw)) return [];
  const out: AtlasModelView[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const m = r as Record<string, unknown>;
    if (typeof m["modelCode"] !== "string" || typeof m["modelName"] !== "string") continue;
    out.push({
      modelCode: m["modelCode"],
      modelName: m["modelName"],
      provider: typeof m["provider"] === "string" ? m["provider"] : "",
      capabilities: Array.isArray(m["capabilities"])
        ? m["capabilities"].filter((c): c is string => typeof c === "string")
        : [],
      isActive: m["isActive"] !== false,
    });
  }
  return out;
}

/** 给 UI 与宿主的身份投射。字段缺失 = 平台这次没给，**不补、不猜**。 */
export interface SessionIdentity {
  profile?: {
    sub: string;
    name?: string;
    username?: string;
    email?: string;
    phone?: string;
    picture?: string;
    roles?: string[];
  };
  org?: { id?: string; name?: string; type?: string };
  workspace?: { id?: string; name?: string };
}

/**
 * 工作区 id 里不算数的值。
 *
 * console-bff 的 `TenantContext.workspace` 在解不出工作区时写的是字面量
 * `"default"`（租户态）或 `"PLATFORM"`（平台态）——那是它内部路由用的占位，
 * 不是一个工作区。拿它当项目归属，**所有租户的项目会落进同一个 "default"**，
 * 跨租户串数据，而且不报错。所以真实 id 只从 `/api/me/workspaces` 取，并且
 * 连那里也挡一遍。
 */
const NOT_A_WORKSPACE_ID = new Set(["", "default", "PLATFORM"]);

/**
 * 平台三条身份读 → {@link SessionIdentity}。纯函数，脱离网络可测。
 *
 * - 用户：`/api/me`。邮箱缺失时平台会合成 `<account>@local.vxture`——那不是
 *   用户的邮箱，照原样显示就是一句假话，所以丢掉。
 * - 租户：`/api/tenant-context`，只认 `mode === "tenant"`；平台态说明这个人
 *   没有任何组织，不该投射出一个「Vxture Platform」租户。
 * - 工作区：`/api/me/workspaces` 里**当前租户**那一行（优先 `isCurrent`）。
 *   订阅读取（`/api/subscription/*`）用的也是租户默认工作区，两边因此一致。
 */
export function projectIdentity(
  me: unknown,
  tenantContext: unknown,
  myWorkspaces: unknown,
): SessionIdentity {
  const out: SessionIdentity = {};
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.length > 0 ? v : undefined;

  if (me && typeof me === "object") {
    const m = me as Record<string, unknown>;
    const sub = str(m["id"]);
    if (sub) {
      const email = str(m["email"]);
      const role = str(m["roleLabel"]);
      out.profile = {
        sub,
        ...(str(m["displayName"]) ?? str(m["name"])
          ? { name: (str(m["displayName"]) ?? str(m["name"]))! }
          : {}),
        ...(str(m["username"]) ? { username: str(m["username"])! } : {}),
        ...(email && !email.endsWith("@local.vxture") ? { email } : {}),
        ...(str(m["phone"]) ? { phone: str(m["phone"])! } : {}),
        ...(str(m["picture"]) ? { picture: str(m["picture"])! } : {}),
        ...(role ? { roles: [role] } : {}),
      };
    }
  }

  let tenantId: string | undefined;
  let fallbackWorkspaceName: string | undefined;
  if (tenantContext && typeof tenantContext === "object") {
    const t = tenantContext as Record<string, unknown>;
    if (t["mode"] === "tenant" && str(t["id"])) {
      tenantId = str(t["id"]);
      out.org = {
        id: tenantId,
        ...(str(t["name"]) ? { name: str(t["name"])! } : {}),
        ...(str(t["tenantType"]) ? { type: str(t["tenantType"])! } : {}),
      };
      fallbackWorkspaceName = str(t["workspaceName"]);
    }
  }

  if (tenantId) {
    // 列表没拉到时名字仍可从租户上下文来；id 只从列表来，所以那时就是有名无 id。
    const rows = (Array.isArray(myWorkspaces) ? myWorkspaces : []).filter(
      (r): r is Record<string, unknown> =>
        !!r && typeof r === "object" && (r as Record<string, unknown>)["tenantId"] === tenantId,
    );
    const row = rows.find((r) => r["isCurrent"] === true) ?? rows[0];
    const id = row ? str(row["workspaceId"]) : undefined;
    const name = (row ? str(row["workspaceName"]) : undefined) ?? fallbackWorkspaceName;
    if ((id && !NOT_A_WORKSPACE_ID.has(id)) || name) {
      out.workspace = {
        ...(id && !NOT_A_WORKSPACE_ID.has(id) ? { id } : {}),
        ...(name ? { name } : {}),
      };
    }
  }
  return out;
}

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
   * **2026-09-17 订正（RY-103 §02 / 阶段 0a，TD-057 补记四、TD-069 补记四）：这一行是
   * 「浏览器已登录仍要输账号密码」的真因，要拆。** 此前这里写着「平台只认 `none`、
   * 其余静默忽略，这一行保留不要拆」——那是对着落后 origin/main 236 个提交的本机
   * 检出读出来的。vxture-platform `5d38b97c` 的 `auth-bff/src/oidc/oidc.service.ts#authorize()`
   * 现在是：`forcesInteraction = req.prompt === "login" || req.prompt === "select_account"`，
   * 命中即 `hasUsableSession = false`——平台**兑现**了这个参数，兑现方式就是
   * 「有会话也当没有」。于是无条件带它 = 每次登录都要求平台忽略浏览器会话。
   *
   * 阶段 0a 的改法：正常登录**不带** `prompt`；只有「换账号」这个显式入口才带
   * `select_account`。`POST /auth/login` 的形状不变。目标态（RY-100 A3）下 RUYIN 是
   * 自己的 OIDC 客户端，这段握手的对端与身份一起换掉（RY-103 阶段 3）。
   */
  /** 实际在用的会话/读接口基址。启动播报要按这条说话，不按退役变量说话。 */
  get baseUrl(): string {
    return this.config.consoleBase;
  }

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
    return this.cachedGet(PLATFORM_READS.subscribedProducts);
  }

  /** 本工作区的权益概览（档位 / 状态 / 限额）。 */
  async entitlements(): Promise<unknown> {
    return this.cachedGet(PLATFORM_READS.entitlements);
  }

  /**
   * 本工作区的配额用量 `{storage, aiCredit}`，每项 `{used, limit}`。
   *
   * 只读展示（ADR-006）：它是平台上那个数字的镜子，桌面端不据此门控、不计量。
   */
  async quotaUsage(): Promise<unknown> {
    return this.cachedGet(PLATFORM_READS.quotaUsage);
  }

  /** 本工作区被授权的模型（原样，未投影；投影在 server 那一层）。 */
  async atlasModels(): Promise<unknown> {
    return this.cachedGet(PLATFORM_READS.atlasModels);
  }

  /**
   * 当前租户的自定义 logo 字节。`null` = 没有自定义 logo（界面自己兜底成
   * 首字母/通用图标），404 是这条路的正常状态，不走 {@link PlatformReadError}。
   *
   * **不走 `cachedGet`**：那条把响应体当 JSON 解析，这里是图片字节。console-bff
   * 自己已经给了 `Cache-Control: immutable` + `ETag`（logo 传一次极少换），
   * 桌面这边不再叠一层内存缓存——反正只在租户菜单打开时才问一次。
   */
  async orgLogo(): Promise<{ data: Buffer; contentType: string } | null> {
    const res = await this.fetch(PLATFORM_READS.orgLogo);
    if (res.status === 404) return null;
    if (!res.ok) throw new PlatformReadError(PLATFORM_READS.orgLogo, res.status);
    return {
      data: Buffer.from(await res.arrayBuffer()),
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
    };
  }

  // --------------------------------------------------------------------------
  // 身份
  // --------------------------------------------------------------------------

  /**
   * 当前会话的用户、租户、工作区。
   *
   * 三条读并发发出，**任何一条失败都只让那一块缺席**，不让整份身份失败：
   * 界面上「名字没拉到」和「整个人没登录」是两件事，混成一件会把一次网关抖动
   * 显示成掉线。会话被平台拒（401）时 `fetch` 已就地清掉本地会话，这里回空。
   *
   * 缓存与权益读同一套（内存、遵 Cache-Control、登出即清）。「显示三天前的名字」
   * 这种缺陷不报错，所以不落盘。
   */
  async identity(): Promise<SessionIdentity> {
    if (!this.signedIn()) return {};
    const read = (path: string) => this.cachedGet(path).catch(() => undefined);
    const [me, tenantContext, myWorkspaces] = await Promise.all([
      read(PLATFORM_READS.me),
      read(PLATFORM_READS.tenantContext),
      read(PLATFORM_READS.myWorkspaces),
    ]);
    if (!this.signedIn()) return {};
    return projectIdentity(me, tenantContext, myWorkspaces);
  }

  /**
   * 项目归属用的工作区 id（ADR-015），拿不到就是 undefined——**没有兜底**。
   *
   * 这是当前租户的默认工作区：桌面会话目前切不了工作区（平台的切换入口只认
   * 浏览器 cookie），订阅读取取的也是它，所以数据归属与订阅判定落在同一个工作区上。
   */
  async activeWorkspaceId(): Promise<string | undefined> {
    return (await this.identity()).workspace?.id;
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
    if (!res.ok) throw new PlatformReadError(path, res.status);
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
       服务端那份到 TTL 自己会走。

       **如实说：今天这一下销毁不了服务端会话。** console-bff 的 `/auth/logout`
       只从 cookie 读 rpsid，不认 `X-Vxture-Session`（oidc-auth.router.ts），而平台
       还没有给头部会话的登出端点——已向平台提出。留着这一下，是为了平台补上
       之后这里不必再改调用点；在那之前，本机清掉就是全部。 */
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
