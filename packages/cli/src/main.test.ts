/**
 * The ruyin CLI (main.ts) had no test at all - every path here is exercised
 * for real by CI's `lint:contract` job against real product files, but that
 * only ever proves the happy path on today's fixtures; the usage errors,
 * exit codes, and multi-target aggregation have no safety net if someone
 * changes them.
 *
 * main.ts calls process.exit() at module scope (argv parsing runs on
 * import), so it cannot be imported into this test process directly -
 * doing so would kill the test runner. It is driven as a real subprocess
 * instead, which also means these tests check the actual CLI contract
 * (exit code, stdout/stderr) rather than internals.
 */

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const CLI = fileURLToPath(new URL("./main.js", import.meta.url));

const VALID_YAML = `contract: "0.1"
product:
  id: test.cli-lint
  name: CLI 测试
  version: 1.0.0
  publisher: vxture
  runtime:
    minimum: 0.1.0
project:
  type: project
  operations: [create, open]
objects:
  - id: root
    name: 根对象
    primary: true
states:
  object: root
  initial: draft
  items:
    - name: draft
      transitions: []
context:
  types:
    - id: doc
      name: 文档
      required: true
      sources: [local]
      class: source
      sensitivity: low
capabilities:
  - id: analyze
    kind: analysis
    description: 分析
tools:
  - id: read_file
    category: local_read
    risk: low
    default: allow
    input_schema:
      type: object
      properties:
        path: { type: string, x-ruyin-ref: path }
      required: [path]
tasks:
  - id: run
    objective: 跑一次
    input_types: [doc]
    output_types: []
    capabilities: [analyze]
    tools: [read_file]
    verification:
      - { id: check, kind: automated }
permissions:
  local_read: allow
  local_write: ask
  delete: ask
  external_send: ask
  sync_to_cloud: ask
sync:
  default: local_only
  classes:
    - { class: source, policy: local_only }
`;

/** 结构合法但 R7 不过：高风险工具默认 allow。 */
const INVALID_YAML = VALID_YAML.replace("test.cli-lint", "test.cli-lint-invalid")
  .replace("risk: low", "risk: high")
  .replace("category: local_read", "category: local_write");

function run(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function tmpFile(name: string, content: string): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "ruyin-cli-"));
  const file = join(dir, name);
  writeFileSync(file, content, "utf8");
  return { dir, file };
}

void test("ruyin lint: no arguments at all is a usage error (exit 2)", () => {
  const res = run();
  assert.equal(res.status, 2);
  assert.match(res.stderr, /usage: ruyin lint/);
});

void test("ruyin lint: an unknown command is also a usage error", () => {
  const res = run("frobnicate", "x");
  assert.equal(res.status, 2);
  assert.match(res.stderr, /usage: ruyin lint/);
});

void test("ruyin lint: 'lint' with no paths is a usage error", () => {
  const res = run("lint");
  assert.equal(res.status, 2);
  assert.match(res.stderr, /usage: ruyin lint/);
});

void test("ruyin lint: a path that does not exist is a usage error naming the path", () => {
  const res = run("lint", join(tmpdir(), "ruyin-cli-does-not-exist-at-all"));
  assert.equal(res.status, 2);
  assert.match(res.stderr, /path not found/);
});

void test("ruyin lint: a valid contract file passes (exit 0)", () => {
  const { dir, file } = tmpFile("ruyin.product.yaml", VALID_YAML);
  try {
    const res = run("lint", file);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /\[OK\]/);
    assert.match(res.stdout, /1\/1 passed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("ruyin lint: an invalid contract file fails (exit 1) and names the rule", () => {
  const { dir, file } = tmpFile("ruyin.product.yaml", INVALID_YAML);
  try {
    const res = run("lint", file);
    assert.equal(res.status, 1);
    // [FAIL] 与逐条规则详情走的是 console.error（stderr）；只有那行汇总计数
    // 走 console.log（stdout）——两条用例分头去查各自那一半，不是随便挑一个流。
    assert.match(res.stderr, /\[FAIL\]/);
    assert.match(res.stderr, /R7/);
    assert.match(res.stdout, /0\/1 passed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("ruyin lint: a product directory (containing the manifest directly) resolves via the shortcut", () => {
  const dir = mkdtempSync(join(tmpdir(), "ruyin-cli-"));
  try {
    writeFileSync(join(dir, "ruyin.product.yaml"), VALID_YAML, "utf8");
    const res = run("lint", dir);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /1\/1 passed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("ruyin lint: a directory of product directories lints each child manifest", () => {
  const root = mkdtempSync(join(tmpdir(), "ruyin-cli-"));
  try {
    mkdirSync(join(root, "good"), { recursive: true });
    writeFileSync(join(root, "good", "ruyin.product.yaml"), VALID_YAML, "utf8");
    mkdirSync(join(root, "bad"), { recursive: true });
    writeFileSync(join(root, "bad", "ruyin.product.yaml"), INVALID_YAML, "utf8");
    // 没有 manifest 的子目录不该被当成产品，也不该让整次调用崩掉。
    mkdirSync(join(root, "not-a-product"), { recursive: true });

    const res = run("lint", root);
    assert.equal(res.status, 1, "目录里有一个不过，整次调用就该是非零退出码");
    assert.match(res.stdout, /1\/2 passed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test("ruyin lint: a directory with no manifest anywhere under it is a usage error", () => {
  const dir = mkdtempSync(join(tmpdir(), "ruyin-cli-"));
  try {
    writeFileSync(join(dir, "README.md"), "nothing to lint here", "utf8");
    const res = run("lint", dir);
    assert.equal(res.status, 2);
    assert.match(res.stderr, new RegExp("no ruyin\\.product\\.yaml found"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("ruyin lint: multiple targets aggregate into one pass/fail count", () => {
  const { dir: dirA, file: fileA } = tmpFile("a.yaml", VALID_YAML);
  const { dir: dirB, file: fileB } = tmpFile("b.yaml", INVALID_YAML);
  try {
    const res = run("lint", fileA, fileB);
    assert.equal(res.status, 1);
    assert.match(res.stdout, /1\/2 passed/);
  } finally {
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  }
});
