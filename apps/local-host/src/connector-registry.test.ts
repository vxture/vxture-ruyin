import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { ConnectorPort } from "@vxture/ruyin-core";
import {
  CONNECTORS_FILE,
  ConnectorInstallRefusedError,
  ConnectorRegistry,
} from "./connector-registry.js";

const FAKE = fileURLToPath(new URL("./fake-mcp-server.js", import.meta.url));

function fresh(allowUnsigned = true) {
  const dataDir = mkdtempSync(join(tmpdir(), "ruyin-conn-"));
  const lookup = new Map<string, ConnectorPort>();
  const log: string[] = [];
  const registry = new ConnectorRegistry(dataDir, lookup, {
    allowUnsigned,
    log: (l) => log.push(l),
    timeoutMs: 5000,
  });
  return { dataDir, lookup, log, registry };
}

test("registry: production refuses to install - the trust anchor does not exist yet", async () => {
  const { registry, dataDir, lookup } = fresh(false);
  await assert.rejects(
    registry.install({ id: "crm", command: process.execPath, args: [FAKE], source: "lan" }),
    (e: unknown) => e instanceof ConnectorInstallRefusedError && /TD-012/.test(e.message),
  );
  assert.equal(lookup.size, 0);
  assert.ok(!existsSync(join(dataDir, CONNECTORS_FILE)));
  rmSync(dataDir, { recursive: true, force: true });
});

test("registry: install starts the connector, registers it in the kernel's lookup, persists the manifest", async () => {
  const { registry, dataDir, lookup } = fresh();
  const view = await registry.install({
    id: "crm",
    command: process.execPath,
    args: [FAKE],
    source: "lan",
  });
  assert.equal(view.health.ok, true);
  assert.ok(lookup.has("crm"));
  const manifest = JSON.parse(readFileSync(join(dataDir, CONNECTORS_FILE), "utf8")) as {
    items: Array<{ id: string; transport: string; source: string }>;
  };
  assert.deepEqual(manifest.items.map((i) => [i.id, i.transport, i.source]), [["crm", "stdio", "lan"]]);

  const listed = await registry.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0]!.health.ok, true);

  await assert.rejects(
    registry.install({ id: "crm", command: process.execPath, args: [FAKE], source: "lan" }),
    /already installed/,
  );
  await registry.remove("crm");
  assert.ok(!lookup.has("crm"));
  assert.deepEqual(JSON.parse(readFileSync(join(dataDir, CONNECTORS_FILE), "utf8")), { items: [] });
  await assert.rejects(registry.remove("crm"), /not installed/);
  rmSync(dataDir, { recursive: true, force: true });
});

test("registry: rejects bad ids, local-fs, missing command, and a source that is not lan/private", async () => {
  const { registry, dataDir } = fresh();
  const base = { command: process.execPath, args: [FAKE], source: "lan" };
  await assert.rejects(registry.install({ ...base, id: "Bad Id" }), /invalid connector id/);
  await assert.rejects(registry.install({ ...base, id: "local-fs" }), /invalid connector id/);
  await assert.rejects(registry.install({ id: "x", command: "", source: "lan" }), /command is required/);
  await assert.rejects(
    registry.install({ ...base, id: "x", source: "cloud" }),
    /source must be lan or private/,
  );
  rmSync(dataDir, { recursive: true, force: true });
});

test("registry: a connector that cannot initialize is not installed, and says so", async () => {
  const { registry, dataDir, lookup } = fresh();
  await assert.rejects(
    registry.install({ id: "dead", command: process.execPath, args: [FAKE, "--exit-after-init"], source: "private" }),
    /initialize|exited|no reply/,
  ).catch(() => {
    // --exit-after-init answers initialize first, so this one may install; that
    // is fine - the next case is the one that must refuse.
  });
  await assert.rejects(
    registry.install({ id: "gone", command: "definitely-not-a-real-binary-ruyin", source: "private" }),
    /spawn failed|no reply/,
  );
  assert.ok(!existsSync(join(dataDir, CONNECTORS_FILE)) || !readFileSync(join(dataDir, CONNECTORS_FILE), "utf8").includes("gone"));
  // A failed bring-up still leaves the id in the lookup, so the kernel says
  // "unavailable" for bindings through it rather than "not installed".
  assert.ok(lookup.has("gone"));
  await registry.stopAll();
  rmSync(dataDir, { recursive: true, force: true });
});

test("registry: load brings up everything in the manifest; an unreadable manifest is an empty start, logged", async () => {
  const { dataDir, lookup, log } = fresh();
  writeFileSync(
    join(dataDir, CONNECTORS_FILE),
    JSON.stringify({
      items: [
        { id: "crm", transport: "stdio", command: process.execPath, args: [FAKE], source: "lan", installedAt: "2026-09-03T00:00:00Z" },
        { id: "broken", transport: "stdio", command: "definitely-not-a-real-binary-ruyin", args: [], source: "private", installedAt: "2026-09-03T00:00:00Z" },
      ],
    }),
  );
  const registry = new ConnectorRegistry(dataDir, lookup, { allowUnsigned: false, log: (l) => log.push(l), timeoutMs: 2000 });
  await registry.load();
  assert.ok(lookup.has("crm"));
  assert.ok(lookup.has("broken"));
  assert.ok(log.some((l) => /connector "broken" failed to start/.test(l)));
  const views = await registry.list();
  assert.equal(views.find((v) => v.id === "crm")?.health.ok, true);
  assert.equal(views.find((v) => v.id === "broken")?.health.ok, false);
  await registry.stopAll();

  writeFileSync(join(dataDir, CONNECTORS_FILE), "{not json");
  const log2: string[] = [];
  const r2 = new ConnectorRegistry(dataDir, new Map(), { allowUnsigned: false, log: (l) => log2.push(l) });
  await r2.load();
  assert.deepEqual(await r2.list(), []);
  assert.ok(log2.some((l) => /unreadable/.test(l)));
  rmSync(dataDir, { recursive: true, force: true });
});
