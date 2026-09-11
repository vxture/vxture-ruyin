/**
 * 随包第三方组件的许可声明（third-party.mjs，TD-058）。
 *
 * 钉三件事：许可证策略（copyleft 与缺许可证不过）、清单确定（同一份依赖一字不差）、
 * 全文里真的有许可证原文（包里没附的照实写，不编）。
 */

import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collect, licenseAllowed, policyProblems, renderFullText, renderSummaryModule } from "./third-party.mjs";

test("licenseAllowed: 宽松许可过；copyleft、缺失、认不得的写法都不过", () => {
  for (const ok of ["MIT", "ISC", "Apache-2.0", "BSD-3-Clause", "(MIT OR GPL-3.0-or-later)", "(MIT AND Zlib)", "(BSD-2-Clause OR MIT OR Apache-2.0)"]) {
    assert.equal(licenseAllowed(ok), true, ok);
  }
  for (const bad of [undefined, "", "GPL-3.0", "AGPL-3.0-only", "LGPL-2.1", "MPL-2.0", "UNLICENSED", "SEE LICENSE IN LICENSE", "(MIT AND GPL-3.0)", "(MIT OR (Apache-2.0 AND GPL-2.0))"]) {
    assert.equal(licenseAllowed(bad), false, String(bad));
  }
});

test("policyProblems: 点名不合规的那几条", () => {
  const got = policyProblems([
    { name: "a", version: "1.0.0", license: "MIT", usedBy: ["daemon"] },
    { name: "b", version: "2.0.0", license: "GPL-3.0", usedBy: ["ui"] },
    { name: "c", version: "3.0.0", license: undefined, usedBy: ["ui"] },
  ]);
  assert.deepEqual(got, ["b@2.0.0: GPL-3.0", "c@3.0.0: （没有许可证字段）"]);
});

/** 清单要确定：不写日期、按名排序 —— 否则 --check 会每天红一次。 */
test("renderSummaryModule: 同样的输入一字不差，不含日期", () => {
  const entries = [{ name: "x", version: "1.0.0", license: "MIT", usedBy: ["ui"] }];
  const a = renderSummaryModule(entries);
  assert.equal(a, renderSummaryModule(entries));
  assert.doesNotMatch(a, /20\d\d-\d\d-\d\d/);
  assert.match(a, /\{ name: "x", version: "1.0.0", license: "MIT", usedBy: \["ui"\] \},/);
});

test("renderFullText: 附上包里的许可证原文；没附的照实写一句，不编", () => {
  const files = { "/p/a": ["LICENSE", "index.js", "NOTICE.md"], "/p/b": ["index.js"] };
  const text = renderFullText(
    [
      { name: "a", version: "1.0.0", license: "MIT", usedBy: ["daemon"], dir: "/p/a" },
      { name: "b", version: "2.0.0", license: "ISC", usedBy: ["ui"], dir: "/p/b" },
    ],
    (dir) => files[dir.replace(/\\/g, "/")] ?? [],
    (path) => `TEXT OF ${String(path).replace(/\\/g, "/")}`,
  );
  assert.match(text, /a@1\.0\.0 {2}— {2}MIT/);
  assert.match(text, /--- LICENSE ---\nTEXT OF \/p\/a\/LICENSE/);
  assert.match(text, /--- NOTICE\.md ---/);
  assert.doesNotMatch(text, /index\.js ---/);
  assert.match(text, /b@2\.0\.0[\s\S]*（包内未附许可证文件；许可证：ISC）/);
  assert.match(text, /RUYIN 本身是闭源商业软件/);
  assert.match(text, /LICENSES\.chromium\.html/);
});

/**
 * 在一棵造出来的小仓库上跑（守卫自测那一步刻意不装依赖，所以不碰真的 node_modules）：
 * 只扫生产依赖、顺着依赖往下走、去重并记下随哪一块、自家包不算、Electron 单独在列。
 */
test("collect: 只扫生产依赖并往下走；去重记下随哪一块；自家包不算；Electron 单独在列", () => {
  const root = mkdtempSync(join(tmpdir(), "ruyin-third-party-"));
  const pkg = (dir, body) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify(body));
  };
  try {
    pkg(join(root, "apps/local-host"), { dependencies: { a: "1", "@vxture/ours": "1" }, devDependencies: { devonly: "1" } });
    pkg(join(root, "apps/ui-workspace"), { dependencies: { a: "1" } });
    pkg(join(root, "apps/shell"), { devDependencies: { electron: "1" } });
    pkg(join(root, "node_modules/a"), { name: "a", version: "1.0.0", license: "MIT", dependencies: { b: "1" } });
    pkg(join(root, "node_modules/b"), { name: "b", version: "2.0.0", licenses: [{ type: "ISC" }] });
    pkg(join(root, "node_modules/@vxture/ours"), { name: "@vxture/ours", version: "0.1.0" });
    pkg(join(root, "node_modules/devonly"), { name: "devonly", version: "9.9.9", license: "GPL-3.0" });
    pkg(join(root, "node_modules/electron"), { name: "electron", version: "42.0.0", license: "MIT" });

    const entries = collect(root).map(({ dir: _dir, ...e }) => e);
    assert.deepEqual(entries, [
      { name: "a", version: "1.0.0", license: "MIT", usedBy: ["daemon", "ui"] },
      { name: "b", version: "2.0.0", license: "ISC", usedBy: ["daemon", "ui"] },
      { name: "electron", version: "42.0.0", license: "MIT", usedBy: ["shell"] },
    ]);
    assert.deepEqual(policyProblems(entries), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
