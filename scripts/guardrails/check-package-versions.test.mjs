/**
 * check-package-versions.mjs 自己的测试。
 *
 * 这道守卫拦的是 W5 版本策略里最静的一种失败：**包内容改了、版本号没动**，发布
 * 流水线会因「这个版本已经发过」而跳过它，全绿 —— 而消费方拿到的还是旧包。
 *
 * 这里测的是**不需要 git 历史**的那三条（形状、步调一致、tag 与版本相符），加上
 * 「还没有任何 packages-v* tag 时如实说明后通过」。
 *
 * 拿基线比对内容的那一半在下半部分 —— 那要一棵有提交、有 tag 的真 git 树，每个
 * 用例都建一棵。慢一点，但假的历史测不出「和上一次发布相比改了什么」。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { commitAll, fixtureRepo } from "./fixture-repo.mjs";

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

/**
 * 拿基线比对内容那一半（第二批补上）。
 *
 * 这是这支守卫的**主路径**，也是 W5 版本策略真正要拦的那件事：**包内容改了、版本
 * 号没动**，发布流水线会因「这个版本已经发过」跳过它而全绿，消费方拿到的还是旧包。
 *
 * 要走到这条路必须有真的提交与 tag（`git show <基线>:packages/x/package.json`、
 * `git diff <基线> HEAD`），所以这几条用例每次都建一棵小 git 树 —— 慢一点，但
 * 假的历史测不出「和上一次发布相比改了什么」。
 */

/** 建一棵有一次「已发布」提交的仓库，返回它自己（调用方负责 clean）。 */
function published(pkgs, tag = "packages-v0.1.0") {
  const repo = fixtureRepo("ruyin-verbase-");
  for (const [dir, json] of Object.entries(pkgs)) {
    repo.json(`packages/${dir}/package.json`, json);
  }
  commitAll(repo.root, "published", tag);
  return repo;
}

void test("基线之后什么都没改 —— 通过", () => {
  const repo = published({ a: pkg("@x/a", "0.1.0") });
  try {
    const r = repo.run(GUARD);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /OK - 1 publishable package\(s\) checked against packages-v0\.1\.0/);
  } finally {
    repo.clean();
  }
});

void test("**内容改了、版本没动**要拦 —— 这正是这支守卫存在的那件事", () => {
  const repo = published({ a: pkg("@x/a", "0.1.0") });
  try {
    repo.write("packages/a/src/index.ts", "export const changed = true;\n");
    commitAll(repo.root, "改了内容但没升版本");
    const r = repo.run(GUARD);
    assert.equal(r.code, 1);
    assert.match(r.out, /@x\/a: 1 file\(s\) changed since packages-v0\.1\.0 but version is still 0\.1\.0/);
    assert.match(r.out, /skips already-published versions/, "要说清后果：消费方拿到的还是旧包");
    assert.match(r.out, /First: packages\/a\/src\/index\.ts/, "要点出是哪个文件改了");
  } finally {
    repo.clean();
  }
});

void test("内容改了、版本也升了 —— 通过", () => {
  const repo = published({ a: pkg("@x/a", "0.1.0") });
  try {
    repo.write("packages/a/src/index.ts", "export const changed = true;\n");
    repo.json("packages/a/package.json", pkg("@x/a", "0.2.0"));
    commitAll(repo.root, "升了版本");
    const r = repo.run(GUARD);
    assert.equal(r.code, 0, r.out);
  } finally {
    repo.clean();
  }
});

void test("**只改了测试文件不算内容变化** —— 否则每补一条用例都得升一次版本", () => {
  const repo = published({ a: pkg("@x/a", "0.1.0") });
  try {
    repo.write("packages/a/src/index.test.ts", "test('x', () => {});\n");
    repo.write("packages/a/src/thing.test.tsx", "test('y', () => {});\n");
    commitAll(repo.root, "只加了测试");
    const r = repo.run(GUARD);
    assert.equal(r.code, 0, r.out);
  } finally {
    repo.clean();
  }
});

void test("版本号往回退要拦 —— 版本不倒流", () => {
  const repo = published({ a: pkg("@x/a", "0.2.0") });
  try {
    repo.json("packages/a/package.json", pkg("@x/a", "0.1.0"));
    commitAll(repo.root, "把版本改小了");
    const r = repo.run(GUARD);
    assert.equal(r.code, 1);
    assert.match(r.out, /is lower than 0\.2\.0/);
    assert.match(r.out, /versions do not go backwards/);
  } finally {
    repo.clean();
  }
});

void test("基线那时还不存在的新包：说明是首发，不当成违规", () => {
  const repo = published({ a: pkg("@x/a", "0.1.0") });
  try {
    repo.json("packages/b/package.json", pkg("@x/b", "0.1.0"));
    commitAll(repo.root, "加了一个新包");
    const r = repo.run(GUARD);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /@x\/b: new since packages-v0\.1\.0 \(0\.1\.0\) - first publish/);
  } finally {
    repo.clean();
  }
});

/**
 * 「上游升了而下游没动」那条提示。
 *
 * **它比看起来难触发，这一点值得写下来。** 步调一致那条规则要求所有要发布的包共用
 * 一个版本号，所以「只升上游」根本过不了前面那一关 —— 第一版这条用例就是那么写的，
 * 结果被步调一致拦下，测的是另一件事。
 *
 * 真正能走到这条提示的只有一种形状：**新加一个包（首发，算作已升）**，而一个没动过
 * 的老包依赖它。那时老包发出去的那份仍然钉着旧版上游，直到它自己再发一次。
 */
void test("上游升了而下游没动：只是**提示**，不拦（步调一致之下只有首发能触发）", () => {
  const repo = published({
    a: { ...pkg("@x/a", "0.1.0"), dependencies: { "@x/b": "workspace:*" } },
  });
  try {
    // b 是新包：基线那时不存在 → 算作已升；而 a 一个字没改。
    repo.json("packages/b/package.json", pkg("@x/b", "0.1.0"));
    commitAll(repo.root, "加了一个 a 依赖的新包");
    const r = repo.run(GUARD);
    assert.equal(r.code, 0, `这是提示不是错误：${r.out}`);
    assert.match(r.out, /note: @x\/b: new since packages-v0\.1\.0/);
    assert.match(r.out, /note: @x\/a: depends on @x\/b which bumped/);
    assert.match(r.out, /keep pinning the older version/);
  } finally {
    repo.clean();
  }
});

void test("步调一致这条在有基线时同样管用 —— 只升一个包过不了", () => {
  const repo = published({ a: pkg("@x/a", "0.1.0"), b: pkg("@x/b", "0.1.0") });
  try {
    repo.json("packages/a/package.json", pkg("@x/a", "0.2.0"));
    commitAll(repo.root, "只升了 a");
    const r = repo.run(GUARD);
    assert.equal(r.code, 1);
    assert.match(r.out, /not in lockstep/);
  } finally {
    repo.clean();
  }
});

void test("--baseline 可以指定别的基线", () => {
  const repo = published({ a: pkg("@x/a", "0.1.0") }, "packages-v0.1.0");
  try {
    repo.write("packages/a/src/index.ts", "export const x = 1;\n");
    commitAll(repo.root, "第二次提交", "packages-v0.1.1");
    // 以第二次提交为基线：那之后什么都没改，应当通过。
    const r = repo.run(GUARD, ["--baseline", "packages-v0.1.1"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /checked against packages-v0\.1\.1/);
  } finally {
    repo.clean();
  }
});

void test("基线不是这个检出认识的提交时报错 —— 浅克隆下别装作查过", () => {
  const repo = published({ a: pkg("@x/a", "0.1.0") });
  try {
    const r = repo.run(GUARD, ["--baseline", "packages-v9.9.9"]);
    assert.equal(r.code, 1);
    assert.match(r.out, /is not a commit this checkout knows/);
    assert.match(r.out, /shallow clone/, "要提示最可能的原因");
  } finally {
    repo.clean();
  }
});
