/**
 * 预置的 MCP 服务器（tool-servers.ts）：索引 → 启动计划 → 状态。起不了的要说清为什么；
 * 真起进程的用例在 connector-registry.test.ts（它拿着 ConnectorRegistry）。
 */

import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BundledToolServers } from "./tool-servers.js";

function rig(index: unknown, over: Partial<ConstructorParameters<typeof BundledToolServers>[0]> = {}) {
  const base = mkdtempSync(join(tmpdir(), "ruyin-tools-"));
  const toolsDir = join(base, "tools");
  const dataDir = join(base, "data");
  mkdirSync(toolsDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  if (index !== undefined) writeFileSync(join(toolsDir, "index.json"), JSON.stringify(index));
  return {
    base,
    toolsDir,
    dataDir,
    servers: new BundledToolServers({ toolsDir, dataDir, execPath: "/opt/ruyin/Ruyin.exe", hasUvx: () => false, hasBin: () => false, ...over }),
  };
}

const INDEX = {
  servers: [
    {
      id: "vendor.node-server",
      tier: "default",
      license: "MIT",
      launch: { runtime: "node", package: "some-mcp", version: "1.0.0", bin: "dist/cli.js", args: ["--headless"] },
      vendored: { dir: "vendor.node-server", package: "some-mcp@1.0.0", entry: "node_modules/some-mcp/dist/cli.js" },
    },
    {
      id: "vendor.needs-env",
      tier: "default",
      license: "MIT",
      launch: { runtime: "node", package: "env-mcp", version: "2.0.0", bin: "cli.js", requiresEnv: ["SEARXNG_URL"] },
      vendored: { dir: "vendor.needs-env", package: "env-mcp@2.0.0", entry: "node_modules/env-mcp/cli.js" },
    },
    { id: "vendor.not-vendored", tier: "default", license: "MIT", launch: { runtime: "node", package: "x", version: "1.0.0", bin: "cli.js" } },
    { id: "py.markitdown", tier: "default", license: "MIT", launch: { runtime: "uvx", package: "markitdown-mcp", version: "0.0.1a4", bin: "markitdown-mcp" } },
    { id: "py.pandoc", tier: "default", license: "MIT", launch: { runtime: "uvx", package: "mcp-pandoc", version: "0.11.1", requiresBin: "pandoc" } },
    { id: "registered.only", tier: "installed-disabled", license: "MIT", launch: null, launchNote: "发行形态未核实" },
    { id: "runos.tavily", tier: "runos-registered", needsKey: true, launch: null },
  ],
};

test("index: list / launchable / get; no index means no bundled layer, never an empty pretence", () => {
  const { servers, toolsDir } = rig(INDEX);
  assert.equal(servers.toolsDir, toolsDir);
  assert.equal(servers.list().length, 7);
  assert.deepEqual(
    servers.launchable().map((s) => s.id),
    ["vendor.node-server", "vendor.needs-env", "vendor.not-vendored", "py.markitdown", "py.pandoc"],
  );
  assert.equal(servers.get("registered.only")?.launchNote, "发行形态未核实");

  const none = rig(undefined);
  assert.equal(none.servers.toolsDir, undefined);
  assert.deepEqual(none.servers.list(), []);
  assert.equal(none.servers.plan("anything").ok, false);
});

test("plan: a vendored node server runs on Ruyin's own Node with ELECTRON_RUN_AS_NODE; a missing entry says so", () => {
  const { servers, toolsDir } = rig(INDEX);
  const missing = servers.plan("vendor.node-server");
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.reason, /入口不存在/);

  mkdirSync(join(toolsDir, "vendor.node-server", "node_modules", "some-mcp", "dist"), { recursive: true });
  writeFileSync(join(toolsDir, "vendor.node-server", "node_modules", "some-mcp", "dist", "cli.js"), "");
  const plan = servers.plan("vendor.node-server");
  assert.ok(plan.ok);
  if (plan.ok) {
    assert.equal(plan.command, "/opt/ruyin/Ruyin.exe");
    assert.equal(plan.args[0], join(toolsDir, "vendor.node-server", "node_modules", "some-mcp", "dist", "cli.js"));
    assert.deepEqual(plan.args.slice(1), ["--headless"]);
    assert.equal(plan.env["ELECTRON_RUN_AS_NODE"], "1");
  }
  const notVendored = servers.plan("vendor.not-vendored");
  assert.equal(notVendored.ok, false);
  if (!notVendored.ok) assert.match(notVendored.reason, /未随包 vendored/);
});

test("plan: required env comes from the user (setEnv), is validated, and travels with the process", () => {
  const { servers, toolsDir } = rig(INDEX);
  mkdirSync(join(toolsDir, "vendor.needs-env", "node_modules", "env-mcp"), { recursive: true });
  writeFileSync(join(toolsDir, "vendor.needs-env", "node_modules", "env-mcp", "cli.js"), "");
  const before = servers.plan("vendor.needs-env");
  assert.equal(before.ok, false);
  if (!before.ok) assert.match(before.reason, /SEARXNG_URL/);
  servers.setEnv("vendor.needs-env", { SEARXNG_URL: "http://searx.local", "bad key": "x", lower: "y" });
  assert.deepEqual(servers.envFor("vendor.needs-env"), { SEARXNG_URL: "http://searx.local" });
  const after = servers.plan("vendor.needs-env");
  assert.ok(after.ok);
  if (after.ok) assert.equal(after.env["SEARXNG_URL"], "http://searx.local");
});

test("plan: uvx servers need uv on this machine; requiresBin needs the external program; both are said plainly", () => {
  const noUv = rig(INDEX);
  const p = noUv.servers.plan("py.markitdown");
  assert.equal(p.ok, false);
  if (!p.ok) assert.match(p.reason, /需要本机有 uv/);

  const withUv = rig(INDEX, { hasUvx: () => true, hasBin: (bin) => bin === "pandoc" });
  const ok = withUv.servers.plan("py.markitdown");
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.command, "uvx");
    assert.deepEqual(ok.args, ["--from", "markitdown-mcp==0.0.1a4", "markitdown-mcp"]);
    assert.equal(ok.env["ELECTRON_RUN_AS_NODE"], undefined);
  }
  const pandoc = withUv.servers.plan("py.pandoc");
  assert.ok(pandoc.ok);
  if (pandoc.ok) assert.deepEqual(pandoc.args, ["--from", "mcp-pandoc==0.11.1", "mcp-pandoc"]);
  const noPandoc = rig(INDEX, { hasUvx: () => true, hasBin: () => false });
  const blocked = noPandoc.servers.plan("py.pandoc");
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.match(blocked.reason, /pandoc/);

  // 没有启动规格的：说它登记里写的原因；经 Runos 的：没有规格。
  const reg = withUv.servers.plan("registered.only");
  assert.equal(reg.ok, false);
  if (!reg.ok) assert.equal(reg.reason, "发行形态未核实");
});

test("state: enabled ids survive a new instance and drop ids that are no longer launchable", () => {
  const { servers, toolsDir, dataDir } = rig(INDEX);
  servers.setEnabled("py.markitdown", true);
  servers.setEnabled("vendor.node-server", true);
  servers.setEnabled("vendor.node-server", false);
  servers.setEnabled("registered.only", true); // 没有启动规格：记了也不算
  const again = new BundledToolServers({ toolsDir, dataDir, hasUvx: () => false });
  assert.deepEqual(again.enabledIds(), ["py.markitdown"]);
  assert.equal(again.isEnabled("py.markitdown"), true);
  assert.equal(again.isEnabled("vendor.node-server"), false);
  rmSync(dataDir, { recursive: true, force: true });
});
