/**
 * ruyin.types.ts - Ruyin 类型定义
 * @package agent-server/ruyin
 *
 * Description: 包含 Ruyin Agent 私有的类型定义，不对外暴露 Prisma 原始类型
 *
 * @author AI-Generated
 * @date 2026-03-11 22:00:00
 * @version 1.0
 *
 * @copyright Vxture Team
 * @license MIT
 *
 * @layer Application
 * @category Types
 */

// ============================================================================
// 核心类型定义
// ============================================================================

/**
 * 会话配置类型
 */
export interface SessionConfig {
  /** 会话ID */
  sessionId: string;
  /** 用户ID */
  userId: string;
  /** 租户ID */
  tenantId: string;
  /** 会话配置 */
  config: Record<string, unknown>;
  /** 创建时间 */
  createdAt: Date;
  /** 更新时间 */
  updatedAt: Date;
}

/**
 * 认证后的请求上下文
 */
export interface AgentRequestContext {
  /** 用户ID */
  userId: string;
  /** 租户ID */
  tenantId: string;
  /** 用户邮箱 */
  email: string;
  /** 平台角色 */
  role: string;
}

/**
 * 工作流任务类型
 */
export interface WorkflowTask {
  /** 任务ID */
  taskId: string;
  /** 任务类型 */
  type: string;
  /** 任务状态 */
  status: "pending" | "running" | "completed" | "failed";
  /** 任务参数 */
  params: Record<string, any>;
  /** 任务结果 */
  result?: any;
  /** 创建时间 */
  createdAt: Date;
  /** 完成时间 */
  completedAt?: Date;
}

/**
 * 向量数据类型
 */
export interface VectorData {
  /** 向量ID */
  id: string;
  /** 内容文本 */
  content: string;
  /** 向量嵌入 */
  embedding: number[];
  /** 元数据 */
  metadata: Record<string, any>;
}

/**
 * 聊天记录类型
 */
export interface ChatMessage {
  /** 消息ID */
  id: string;
  /** 发送方 */
  sender: "user" | "agent" | "system";
  /** 消息内容 */
  content: string;
  /** 消息类型 */
  type: "text" | "image" | "document" | "action";
  /** 发送时间 */
  timestamp: Date;
  /** 相关任务ID */
  taskId?: string;
}

/**
 * Agent 配置类型
 */
export interface AgentConfig {
  /** Agent ID */
  agentId: string;
  /** Agent 名称 */
  name: string;
  /** 描述 */
  description: string;
  /** AI 模型配置 */
  modelConfig: {
    /** 模型名称 */
    modelName: string;
    /** 温度参数 */
    temperature: number;
    /** 最大 token 数 */
    maxTokens: number;
  };
  /** 功能配置 */
  features: {
    /** 是否启用 RAG */
    ragEnabled: boolean;
    /** 是否启用工作流 */
    workflowEnabled: boolean;
    /** 是否启用向量存储 */
    vectorStoreEnabled: boolean;
  };
}

// ============================================================================
// API 响应类型
// ============================================================================

/**
 * 通用响应类型
 */
export interface ApiResponse<T = any> {
  /** 状态码 */
  code: number;
  /** 消息 */
  message: string;
  /** 数据 */
  data?: T;
  /** 错误信息 */
  error?: string;
}

/**
 * 会话创建请求
 */
export interface CreateSessionRequest {
  /** 初始配置 */
  config?: Record<string, unknown>;
}

/**
 * 会话创建响应
 */
export interface CreateSessionResponse {
  /** 会话ID */
  sessionId: string;
  /** 会话配置 */
  config: SessionConfig;
}

/**
 * 发送消息请求
 */
export interface SendMessageRequest {
  /** 会话ID */
  sessionId: string;
  /** 消息内容 */
  content: string;
  /** 消息类型 */
  type: "text" | "image" | "document" | "action";
  /** 相关任务ID */
  taskId?: string;
}

/**
 * 发送消息响应
 */
export interface SendMessageResponse {
  /** 消息记录 */
  message: ChatMessage;
  /** 是否需要异步处理 */
  requiresAsync: boolean;
  /** 任务ID（如需要异步处理） */
  taskId?: string;
}

/**
 * 获取任务状态请求
 */
export interface GetTaskStatusRequest {
  /** 任务ID */
  taskId: string;
}

/**
 * 获取任务状态响应
 */
export interface GetTaskStatusResponse {
  /** 任务状态 */
  status: "pending" | "running" | "completed" | "failed";
  /** 任务进度 */
  progress?: number;
  /** 任务结果 */
  result?: any;
  /** 错误信息 */
  error?: string;
}
