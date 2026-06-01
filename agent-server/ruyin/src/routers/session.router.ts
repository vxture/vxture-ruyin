/**
 * session.router.ts - 会话路由处理
 * @package agent-server/ruyin
 *
 * Description: 处理会话相关的 HTTP 路由，只负责请求路由和响应格式化，不含业务逻辑
 *
 * @author AI-Generated
 * @date 2026-03-11 22:00:00
 * @version 1.0
 *
 * @copyright Vxture Team
 * @license MIT
 *
 * @layer Application
 * @category Router
 */

import type {
  AgentRequestContext,
  CreateSessionRequest,
  CreateSessionResponse,
  SendMessageRequest,
  SendMessageResponse,
  GetTaskStatusRequest,
  GetTaskStatusResponse,
  ApiResponse,
  ChatMessage,
} from "../types/ruyin.types";
import { chatService } from "../services/chat.service";
import { workflowTaskManager } from "../workflows/ruyin.workflow";

// ============================================================================
// 会话路由处理
// ============================================================================

/**
 * 会话路由处理器
 */
export class SessionRouter {
  private static instance: SessionRouter;

  /**
   * 获取单例实例
   */
  static getInstance(): SessionRouter {
    if (!SessionRouter.instance) {
      SessionRouter.instance = new SessionRouter();
    }
    return SessionRouter.instance;
  }

  /**
   * 创建新会话
   */
  async createSession(
    context: AgentRequestContext,
    req: CreateSessionRequest,
  ): Promise<ApiResponse<CreateSessionResponse>> {
    try {
      const session = await chatService.createSession(
        context.userId,
        context.tenantId,
        req.config,
      );

      return {
        code: 200,
        message: "Session created successfully",
        data: {
          sessionId: session.sessionId,
          config: session,
        },
      };
    } catch (error) {
      return {
        code: 500,
        message: "Failed to create session",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * 发送消息
   */
  async sendMessage(
    context: AgentRequestContext,
    req: SendMessageRequest,
  ): Promise<ApiResponse<SendMessageResponse>> {
    try {
      const result = await chatService.sendMessage(req, context);

      return {
        code: 200,
        message: "Message sent successfully",
        data: result,
      };
    } catch (error) {
      return {
        code: 500,
        message: "Failed to send message",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * 获取会话历史
   */
  async getSessionHistory(
    context: AgentRequestContext,
    sessionId: string,
    limit?: number,
  ): Promise<ApiResponse<ChatMessage[]>> {
    try {
      const messages = await chatService.getSessionHistory(
        sessionId,
        context,
        limit,
      );

      return {
        code: 200,
        message: "History retrieved successfully",
        data: messages,
      };
    } catch (error) {
      return {
        code: 500,
        message: "Failed to retrieve history",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * 获取任务状态
   */
  async getTaskStatus(
    context: AgentRequestContext,
    sessionId: string,
    req: GetTaskStatusRequest,
  ): Promise<ApiResponse<GetTaskStatusResponse>> {
    try {
      await chatService.ensureSessionAccess(
        sessionId,
        context.userId,
        context.tenantId,
      );
      const task = workflowTaskManager.getTaskStatus(req.taskId);

      if (!task) {
        return {
          code: 404,
          message: "Task not found",
        };
      }

      return {
        code: 200,
        message: "Task status retrieved successfully",
        data: {
          status: task.status,
          progress:
            task.status === "running"
              ? 50
              : task.status === "completed"
                ? 100
                : 0,
          result: task.result,
          ...(task.status === "failed"
            ? {
                error:
                  task.result &&
                  typeof task.result === "object" &&
                  "error" in task.result
                    ? String(task.result.error)
                    : "Task failed",
              }
            : {}),
        },
      };
    } catch (error) {
      return {
        code: 500,
        message: "Failed to retrieve task status",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}

/**
 * 全局路由实例
 */
export const sessionRouter = SessionRouter.getInstance();
