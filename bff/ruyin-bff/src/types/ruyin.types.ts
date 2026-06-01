/**
 * ruyin.types.ts - Ruyin BFF DTOs
 * @package @vxture/bff-ruyin
 *
 * Description: Frontend-facing request and response DTOs for the Ruyin BFF.
 *
 * @author AI-Generated
 * @date 2026-04-22
 * @version 1.0
 *
 * @copyright Vxture Team
 * @license MIT
 *
 * @layer Application
 * @category Types
 */

export interface CreateSessionDto {
  config?: Record<string, unknown>;
}

export interface SessionDto {
  sessionId: string;
  tenantId: string;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSessionResponseDto {
  sessionId: string;
  session: SessionDto;
}

export interface ChatMessageDto {
  id: string;
  sender: "user" | "agent" | "system";
  content: string;
  type: "text" | "image" | "document" | "action";
  timestamp: string;
  taskId?: string;
}

export interface SendMessageDto {
  content: string;
  type: "text" | "image" | "document" | "action";
  taskId?: string;
}

export interface SendMessageResponseDto {
  message: ChatMessageDto;
  requiresAsync: boolean;
  taskId?: string;
}

export interface TaskStatusResponseDto {
  status: "pending" | "running" | "completed" | "failed";
  progress?: number;
  result?: unknown;
  error?: string;
}
