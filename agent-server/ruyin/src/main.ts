/**
 * main.ts - Ruyin Agent Server bootstrap
 * @package @vxture/agent-server-ruyin
 */

import { startRuyinServer } from "./index";

const port = Number(
  process.env.RUYIN_SERVER_PORT ?? process.env.RUYINAGENT_SERVER_PORT ?? 3112,
);

startRuyinServer(port).catch((error: unknown) => {
  console.error("Ruyin Server bootstrap failed:", error);
  process.exit(1);
});
