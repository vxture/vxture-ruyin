/**
 * check-skill-manifest.mjs 自己的测试。
 *
 * 守卫和被守的东西一起改，是最容易出的一种事故：清单加了一个字段，守卫顺手放宽
 * 一条规则，两边都「通过」，而那条规则从此再也不会拦住任何东西。所以这里**反向
 * 验证**每一条新规则 —— 每个用例都是一份只坏了一处的清单，断言守卫真的拒绝它，
 * 并且拒绝的理由说的就是那一处。
 *
 * 跑的是真的 CLI（子进程 + 一份临时清单文件），不是被抽出来的一份副本逻辑：
 * 测另一份逻辑测过了，也不说明 `pnpm lint:skill-manifest` 会拦住什么。
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

const guard = fileURLToPath(new URL("./check-skill-manifest.mjs", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "ruyin-skill-manifest-"));
let n = 0;

/** 跑一次守卫，返回 { code, out }。 */
function run(manifest) {
  const file = join(dir, `m${n++}.json`);
  writeFileSync(file, JSON.stringify(manifest));
  const res = spawnSync(process.execPath, [guard, file], { encoding: "utf8" });
  return { code: res.status, out: `${res.stdout}${res.stderr}` };
}

/** 一份最小的、干净的清单：一个 node 形态的默认档服务器 + 一个解锁它的组件。 */
function baseline() {
  return {
    version: 1,
    tiers: { default: "", "installed-disabled": "", "acquire-on-demand": "", "runos-registered": "" },
    allowedOrigins: ["https://cdn.example.com"],
    // uv 是随包的可执行文件，守卫对它的要求和对按需组件一样严（钉死 + 校验）。
    // 这里写全，是因为**它以前写不全也照样通过** —— 汇报夹在这段之前，push 进去
    // 的每一条都没人读（2026-09-09 修）。
    pythonRuntime: {
      uv: {
        version: "0.12.10",
        upstream: "https://example.com/uv.zip",
        sha256: "b".repeat(64),
        size: 10,
        license: "MIT OR Apache-2.0",
        licenseSource: "tag 上并存的两份 LICENSE",
        licenseFiles: ["LICENSE-MIT", "LICENSE-APACHE"],
      },
      seed: ["x.uvx-server"],
    },
    skills: [],
    components: [
      {
        id: "browser.thing",
        kind: "browser",
        version: "1",
        unlocks: ["x.node-server"],
        source: { url: "https://cdn.example.com/thing.zip" },
        sha256: "a".repeat(64),
        size: 10,
        unpackedBytes: 20,
        install: { kind: "zip", into: "thing" },
        license: "BSD-3-Clause",
        licenseSource: "包内 LICENSE",
        licenseFile: ["thing/LICENSE"],
        redistribution: "download-only",
      },
    ],
    servers: [
      {
        id: "x.node-server",
        kind: "mcp-server",
        repo: "https://github.com/x/node-server",
        commit: "b".repeat(40),
        license: "MIT",
        licenseSource: "仓库级 LICENSE",
        tier: "default",
        needsKey: false,
        launch: { runtime: "node", package: "node-server", version: "1.0.0", bin: "dist/cli.js" },
        vendored: { bundled: true },
      },
      {
        id: "x.uvx-server",
        kind: "mcp-server",
        repo: "https://github.com/x/uvx-server",
        commit: "c".repeat(40),
        license: "MIT",
        licenseSource: "仓库级 LICENSE",
        tier: "default",
        needsKey: false,
        launch: { runtime: "uvx", package: "uvx-server", version: "1.0.0", offline: { cacheSeeded: true } },
      },
    ],
  };
}

test("干净的清单通过", () => {
  const { code, out } = run(baseline());
  assert.equal(code, 0, out);
});

test("默认档的 node 服务器没随包 —— 干净机器上它根本不在", () => {
  const m = baseline();
  delete m.servers[0].vendored;
  const { code, out } = run(m);
  assert.equal(code, 1);
  assert.match(out, /vendored\.bundled/);
});

test("默认档的 uvx 服务器没预取 wheel —— 断网就起不来，不许叫默认启用", () => {
  const m = baseline();
  m.servers[1].launch.offline = { cacheSeeded: false };
  assert.match(run(m).out, /cacheSeeded/);
});

test("默认档的 uvx 服务器不在 pythonRuntime.seed 里 —— 构建时没人会去取它的 wheel", () => {
  const m = baseline();
  m.pythonRuntime.seed = [];
  assert.match(run(m).out, /pythonRuntime\.seed/);
});

test("默认档不许有 requiresComponent —— 要先下载才能起的不叫「零字节就能起」", () => {
  const m = baseline();
  m.servers[0].launch.requiresComponent = ["browser.thing"];
  assert.match(run(m).out, /default 档不许有 requiresComponent/);
});

test("acquire-on-demand 却没有 requiresComponent —— 那要用户点什么", () => {
  const m = baseline();
  m.servers[0].tier = "acquire-on-demand";
  delete m.servers[0].vendored;
  assert.match(run(m).out, /那要用户点什么/);
});

test("requiresComponent 指向一个不存在的组件", () => {
  const m = baseline();
  m.servers[0].tier = "acquire-on-demand";
  m.servers[0].launch.requiresComponent = ["nope"];
  assert.match(run(m).out, /不在 components\[\] 里/);
});

test("需密钥的服务器不许有载荷 —— 密钥不进本机，载荷也不进", () => {
  const m = baseline();
  m.servers[0].tier = "runos-registered";
  m.servers[0].needsKey = true;
  m.servers[0].launch = null;
  m.servers[0].launchNote = "经 Runos 注册";
  m.servers[0].launch = { runtime: "node", package: "p", version: "1.0.0", bin: "a.js", requiresComponent: ["browser.thing"] };
  assert.match(run(m).out, /不许有 requiresComponent/);
});

test("组件的 sha256 是占位符 —— 没有真摘要的载荷不许进清单", () => {
  const m = baseline();
  m.components[0].sha256 = "<CI 造包时算出写回>";
  assert.match(run(m).out, /sha256 不是 64 位小写十六进制/);
});

test("组件的 origin 不在白名单里", () => {
  const m = baseline();
  m.components[0].source.url = "https://evil.example.net/thing.zip";
  assert.match(run(m).out, /不在 allowedOrigins 里/);
});

test("组件的 url 是 http —— 明文取字节这条路不存在（哪怕 origin 对得上）", () => {
  const m = baseline();
  // 白名单里同时有一条写成 http 的：光比 origin，这一对**是能对上的**。
  m.allowedOrigins.push("http://cdn.example.com");
  m.components[0].source.url = "http://cdn.example.com/thing.zip";
  const { code, out } = run(m);
  assert.equal(code, 1);
  assert.match(out, /source\.url 不是 https/);
});

test("白名单里有一条 http —— 那条项本身就是明文取字节的许可", () => {
  const m = baseline();
  m.allowedOrigins.push("http://mirror.example.com");
  const { code, out } = run(m);
  assert.equal(code, 1);
  assert.match(out, /不是 https —— 明文的来源不许进白名单/);
});

test("组件一个许可证文件都没有 —— 这条正是挡住完整 chrome-win64 的那一条", () => {
  const m = baseline();
  m.components[0].licenseFile = [];
  assert.match(run(m).out, /licenseFile 要是非空数组/);
});

test("copyleft 的组件没有 sourceOffer", () => {
  const m = baseline();
  m.components[0].license = "GPL-2.0-or-later";
  assert.match(run(m).out, /sourceOffer/);
});

test("download-only 的组件指向我们自己的主机 —— 镜像本身就是再分发", () => {
  const m = baseline();
  m.allowedOrigins.push("https://dl.vxture.com");
  m.components[0].source.url = "https://dl.vxture.com/thing.zip";
  assert.match(run(m).out, /指向我们自己的主机/);
});

test("孤儿载荷：unlocks 指向一个不存在的服务器", () => {
  const m = baseline();
  m.components[0].unlocks = ["ghost"];
  assert.match(run(m).out, /不在 servers 里/);
});

test("获取通道不带任何凭据", () => {
  const m = baseline();
  m.components[0].source.headers = { authorization: "Bearer x" };
  assert.match(run(m).out, /不带任何凭据/);
});

test("unpackedBytes 小于 size —— 至少有一个数是错的", () => {
  const m = baseline();
  m.components[0].unpackedBytes = 1;
  assert.match(run(m).out, /至少有一个数是错的/);
});

test("工具目录写成空数组 —— 读起来是「它什么都不暴露」", () => {
  const m = baseline();
  m.servers[0].tools = [];
  assert.match(run(m).out, /去重的非空字符串数组/);
});

test("工具目录里有重复的名字", () => {
  const m = baseline();
  m.servers[0].tools = ["a", "a"];
  assert.match(run(m).out, /重复的工具名/);
});

// --- refused（查过了、不能收的来源）------------------------------------
// 这一段是 2026-09-09 xberg-io/xberg 的直接产物：它以 default 档随包默认启用，
// 而仓库级 LICENSE（MIT）与技能自己的前言（Elastic-2.0）说的不是一回事。撤下容易，
// 难的是不让它明天被同一个理由重新加回来。

test("refused 条目没写理由 —— 那和把它删掉是同一件事", () => {
  const m = baseline();
  m.refused = [{ id: "a.b", repo: "https://github.com/a/b", reason: "短", verifiedAt: "2026-09-09" }];
  assert.match(run(m).out, /缺 reason/);
});

test("refused 条目没写核实日期", () => {
  const m = baseline();
  m.refused = [{ id: "a.b", repo: "https://github.com/a/b", reason: "许可证两个说法，取限制性的那个" }];
  assert.match(run(m).out, /verifiedAt 要是 YYYY-MM-DD/);
});

test("被拒的来源又出现在 skills 里 —— 撤下之后被人加了回来", () => {
  const m = baseline();
  m.skills = [
    {
      id: "a.b",
      kind: "skill-source",
      repo: "https://github.com/a/b",
      commit: "b".repeat(40),
      license: "MIT",
      licenseSource: "仓库级 LICENSE",
      tier: "default",
    },
  ];
  m.refused = [{ id: "a.b", repo: "https://github.com/a/b", reason: "许可证两个说法，取限制性的那个", verifiedAt: "2026-09-09" }];
  assert.match(run(m).out, /又出现在 skills \/ servers 里/);
});

test("refused 的 commit 给了就要钉死", () => {
  const m = baseline();
  m.refused = [{ id: "a.b", repo: "https://github.com/a/b", reason: "许可证两个说法，取限制性的那个", verifiedAt: "2026-09-09", commit: "main" }];
  assert.match(run(m).out, /commit 给了就要是 40 位十六进制/);
});

test("干净的 refused 段不该拦住任何东西", () => {
  const m = baseline();
  m.refused = [
    {
      id: "a.b",
      repo: "https://github.com/a/b",
      commit: "b".repeat(40),
      reason: "许可证两个说法，取限制性的那个",
      verifiedAt: "2026-09-09",
    },
  ];
  assert.equal(run(m).code, 0);
});

// 这一条守的是守卫自己的结构：汇报必须在**所有**规则之后。它此前夹在组件段与
// pythonRuntime 段之间，于是随包 uv 的每一条校验都是死信 —— 检查在跑，结论没人读。
// 把汇报挪到末尾之后，这条用例才第一次能失败（2026-09-09）。
test("随包 uv 没钉哈希 —— pythonRuntime 段的结论必须真的被报出来", () => {
  const m = baseline();
  m.pythonRuntime.uv.sha256 = "not-a-hash";
  const r = run(m);
  assert.equal(r.code, 1);
  assert.match(r.out, /sha256 不是/);
});

test("仓里那份真清单必须自洽", () => {
  const res = spawnSync(process.execPath, [guard], {
    encoding: "utf8",
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
  });
  assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
});
