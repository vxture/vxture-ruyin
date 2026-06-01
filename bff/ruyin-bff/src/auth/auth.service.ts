/**
 * auth.service.ts - Ruyin Agent BFF auth utilities
 * @package @vxture/bff-ruyin
 *
 * Description: Verifies platform access tokens and projects them into BFF request user context.
 *
 * @author AI-Generated
 * @date 2026-04-22
 * @version 1.0
 *
 * @copyright Vxture Team
 * @license MIT
 *
 * @layer Application
 * @category Service
 */

import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import {
  JwtAuthScope,
  JwtUserType,
  type JwtAccessPayload,
} from "@vxture/core-auth";
import { VxConfigService } from "@vxture/core-config";
import type { AgentViewer } from "../types/auth.types";

@Injectable()
export class AgentAuthService {
  constructor(
    @Inject(JwtService) private readonly jwtService: JwtService,
    @Inject(VxConfigService) private readonly configService: VxConfigService,
  ) {}

  verifyAccessToken(token: string): JwtAccessPayload {
    const payload = this.jwtService.verify<JwtAccessPayload>(token, {
      secret: this.configService.auth.JWT_SECRET,
    });

    if (payload.userType !== JwtUserType.TENANT_USER) {
      throw new ForbiddenException("Invalid ruyin token user type");
    }
    if (payload.authScope !== JwtAuthScope.TENANT_CONSOLE) {
      throw new ForbiddenException("Invalid ruyin token scope");
    }
    if (!payload.tenantId?.trim()) {
      throw new UnauthorizedException("Ruyin token requires tenantId");
    }

    return payload;
  }

  buildViewer(payload: JwtAccessPayload): AgentViewer {
    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      tenantId: payload.tenantId,
      permissions: payload.permissions ?? [],
      provider: payload.provider,
    };
  }
}
