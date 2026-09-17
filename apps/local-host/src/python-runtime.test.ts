/**
 * Python 半边（python-runtime.ts，TD-042 ②）：uv 不随安装包，用户点一次才装。
 *
 * 这里**不真的起 uv**（那要下 100 MB 再跑几分钟），而是把 `run` 换掉 —— 断言的是
 * 这一支自己的三件事：跑了哪几条命令、状态怎么算、没成时说的是哪一种没成。
 * 至于「uv 这几条命令真能把环境装出来」，那是 provision 最后一步 `--offline` 真起
 * 一次在**用户机器上**回答的问题，不是这里能回答的。
 */

import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PythonRuntime, type ComponentPayloadStatus, type RunResult } from "./python-runtime.js";

const CONFIG = { component: "python.uv", cpython: { version: "3.13.15" }, seed: ["py.excel"] };
const SEEDS = [{ package: "excel-mcp-server", version: "0.1.8", bin: "excel-mcp-server" }];
const UV_EXE = process.platform === "win32" ? "uv.exe" : "uv";

function payload(over: Partial<ComponentPayloadStatus> = {}): ComponentPayloadStatus {
  return {
    id: "python.uv",
    state: "acquired",
    version: "0.12.10",
    downloadBytes: 16989876,
    diskBytes: 42103296,
    license: "MIT OR Apache-2.0",
    origin: "https://github.com",
    ...over,
  };
}

function rig(
  opts: {
    /** uv 那棵树在不在（undefined = 还没获取）。 */
    acquired?: boolean;
    run?: (cmd: string, args: string[], env: Record<string, string>) => RunResult;
    config?: typeof CONFIG | undefined;
  } = {},
) {
  const base = mkdtempSync(join(tmpdir(), "ruyin-python-"));
  const tree = join(base, "c", "python.uv", "0.12.10");
  if (opts.acquired !== false) {
    mkdirSync(join(tree, "uv"), { recursive: true });
    writeFileSync(join(tree, "uv", UV_EXE), "");
  }
  const calls: Array<{ args: string[]; env: Record<string, string> }> = [];
  const runtime = new PythonRuntime({
    dataDir: base,
    components: {
      pathOf: () => (opts.acquired === false ? undefined : tree),
      status: () => payload(opts.acquired === false ? { state: "not-acquired" } : {}),
    },
    config: () => (opts.config === undefined && "config" in opts ? undefined : (opts.config ?? CONFIG)),
    seeds: () => SEEDS,
    run: async (cmd, args, env) => {
      calls.push({ args, env });
      return opts.run ? opts.run(cmd, args, env) : { status: 0, output: "" };
    },
    now: () => "2026-09-18T00:00:00.000Z",
  });
  return { base, tree, runtime, calls, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

test("status: 还没获取 uv 就是 not-acquired，而且**一个字节都不取**（只读盘）", () => {
  const { runtime, calls, cleanup } = rig({ acquired: false });
  try {
    const s = runtime.status();
    assert.equal(s.state, "not-acquired");
    assert.equal(s.component, "python.uv");
    assert.deepEqual(s.wanted, ["excel-mcp-server==0.1.8"]);
    // 点之前就看得见要下多少：载荷那一份原样带出来。
    assert.equal(s.payload?.downloadBytes, 16989876);
    assert.equal(calls.length, 0, "算状态不许起任何进程");
  } finally {
    cleanup();
  }
});

test("status: 清单里没有 Python 半边 —— 整块不存在，不是「没装」", () => {
  const { runtime, cleanup } = rig({ config: undefined });
  try {
    const s = runtime.status();
    assert.equal(s.component, null);
    assert.equal(s.payload, undefined);
  } finally {
    cleanup();
  }
});

test("provision: 装 CPython → 预热 → --offline 复核，三步都用钉死的那个版本；回执写完才算 ready", async () => {
  const { runtime, calls, base, cleanup } = rig();
  try {
    const s = await runtime.provision();
    assert.equal(s.state, "ready", s.reason);
    assert.equal(s.pythonVersion, "3.13.15");
    assert.deepEqual(s.packages, ["excel-mcp-server==0.1.8"]);

    assert.equal(calls.length, 3, "装 Python、预热、离线复核，各一次");
    assert.deepEqual(calls[0]?.args, ["python", "install", "3.13"]);
    // 预热与运行时起它用的是**同一条命令**，只是不带 --offline —— 缓存要被写成什么样，
    // 只有真正读它的那条命令说了算（`uv tool install` 写的是别处，实测过不了复核）。
    assert.deepEqual(calls[1]?.args, [
      "tool",
      "run",
      "--from",
      "excel-mcp-server==0.1.8",
      "excel-mcp-server",
      "--help",
    ]);
    assert.equal(calls[2]?.args[2], "--offline", "最后一步必须断网真起一次");
    // 复核要在一个空的 UV_TOOL_DIR 里做：看得见上一轮的 venv，证明的就成了
    // 「这台机器上此刻能起」，而不是「这棵树自己够」。
    assert.notEqual(calls[1]?.env["UV_TOOL_DIR"], calls[2]?.env["UV_TOOL_DIR"]);
    for (const c of calls) {
      assert.equal(c.env["UV_CACHE_DIR"], join(base, "tools", "uv-cache"));
      assert.equal(c.env["UV_PYTHON_INSTALL_DIR"], join(base, "tools", "uv-python"));
    }

    const receipt = JSON.parse(readFileSync(join(base, "tools", "python-runtime.json"), "utf8")) as {
      provisionedAt: string;
    };
    assert.equal(receipt.provisionedAt, "2026-09-18T00:00:00.000Z");
    assert.equal(runtime.isReady(), true);
    assert.equal(runtime.uvExe(), join(base, "c", "python.uv", "0.12.10", "uv", UV_EXE));
  } finally {
    cleanup();
  }
});

test("provision: 哪一步没成就说哪一步 —— 「没下载成功」与「试跑没通过」不是同一件事", async () => {
  for (const [failAt, code] of [
    [0, "install-python-failed"],
    [1, "warm-failed"],
    [2, "verify-failed"],
  ] as const) {
    let n = 0;
    const { runtime, cleanup } = rig({ run: () => (n++ === failAt ? { status: 1, output: "uv 说了句什么" } : { status: 0, output: "" }) });
    try {
      const s = await runtime.provision();
      assert.equal(s.state, "failed");
      assert.equal(s.code, code);
      // 原文留着当诊断，但界面一个字不渲染（按 code 出话）。
      assert.match(s.reason ?? "", /uv 说了句什么/);
      assert.equal(runtime.isReady(), false, `${code} 之后不许算装好了`);
    } finally {
      cleanup();
    }
  }
});

test("provision: uv 还没获取时先取它 —— 取不到就说取不到，不含糊成一句「装不上」", async () => {
  const { runtime, calls, cleanup } = rig({ acquired: false });
  try {
    const s = await runtime.provision({
      acquire: () => Promise.reject(new Error("unreachable: 网络到不了")),
    });
    assert.equal(s.state, "failed");
    assert.equal(s.code, "acquire-failed");
    assert.equal(calls.length, 0, "uv 都没拿到，不该去起任何命令");
  } finally {
    cleanup();
  }
});

test("provision: 给了 acquire 但它什么都没装出来 —— 也要说清，而不是接着往下跑", async () => {
  const { runtime, cleanup } = rig({ acquired: false });
  try {
    const s = await runtime.provision({ acquire: () => Promise.resolve() });
    assert.equal(s.code, "uv-missing");
  } finally {
    cleanup();
  }
});

test("status: 装过、但这一版清单换了包 —— 是 stale，**不是**「没装过」", async () => {
  const { base, tree, cleanup } = rig();
  try {
    mkdirSync(join(base, "tools"), { recursive: true });
    mkdirSync(join(base, "tools", "uv-python"), { recursive: true });
    writeFileSync(
      join(base, "tools", "python-runtime.json"),
      JSON.stringify({ uvVersion: "0.12.10", pythonVersion: "3.13.15", packages: ["excel-mcp-server==0.1.7"], provisionedAt: "x" }),
    );
    const runtime = new PythonRuntime({
      dataDir: base,
      components: { pathOf: () => tree, status: () => payload() },
      config: () => CONFIG,
      seeds: () => SEEDS,
      run: async () => ({ status: 0, output: "" }),
    });
    const s = runtime.status();
    assert.equal(s.state, "stale");
    assert.deepEqual(s.packages, ["excel-mcp-server==0.1.7"]);
    assert.deepEqual(s.wanted, ["excel-mcp-server==0.1.8"]);
  } finally {
    cleanup();
  }
});

test("provision: 装到一半取消 —— 说「已取消」，并且不再往下跑", async () => {
  const base = mkdtempSync(join(tmpdir(), "ruyin-python-"));
  const tree = join(base, "c", "python.uv", "0.12.10");
  mkdirSync(join(tree, "uv"), { recursive: true });
  writeFileSync(join(tree, "uv", UV_EXE), "");
  let runtime: PythonRuntime | undefined;
  const calls: string[][] = [];
  runtime = new PythonRuntime({
    dataDir: base,
    components: { pathOf: () => tree, status: () => payload() },
    config: () => CONFIG,
    seeds: () => SEEDS,
    run: async (_cmd, args) => {
      calls.push(args);
      // 第一条命令跑完就取消：真实情形是用户在装 CPython 的那几十秒里点了取消。
      runtime?.cancel();
      return { status: 0, output: "" };
    },
  });
  try {
    const s = await runtime.provision();
    assert.equal(s.state, "failed");
    assert.equal(s.code, "cancelled");
    assert.equal(calls.length, 1, "取消之后不许再起下一条");
    assert.equal(existsSync(join(base, "tools", "python-runtime.json")), false, "没装完就不许有回执");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("remove: 回执、解释器、缓存一起走；没装过时回 false（不是错误）", async () => {
  const { runtime, base, cleanup } = rig();
  try {
    assert.equal(runtime.remove(), false);
    await runtime.provision();
    mkdirSync(join(base, "tools", "uv-cache"), { recursive: true });
    assert.equal(runtime.remove(), true);
    assert.equal(existsSync(join(base, "tools", "python-runtime.json")), false);
    assert.equal(existsSync(join(base, "tools", "uv-cache")), false);
    assert.equal(runtime.status().state, "not-provisioned", "uv 还在，所以不是 not-acquired");
  } finally {
    cleanup();
  }
});
