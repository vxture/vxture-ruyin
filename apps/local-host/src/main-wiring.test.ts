/**
 * 守护进程的**装配线**（`main.ts`）。
 *
 * ## 为什么单独有这么一套
 *
 * `main.ts` 是 735 行的顶层脚本：它一被 import 就开库、起进程、占端口。于是没有
 * 任何测试 import 得了它 —— 而 Node 的覆盖率**只统计被加载过的文件**，所以它连
 * 分母都不在。`local-host` 报的 96% 是「测试碰过的那些文件」的 96%，这 735 行不在
 * 其中（2026-09-07 核实）。
 *
 * 那 735 行做的全是**接线**：把 `contextBudgetFromEnv` 的结果接到内核、把
 * `resourceLimitsFromEnv` 的结果接到连接器登记册、把文件区接到路由、把云同步与
 * 系统目录那两道检查接到换目录那条路。这一批里每一样新东西都从这里穿过。
 *
 * **接线坏掉的样子，和好的一模一样**：端口上加了字段却忘了传，纯逻辑的用例照样
 * 全绿，而那个功能一次都不生效。这一整轮我靠「每次记得写一条端到端用例」挡住了
 * 几次（TD-044/050/041 各一条），但那是靠人记得，不是靠机制。这个文件是机制。
 *
 * ## 怎么测：**真的把它启动起来**
 *
 * 不重构。把 735 行拆成一个可测函数是一次大改动，而它现在是对的 —— 为了能测而
 * 改一段正在正常工作的装配线，风险比它挡下的多。
 *
 * 所以起一个真的子进程：临时数据目录、临时指针文件、一个空闲端口，然后**只断言
 * 那些「接上了」与「没接上」表现不同的地方**。断言分两类，价值不一样，这里明写：
 *
 * - **行为断言**（强）：接错了 HTTP 的回答就不一样。上限、文件区、两道目录检查
 *   都是这一类。
 * - **日志断言**（弱）：只能证明那个值被算出来并打印了，不能证明它被用上。上下文
 *   预算是这一类 —— 它没有任何 HTTP 面。**弱在哪儿写在断言旁边**，免得下一个人
 *   以为它证明了更多。
 *
 * ## 这套用例**不会让覆盖率数字变好看**
 *
 * 守护进程是**子进程**，而 Node 的覆盖率收集在父进程里 —— 所以跑完之后 `main.js`
 * 仍然不出现在覆盖表里，`all files` 那一行也一动不动（实测：加这套之前之后都是
 * 95.99%）。
 *
 * 这不是缺陷，是这条路的代价，写在这儿是**免得下一个人把它当成缺陷去修**：为了让
 * 数字变好看而把 735 行装配线拆开重构，风险比它挡下的多。要的是「接线断了会有人
 * 喊」，不是「表格上多一行绿的」。
 */

import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import test from "node:test";

const MAIN = fileURLToPath(new URL("./main.js", import.meta.url));
const PRODUCTS = resolve(fileURLToPath(new URL("../../../products", import.meta.url)));

/** 要一个真的空闲端口：写死一个数字会在并行跑测试时偶发地撞车。 */
async function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const probe = createServer();
    probe.on("error", fail);
    probe.listen(0, "127.0.0.1", () => {
      const port = (probe.address() as { port: number }).port;
      probe.close(() => ok(port));
    });
  });
}

interface Daemon {
  base: string;
  token: string;
  /** 启动到现在打过的所有 stdout/stderr。 */
  log: () => string;
  get: (path: string) => Promise<Response>;
  post: (path: string, body: unknown) => Promise<Response>;
  stop: () => Promise<void>;
}

/**
 * 起一个守护进程，等它说自己在监听。
 *
 * `RUYIN_LOCATION_FILE` 也指到临时位置：不指的话它会读到这台机器上真实的指针
 * 文件，然后**用开发者自己的数据目录**跑测试 —— 那是能把人的数据搬走的那条路。
 */
async function startDaemon(env: NodeJS.ProcessEnv = {}): Promise<Daemon> {
  const dataDir = mkdtempSync(join(tmpdir(), "ruyin-wiring-"));
  const locationFile = join(tmpdir(), `ruyin-wiring-loc-${process.pid}-${Date.now()}.json`);
  const port = await freePort();
  const token = "wiring-test-token";
  let out = "";

  const child: ChildProcess = spawn(process.execPath, [MAIN], {
    env: {
      ...process.env,
      RUYIN_DATA_DIR: dataDir,
      RUYIN_LOCATION_FILE: locationFile,
      RUYIN_PRODUCTS_DIR: PRODUCTS,
      RUYIN_PORT: String(port),
      RUYIN_TOKEN: token,
      // 能力面留空：这套用例问的是接线，不是跑任务。
      RUYIN_CAPABILITY_BASE: "",
      RUYIN_PLATFORM_API_BASE: "",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (c: string) => (out += c));
  child.stderr?.on("data", (c: string) => (out += c));

  const deadline = Date.now() + 60_000;
  while (!out.includes("listening on")) {
    if (child.exitCode !== null) {
      throw new Error(`守护进程没起来就退了（code ${child.exitCode}）：\n${out}`);
    }
    if (Date.now() > deadline) throw new Error(`等不到「listening on」：\n${out}`);
    await new Promise((r) => setTimeout(r, 100));
  }

  const base = `http://127.0.0.1:${port}`;
  const headers = { authorization: `Bearer ${token}` };
  return {
    base,
    token,
    log: () => out,
    get: (path) => fetch(base + path, { headers }),
    post: (path, body) =>
      fetch(base + path, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    stop: async () => {
      child.kill();
      // 等它真的退出再删目录：Windows 上一个开着的 SQLite 文件会让 rmSync EPERM。
      const until = Date.now() + 10_000;
      while (child.exitCode === null && child.signalCode === null && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 50));
      }
      await new Promise((r) => setTimeout(r, 200));
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(locationFile, { force: true });
    },
  };
}

void test("装配线：起得来、答得了 /health，且没有静默失败", async () => {
  const d = await startDaemon();
  try {
    const health = await d.get("/health");
    assert.equal(health.status, 200);
    // 起来时不该有异常堆栈 —— 一个「起来了但半路抛过」的进程，日志里看得见，
    // 而 listening 那一行照样会打。
    assert.doesNotMatch(d.log(), /UnhandledPromiseRejection|Error: /);
  } finally {
    await d.stop();
  }
});

void test("装配线：**没接能力面就说没接** —— 「没接上」绝不能看起来像「在工作」", async () => {
  const d = await startDaemon();
  try {
    assert.match(d.log(), /capability surface: NOT configured/);
    assert.match(d.log(), /mock output/, "要说清后果，不只说没配");
  } finally {
    await d.stop();
  }
});

/**
 * 资源上限接到连接器登记册了（TD-046）。
 *
 * **行为断言**：把上限压到 1，装第二个连接器必须被拒，且拒绝的话里点得出正占着
 * 名额的是谁。`limits` 忘了传的话，缺省是 6，这两次都会成功 —— 那正是「接线坏了
 * 和好了长得一样」的样子。
 */
void test("装配线：资源上限真的到了连接器登记册（压到 1，第二个装不进去）", async () => {
  const d = await startDaemon({
    RUYIN_MAX_TOOL_SERVERS: "1",
    RUYIN_ALLOW_UNSIGNED_CONNECTORS: "1",
  });
  const fake = fileURLToPath(new URL("./fake-mcp-server.js", import.meta.url));
  try {
    assert.match(d.log(), /资源上限（已改）：RUYIN_MAX_TOOL_SERVERS=1/);

    const first = await d.post("/connectors", {
      id: "one",
      command: process.execPath,
      args: [fake],
      source: "lan",
    });
    assert.equal(first.status, 201, await first.text());

    const second = await d.post("/connectors", {
      id: "two",
      command: process.execPath,
      args: [fake],
      source: "lan",
    });
    assert.equal(second.status, 400);
    const body = (await second.json()) as { message: string };
    assert.match(body.message, /已达上限 1/);
    assert.match(body.message, /one/, "要说得出是谁占着");
  } finally {
    await d.stop();
  }
});

/**
 * 文件区接到路由了（TD-041）。
 *
 * **行为断言，而且是个干净的判别器**：`files` 没接上时那几条路由整段不存在，请求
 * 落到通用 404；接上了则 `list()` 对一个不存在的项目回空表（`?? []`）。两种回答
 * 差得足够远，不会混。
 */
void test("装配线：文件区路由真的挂上了（没接上就是 404，接上了是空表）", async () => {
  const d = await startDaemon();
  try {
    const res = await d.get("/projects/prj_不存在/files");
    assert.equal(res.status, 200, "404 说明 deps.files 没接上");
    assert.deepEqual(await res.json(), { items: [] });
  } finally {
    await d.stop();
  }
});

/**
 * 换数据目录那条路上的两道检查都接上了（TD-039 系统目录 / TD-051 云同步）。
 *
 * **行为断言**：两者都走 `checkTarget`，而 `checkTarget` 是经 `dataMove.check`
 * 接进路由的。任何一处没接，这里回的就是 `ok: true`。
 */
void test("装配线：系统目录与云同步两道检查都接到了换目录那条路", async () => {
  const d = await startDaemon();
  try {
    for (const [target, expect] of [
      ["C:\\Windows\\Temp\\RuyinData", /Windows 系统目录|系统目录/],
      ["C:\\Users\\amy\\OneDrive\\RuyinData", /OneDrive/],
    ] as const) {
      const res = await d.post("/system/data-dir/check", { target });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { ok: boolean; reason?: string };
      assert.equal(body.ok, false, `${target} 应该被拒 —— ok:true 说明那道检查没接上`);
      assert.match(body.reason ?? "", expect);
    }
    // 正常目录照样放行 —— 拦的是位置，不是「换目录这件事被关掉了」。
    const fine = join(tmpdir(), `ruyin-wiring-ok-${Date.now()}`);
    const ok = await d.post("/system/data-dir/check", { target: fine });
    assert.equal(((await ok.json()) as { ok: boolean }).ok, true);
  } finally {
    await d.stop();
  }
});

/**
 * 上下文预算（TD-044）。
 *
 * **这一条是日志断言，比上面那些弱**，写清楚免得被当成同一档：它只证明
 * `contextBudgetFromEnv` 被调用、结果被打印了，**不证明那个数走到了内核**。
 * 预算没有任何 HTTP 面，从进程外看不见它。
 *
 * 「那个数真的走到选择那一步」由 runtime-core 的端到端用例保证
 * （core.test.ts「上下文预算：宿主把预算调小，选进去的条目跟着变少」）；这里
 * 补的是它中间那一段 —— 宿主确实读了环境变量，而不是让它一直是缺省。
 */
void test("装配线：上下文预算读到了（**日志断言，弱于上面几条**）", async () => {
  const d = await startDaemon({ RUYIN_CONTEXT_BUDGET_KB: "256" });
  try {
    assert.match(d.log(), /上下文预算：约 256 KB/);
  } finally {
    await d.stop();
  }
});

/**
 * 数据目录落在不该放的位置时**只警告，不拦启动**（TD-039）。
 *
 * 这一条钉的是那个决定本身：拒绝启动会让应用变成一个既打不开、也没法在界面里把
 * 目录改回来的东西 —— 而改目录的界面正在它里面。所以必须**既警告、又起来**。
 */
void test("装配线：数据目录在系统位置时，警告了但照样起得来", async () => {
  // execPath 的上一级就是「应用自己的安装目录」那条规则要拒的地方。
  const inAppDir = join(resolve(process.execPath, ".."), `ruyin-wiring-probe-${Date.now()}`);
  const d = await startDaemon({ RUYIN_DATA_DIR: inAppDir });
  try {
    assert.match(d.log(), /数据目录在一个不该放数据的位置/);
    assert.match(d.log(), /卸载会把数据一起删掉/);
    // **而且它起来了** —— 这半条和上半条一样重要。
    assert.equal((await d.get("/health")).status, 200);
  } finally {
    await d.stop();
    rmSync(inAppDir, { recursive: true, force: true });
  }
});

/** 预置的技能层与工具层：报的是真数字还是「没有这一层」，两者都要说得出来。 */
void test("装配线：预置层的计数打得出来（没拉过就说没有，不装作有）", async () => {
  const d = await startDaemon();
  try {
    assert.match(d.log(), /\[ruyin\] skills: bundled \d+/);
    assert.match(d.log(), /\[ruyin\] tools: bundled \d+ server definition\(s\)/);
    // 数据目录、主密钥保护方式也要报 —— 装机之后排查问题全靠这几行。
    assert.match(d.log(), /\[ruyin\] data dir: /);
    assert.match(d.log(), /master key protection: (dpapi|plaintext)/);
  } finally {
    await d.stop();
  }
});

/** 会话令牌是真的在把门：不带令牌一律 401，而不是「本机就放行」。 */
void test("装配线：令牌真的在把门 —— 不带令牌的请求进不来", async () => {
  const d = await startDaemon();
  try {
    const bare = await fetch(`${d.base}/products`);
    assert.equal(bare.status, 401);
    const wrong = await fetch(`${d.base}/products`, {
      // 故意用 ASCII：HTTP 头的值只能是 byte string，中文放进去是 fetch 当场抛，
      // 而那会让这条用例「因为别的原因」失败。
      headers: { authorization: "Bearer not-the-token" },
    });
    assert.equal(wrong.status, 401);
  } finally {
    await d.stop();
  }
});
