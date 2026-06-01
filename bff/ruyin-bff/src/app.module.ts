/**
 * app.module.ts - Ruyin BFF Root Module（重构 v1.4）
 * @package @vxture/bff-ruyin
 *
 * 【重构说明】
 * 添加 CrossDomainRouter 注册，处理跨域 SSO callback。
 * ruya.ai 作为独立 domain，通过 auth-bff 跨域一次性 token 实现 SSO。
 *
 * @author AI-Generated
 * @date 2026-05-07
 * @version 1.4
 */

import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import {
  AccessTokenRevocationService,
  REDIS_REVOCATION_CONFIG,
} from "@vxture/core-auth";
import { VxConfigModule, VxConfigService } from "@vxture/core-config";
import { RuyinAggregator } from "./aggregators/ruyin.aggregator";
import { AgentAuthService } from "./auth/auth.service";
import { AuthMiddleware } from "./middleware/auth.middleware";
import { AuthRouter } from "./routers/auth.router";
import { CrossDomainRouter } from "./routers/crossdomain.router";
import { SessionRouter } from "./routers/session.router";

@Module({
  imports: [
    VxConfigModule.register({
      domains: ["app", "auth", "redis", "platform"],
    }),
    JwtModule.register({}),
  ],
  controllers: [AuthRouter, CrossDomainRouter, SessionRouter],
  providers: [
    AgentAuthService,
    RuyinAggregator,
    {
      provide: REDIS_REVOCATION_CONFIG,
      useFactory: (c: VxConfigService) => c.redis,
      inject: [VxConfigService],
    },
    AccessTokenRevocationService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthMiddleware)
      .forRoutes({ path: "api/(.*)", method: RequestMethod.ALL });
  }
}
