/**
 * check-app-version.mjs 的自测。照这一批守卫的规矩：**每条规则都反向验一遍** ——
 * 一份只坏了一处的输入，断言它真的被拒，且拒绝的理由说的就是那一处。
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { problemsFor, versionInMain } from "./check-app-version.mjs";

const OK = { shell: "0.2.0-beta.1", daemon: "0.2.0-beta.1", main: "0.2.0-beta.1" };

test("三处一致、形状合法就通过", () => {
  assert.deepEqual(problemsFor(OK), []);
  assert.deepEqual(problemsFor({ shell: "1.2.0", daemon: "1.2.0", main: "1.2.0" }), []);
});

test("三处漂开要拦 —— 安静的后果是「每次检查更新都说有新版本」", () => {
  const p = problemsFor({ ...OK, main: "0.1.0" });
  assert.equal(p.length, 1);
  assert.match(p[0], /三处版本号不一致/);
  assert.match(p[0], /每次检查更新都说有新版本/, "报错要说清后果，不是只说不一致");
});

test("形状不合法要拦（不要 rc，与包那条守卫同一套）", () => {
  assert.match(problemsFor({ shell: "1.2.0-rc.1", daemon: "1.2.0-rc.1", main: "1.2.0-rc.1" })[0], /不是 X\.Y\.Z/);
  assert.match(problemsFor({ shell: "1.2", daemon: "1.2", main: "1.2" })[0], /不是 X\.Y\.Z/);
});

test("读不出版本号要说出来，而不是当成通过", () => {
  assert.match(problemsFor({ ...OK, shell: undefined })[0], /读不出版本号/);
  assert.equal(versionInMain('const VERSION = "1.2.3";'), "1.2.3");
  assert.equal(versionInMain("const VERSION = 1;"), undefined, "写法一变就该读不出来，而不是猜一个");
});

test("beta tag 要求版本号带 -beta.N —— 没有后缀，客户端分不出谁新谁旧", () => {
  const p = problemsFor({ shell: "1.2.0", daemon: "1.2.0", main: "1.2.0", tag: "beta-20260918.1" });
  assert.equal(p.length, 1);
  assert.match(p[0], /没有预发布后缀/);
  assert.deepEqual(problemsFor({ ...OK, tag: "beta-20260918.1" }), [], "带后缀就该过");
});

test("v tag 要求去掉后缀，且与 tag 相等", () => {
  assert.match(problemsFor({ ...OK, tag: "v0.2.0" })[0], /还带着预发布后缀/);
  const mismatch = problemsFor({ shell: "1.2.0", daemon: "1.2.0", main: "1.2.0", tag: "v1.3.0" });
  assert.match(mismatch[0], /与版本号 1\.2\.0 不相等/);
  assert.deepEqual(problemsFor({ shell: "1.2.0", daemon: "1.2.0", main: "1.2.0", tag: "v1.2.0" }), []);
});

test("仓里此刻的三处版本号必须自洽（跑真的 CLI，不是另一份副本逻辑）", () => {
  const guard = fileURLToPath(new URL("./check-app-version.mjs", import.meta.url));
  const res = spawnSync(process.execPath, [guard], { encoding: "utf8" });
  assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
});
