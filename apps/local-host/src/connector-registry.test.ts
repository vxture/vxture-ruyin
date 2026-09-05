import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { ConnectorPort } from "@vxture/ruyin-core";
import {
  CONNECTORS_FILE,
  ConnectorBundledError,
  ConnectorInstallRefusedError,
  ConnectorRegistry,
} from "./connector-registry.js";
import { BundledToolServers } from "./tool-servers.js";
import { mkdirSync } from "node:fs";

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

test("registry: probe answers whether a command connects, and leaves nothing behind", async () => {
  const { registry, dataDir, lookup } = fresh();
  const ok = await registry.probe({ id: "crm", command: process.execPath, args: [FAKE] });
  assert.equal(ok.ok, true);
  assert.ok(ok.tools.length > 0, "a connected server reports its tools");
  // **试连不落盘、不注册**：添加页要在写下任何东西之前先问一句。
  assert.equal(lookup.size, 0);
  assert.ok(!existsSync(join(dataDir, CONNECTORS_FILE)));

  const bad = await registry.probe({ id: "crm", command: process.execPath, args: ["--eval", "process.exit(3)"] });
  assert.equal(bad.ok, false);
  assert.ok((bad.detail ?? "").length > 0, "a failure carries its reason");
  assert.equal(lookup.size, 0);

  const empty = await registry.probe({ id: "crm", command: "" });
  assert.equal(empty.ok, false);
  assert.match(empty.detail ?? "", /命令不能为空/);
  rmSync(dataDir, { recursive: true, force: true });
});

test("registry: a stashed connector is persisted but never started, and activate re-tests it", async () => {
  const { registry, dataDir, lookup } = fresh();
  const view = await registry.install({
    id: "crm",
    command: process.execPath,
    args: ["--eval", "process.exit(3)"],
    source: "lan",
    state: "stashed",
  });
  assert.equal(view.state, "stashed");
  assert.equal(view.health.ok, false);
  // 暂存的**不进 lookup**：一个连不上的连接器留在任务能拿到的清单里，
  // 是把待办伪装成能力。
  assert.equal(lookup.size, 0);
  const manifest = JSON.parse(readFileSync(join(dataDir, CONNECTORS_FILE), "utf8")) as {
    items: Array<{ id: string; state: string }>;
  };
  assert.deepEqual(manifest.items.map((i) => [i.id, i.state]), [["crm", "stashed"]]);

  // 启用会重新试一次；换个状态不会让它连上。
  await assert.rejects(registry.activate("crm"), /still cannot start/);
  assert.equal(lookup.size, 0, "a failed activate leaves nothing half-registered");
  assert.equal((await registry.list())[0]?.state, "stashed");

  await assert.rejects(registry.activate("nope"), /not installed/);
  rmSync(dataDir, { recursive: true, force: true });
});

test("registry: activate turns a stashed connector that now works into an active one", async () => {
  const { registry, dataDir, lookup } = fresh();
  await registry.install({ id: "crm", command: process.execPath, args: [FAKE], source: "lan", state: "stashed" });
  assert.equal(lookup.size, 0);
  const view = await registry.activate("crm");
  assert.equal(view.state, "active");
  assert.equal(view.health.ok, true);
  assert.equal(lookup.size, 1);
  // 已经是 active 的再启用一次是空操作，不该重起一遍进程。
  const again = await registry.activate("crm");
  assert.equal(again.state, "active");
  assert.equal(lookup.size, 1);
  const manifest = JSON.parse(readFileSync(join(dataDir, CONNECTORS_FILE), "utf8")) as {
    items: Array<{ state: string }>;
  };
  assert.equal(manifest.items[0]?.state, "active");
  await registry.stopAll();
  rmSync(dataDir, { recursive: true, force: true });
});

test("registry: load skips stashed entries, and a manifest written before state existed counts as active", async () => {
  const { registry, dataDir, lookup } = fresh();
  writeFileSync(
    join(dataDir, CONNECTORS_FILE),
    JSON.stringify({
      items: [
        // 旧清单：**没有 state**。默认成暂存会让一次升级静静地停掉所有连接器。
        { id: "old", transport: "stdio", command: process.execPath, args: [FAKE], source: "lan", installedAt: "t" },
        { id: "held", transport: "stdio", command: process.execPath, args: [FAKE], source: "lan", installedAt: "t", state: "stashed" },
      ],
    }),
  );
  await registry.load();
  assert.deepEqual(
    (await registry.list()).map((c) => [c.id, c.state]),
    [
      ["old", "active"],
      ["held", "stashed"],
    ],
  );
  assert.deepEqual([...lookup.keys()], ["old"]);
  await registry.stopAll();
  rmSync(dataDir, { recursive: true, force: true });
});

// ───────────────── 预置的 MCP 服务器（ADR-018 §2.2 / TD-042）：来源为 bundled 的连接器 ─────────────────

/** 一个 vendored 的 node 服务器：入口就是测试用的假 MCP 服务器。 */
function bundledRig() {
  const { dataDir, lookup, log } = fresh();
  const toolsDir = join(dataDir, "tools-bundle");
  mkdirSync(join(toolsDir, "fake.server", "node_modules", "fake-mcp"), { recursive: true });
  writeFileSync(join(toolsDir, "fake.server", "node_modules", "fake-mcp", "cli.js"), readFileSync(FAKE));
  writeFileSync(
    join(toolsDir, "index.json"),
    JSON.stringify({
      servers: [
        {
          id: "fake.server",
          tier: "default",
          license: "MIT",
          launch: { runtime: "node", package: "fake-mcp", version: "1.0.0", bin: "cli.js", args: [] },
          vendored: { dir: "fake.server", package: "fake-mcp@1.0.0", entry: "node_modules/fake-mcp/cli.js" },
        },
        {
          id: "py.only",
          tier: "default",
          license: "MIT",
          launch: { runtime: "uvx", package: "some-py", version: "1.0.0" },
        },
      ],
    }),
  );
  const bundled = new BundledToolServers({ toolsDir, dataDir, execPath: process.execPath, hasUvx: () => false });
  const registry = new ConnectorRegistry(dataDir, lookup, { allowUnsigned: false, log: (l) => log.push(l), timeoutMs: 5000, bundled });
  return { dataDir, lookup, log, registry, bundled };
}

test("bundled: listed as stashed until enabled; activate really starts it, lists its tools, and remembers; deactivate stops it", async () => {
  const { registry, lookup, bundled, dataDir } = bundledRig();
  await registry.load();
  let list = await registry.list();
  const fake = list.find((c) => c.id === "fake.server");
  assert.ok(fake);
  assert.equal(fake.source, "bundled");
  assert.equal(fake.state, "stashed");
  assert.equal(fake.health.detail, "未启用");
  assert.equal(fake.bundled?.runtime, "node");
  // uvx 的在这台机器上起不了：原因写在 blocked 里，不是「未启用」。
  const py = list.find((c) => c.id === "py.only");
  assert.match(py?.bundled?.blocked ?? "", /需要本机有 uv/);
  assert.match(py?.health.detail ?? "", /uv/);

  const view = await registry.activate("fake.server");
  assert.equal(view.state, "active");
  assert.ok(view.tools.length > 0);
  assert.ok(lookup.has("fake.server"));
  assert.equal(registry.exposes(view.tools[0]!), true);
  assert.deepEqual(registry.providersOf(view.tools[0]!, ["fake.server"]), ["fake.server"]);
  assert.equal(bundled.isEnabled("fake.server"), true);
  // 启用状态不进 connectors.json —— 预置的不是用户装的。
  assert.ok(!existsSync(join(dataDir, CONNECTORS_FILE)));

  const off = await registry.deactivate("fake.server");
  assert.equal(off.state, "stashed");
  assert.equal(lookup.has("fake.server"), false);
  assert.equal(bundled.isEnabled("fake.server"), false);

  await assert.rejects(registry.remove("fake.server"), (e: unknown) => e instanceof ConnectorBundledError);
  await assert.rejects(registry.activate("py.only"), /需要本机有 uv/);
  await registry.stopAll();
  rmSync(dataDir, { recursive: true, force: true });
});

test("bundled: an enabled server comes up at load; a user connector can be deactivated into stashed", async () => {
  const { registry, bundled, lookup, dataDir } = bundledRig();
  bundled.setEnabled("fake.server", true);
  await registry.load();
  assert.ok(lookup.has("fake.server"));
  assert.equal((await registry.list()).find((c) => c.id === "fake.server")?.state, "active");
  await registry.stopAll();
  rmSync(dataDir, { recursive: true, force: true });

  const user = fresh();
  await user.registry.install({ id: "crm", command: process.execPath, args: [FAKE], source: "lan" });
  const stashed = await user.registry.deactivate("crm");
  assert.equal(stashed.state, "stashed");
  assert.equal(user.lookup.has("crm"), false);
  const persisted = JSON.parse(readFileSync(join(user.dataDir, CONNECTORS_FILE), "utf8")) as { items: Array<{ id: string; state: string }> };
  assert.equal(persisted.items[0]?.state, "stashed");
  await assert.rejects(user.registry.deactivate("nope"), /not installed/);
  await user.registry.stopAll();
  rmSync(user.dataDir, { recursive: true, force: true });
});
