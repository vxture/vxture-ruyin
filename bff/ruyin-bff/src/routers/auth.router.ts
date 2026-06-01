/**
 * auth.router.ts - Ruyin Agent auth router
 * @package @vxture/bff-ruyin
 *
 * Description: Exposes lightweight session inspection endpoints for the agent frontend.
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
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { AUTH_CONSTANTS } from "@vxture/shared";
import { VxConfigService } from "@vxture/core-config";
import type { RequestContext } from "../types/auth.types";

function forwardCookie(req: Request): string {
  const raw = req.headers.cookie;
  return Array.isArray(raw) ? raw.join("; ") : (raw ?? "");
}

@Controller("api/auth")
export class AuthRouter {
  private readonly authBffUrl: string;
  private readonly ruyinCookieDomain: string | undefined;

  constructor(@Inject(VxConfigService) configService: VxConfigService) {
    const cfg = configService.platform;
    this.authBffUrl = cfg.AUTH_BFF_URL.trim().replace(/\/+$/, "");
    const domain = cfg.COOKIE_DOMAIN_RUYIN?.trim();
    this.ruyinCookieDomain =
      domain && domain !== "localhost" ? domain : undefined;
  }
  @Get("session")
  getSession(@Req() req: Request & RequestContext) {
    if (!req.user) {
      throw new UnauthorizedException("No active session");
    }

    return {
      status: "active",
      user: req.user,
    };
  }

  @Get("me")
  getCurrentUser(@Req() req: Request & RequestContext) {
    if (!req.user) {
      throw new UnauthorizedException("No active session");
    }

    return req.user;
  }

  @Post("logout")
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res() res: Response): Promise<void> {
    let status = HttpStatus.OK;
    let data: unknown = { status: "logged_out" };

    try {
      const response = await fetch(
        this.authBffUrl + "/auth/logout?source=ruyin",
        {
          method: "POST",
          headers: {
            Cookie: forwardCookie(req),
          },
        },
      );
      status = response.status;
      data = await response.json().catch(() => ({
        status: response.ok ? "logged_out" : "logout_failed",
      }));
    } catch {
      status = HttpStatus.BAD_GATEWAY;
      data = {
        status: "logout_failed",
        message: "Failed to revoke tenant session",
      };
    }

    const domain = this.ruyinCookieDomain;
    res.clearCookie(AUTH_CONSTANTS.RUYIN_COOKIE_KEYS.ACCESS_TOKEN, {
      path: "/",
      domain,
    });
    res.clearCookie(AUTH_CONSTANTS.RUYIN_COOKIE_KEYS.REFRESH_TOKEN, {
      path: "/",
      domain,
    });

    res.status(status).json(data);
  }
}
