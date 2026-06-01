/**
 * index.ts - Ruyin Agent Server 应用入口
 * @package agent-server/ruyin
 *
 * Description: Ruyin Agent 的私有后端服务入口，使用 HTTP 服务器响应 BFF 请求
 *
 * @author AI-Generated
 * @date 2026-03-11 22:00:00
 * @version 1.0
 *
 * @copyright Vxture Team
 * @license MIT
 *
 * @layer Application
 * @category Main
 */

import { createServer } from "http";
import type { IncomingMessage, ServerResponse } from "http";
import { z } from "zod";
import { JwtService } from "@nestjs/jwt";
import type { JwtAccessPayload } from "@vxture/core-auth";
import { extractBearerTokenFromHeaders } from "@vxture/core-auth";
import { aiProvider } from "./providers/ai.provider";
import { sessionRouter } from "./routers/session.router";
import type {
  AgentRequestContext,
  CreateSessionRequest,
  SendMessageRequest,
} from "./types/ruyin.types";

// ============================================================================
// 服务器配置
// ============================================================================

// Fail-fast: JWT_SECRET must be present and ≥32 chars before the server starts.
// Direct process.env.JWT_SECRET is intentional here — ruyin runs as a plain
// HTTP server (not NestJS), so VxConfigService DI is not available.
const JWT_SECRET = z
  .string()
  .min(32, "JWT_SECRET must be at least 32 characters for security")
  .parse(process.env["JWT_SECRET"]);

const DEFAULT_PORT = 3112;
const jwtService = new JwtService();

// ============================================================================
// 请求处理函数
// ============================================================================

const handleRequest = async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  try {
    // 设置 CORS 头部
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, OPTIONS",
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
    );

    // 处理 OPTIONS 预检请求
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // 路由处理
    const requestUrl = new URL(
      req.url ?? "/",
      `http://${req.headers.host ?? "localhost"}`,
    );
    const pathname = requestUrl.pathname;

    // 健康检查
    if (pathname === "/health") {
      writeJson(res, 200, {
        status: "healthy",
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // API 路由
    if (pathname.startsWith("/api")) {
      const context = resolveRequestContext(req);
      if (!context) {
        writeJson(res, 401, { error: "Unauthorized" });
        return;
      }

      await handleApiRequest(req, res, pathname, requestUrl, context);
      return;
    }

    // 默认响应
    writeJson(res, 404, { error: "Not Found" });
  } catch (error) {
    console.error("Request handling error:", error);
    writeJson(res, 500, {
      error: "Internal Server Error",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// ============================================================================
// API 请求处理
// ============================================================================

const handleApiRequest = async (
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  requestUrl: URL,
  context: AgentRequestContext,
): Promise<void> => {
  if (pathname === "/api/session") {
    if (req.method === "POST") {
      await handleCreateSession(req, res, context);
    } else {
      writeJson(res, 405, { error: "Method Not Allowed" });
    }
    return;
  }

  if (pathname.startsWith("/api/session/")) {
    const match = pathname.match(/\/api\/session\/([^/]+)/);
    const sessionId = match?.[1];
    if (sessionId) {
      await handleSessionOperations(
        req,
        res,
        pathname,
        requestUrl,
        sessionId,
        context,
      );
    } else {
      writeJson(res, 404, { error: "Not Found" });
    }
    return;
  }

  writeJson(res, 404, { error: "API endpoint not found" });
};

// ============================================================================
// 会话操作处理
// ============================================================================

const handleCreateSession = async (
  req: IncomingMessage,
  res: ServerResponse,
  context: AgentRequestContext,
): Promise<void> => {
  const requestData = await readJsonBody<CreateSessionRequest>(req);
  const response = await sessionRouter.createSession(context, requestData);
  writeJson(res, response.code, response);
};

const handleSessionOperations = async (
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  requestUrl: URL,
  sessionId: string,
  context: AgentRequestContext,
): Promise<void> => {
  if (pathname === `/api/session/${sessionId}`) {
    if (req.method === "GET") {
      writeJson(res, 501, { error: "Not Implemented" });
      return;
    }
  } else if (pathname === `/api/session/${sessionId}/history`) {
    if (req.method === "GET") {
      const response = await sessionRouter.getSessionHistory(
        context,
        sessionId,
        50,
      );
      writeJson(res, response.code, response);
      return;
    }
  } else if (pathname === `/api/session/${sessionId}/message`) {
    if (req.method === "POST") {
      const requestData =
        await readJsonBody<Omit<SendMessageRequest, "sessionId">>(req);
      const response = await sessionRouter.sendMessage(context, {
        sessionId,
        ...requestData,
      });
      writeJson(res, response.code, response);
      return;
    }
  } else if (pathname === `/api/session/${sessionId}/task`) {
    if (req.method === "GET") {
      const taskId = requestUrl.searchParams.get("taskId");
      if (taskId) {
        const response = await sessionRouter.getTaskStatus(context, sessionId, {
          taskId,
        });
        writeJson(res, response.code, response);
      } else {
        writeJson(res, 400, { error: "Missing taskId parameter" });
      }
      return;
    }
  }

  writeJson(res, 405, { error: "Method Not Allowed" });
};

// ============================================================================
// 服务器类
// ============================================================================

class RuyinServer {
  private server: ReturnType<typeof createServer> | null = null;
  private port: number;

  constructor(port: number = DEFAULT_PORT) {
    this.port = port;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer(handleRequest);

      this.server.listen(this.port, async () => {
        try {
          // 初始化 AI Provider
          await aiProvider.initialize();

          console.log(`Ruyin Server running on port ${this.port}`);
          resolve();
        } catch (error) {
          console.error("AI Provider initialization failed:", error);
          reject(error);
        }
      });

      this.server.on("error", (error) => {
        console.error("Server error:", error);
        reject(error);
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.server) {
        this.server.close((error) => {
          if (error) {
            console.error("Error closing server:", error);
            reject(error);
          } else {
            console.log("Ruyin Server stopped");
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }
}

// ============================================================================
// 启动函数
// ============================================================================

export function startRuyinServer(port?: number): Promise<RuyinServer> {
  const server = new RuyinServer(port);
  return server.start().then(() => server);
}

export default RuyinServer;

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  let body = "";

  await new Promise<void>((resolve, reject) => {
    req.on("data", (chunk: Buffer | string) => {
      body += chunk.toString();
    });
    req.on("end", resolve);
    req.on("error", reject);
  });

  return (body ? JSON.parse(body) : {}) as T;
}

function resolveRequestContext(
  req: IncomingMessage,
): AgentRequestContext | null {
  const token = extractBearerTokenFromHeaders(req.headers);

  if (!token) {
    return null;
  }

  try {
    const payload = jwtService.verify<JwtAccessPayload>(token, {
      secret: JWT_SECRET,
    });
    return {
      userId: payload.sub,
      tenantId: payload.tenantId,
      email: payload.email,
      role: payload.role,
    };
  } catch {
    return null;
  }
}

function writeJson(
  res: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  res.writeHead(statusCode);
  res.end(JSON.stringify(body));
}
