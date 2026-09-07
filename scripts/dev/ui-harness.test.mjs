/**
 * 观察台的烟测：**它起不来的时候要有人喊。**
 *
 * `ui-harness.mjs` 是唯一一处把真的 SqliteStoragePort / ProjectRuntime /
 * ConnectorRegistry / LocalToolExecutor 按装机态拼起来的地方，而在 2026-09-07 这一
 * 轮里它被改了四次（TD-044 / TD-045 / TD-046 / TD-041）。其中一次在 rebase 解冲突
 * 时被拼坏过：两条 `await import(...)` 被合成了一条、少了一个 `);` —— 文件语法就
 * 是错的，`pnpm dev:ui` 一个字都跑不出来。而 `pnpm test` 全程是绿的，因为没有任何
 * 用例碰它。是人工 `node --check` 才发现的。
 *
 * 这就是这个仓库反复出现的那个形状：**一条从没被测过的路径，坏了和好了长得一模
 * 一样。** 所以这里只钉一件事 —— 它能不能起来 —— 而不去测它内部的任何逻辑：观察
 * 台是开发工具，价值全在「能起来」，为了可测把它重构一遍是本末倒置。
 *
 * 两支用例，各挡一类事故：
 *   ① `node --check`：零依赖、任何环境都跑，抓的正是上面那种拼坏。
 *   ② 真起一次：临时数据目录 + 临时端口，等它印出带令牌的地址，再照那个地址请求
 *      `/health`、`/`、`/projects`。前两个证明「服务端起来了、界面产物接上了」，
 *      第三个证明**真的存储与内核也跑通了** —— 只绑上一个端口的进程，和一个能用
 *      的观察台，在 `/health` 那一层同样分不出来。
 *
 * **缺构建产物时明确跳过并说明，绝不静默通过**（观察台读的是各包的 dist）。CI 的
 * build job 在 `pnpm build` 之后带 `RUYIN_REQUIRE_HARNESS_SMOKE=1` 跑这个文件，那
 * 里跳过即失败 —— 一条「跳过」在 CI 里和「通过」长得一模一样，正是本文件要治的病。
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const harness = join(repoRoot, "scripts", "dev", "ui-harness.mjs");

/** 观察台读的构建产物。少任何一件它都起不来，而那不是观察台的毛病。 */
const NEEDS_BUILD = [
  "packages/contract-schema/dist/index.js",
  "packages/runtime-core/dist/index.js",
  "apps/local-host/dist/server.js",
  "apps/ui-workspace/dist/index.html",
];

/** 起一次要给多久：它要建三个项目、索引一遍、再跑一个任务到人工检查点。 */
const BOOT_TIMEOUT_MS = 120_000;

test("语法完好 —— rebase 把两条 import 拼成一条，就是在这里被抓住", () => {
  const res = spawnSync(process.execPath, ["--check", harness], { encoding: "utf8" });
  assert.equal(res.status, 0, `node --check 失败：\n${res.stderr}`);
});

test("真起一次：印出地址、应答请求、项目真的建出来了", async (t) => {
  const missing = NEEDS_BUILD.filter((rel) => !existsSync(join(repoRoot, rel)));
  if (missing.length > 0) {
    // 环境不具备与「测过了」是两件事，必须说出来。CI 的 build job 里 dist 一定在，
    // 所以那边把这条跳过判成失败（见文件头）。
    const why = `观察台的前置构建产物缺失（先 pnpm build）：${missing.join(", ")}`;
    if (process.env.RUYIN_REQUIRE_HARNESS_SMOKE === "1") assert.fail(why);
    t.skip(why);
    return;
  }

  // 观察台会 mkdtemp 出数据目录与工作目录、还会在 tmpdir 里放一个指针文件，而它
  // 不把这些路径告诉外面。把整个 tmpdir 指到测试自己的目录，收拾时一并端走。
  const sandbox = mkdtempSync(join(tmpdir(), "ruyin-uiharness-smoke-"));
  const env = { ...process.env, TMPDIR: sandbox, TMP: sandbox, TEMP: sandbox, PORT: "0" };
  // 观察台那几个可选开关一律**摘掉而不是置空**（置空要赌每个解析函数怎么看待空串）：
  // 这里量的是「能不能起来」，而从开发者 shell 继承来的值会让同一份用例在两台机器
  // 上测的不是同一件事 —— 比如把并发上限调成 1 之后，启动那个任务就再也跑不到头。
  for (const key of Object.keys(env)) if (key.startsWith("RUYIN_")) delete env[key];
  const child = spawn(process.execPath, [harness], { cwd: repoRoot, env, stdio: ["ignore", "pipe", "pipe"] });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  /** 等那一行带令牌的地址。进程先死或超时都要带上它自己的输出，别只说「超时」。 */
  const waitForBanner = () =>
    new Promise((resolve, reject) => {
      const line = /\[uiharness\] http:\/\/127\.0\.0\.1:(\d+)\/\?token=(\S+)/;
      const fail = (why) => {
        clearTimeout(timer);
        reject(
          new Error(`观察台没起来：${why}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`),
        );
      };
      const timer = setTimeout(() => fail(`${BOOT_TIMEOUT_MS} ms 内没有印出地址`), BOOT_TIMEOUT_MS);
      const onData = () => {
        const m = line.exec(stdout);
        if (!m) return;
        clearTimeout(timer);
        child.off("exit", onExit);
        resolve({ port: Number(m[1]), token: m[2] });
      };
      const onExit = (code, signal) => fail(`进程先退出了（code=${code} signal=${signal}）`);
      child.stdout.on("data", onData);
      child.once("error", (cause) => fail(String(cause)));
      child.once("exit", onExit);
      onData(); // 地址可能在挂监听器之前就已经到了。
    });

  try {
    const banner = await waitForBanner();
    const base = `http://127.0.0.1:${banner.port}`;
    // 令牌照它印出来的那一行用，不写死常量：这一行是观察台对人的全部接口，
    // 它印错了就等于观察台不可用，而写死常量正好会把这种错测过去。
    const auth = { authorization: `Bearer ${banner.token}` };

    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, version: "0.1.0-uiharness" });

    // 界面产物真的被服务出去了 —— uiDir 指错时 /health 照样是 200，而观察台
    // 存在的全部理由（在浏览器里看见界面）已经没了。
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await page.text(), /<div id="root"|<script/);

    // 真的存储与内核也跑通了：观察台在启动时建了三个项目、跑过一个任务。
    // 只绑上端口的进程，到这一步才和一个能用的观察台分开。
    const projects = await fetch(`${base}/projects`, { headers: auth });
    assert.equal(projects.status, 200);
    const body = await projects.json();
    assert.equal(Array.isArray(body.items), true, `/projects 形状不对：${JSON.stringify(body)}`);
    assert.equal(body.items.length, 3, `期望观察台建出三个项目，实得 ${body.items.length}`);
  } finally {
    // 进程可能已经自己死了（启动就炸的那一路）。那时 "exit" 早发过，再等一次
    // 就是永远等下去 —— 一个挂住的清理，比不清理更难查。
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await exited;
    }
    try {
      // Windows 上 SQLite 的文件句柄要等进程真的收干净才放开，故带重试。
      rmSync(sandbox, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    } catch (cause) {
      // 收拾不掉不判用例失败（临时目录留在系统 temp 下不影响结论），但要说出来 ——
      // 悄悄留下一堆目录，是另一种「坏了和好了长得一样」。
      console.error(`[uiharness.test] 临时目录没删掉：${sandbox}（${cause}）`);
    }
  }
});
