/**
 * chat.service.ts - 聊天业务逻辑服务
 * @package agent-server/ruyin
 *
 * Description: 包含 Ruyin Agent 的聊天业务逻辑，调用 storage 层获取数据，调用 @vxture/ai-gateway-client 处理 AI 任务
 *
 * @author AI-Generated
 * @date 2026-03-11 22:00:00
 * @version 1.0
 *
 * @copyright Vxture Team
 * @license MIT
 *
 * @layer Application
 * @category Service
 */

import type {
  ChatMessage,
  SessionConfig,
  SendMessageRequest,
  SendMessageResponse,
} from "../types/ruyin.types";
import { sessionStorage } from "../storage/session.storage";
import { vectorStorage } from "../storage/vector.storage";

// ============================================================================
// 聊天服务
// ============================================================================

/**
 * 聊天服务
 */
export class ChatService {
  private static instance: ChatService;

  /**
   * 获取单例实例
   */
  static getInstance(): ChatService {
    if (!ChatService.instance) {
      ChatService.instance = new ChatService();
    }
    return ChatService.instance;
  }

  /**
   * 创建新会话
   */
  async createSession(
    userId: string,
    tenantId: string,
    config?: Record<string, unknown>,
  ): Promise<SessionConfig> {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const sessionConfig: SessionConfig = {
      sessionId,
      userId,
      tenantId,
      config: config || {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    return await sessionStorage.createSession(sessionConfig);
  }

  /**
   * 确保会话属于当前认证用户
   */
  async ensureSessionAccess(
    sessionId: string,
    userId: string,
    tenantId: string,
  ): Promise<SessionConfig> {
    const session = await sessionStorage.getSession(sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    if (session.userId !== userId) {
      throw new Error("Session access denied");
    }

    if (tenantId && session.tenantId && session.tenantId !== tenantId) {
      throw new Error("Session access denied");
    }

    return session;
  }

  /**
   * 发送消息
   */
  async sendMessage(
    request: SendMessageRequest,
    context: { userId: string; tenantId: string },
  ): Promise<SendMessageResponse> {
    await this.ensureSessionAccess(
      request.sessionId,
      context.userId,
      context.tenantId,
    );

    const userMessage: ChatMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      sender: "user",
      content: request.content,
      type: request.type,
      timestamp: new Date(),
      ...(request.taskId ? { taskId: request.taskId } : {}),
    };

    await sessionStorage.storeMessage(request.sessionId, userMessage);

    const needsAsync =
      request.type === "action" || request.content.length > 500;

    if (needsAsync) {
      return {
        message: userMessage,
        requiresAsync: true,
        taskId: `task_${Date.now()}`,
      };
    }

    // 简单的模拟响应（实际项目中会调用真实的 LLM）
    const responseMessage: ChatMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      sender: "agent",
      content: "我收到了你的消息。由于 AI SDK 尚未完整实现，这是一个模拟响应。",
      type: "text",
      timestamp: new Date(),
    };

    await sessionStorage.storeMessage(request.sessionId, responseMessage);

    return {
      message: userMessage,
      requiresAsync: false,
    };
  }

  /**
   * 获取会话历史
   */
  async getSessionHistory(
    sessionId: string,
    context: { userId: string; tenantId: string },
    limit?: number,
  ): Promise<ChatMessage[]> {
    await this.ensureSessionAccess(sessionId, context.userId, context.tenantId);
    return await sessionStorage.getSessionHistory(sessionId, limit);
  }

  /**
   * 向知识库添加文档
   */
  async addToKnowledgeBase(
    content: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    // 简单的模拟实现
    const mockEmbedding = Array(1536)
      .fill(0)
      .map(() => Math.random());

    await vectorStorage.storeVector({
      content,
      embedding: mockEmbedding,
      metadata,
    });
  }
}

/**
 * 全局聊天服务实例
 */
export const chatService = ChatService.getInstance();
