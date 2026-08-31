/**
 * 安装管线用例（30-contract-schema §18.2 信任链 / §18.4 更新与回滚）。
 * 重点：管线顺序即安全顺序，且**失败绝不在磁盘留下半个产品**。
 */

import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  InstallError,
  compareVersions,
  installPackage,
  listStored,
  uninstallVersion,
} from "./installer.js";
import { CHECKSUMS_ENTRY, MANIFEST_ENTRY, sha256 } from "./pkg.js";
import { makeTestZip } from "./pkg-testkit.js";

function contractYaml(version = "1.0.0", minimum = "0.1.0"): string {
  return `contract: "0.1"
product:
  id: test.pkg
  name: 打包演示
  version: ${version}
  publisher: vxture
  runtime:
    minimum: ${minimum}
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
    - id: report
      name: 报告
      required: false
      sources: [project]
      class: generated
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
    output_types: [report]
    capabilities: [analyze]
    tools: [read_file]
    verification:
      - { id: check, kind: automated }
      - { id: human_review, kind: human }
permissions:
  local_read: allow
  local_write: ask
  delete: ask
  external_send: ask
  sync_to_cloud: ask
sync:
  default: local_only
  classes:
    - { class: source,    policy: local_only }
    - { class: generated, policy: manual }
`;
}

function pkg(yaml: string, extra: Array<[string, Buffer]> = []): Buffer {
  const files: Array<[string, Buffer]> = [
    [MANIFEST_ENTRY, Buffer.from(yaml, "utf8")],
    ...extra,
  ];
  const checksums = Buffer.from(
    files.map(([n, d]) => `${sha256(d)}  ${n}`).join("\n") + "\n",
    "utf8",
  );
  return makeTestZip([
    ...files.map(([name, data]) => ({ name, data })),
    { name: CHECKSUMS_ENTRY, data: checksums },
  ]);
}

function store(): string {
  return mkdtempSync(join(tmpdir(), "ruyin-store-"));
}

const DEV = { runtimeVersion: "0.1.0", requireSignature: false };

void test("compareVersions 按数值段比较，缺位补 0", () => {
  assert.ok(compareVersions("1.0.0", "1.0.1") < 0);
  assert.ok(compareVersions("1.2", "1.2.0") === 0);
  assert.ok(compareVersions("2.0.0", "1.9.9") > 0);
});

void test("安装：验证通过后版本化落盘，可枚举", () => {
  const storeDir = store();
  try {
    const r = installPackage(pkg(contractYaml()), { storeDir, ...DEV });
    assert.equal(r.productId, "test.pkg");
    assert.equal(r.version, "1.0.0");
    assert.equal(r.signed, false); // 无信任锚，不谎称验过
    assert.ok(existsSync(join(r.dir, MANIFEST_ENTRY)));
    const stored = listStored(storeDir);
    assert.equal(stored.length, 1);
    assert.equal(stored[0]?.version, "1.0.0");
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
  }
});

void test("生产策略：未经副署的包一律拒装（§18.2）", () => {
  const storeDir = store();
  try {
    assert.throws(
      () =>
        installPackage(pkg(contractYaml()), {
          storeDir,
          runtimeVersion: "0.1.0",
          requireSignature: true,
        }),
      /not countersigned/,
    );
    assert.equal(listStored(storeDir).length, 0); // 磁盘干净
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
  }
});

void test("契约无效的包被拒，且不落盘", () => {
  const storeDir = store();
  try {
    assert.throws(
      () => installPackage(pkg('contract: "0.1"\nproduct: {}\n'), { storeDir, ...DEV }),
      InstallError,
    );
    assert.equal(readdirSync(storeDir).length, 0);
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
  }
});

void test("runtime.minimum 高于当前 runtime 时拒装（L3）", () => {
  const storeDir = store();
  try {
    assert.throws(
      () => installPackage(pkg(contractYaml("1.0.0", "9.9.9")), { storeDir, ...DEV }),
      /requires runtime >= 9\.9\.9/,
    );
    assert.equal(listStored(storeDir).length, 0);
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
  }
});

void test("摘要不符的包被拒，且不落盘", () => {
  const storeDir = store();
  try {
    const tampered = makeTestZip([
      { name: MANIFEST_ENTRY, data: Buffer.from(contractYaml(), "utf8") },
      {
        name: CHECKSUMS_ENTRY,
        data: Buffer.from(`${"0".repeat(64)}  ${MANIFEST_ENTRY}\n`, "utf8"),
      },
    ]);
    assert.throws(() => installPackage(tampered, { storeDir, ...DEV }), /checksum mismatch/);
    assert.equal(readdirSync(storeDir).length, 0);
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
  }
});

void test("多版本并行安装，互不覆盖（§18.4 可回滚）", () => {
  const storeDir = store();
  try {
    installPackage(pkg(contractYaml("1.0.0")), { storeDir, ...DEV });
    installPackage(pkg(contractYaml("1.1.0")), { storeDir, ...DEV });
    const versions = listStored(storeDir)
      .map((s) => s.version)
      .sort(compareVersions);
    assert.deepEqual(versions, ["1.0.0", "1.1.0"]);
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
  }
});

void test("同版本重复安装被拒（不静默覆盖）", () => {
  const storeDir = store();
  try {
    installPackage(pkg(contractYaml()), { storeDir, ...DEV });
    assert.throws(
      () => installPackage(pkg(contractYaml()), { storeDir, ...DEV }),
      /already installed/,
    );
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
  }
});

void test("卸载只删该版本，其余版本保留", () => {
  const storeDir = store();
  try {
    installPackage(pkg(contractYaml("1.0.0")), { storeDir, ...DEV });
    installPackage(pkg(contractYaml("1.1.0")), { storeDir, ...DEV });
    uninstallVersion(storeDir, "test.pkg", "1.0.0");
    const left = listStored(storeDir);
    assert.equal(left.length, 1);
    assert.equal(left[0]?.version, "1.1.0");
    assert.throws(
      () => uninstallVersion(storeDir, "test.pkg", "1.0.0"),
      /not installed/,
    );
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
  }
});

void test("产品 id / 版本不得越出库目录", () => {
  const storeDir = store();
  try {
    assert.throws(
      () => uninstallVersion(storeDir, "../escape", "1.0.0"),
      /illegal product id/,
    );
    assert.throws(
      () => uninstallVersion(storeDir, "test.pkg", "../../etc"),
      /illegal version/,
    );
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
  }
});

void test("包内资源随安装落盘（保持目录结构）", () => {
  const storeDir = store();
  try {
    const r = installPackage(
      pkg(contractYaml(), [["resources/tpl.txt", Buffer.from("body")]]),
      { storeDir, ...DEV },
    );
    assert.ok(existsSync(join(r.dir, "resources", "tpl.txt")));
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
  }
});
