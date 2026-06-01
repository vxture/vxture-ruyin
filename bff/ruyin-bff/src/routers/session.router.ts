/**
 * session.router.ts - Ruyin session router
 * @package @vxture/bff-ruyin
 *
 * Description: Authenticated frontend-facing routes for session lifecycle and messaging.
 *
 * @author AI-Generated
 * @date 2026-04-22
 * @version 1.0
 *
 * @copyright Vxture Team
 * @license MIT
 *
 * @layer Application
 * @category Router
 */

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import {
  RuyinAggregator,
  RuyinBffError,
} from "../aggregators/ruyin.aggregator";
import type { RequestContext } from "../types/auth.types";
import type { CreateSessionDto, SendMessageDto } from "../types/ruyin.types";

@Controller("api/session")
export class SessionRouter {
  constructor(
    @Inject(RuyinAggregator) private readonly ruyinAggregator: RuyinAggregator,
  ) {}

  @Post()
  async createSession(
    @Req() req: Request & RequestContext,
    @Body() body: CreateSessionDto,
  ) {
    const accessToken = requireAccessToken(req);

    try {
      return await this.ruyinAggregator.createSession(accessToken, body);
    } catch (error: unknown) {
      throw mapBffError(error);
    }
  }

  @Get(":sessionId/history")
  async getSessionHistory(
    @Req() req: Request & RequestContext,
    @Param("sessionId") sessionId: string,
  ) {
    const accessToken = requireAccessToken(req);

    try {
      return await this.ruyinAggregator.getSessionHistory(
        accessToken,
        sessionId,
      );
    } catch (error: unknown) {
      throw mapBffError(error);
    }
  }

  @Post(":sessionId/message")
  async sendMessage(
    @Req() req: Request & RequestContext,
    @Param("sessionId") sessionId: string,
    @Body() body: SendMessageDto,
  ) {
    const accessToken = requireAccessToken(req);

    try {
      return await this.ruyinAggregator.sendMessage(
        accessToken,
        sessionId,
        body,
      );
    } catch (error: unknown) {
      throw mapBffError(error);
    }
  }

  @Get(":sessionId/task")
  async getTaskStatus(
    @Req() req: Request & RequestContext,
    @Param("sessionId") sessionId: string,
    @Query("taskId") taskId?: string,
  ) {
    if (!taskId) {
      throw new BadRequestException("Missing taskId parameter");
    }

    const accessToken = requireAccessToken(req);

    try {
      return await this.ruyinAggregator.getTaskStatus(
        accessToken,
        sessionId,
        taskId,
      );
    } catch (error: unknown) {
      throw mapBffError(error);
    }
  }
}

function requireAccessToken(req: RequestContext): string {
  if (!req.user || !req.accessToken) {
    throw new UnauthorizedException("No active session");
  }

  return req.accessToken;
}

function mapBffError(error: unknown): HttpException {
  if (error instanceof RuyinBffError) {
    return new HttpException(error.message, error.statusCode);
  }

  if (error instanceof HttpException) {
    return error;
  }

  return new HttpException(
    error instanceof Error ? error.message : "Unexpected Ruyin BFF error",
    500,
  );
}
