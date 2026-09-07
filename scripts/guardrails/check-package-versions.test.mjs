/**
 * check-package-versions.mjs 自己的测试。
 *
 * 这道守卫拦的是 W5 版本策略里最静的一种失败：**包内容改了、版本号没动**，发布
 * 流水线会因「这个版本已经发过」而跳过它，全绿 —— 而消费方拿到的还是旧包。
 *
 * 这里测的是**不需要 git 历史**的那三条（形状、步调一致、tag 与版本相符），加上
 * 「还没有任何 packages-v* tag 时如实说明后通过」。
 *
 * **拿基线比对内容的那一半没有覆盖**，说清楚免得被当成全测了：那要一棵有提交、
 * 有 tag 的真 git 树，每个用例都要 init+commit+tag。它是这支脚本的主路径，值得
 * 补，但属于下一批（见 TD-053）。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { fixtureRepo } from "./fixture-repo.mjs";

const GUARD = "check-package-versions.mjs";

/** 造一棵只有 packages/ 的假仓库（不是 git 仓库）。 */
function check(pkgs, args = []) {
  const repo = fixtureRepo("ruyin-ver-");
  try {
    for (const [dir, json] of Object.entries(pkgs)) {
      repo.json(`packages/${dir}/package.json`, json);
    }
    return repo.run(GUARD, args);
  } finally {
    repo.clean();
  }
}

const pkg = (name, version) => ({ name, version });

void test("版本号形状：X.Y.Z 与预发布形态都认，别的拒", () => {
  for (const good of ["0.1.0", "1.2.3", "0.2.0-alpha.1", "0.2.0-beta.12"]) {
    const r = check({ a: pkg("@x/a", good) });
    assert.equal(r.code, 0, `${good} 应该被接受：${r.out}`);
  }
  for (const bad of ["v0.1.0", "0.1", "0.1.0-rc.1", "latest", "0.1.0.1"]) {
    const r = check({ a: pkg("@x/a", bad) });
    assert.equal(r.code, 1, `${bad} 应该被拒`);
    assert.match(r.out, /is not X\.Y\.Z/);
  }
});

void test("**四个包必须步调一致** —— 版本号不一样时 tag 该等于哪一个？", () => {
  const r = check({ a: pkg("@x/a", "0.1.0"), b: pkg("@x/b", "0.2.0") });
  assert.equal(r.code, 1);
  assert.match(r.out, /not in lockstep/);
  assert.match(r.out, /@x\/a@0\.1\.0/);
  assert.match(r.out, /@x\/b@0\.2\.0/, "要把两边的版本都列出来，否则不知道该改哪个");
});

void test("tag 与包版本对不上要拦 —— 否则会以 0.2.0 的名义发出一份没人升过的包", () => {
  const r = check({ a: pkg("@x/a", "0.1.0") }, ["--tag", "packages-v0.2.0"]);
  assert.equal(r.code, 1);
  assert.match(r.out, /tag packages-v0\.2\.0 says 0\.2\.0 但?.*packages say 0\.1\.0|says 0\.2\.0/);
  assert.match(r.out, /bump the packages or tag the version/, "要说出两条出路");
});

void test("tag 与包版本相符时明说相符 —— 发布日志里要看得见这一步真的比过", () => {
  const r = check({ a: pkg("@x/a", "0.2.0") }, ["--tag", "packages-v0.2.0"]);
  assert.match(r.out, /tag packages-v0\.2\.0 matches the packages' version/);
});

void test("tag 形状不对也要拦", () => {
  const r = check({ a: pkg("@x/a", "0.1.0") }, ["--tag", "v0.1.0"]);
  assert.equal(r.code, 1);
  assert.match(r.out, /is not packages-vX\.Y\.Z/);
});

void test("private 包不参与 —— 它不发布，版本号是它自己的事", () => {
  const r = check({
    a: pkg("@x/a", "0.1.0"),
    fixtures: { ...pkg("@x/fixtures", "9.9.9-not-a-shape"), private: true },
  });
  assert.equal(r.code, 0, r.out);
});

void test("用法错与检查未过是**两个退出码**（2 / 1）—— 混了就分不清是谁的问题", () => {
  // 少给参数 = 调用方写错了命令，退 2。
  const usage = check({ a: pkg("@x/a", "0.1.0") }, ["--tag"]);
  assert.equal(usage.code, 2, "用法错该退 2");
  assert.match(usage.out, /--tag needs a tag name/);
  const usage2 = check({ a: pkg("@x/a", "0.1.0") }, ["--baseline"]);
  assert.equal(usage2.code, 2);
  assert.match(usage2.out, /--baseline needs a ref/);

  // 检查没通过 = 仓库的问题，退 1。CI 靠这个区分「脚本被调错了」和「代码有问题」。
  const failed = check({ a: pkg("@x/a", "坏版本") });
  assert.equal(failed.code, 1, "检查未过该退 1");
});

void test("还没发过任何版本时**如实说明后通过**，不拿一个假基线装作检查过", () => {
  // 假仓库不是 git 仓库，也没有 packages-v* tag —— 走的就是这条路。
  const r = check({ a: pkg("@x/a", "0.1.0") });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /no packages-v\* tag yet/);
  assert.match(r.out, /Passing, honestly/, "这句是有意写的：它说明自己没有在检查什么");
});
