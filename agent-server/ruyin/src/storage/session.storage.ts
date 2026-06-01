/**
 * session.storage.ts - 会话数据存储
 * @package agent-server/ruyin
 *
 * Description: 封装会话相关的存储操作，返回 Agent 领域类型，不直接返回 Prisma 原始类型
 *
 * @author AI-Generated
 * @date 2026-03-11 22:00:00
 * @version 1.0
 *
 * @copyright Vxture Team
 * @license MIT
 *
 * @layer Application
 * @category Storage
 */

import type { SessionConfig, ChatMessage } from "../types/ruyin.types";

// ============================================================================
// 数据访问接口
// ============================================================================

/**
 * 会话存储接口
 */
export interface SessionStorage {
  /** 创建新会话 */
  createSession(
    config: Omit<SessionConfig, "createdAt" | "updatedAt">,
  ): Promise<SessionConfig>;

  /** 获取会话 */
  getSession(sessionId: string): Promise<SessionConfig | null>;

  /** 更新会话 */
  updateSession(
    sessionId: string,
    updates: Partial<SessionConfig>,
  ): Promise<SessionConfig>;

  /** 删除会话 */
  deleteSession(sessionId: string): Promise<boolean>;

  /** 存储聊天消息 */
  storeMessage(sessionId: string, message: ChatMessage): Promise<ChatMessage>;

  /** 获取会话历史消息 */
  getSessionHistory(sessionId: string, limit?: number): Promise<ChatMessage[]>;

  /** 搜索会话历史 */
  searchSessionHistory(
    sessionId: string,
    query: string,
  ): Promise<ChatMessage[]>;
}

// ============================================================================
// 内存存储实现（示例）
// ============================================================================

/**
 * 内存存储实现（用于开发和测试）
 */
export class MemorySessionStorage implements SessionStorage {
  private sessions: Map<string, SessionConfig> = new Map();
  private messages: Map<string, ChatMessage[]> = new Map();

  async createSession(
    config: Omit<SessionConfig, "createdAt" | "updatedAt">,
  ): Promise<SessionConfig> {
    const session: SessionConfig = {
      ...config,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.sessions.set(config.sessionId, session);
    this.messages.set(config.sessionId, []);

    return session;
  }

  async getSession(sessionId: string): Promise<SessionConfig | null> {
    return this.sessions.get(sessionId) || null;
  }

  async updateSession(
    sessionId: string,
    updates: Partial<SessionConfig>,
  ): Promise<SessionConfig> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const updatedSession: SessionConfig = {
      ...session,
      ...updates,
      updatedAt: new Date(),
    };

    this.sessions.set(sessionId, updatedSession);
    return updatedSession;
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const deletedSession = this.sessions.delete(sessionId);
    this.messages.delete(sessionId);
    return deletedSession;
  }

  async storeMessage(
    sessionId: string,
    message: ChatMessage,
  ): Promise<ChatMessage> {
    const sessionMessages = this.messages.get(sessionId);
    if (!sessionMessages) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    sessionMessages.push(message);
    return message;
  }

  async getSessionHistory(
    sessionId: string,
    limit: number = 50,
  ): Promise<ChatMessage[]> {
    const sessionMessages = this.messages.get(sessionId) || [];
    return sessionMessages.slice(-limit);
  }

  async searchSessionHistory(
    sessionId: string,
    query: string,
  ): Promise<ChatMessage[]> {
    const sessionMessages = this.messages.get(sessionId) || [];
    const lowerCaseQuery = query.toLowerCase();

    return sessionMessages.filter(
      (message) =>
        message.content.toLowerCase().includes(lowerCaseQuery) ||
        message.taskId?.toLowerCase().includes(lowerCaseQuery),
    );
  }
}

// ============================================================================
// 存储工厂
// ============================================================================

/**
 * 创建会话存储实例
 */
export function createSessionStorage(
  type: "memory" | "prisma" = "memory",
): SessionStorage {
  switch (type) {
    case "memory":
      return new MemorySessionStorage();
    case "prisma":
      // 未来支持 Prisma 存储
      throw new Error("Prisma storage not implemented yet");
    default:
      throw new Error(`Unknown storage type: ${type}`);
  }
}

/**
 * 全局存储实例
 */
export const sessionStorage = createSessionStorage("memory");
