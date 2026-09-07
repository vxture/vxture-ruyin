/**
 * check-publish-order.mjs 自己的测试。
 *
 * 这道守卫拦的是一件**只在发布那一刻才现形**的事：`pnpm publish` 会把
 * `workspace:*` 重写成具体版本，所以依赖没先发，包在注册表上就指向一个不存在的
 * 版本，而消费方要到 `npm install` 那一刻才发现。
 *
 * 它自己坏掉同样安静：ORDER 的正则没匹配上、或者依赖比较写反了，它照样打一行
 * OK。所以三条规则各验一遍，**每次只坏一处**。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { fixtureRepo } from "./fixture-repo.mjs";

const GUARD = "check-publish-order.mjs";

/**
 * 造一棵假仓库：`pkgs` 是 { 目录名: package.json }，`order` 是 ORDER 数组的内容。
 */
function check(pkgs, order) {
  const repo = fixtureRepo("ruyin-porder-");
  try {
    for (const [dir, json] of Object.entries(pkgs)) {
      repo.json(`packages/${dir}/package.json`, json);
    }
    repo.write(
      "scripts/release/publish-packages.mjs",
      `const ORDER = [\n${order.map((d) => `  "${d}",`).join("\n")}\n];\n`,
    );
    return repo.run(GUARD);
  } finally {
    repo.clean();
  }
}

const pkg = (name, deps = {}) => ({ name, version: "0.1.0", dependencies: deps });

void test("依赖排在前面就通过", () => {
  const r = check(
    {
      "contract-schema": pkg("@x/schema"),
      "runtime-core": pkg("@x/core", { "@x/schema": "workspace:*" }),
    },
    ["contract-schema", "runtime-core"],
  );
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /OK - 2 个包/);
});

void test("**依赖排在后面**要拦 —— 这正是它存在的那件事", () => {
  const r = check(
    {
      "contract-schema": pkg("@x/schema"),
      "runtime-core": pkg("@x/core", { "@x/schema": "workspace:*" }),
    },
    ["runtime-core", "contract-schema"],
  );
  assert.equal(r.code, 1);
  assert.match(r.out, /@x\/core 依赖 @x\/schema/);
  assert.match(r.out, /注册表上还不存在的版本/, "要说清后果，不只说顺序错了");
});

void test("加了新包却忘了排进 ORDER —— 它不会被发布，要拦", () => {
  const r = check(
    { "contract-schema": pkg("@x/schema"), document: pkg("@x/doc") },
    ["contract-schema"],
  );
  assert.equal(r.code, 1);
  assert.match(r.out, /@x\/doc（packages\/document）不在 ORDER 里/);
  assert.match(r.out, /不会被发布/);
});

void test("ORDER 里有一个已经不存在的包，也要拦", () => {
  const r = check({ "contract-schema": pkg("@x/schema") }, ["contract-schema", "已删掉的包"]);
  assert.equal(r.code, 1);
  assert.match(r.out, /"已删掉的包" 不是一个要发布的包/);
});

void test("private 包不参与顺序 —— 它本来就不发", () => {
  const r = check(
    {
      "contract-schema": pkg("@x/schema"),
      fixtures: { ...pkg("@x/fixtures"), private: true },
    },
    ["contract-schema"],
  );
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /OK - 1 个包/);
});

void test("外部依赖与顺序无关 —— 不能把 npm 上的包也拿来排队", () => {
  const r = check(
    { "runtime-core": pkg("@x/core", { zod: "^3", "node-fetch": "^3" }) },
    ["runtime-core"],
  );
  assert.equal(r.code, 0, r.out);
});

void test("ORDER 找不到时报错而不是当成空表通过", () => {
  const repo = fixtureRepo("ruyin-porder-none-");
  try {
    repo.json("packages/a/package.json", pkg("@x/a"));
    repo.write("scripts/release/publish-packages.mjs", "// 谁把 ORDER 改名了\n");
    const r = repo.run(GUARD);
    assert.equal(r.code, 1);
    assert.match(r.out, /找不到 publish-packages\.mjs 里的 ORDER/);
  } finally {
    repo.clean();
  }
});
