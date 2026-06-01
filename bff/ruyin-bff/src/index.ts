/**
 * index.ts - Ruyin BFF bootstrap
 * @package @vxture/bff-ruyin
 *
 * Description: Bootstraps the NestJS application that fronts agent-studio/ruyin
 * and proxies authenticated requests to agent-server/ruyin.
 *
 * @author AI-Generated
 * @date 2026-04-22
 * @version 1.0
 *
 * @copyright Vxture Team
 * @license MIT
 *
 * @layer Application
 * @category Ruyin BFF
 */

import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());
  app.enableCors({
    origin: true,
    credentials: true,
  });

  const port = Number(
    process.env.RUYIN_BFF_PORT ??
      process.env.RUYINAGENT_BFF_PORT ??
      process.env.PORT ??
      3111,
  );
  await app.listen(port);
}

void bootstrap();
