/**
 * ADR-022 片二：postMessage 桥接协议 + 工作台侧的桥。
 *
 * **裁剪已经在守护进程里做完了**（ADR-022 §3.2，`/bridge/*` 按产品级凭据裁剪）
 * ——这一层只做转发：把沙箱那一侧发来的一条 postMessage 请求，转成一次打
 * `/bridge/*` 的 HTTP 调用，再把响应原样投回去。它不判断产品能不能做某件事，
 * 那从来不是它的职责，它也没有资格判断——它手上唯一能出示的是那张已经被裁剪
 * 过的产品级凭据，连会话令牌都摸不到。
 *
 * **沙箱装载（片三）与 SDK 本身（片五）都不在这一片。** 这座桥只要求「有一扇
 * 窗口会用 postMessage 说话」，不关心那扇窗口是不是真的跑在 sandbox iframe
 * 里——用一个测试页当假产品，就能把协议本身验完（ADR-022 §5「片二」）。
 */

import { extractSseEvents } from "./sse";

/** 命名空间字段：postMessage 是整个页面共用的通道，得先筛出是不是在跟我们说话。 */
const NAMESPACE = "ruyin.bridge";

/** 产品界面 → 工作台：一次调用。`path` 是 `/bridge` 之后那一段，桥自己拼完整地址。 */
export interface BridgeRequestMessage {
  ns: typeof NAMESPACE;
  kind: "request";
  id: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
}

/**
 * 守护进程的错误封套（X-1：`{code, message, retryable, field?}`）。原样带回
 * 产品界面，不改写——改写等于替产品重新判断一次守护进程已经判断过的事。
 */
export interface BridgeApiError {
  code: string;
  message: string;
  retryable: boolean;
  field?: string;
}

/** 工作台 → 产品界面：对某次调用的答复。`ok` 与 HTTP 的 2xx 同义，不额外定义。 */
export interface BridgeResponseMessage {
  ns: typeof NAMESPACE;
  kind: "response";
  id: string;
  ok: boolean;
  status: number;
  body?: unknown;
  error?: BridgeApiError;
}

/**
 * 工作台 → 产品界面：一次事件投影。来源是守护进程的 `GET /bridge/events`（片四）：
 * 给什么由守护进程定（bridge-events.ts，只有这个项目的 task / project），桥原样转投。
 */
export interface BridgeEventMessage {
  ns: typeof NAMESPACE;
  kind: "event";
  topic: string;
  payload: unknown;
}

export type BridgeOutboundMessage = BridgeResponseMessage | BridgeEventMessage;

/**
 * 窗口上什么消息都可能飘过来（浏览器扩展、别的 iframe……），不是随便一条
 * `{...}` 就认。四个字段全对上、`path` 以 `/` 开头，才当作一次真请求。
 */
function isBridgeRequest(data: unknown): data is BridgeRequestMessage {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    d["ns"] === NAMESPACE &&
    d["kind"] === "request" &&
    typeof d["id"] === "string" &&
    (d["method"] === "GET" || d["method"] === "POST" || d["method"] === "PUT" || d["method"] === "DELETE") &&
    typeof d["path"] === "string" &&
    d["path"].startsWith("/")
  );
}

export interface ProductBridgeOptions {
  /** 会话令牌能换到的那一次性凭据。桥只用它来换产品级凭据，绝不转发它本身。 */
  getBridgeToken: () => Promise<{ token: string; expiresAt: number }>;
  /**
   * 只认这扇窗口发来的消息——`postMessage` 监听器是整页共用的，不筛 `source`
   * 的话，任何一扇打开过的窗口都能冒充这个产品发请求。
   */
  source: Window;
  /**
   * 只回这个 origin。沙箱 iframe 是独立 origin（ADR-022 §3.1），回错地方
   * 等于谁都收不到——`postMessage` 的 targetOrigin 不对，浏览器直接丢弃。
   */
  targetOrigin: string;
  /** 供测试替换；默认 `window.fetch`。 */
  fetchImpl?: typeof fetch;
  /**
   * 挂上时就开守护进程那条事件流、原样转投给产品界面（片四）。缺省关：只做请求 /
   * 响应的桥（以及它的用例）不该平白多一条长连接。
   */
  events?: boolean;
  /** 事件流断了之后多久重连（毫秒，每次翻倍、封顶 5 秒）。供测试调小。 */
  reconnectDelayMs?: number;
}

export class ProductBridge {
  private readonly getBridgeToken: ProductBridgeOptions["getBridgeToken"];
  private readonly source: Window;
  private readonly targetOrigin: string;
  private readonly fetchImpl: typeof fetch;
  private cached?: { token: string; expiresAt: number };
  private readonly eventsEnabled: boolean;
  private readonly reconnectDelayMs: number;
  private streamAbort?: AbortController;

  private readonly listener = (event: MessageEvent): void => {
    if (event.source !== this.source) return;
    if (event.origin !== this.targetOrigin) return;
    if (!isBridgeRequest(event.data)) return;
    void this.handle(event.data);
  };

  constructor(options: ProductBridgeOptions) {
    this.getBridgeToken = options.getBridgeToken;
    this.source = options.source;
    this.targetOrigin = options.targetOrigin;
    // **不能直接存 `fetch`**：存下来再以 `this.fetchImpl(...)` 调用时，`fetch` 的 `this`
    // 是桥实例，真浏览器直接抛「Failed to execute 'fetch' on 'Window': Illegal
    // invocation」—— 片二第一版就是这样，**在真浏览器里一个请求都发不出去**。它的
    // 26 条用例全部注入了 mock 的 fetchImpl，默认这条路一次都没被走过；jsdom 里也
    // 测不出来（jsdom 的 fetch 不查 this）。是片三 a 在真 Chromium 里跑观察台测试包时
    // 抓到的。包一层箭头函数，让 `fetch` 以全局身份被调用。
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.eventsEnabled = options.events ?? false;
    this.reconnectDelayMs = options.reconnectDelayMs ?? 500;
  }

  attach(): void {
    window.addEventListener("message", this.listener);
    if (this.eventsEnabled && !this.streamAbort) void this.streamEvents();
  }

  /**
   * 卸载产品界面时调用——监听器不摘，一扇已经关掉的窗口的引用会一直留着；事件流
   * 不断，一个已经卸掉的产品界面会一直占着一条长连接。
   */
  detach(): void {
    window.removeEventListener("message", this.listener);
    this.streamAbort?.abort();
    this.streamAbort = undefined;
  }

  /**
   * 守护进程那条事件流（片四），**原样**转投给产品界面。**不筛**：给什么守护进程
   * 已经按凭据定了 —— 桥在这里再筛一遍，筛子就进了渲染进程（ADR-022 §2）。
   *
   * 流会断：凭据到期或被作废时守护进程主动收掉它，守护进程重启也会断。断了就换张
   * 凭据重连，间隔翻倍、封顶 5 秒；**401 时扔掉手上那张凭据** —— 它按时间看还没到期，
   * 不扔的话会拿着一张被作废的凭据一直撞门。
   */
  private async streamEvents(): Promise<void> {
    const abort = new AbortController();
    this.streamAbort = abort;
    let delay = this.reconnectDelayMs;
    while (!abort.signal.aborted) {
      try {
        const res = await this.fetchImpl("/bridge/events", {
          headers: { authorization: `Bearer ${await this.token()}` },
          signal: abort.signal,
        });
        if (res.status === 401) this.cached = undefined;
        if (res.ok && res.body) {
          delay = this.reconnectDelayMs;
          await this.pump(res.body, abort.signal);
        }
      } catch {
        // 断开、换不到凭据、或者 detach() 掐断了请求 —— 下面按是否已掐断决定走不走。
      }
      if (abort.signal.aborted) return;
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, 5_000);
    }
  }

  private async pump(body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) return;
      const parsed = extractSseEvents<unknown>(buffer, decoder.decode(value, { stream: true }));
      buffer = parsed.buffer;
      for (const e of parsed.events) {
        const d = e as { topic?: unknown; payload?: unknown } | null;
        if (d && typeof d.topic === "string") this.emit(d.topic, d.payload);
      }
    }
  }

  /**
   * 向产品界面投一个事件。发起方是工作台自己（比如收到一条 SSE 之后转投），
   * 不经过 `message` 监听那条路——事件投影是单向的，产品界面不会「请求」一个
   * 事件。
   */
  emit(topic: string, payload: unknown): void {
    const message: BridgeEventMessage = { ns: NAMESPACE, kind: "event", topic, payload };
    this.source.postMessage(message, this.targetOrigin);
  }

  /** 提前 30s 换新的，别让一次正常请求恰好卡在令牌过期那一刻上。 */
  private async token(): Promise<string> {
    const now = Date.now();
    if (!this.cached || this.cached.expiresAt - now < 30_000) {
      this.cached = await this.getBridgeToken();
    }
    return this.cached.token;
  }

  private reply(id: string, outcome: Omit<BridgeResponseMessage, "ns" | "kind" | "id">): void {
    const message: BridgeResponseMessage = { ns: NAMESPACE, kind: "response", id, ...outcome };
    this.source.postMessage(message, this.targetOrigin);
  }

  private async handle(request: BridgeRequestMessage): Promise<void> {
    let token: string;
    try {
      token = await this.token();
    } catch (cause) {
      // 换凭据这一步本身失败了（会话令牌过期、项目已不存在……）——请求从没
      // 发出去过，这与「守护进程回了一个错误」是两种不同的失败，错误还原要
      // 分得清。
      this.reply(request.id, {
        ok: false,
        status: 0,
        error: {
          code: "BRIDGE_TOKEN_UNAVAILABLE",
          message: cause instanceof Error ? cause.message : String(cause),
          retryable: true,
        },
      });
      return;
    }

    let res: Response;
    try {
      res = await this.fetchImpl(`/bridge${request.path}`, {
        method: request.method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(request.body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: request.body !== undefined ? JSON.stringify(request.body) : undefined,
      });
    } catch (cause) {
      this.reply(request.id, {
        ok: false,
        status: 0,
        error: {
          code: "BRIDGE_NETWORK_ERROR",
          message: cause instanceof Error ? cause.message : String(cause),
          retryable: true,
        },
      });
      return;
    }

    const data: unknown = await res.json().catch(() => undefined);
    if (res.ok) {
      this.reply(request.id, { ok: true, status: res.status, body: data });
      return;
    }

    const err = data as Partial<BridgeApiError> | undefined;
    this.reply(request.id, {
      ok: false,
      status: res.status,
      error: {
        code: typeof err?.code === "string" ? err.code : "BRIDGE_UNKNOWN_ERROR",
        message: typeof err?.message === "string" ? err.message : `HTTP ${res.status}`,
        retryable: typeof err?.retryable === "boolean" ? err.retryable : false,
        ...(typeof err?.field === "string" ? { field: err.field } : {}),
      },
    });
  }
}
