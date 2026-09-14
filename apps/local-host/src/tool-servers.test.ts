/**
 * 预置的 MCP 服务器（tool-servers.ts）：索引 → 启动计划 → 状态。起不了的要说清为什么；
 * 真起进程的用例在 connector-registry.test.ts（它拿着 ConnectorRegistry）。
 */

import { strict as assert } from "node:assert";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
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
  if (!notVendored.ok) assert.match(notVendored.reason, /这一版安装包里没有它/);
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
  if (!p.ok) assert.match(p.reason, /没有随包的 uv，PATH 上也没有/);

  const withUv = rig(INDEX, { hasUvx: () => true, hasBin: (bin) => bin === "pandoc" });
  const ok = withUv.servers.plan("py.markitdown");
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.command, "uvx");
    // --offline 一定在：随包了缓存也照样联网，是这条契约最容易漏掉的一半。
    assert.deepEqual(ok.args, ["--offline", "--from", "markitdown-mcp==0.0.1a4", "markitdown-mcp"]);
    assert.equal(ok.env["UV_PYTHON_DOWNLOADS"], "never");
    assert.equal(ok.env["ELECTRON_RUN_AS_NODE"], undefined);
  }
  const pandoc = withUv.servers.plan("py.pandoc");
  assert.ok(pandoc.ok);
  if (pandoc.ok) assert.deepEqual(pandoc.args, ["--offline", "--from", "mcp-pandoc==0.11.1", "mcp-pandoc"]);
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

/* ---- 获取通道与浏览器梯子（ADR-018 §7.2）---- */

const ACQUIRE_INDEX = {
  servers: [
    {
      id: "vendor.browser",
      tier: "default",
      license: "Apache-2.0",
      launch: { runtime: "node", package: "b-mcp", version: "1.0.0", bin: "cli.js", browserLadder: true },
      vendored: { dir: "vendor.browser", package: "b-mcp@1.0.0", entry: "node_modules/b-mcp/cli.js" },
    },
    {
      id: "vendor.needs-payload",
      tier: "acquire-on-demand",
      license: "MIT",
      launch: { runtime: "node", package: "p-mcp", version: "1.0.0", bin: "cli.js", requiresComponent: ["node-bundle.p"] },
      vendored: { dir: "vendor.needs-payload", package: "p-mcp@1.0.0", entry: "node_modules/p-mcp/cli.js" },
    },
  ],
};

/** 一个假的获取通道：只回答「装了没有」与「多大」，外加一种坏掉的样子。 */
function fakeComponents(acquired: Set<string>, broken?: { id: string; state: "payload-missing"; reason: string }) {
  const specs = [
    {
      id: "node-bundle.p",
      kind: "node-bundle",
      version: "1.0.0",
      install: { kind: "zip" as const, into: "p" },
      downloadBytes: 24_979_105,
      diskBytes: 24_979_105,
    },
    {
      id: "browser.shell",
      kind: "browser",
      version: "1.0.0",
      install: { kind: "zip" as const, into: "shell", expect: "shell/headless.exe" },
      downloadBytes: 120_200_717,
      diskBytes: 283_200_000,
    },
  ];
  const status = (id: string) => {
    const s = specs.find((x) => x.id === id);
    if (!s) return undefined;
    if (broken && broken.id === id) {
      return {
        id: s.id,
        kind: s.kind,
        version: s.version,
        state: broken.state,
        reason: broken.reason,
        downloadBytes: s.downloadBytes,
        diskBytes: s.diskBytes,
        license: "BSD-3-Clause",
        origin: "cdn.example.com",
        redistribution: "download-only" as const,
        unlocks: [],
      };
    }
    return {
      id: s.id,
      kind: s.kind,
      version: s.version,
      state: acquired.has(s.id) ? ("acquired" as const) : ("not-acquired" as const),
      downloadBytes: s.downloadBytes,
      diskBytes: s.diskBytes,
      license: "BSD-3-Clause",
      origin: "cdn.example.com",
      redistribution: "download-only" as const,
      unlocks: [],
    };
  };
  return {
    isAcquired: (id: string) => acquired.has(id),
    status,
    list: () => specs.map((s) => status(s.id)!),
    spec: (id: string) => specs.find((x) => x.id === id) as never,
    pathOf: (id: string) => (acquired.has(id) ? `C:/data/c/${id}/1.0.0/shell` : undefined),
  } as never;
}

test("plan: 未获取的载荷是它自己的一种起不了 —— 与「未随包」「需要 uv」分开说，并带上组件 id", () => {
  const { servers, toolsDir } = rig(ACQUIRE_INDEX, { components: fakeComponents(new Set()) });
  mkdirSync(join(toolsDir, "vendor.needs-payload", "node_modules", "p-mcp"), { recursive: true });
  writeFileSync(join(toolsDir, "vendor.needs-payload", "node_modules", "p-mcp", "cli.js"), "");
  const plan = servers.plan("vendor.needs-payload");
  assert.equal(plan.ok, false);
  if (!plan.ok) {
    assert.match(plan.reason, /^未获取：需下载 23\.8 MB/);
    // 界面按这个给「获取」按钮；**地址不在这里** —— 它只在守护进程读出的那份清单里。
    assert.equal(plan.needsComponent, "node-bundle.p");
    assert.ok(!/https?:/.test(plan.reason));
  }
});

test("plan: 取过、但载荷不在了 —— 不许说成「未获取」，用户记得自己装过", () => {
  const { servers, toolsDir } = rig(ACQUIRE_INDEX, {
    components: fakeComponents(new Set(), {
      id: "node-bundle.p",
      state: "payload-missing",
      reason: "回执在，载荷里的 p/cli.exe 不在了（杀毒隔离、手工清盘都会这样）—— 移除后重新获取",
    }),
  });
  mkdirSync(join(toolsDir, "vendor.needs-payload", "node_modules", "p-mcp"), { recursive: true });
  writeFileSync(join(toolsDir, "vendor.needs-payload", "node_modules", "p-mcp", "cli.js"), "");
  const plan = servers.plan("vendor.needs-payload");
  assert.equal(plan.ok, false);
  if (!plan.ok) {
    assert.match(plan.reason, /^载荷不在了：/);
    // 守护进程那句原话照样带上：为什么不在了，用户只在这儿看得到。
    assert.match(plan.reason, /杀毒隔离/);
    assert.equal(plan.needsComponent, "node-bundle.p");
  }
});

test("plan: 载荷取到了就照常起", () => {
  const { servers, toolsDir } = rig(ACQUIRE_INDEX, { components: fakeComponents(new Set(["node-bundle.p"])) });
  mkdirSync(join(toolsDir, "vendor.needs-payload", "node_modules", "p-mcp"), { recursive: true });
  writeFileSync(join(toolsDir, "vendor.needs-payload", "node_modules", "p-mcp", "cli.js"), "");
  assert.equal(servers.plan("vendor.needs-payload").ok, true);
});

test("浏览器梯子：本机有 Chrome 就什么都不加 —— 离线浏览器自动化是零字节就已到手的能力", () => {
  const { servers, toolsDir } = rig(ACQUIRE_INDEX, {
    components: fakeComponents(new Set()),
    findBrowser: (c) => c === "chrome",
  });
  mkdirSync(join(toolsDir, "vendor.browser", "node_modules", "b-mcp"), { recursive: true });
  writeFileSync(join(toolsDir, "vendor.browser", "node_modules", "b-mcp", "cli.js"), "");
  const plan = servers.plan("vendor.browser");
  assert.ok(plan.ok);
  if (plan.ok) assert.deepEqual(plan.args.slice(1), []);
});

test("浏览器梯子：没有 Chrome 但有 Edge —— Win11 一定有 Edge", () => {
  const { servers, toolsDir } = rig(ACQUIRE_INDEX, {
    components: fakeComponents(new Set()),
    findBrowser: (c) => c === "msedge",
  });
  mkdirSync(join(toolsDir, "vendor.browser", "node_modules", "b-mcp"), { recursive: true });
  writeFileSync(join(toolsDir, "vendor.browser", "node_modules", "b-mcp", "cli.js"), "");
  const plan = servers.plan("vendor.browser");
  assert.ok(plan.ok);
  if (plan.ok) assert.deepEqual(plan.args.slice(1), ["--browser", "msedge"]);
});

test("浏览器梯子：两个都没有时给用户指定的路径，再没有就指向那件可获取的载荷（带体积与许可证）", () => {
  const { servers, toolsDir, dataDir } = rig(ACQUIRE_INDEX, {
    components: fakeComponents(new Set()),
    findBrowser: () => false,
  });
  mkdirSync(join(toolsDir, "vendor.browser", "node_modules", "b-mcp"), { recursive: true });
  writeFileSync(join(toolsDir, "vendor.browser", "node_modules", "b-mcp", "cli.js"), "");
  const blocked = servers.plan("vendor.browser");
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.match(blocked.reason, /需下载 114\.6 MB（占盘 270\.1 MB，BSD-3-Clause）/);
    assert.equal(blocked.needsComponent, "browser.shell");
  }
  // 用户自己给了一个浏览器：不必获取任何东西。
  const exe = join(dataDir, "my-chrome.exe");
  writeFileSync(exe, "");
  servers.setEnv("vendor.browser", { BROWSER_EXECUTABLE_PATH: exe });
  const given = servers.plan("vendor.browser");
  assert.ok(given.ok);
  if (given.ok) assert.deepEqual(given.args.slice(1), ["--executable-path", exe]);
});

test("浏览器梯子：取到了 headless shell 就用它", () => {
  const { servers, toolsDir } = rig(ACQUIRE_INDEX, {
    components: fakeComponents(new Set(["browser.shell"])),
    findBrowser: () => false,
  });
  mkdirSync(join(toolsDir, "vendor.browser", "node_modules", "b-mcp"), { recursive: true });
  writeFileSync(join(toolsDir, "vendor.browser", "node_modules", "b-mcp", "cli.js"), "");
  const plan = servers.plan("vendor.browser");
  assert.ok(plan.ok);
  if (plan.ok) {
    assert.equal(plan.args[1], "--executable-path");
    assert.match(String(plan.args[2]), /headless\.exe$/);
  }
});

/**
 * uvx 形态的缓存（TD-062）：随包那份只是种子，可写的副本在数据目录。这里把「计划怎么
 * 指」和「prepare 怎么种」各钉一遍 —— 随包目录只读时起不起得来，是装到 Program Files
 * 之后才会现形的事，CI 的可写工作区永远看不到。
 */
function uvRig() {
  const r = rig({ ...INDEX, pythonRuntime: { uv: { version: "0.12.10" }, cpython: { version: "3.13.15" } } });
  // uvHome() 找的是 toolsDir 的兄弟目录 <base>/uv，里面要有 uv 可执行文件才算随包。
  const uvHome = join(r.base, "uv");
  mkdirSync(join(uvHome, "cache", "wheels-v5", "pypi", "x"), { recursive: true });
  mkdirSync(join(uvHome, "cache", "archive-v0", "abc"), { recursive: true });
  mkdirSync(join(uvHome, "python"), { recursive: true });
  writeFileSync(join(uvHome, process.platform === "win32" ? "uv.exe" : "uv"), "");
  writeFileSync(join(uvHome, "cache", "CACHEDIR.TAG"), "Signature: 8a477f597d28d172789f06886806bc55");
  writeFileSync(join(uvHome, "cache", "archive-v0", "abc", "file.py"), "print(1)");
  writeFileSync(join(uvHome, "cache", "wheels-v5", "pypi", "x", "1.0.http"), "{}");
  // 种子里的目录软链（指向构建机的绝对路径）—— 建得了就建，Windows 上没特权就跳过那一支。
  let link = false;
  try {
    symlinkSync(join(uvHome, "cache", "archive-v0", "abc"), join(uvHome, "cache", "wheels-v5", "pypi", "x", "1.0"), "dir");
    link = true;
  } catch {
    /* 没特权 */
  }
  // 种子文件只读：装在 Program Files 里就是这个样子。
  chmodSync(join(uvHome, "cache", "archive-v0", "abc", "file.py"), 0o444);
  return { ...r, uvHome, link };
}

test("plan(uvx, 随包 uv): UV_CACHE_DIR 指向数据目录的副本，UV_PYTHON_INSTALL_DIR 仍指随包 python；计划本身不碰磁盘", () => {
  const { servers, uvHome, dataDir } = uvRig();
  const plan = servers.plan("py.markitdown");
  assert.ok(plan.ok);
  if (!plan.ok) return;
  assert.equal(plan.command, join(uvHome, process.platform === "win32" ? "uv.exe" : "uv"));
  assert.deepEqual(plan.args.slice(0, 3), ["tool", "run", "--offline"]);
  assert.equal(plan.env["UV_CACHE_DIR"], join(dataDir, "tools", "uv-cache"));
  assert.equal(plan.env["UV_PYTHON_INSTALL_DIR"], join(uvHome, "python"));
  assert.equal(plan.env["UV_TOOL_DIR"], join(dataDir, "tools", "uv-tools"));
  assert.equal(typeof plan.prepare, "function", "起进程之前要有准备这一步");
  // 只算计划不种：列表页也会算计划，一算就复制两百兆不行。
  assert.equal(existsSync(join(dataDir, "tools", "uv-cache")), false);
});

test("prepare(): 首次把随包缓存种到数据目录 —— 跳过软链、文件可写、留种子标记；第二次不动", async () => {
  const { servers, dataDir, link } = uvRig();
  const plan = servers.plan("py.markitdown");
  assert.ok(plan.ok && plan.prepare);
  if (!plan.ok || !plan.prepare) return;
  await plan.prepare();
  const cache = join(dataDir, "tools", "uv-cache");
  assert.ok(existsSync(join(cache, "CACHEDIR.TAG")));
  assert.ok(existsSync(join(cache, "archive-v0", "abc", "file.py")));
  assert.ok(existsSync(join(cache, "wheels-v5", "pypi", "x", "1.0.http")));
  if (link) assert.equal(existsSync(join(cache, "wheels-v5", "pypi", "x", "1.0")), false, "软链不带过去");
  // 权限重置：种子是只读的，副本必须可写，否则 uv 一写就被拒（实测栽在 sdists-v9/.git）。
  if (process.platform !== "win32") {
    assert.ok(statSync(join(cache, "archive-v0", "abc", "file.py")).mode & 0o200, "文件要可写");
    assert.ok(statSync(cache).mode & 0o200, "根目录也要可写 —— uv 在根下建临时文件");
  }
  const marker = JSON.parse(readFileSync(join(cache, ".ruyin-seed.json"), "utf8")) as { key: string };
  assert.match(marker.key, /^[0-9a-f]{64}$/);
  assert.equal(existsSync(`${cache}.seeding-${process.pid}`), false, "临时目录要改名走，不留");

  // 第二次：键没变，一个字节不动（拿标记的 mtime 当证据）。
  const before = statSync(join(cache, ".ruyin-seed.json")).mtimeMs;
  await plan.prepare();
  assert.equal(statSync(join(cache, ".ruyin-seed.json")).mtimeMs, before);
});

test("prepare(): 随包种子变了（安装包升级）就整份重种 —— 旧缓存对新版本会在 --offline 下干净地失败", async () => {
  const { servers, dataDir, uvHome, toolsDir } = uvRig();
  const first = servers.plan("py.markitdown");
  assert.ok(first.ok && first.prepare);
  if (!first.ok || !first.prepare) return;
  await first.prepare();
  const cache = join(dataDir, "tools", "uv-cache");
  const oldKey = (JSON.parse(readFileSync(join(cache, ".ruyin-seed.json"), "utf8")) as { key: string }).key;

  // 升级：uv 换了版本，种子里多了一个文件。
  writeFileSync(join(toolsDir, "index.json"), JSON.stringify({ ...INDEX, pythonRuntime: { uv: { version: "0.13.0" } } }));
  writeFileSync(join(uvHome, "cache", "archive-v0", "abc", "new.py"), "print(2)");
  servers.refresh();
  const second = servers.plan("py.markitdown");
  assert.ok(second.ok && second.prepare);
  if (!second.ok || !second.prepare) return;
  await second.prepare();
  const newKey = (JSON.parse(readFileSync(join(cache, ".ruyin-seed.json"), "utf8")) as { key: string }).key;
  assert.notEqual(newKey, oldKey);
  assert.ok(existsSync(join(cache, "archive-v0", "abc", "new.py")), "重种后新文件在");
});

test("prepare(): 随包没有 cache 目录时不算失败 —— 只说一句，uvx 照旧按 --offline 冷缓存的样子干净地失败", async () => {
  const lines: string[] = [];
  const r = rig({ ...INDEX, pythonRuntime: {} }, { log: (l) => lines.push(l) });
  const uvHome = join(r.base, "uv");
  mkdirSync(uvHome, { recursive: true });
  writeFileSync(join(uvHome, process.platform === "win32" ? "uv.exe" : "uv"), "");
  const plan = r.servers.plan("py.markitdown");
  assert.ok(plan.ok && plan.prepare);
  if (!plan.ok || !plan.prepare) return;
  await plan.prepare();
  assert.equal(existsSync(join(r.dataDir, "tools", "uv-cache")), false);
  assert.ok(lines.some((l) => /随包没有种子/.test(l)));
});
