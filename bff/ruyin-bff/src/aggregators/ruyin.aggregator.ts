/**
 * ruyin.aggregator.ts - Ruyin upstream aggregator
 * @package @vxture/bff-ruyin
 *
 * Description: Calls the paired agent-server/ruyin internal API and reshapes
 * responses for the frontend consumer.
 *
 * @author AI-Generated
 * @date 2026-04-22
 * @version 1.0
 *
 * @copyright Vxture Team
 * @license MIT
 *
 * @layer Application
 * @category Aggregator
 */

import { Inject, Injectable } from "@nestjs/common";
import { VxConfigService } from "@vxture/core-config";
import type {
  CreateSessionDto,
  CreateSessionResponseDto,
  ChatMessageDto,
  SendMessageDto,
  SendMessageResponseDto,
  TaskStatusResponseDto,
} from "../types/ruyin.types";

interface AgentServerEnvelope<T> {
  code: number;
  message: string;
  data?: T;
  error?: string;
}

interface AgentServerSessionConfig {
  sessionId: string;
  userId: string;
  tenantId: string;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface AgentServerCreateSessionData {
  sessionId: string;
  config: AgentServerSessionConfig;
}

interface AgentServerChatMessage {
  id: string;
  sender: "user" | "agent" | "system";
  content: string;
  type: "text" | "image" | "document" | "action";
  timestamp: string;
  taskId?: string;
}

interface AgentServerSendMessageData {
  message: AgentServerChatMessage;
  requiresAsync: boolean;
  taskId?: string;
}

interface AgentServerTaskStatusData {
  status: "pending" | "running" | "completed" | "failed";
  progress?: number;
  result?: unknown;
  error?: string;
}

export class RuyinBffError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "RuyinBffError";
  }
}

@Injectable()
export class RuyinAggregator {
  constructor(
    @Inject(VxConfigService) private readonly configService: VxConfigService,
  ) {}

  async createSession(
    accessToken: string,
    body: CreateSessionDto,
  ): Promise<CreateSessionResponseDto> {
    const data = await this.request<AgentServerCreateSessionData>(
      "/api/session",
      {
        method: "POST",
        headers: this.buildHeaders(accessToken),
        body: JSON.stringify({
          config: body.config ?? {},
        }),
      },
    );

    return {
      sessionId: data.sessionId,
      session: this.mapSession(data.config),
    };
  }

  async getSessionHistory(
    accessToken: string,
    sessionId: string,
  ): Promise<ChatMessageDto[]> {
    const data = await this.request<AgentServerChatMessage[]>(
      `/api/session/${encodeURIComponent(sessionId)}/history`,
      {
        method: "GET",
        headers: this.buildHeaders(accessToken, false),
      },
    );

    return data.map((message) => this.mapMessage(message));
  }

  async sendMessage(
    accessToken: string,
    sessionId: string,
    body: SendMessageDto,
  ): Promise<SendMessageResponseDto> {
    const data = await this.request<AgentServerSendMessageData>(
      `/api/session/${encodeURIComponent(sessionId)}/message`,
      {
        method: "POST",
        headers: this.buildHeaders(accessToken),
        body: JSON.stringify(body),
      },
    );

    return {
      message: this.mapMessage(data.message),
      requiresAsync: data.requiresAsync,
      ...(data.taskId !== undefined ? { taskId: data.taskId } : {}),
    };
  }

  async getTaskStatus(
    accessToken: string,
    sessionId: string,
    taskId: string,
  ): Promise<TaskStatusResponseDto> {
    const data = await this.request<AgentServerTaskStatusData>(
      `/api/session/${encodeURIComponent(sessionId)}/task?taskId=${encodeURIComponent(taskId)}`,
      {
        method: "GET",
        headers: this.buildHeaders(accessToken, false),
      },
    );

    return {
      status: data.status,
      ...(data.progress !== undefined ? { progress: data.progress } : {}),
      ...(data.result !== undefined ? { result: data.result } : {}),
      ...(data.error !== undefined ? { error: data.error } : {}),
    };
  }

  private buildHeaders(
    accessToken: string,
    includeContentType: boolean = true,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${accessToken}`,
    };

    if (includeContentType) {
      headers["content-type"] = "application/json";
    }

    return headers;
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(
      `${this.configService.app.AGENT_SERVER_BASE_URL}${path}`,
      init,
    );
    const payload = (await response.json()) as AgentServerEnvelope<T>;
    const statusCode = response.status || payload.code || 500;

    if (!response.ok || payload.code >= 400 || payload.data === undefined) {
      throw new RuyinBffError(
        payload.error ?? payload.message ?? "Upstream request failed",
        statusCode,
      );
    }

    return payload.data;
  }

  private mapSession(
    session: AgentServerSessionConfig,
  ): CreateSessionResponseDto["session"] {
    return {
      sessionId: session.sessionId,
      tenantId: session.tenantId,
      config: session.config,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  private mapMessage(message: AgentServerChatMessage): ChatMessageDto {
    return {
      id: message.id,
      sender: message.sender,
      content: message.content,
      type: message.type,
      timestamp: message.timestamp,
      ...(message.taskId !== undefined ? { taskId: message.taskId } : {}),
    };
  }
}
