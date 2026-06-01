/**
 * auth.middleware.ts - Ruyin Agent auth middleware
 * @package @vxture/bff-ruyin
 *
 * Description: Resolves the current platform user from the shared access-token cookie.
 *
 * @author AI-Generated
 * @date 2026-04-22
 * @version 1.0
 *
 * @copyright Vxture Team
 * @license MIT
 *
 * @layer Application
 * @category Middleware
 */

import { Inject, Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { AccessTokenRevocationService } from "@vxture/core-auth";
import { AUTH_CONSTANTS } from "@vxture/shared";
import { AgentAuthService } from "../auth/auth.service";
import type { RequestContext } from "../types/auth.types";

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(
    @Inject(AgentAuthService)
    private readonly agentAuthService: AgentAuthService,
    @Inject(AccessTokenRevocationService)
    private readonly tokenRevocationService: AccessTokenRevocationService,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const accessToken =
      req.cookies?.[AUTH_CONSTANTS.RUYIN_COOKIE_KEYS.ACCESS_TOKEN];
    if (!accessToken) {
      next();
      return;
    }

    try {
      const payload = this.agentAuthService.verifyAccessToken(accessToken);
      await this.tokenRevocationService.assertAccessTokenActive(
        payload,
        "tenant",
      );
      const request = req as Request & RequestContext;
      request.user = this.agentAuthService.buildViewer(payload);
      request.accessToken = accessToken;
    } catch {
      // Keep middleware silent so routers can return explicit 401s when needed.
    }

    next();
  }
}
