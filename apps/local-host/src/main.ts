#!/usr/bin/env node
/**
 * Runtime daemon entry point (dev mode).
 *
 * Env:
 *   RUYIN_DATA_DIR      data root (default: ~/.ruyin/dev)
 *   RUYIN_PRODUCTS_DIR  unpacked products dir (default: ./products)
 *   RUYIN_PORT          listen port on 127.0.0.1 (default: 7420)
 *   RUYIN_TOKEN         session token override (default: random per launch)
 */

import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { WorkspaceRuntime } from "@vxture/ruyin-core";
import { SqliteStoragePort } from "./storage.js";
import { MockAIGateway, nodeClock, nodeCrypto, nodeId } from "./host-ports.js";
import { loadProducts } from "./products.js";
import { createLocalApi } from "./server.js";

const VERSION = "0.1.0";

const dataDir = resolve(
  process.env["RUYIN_DATA_DIR"] ?? join(homedir(), ".ruyin", "dev"),
);
const productsDir = resolve(process.env["RUYIN_PRODUCTS_DIR"] ?? "products");
const port = Number(process.env["RUYIN_PORT"] ?? 7420);
const token = process.env["RUYIN_TOKEN"] ?? randomBytes(24).toString("hex");

const scan = loadProducts(productsDir);
for (const failure of scan.failed) {
  console.error(`[ruyin] product failed contract validation: ${failure.path}`);
  for (const e of failure.errors) {
    console.error(`  ${e.rule} ${e.path}: ${e.message}`);
  }
}

const runtime = new WorkspaceRuntime({
  storage: new SqliteStoragePort(dataDir),
  clock: nodeClock,
  id: nodeId,
  crypto: nodeCrypto,
  gateway: new MockAIGateway(),
});

const server = createLocalApi({
  runtime,
  products: scan.loaded,
  token,
  version: VERSION,
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[ruyin] local runtime ${VERSION}`);
  console.log(`[ruyin] data dir: ${dataDir}`);
  console.log(
    `[ruyin] products: ${scan.loaded.map((p) => `${p.id}@${p.version}`).join(", ") || "(none)"}`,
  );
  console.log(`[ruyin] listening on http://127.0.0.1:${port}`);
  console.log(`[ruyin] session token: ${token}`);
});
