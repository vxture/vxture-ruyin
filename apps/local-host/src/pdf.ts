/**
 * 向壳请求 PDF 排版（ADR-017 守护进程侧）。
 *
 * 守护进程里没有 Chromium，壳里有。请求经 `utilityProcess` 的消息通道过去，
 * 字节回来，**落盘仍然在这一侧**走 `writeArtifact` —— 授权护栏、大小上限、
 * 原子改名只有那一处。
 *
 * 守护进程也可以脱离壳单独跑（开发时就是）。那种配置下 `parentPort` 不存在，
 * 这里返回 undefined，工具执行器据此如实回答「本宿主没有接 PDF 渲染器」，
 * 而不是给一份空文件。
 */

/** 一次排版的上限。等不到就报错 —— 挂着不返回的工具调用比失败更糟。 */
const RENDER_TIMEOUT_MS = 90_000;

interface ParentPort {
  postMessage(message: unknown): void;
  on(event: "message", listener: (event: { data: unknown }) => void): void;
  start?(): void;
}

interface RenderReply {
  kind: "render-pdf-result";
  id: string;
  ok: boolean;
  bytes?: ArrayLike<number> | { data?: ArrayLike<number> };
  error?: string;
}

function isReply(value: unknown): value is RenderReply {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v["kind"] === "render-pdf-result" && typeof v["id"] === "string";
}

/**
 * 结构化克隆过来的 Uint8Array 在有些 Electron 版本上会变成
 * `{ type: "Buffer", data: [...] }`。两种形状都收，收不了就明说 —— 悄悄产出
 * 一份长度为 0 的「PDF」，它会安静地落到用户等成果的位置上。
 */
function toBytes(raw: RenderReply["bytes"]): Uint8Array {
  if (raw instanceof Uint8Array) return raw;
  if (raw && typeof raw === "object" && "data" in raw && raw.data) {
    return Uint8Array.from(raw.data);
  }
  if (raw && typeof (raw as ArrayLike<number>).length === "number") {
    return Uint8Array.from(raw as ArrayLike<number>);
  }
  throw new Error("shell returned a PDF payload this host cannot read");
}

/**
 * 接上壳的 PDF 渲染器；脱离壳运行时返回 undefined。
 */
export function shellPdfRenderer():
  | ((html: string) => Promise<Uint8Array>)
  | undefined {
  const port = (process as unknown as { parentPort?: ParentPort }).parentPort;
  if (!port) return undefined;

  const pending = new Map<
    string,
    { resolve: (bytes: Uint8Array) => void; reject: (cause: Error) => void }
  >();
  let seq = 0;

  port.on("message", (event) => {
    // 两种形状都收：不同 Electron 版本上，投递过来的可能是 { data } 包装，
    // 也可能就是消息本身。
    const reply = (event as { data?: unknown })?.data ?? event;
    if (!isReply(reply)) return;
    const waiter = pending.get(reply.id);
    if (!waiter) return;
    pending.delete(reply.id);
    if (!reply.ok) {
      waiter.reject(new Error(reply.error ?? "the shell could not render this document"));
      return;
    }
    try {
      waiter.resolve(toBytes(reply.bytes));
    } catch (cause) {
      waiter.reject(cause instanceof Error ? cause : new Error(String(cause)));
    }
  });
  port.start?.();

  return (html: string) =>
    new Promise<Uint8Array>((resolve, reject) => {
      const id = `pdf_${++seq}`;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`the shell did not answer within ${RENDER_TIMEOUT_MS}ms`));
      }, RENDER_TIMEOUT_MS);
      pending.set(id, {
        resolve: (bytes) => {
          clearTimeout(timer);
          resolve(bytes);
        },
        reject: (cause) => {
          clearTimeout(timer);
          reject(cause);
        },
      });
      port.postMessage({ kind: "render-pdf", id, html });
    });
}
