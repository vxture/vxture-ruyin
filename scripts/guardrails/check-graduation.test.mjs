/**
 * 毕业前置的自测。照这一批守卫的规矩反向验：每条规则都给一份只坏了一处的输入，
 * 断言它真的被拒、且理由说的就是那一处。
 */
import { strict as assert } from "node:assert";
import test from "node:test";

import { graduationProblem, versionInFeed } from "./check-graduation.mjs";

test("beta 上就是同一条版本线的预发布版 —— 放行", () => {
  assert.equal(graduationProblem({ tag: "v1.2.0", betaVersion: "1.2.0-beta.3" }), undefined);
});

test("从没发过 beta 就要发正式版 —— 拦住，并说清该先做什么", () => {
  const p = graduationProblem({ tag: "v1.2.0", betaVersion: undefined });
  assert.match(p, /无法证明这一版在 beta 上跑过/);
  assert.match(p, /1\.2\.0-beta\.N/, "要告诉他该先发哪一版");
  assert.match(p, /ALLOW_UNPROVEN_STABLE/, "要说清绕过的方式 —— 让它是一个决定，不是一次卡住");
});

test("beta 上是另一条版本线 —— 拦住（包括版本号打错一位那种）", () => {
  assert.match(graduationProblem({ tag: "v1.2.0", betaVersion: "1.1.0-beta.3" }), /对不上/);
  assert.match(graduationProblem({ tag: "v1.2.0", betaVersion: "1.3.0-beta.1" }), /对不上/);
  // 前缀比对要认边界：1.2.0 不该被 1.2.01-beta.1 蒙混过去。
  assert.match(graduationProblem({ tag: "v1.2.0", betaVersion: "1.2.01-beta.1" }), /对不上/);
});

test("beta tag 与这条无关 —— 不许顺手拦住测试版的发布", () => {
  assert.equal(graduationProblem({ tag: "beta-20260918.4", betaVersion: undefined }), undefined);
});

test("绕过要生效，而且是显式的", () => {
  assert.equal(graduationProblem({ tag: "v1.2.0", betaVersion: undefined, allowUnproven: true }), undefined);
});

test("feed 里的版本号读得出来；形状不对时**不猜**", () => {
  assert.equal(versionInFeed("version: 1.2.0-beta.3\npath: x.exe\n"), "1.2.0-beta.3");
  assert.equal(versionInFeed("path: x.exe\n"), undefined);
  assert.equal(versionInFeed(""), undefined);
  assert.equal(versionInFeed(undefined), undefined);
  // 不能被别处出现的 version: 蒙到（feed 里 files: 段下面还有一层缩进的字段）。
  assert.equal(versionInFeed("files:\n  - url: x.exe\n    version: 9.9.9\nversion: 1.2.0\n"), "1.2.0");
});
