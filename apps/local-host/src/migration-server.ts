/**
 * 搬家期间的那个**极小服务**（TD-039）。
 *
 * 为什么需要它：搬家发生在开库之前，而开库之前守护进程本来什么都不回答 —— 壳只
 * 能干等，用户只能看着一个不确定的进度条。让它在这段时间里先把 `/health` 支起来，
 * 壳就能问「搬到哪儿了」，那一屏也就有了真实进度。
 *
 * **故意只有两个端点，而且什么都不打开。** 这段时间里数据库、密钥、平台会话全都
 * 还没准备好；任何多余的端点都会变成一条「在半个运行时上被调用」的路。
 */
import { createServer, type Server } from "node:http";

export interface MigrationStatus {
  /** 正在搬（`copy`/`verify`），还是已经收尾。 */
  phase: "copy" | "verify";
  copiedBytes: number;
  totalBytes: number;
  from: string;
  to: string;
}

/**
 * 起这个小服务。**返回的 Promise 在真正监听上之后才 resolve** —— 调用方紧接着就
 * 要开始搬家，端口没起来的话壳问不到进度，那一屏就退回不确定态。
 */
export function startMigrationServer(
  port: number,
  token: string,
  status: () => MigrationStatus,
): Promise<Server> {
  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    // `/health` 不校验令牌，与正式服务同一个口径：壳要能先判断「有没有人在」。
    if (url.startsWith("/health")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, state: "migrating" }));
      return;
    }
    if (url.startsWith("/migration")) {
      const auth = req.headers["authorization"];
      if (auth !== `Bearer ${token}`) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ code: "UNAUTHORIZED", message: "missing or bad token" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(status()));
      return;
    }
    // 别的什么都没有：这一刻运行时只搬了一半，任何别的回答都会是假的。
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ code: "MIGRATING", message: "runtime is moving its data directory" }));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

/** 关掉它，**等真的关上**：紧接着正式服务要监听同一个端口。 */
export function stopMigrationServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}
