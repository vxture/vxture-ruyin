/**
 * 工具名对照表的生成必须是**确定的**。
 *
 * CI 里那条检查（packaged-smoke：pack 跑过 pull-tools 之后一句 `git diff
 * --exit-code`）只有在「同一份 index.json 永远生成同一份文档」时才有意义。上一版
 * 正文里写了一句「本次构建（YYYY-MM-DD）」，而 `resources/tools/` 是 gitignore 的
 * 构建产物 —— 每次构建都会重生成 index.json，`generatedAt` 就是当天。于是那份文档
 * **在提交的第二天起，对每一次与工具名毫无关系的提交都判过期**。
 *
 * 一个每天都会红一次的必需检查，等于教会所有人忽略它。这里的用例就是那件事：
 * 换一个日期重新生成，输出必须一字不差。
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { renderToolNameDoc, renderToolNameTable } from "./tool-name-doc.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/** 一份最小的、形状真实的 index.json。 */
function index(generatedAt) {
  return {
    generatedAt,
    manifestVersion: 1,
    servers: [
      {
        id: "x.browser",
        tier: "default",
        launch: { runtime: "node" },
        tools: ["browser_navigate", "browser_run_code_unsafe"],
      },
      { id: "x.uvx", tier: "installed-disabled", launch: { runtime: "uvx" }, toolsUnprobed: "本次构建没有 vendored 它" },
      { id: "x.registered", tier: "runos-registered" },
    ],
  };
}

test("换一天再生成，输出一字不差 —— 否则那条必需检查每天都会红一次", () => {
  const day1 = renderToolNameDoc(index("2026-09-06T04:15:07.018Z"));
  const day2 = renderToolNameDoc(index("2027-01-31T22:00:00.000Z"));
  assert.equal(day1, day2);
  assert.equal(renderToolNameTable(index("2026-09-06T00:00:00.000Z")), renderToolNameTable(index("2030-01-01T00:00:00.000Z")));
});

test("构建日期一个字都不进生成物 —— 它只留在 gitignore 的 index.json 里", () => {
  // 正文里那些固定日期（owner 定某条的日子）是常量，不影响确定性；会漂的只有
  // `generatedAt`。所以查的是**那一个日期有没有渗进正文**。
  const doc = renderToolNameDoc(index("2031-07-19T11:22:33.444Z"));
  for (const shape of ["2031-07-19", "2031", "T11:22:33"]) {
    assert.equal(doc.includes(shape), false, `生成的文档里出现了构建日期的 ${shape}`);
  }
});

test("能跑任意代码的工具照登不藏，并且标出来", () => {
  const doc = renderToolNameDoc(index("2026-09-06T04:15:07.018Z"));
  assert.match(doc, /`browser_run_code_unsafe` ⚠️/);
  // 探不到的写一句原因，不是空数组（空数组读起来是「它什么都不暴露」）。
  assert.match(doc, /_未探到：本次构建没有 vendored 它_/);
  // 没有 launch 的只登记不装，不该出现在这张表里。
  assert.equal(doc.includes("x.registered"), false);
});

test("仓里那份已提交的对照表，就是现在这份 index.json 生成出来的样子", (t) => {
  const indexFile = join(repoRoot, "resources", "tools", "index.json");
  if (!existsSync(indexFile)) {
    // resources/tools/ 是构建产物：没跑过 pnpm tools:pull 的克隆里没有它。
    t.skip("resources/tools/index.json 不在（先跑一次 pnpm tools:pull）");
    return;
  }
  const source = JSON.parse(readFileSync(indexFile, "utf8"));
  const committed = readFileSync(join(repoRoot, "docs", "40-implementation", "40-bundled-tool-names.md"), "utf8");
  assert.equal(renderToolNameDoc(source), committed, "跑一次 pnpm tools:names 重生成");
  // 而且**换一天生成还是这一份** —— 这才是 CI 那条 git diff 检查成立的前提。
  assert.equal(renderToolNameDoc({ ...source, generatedAt: "2099-12-31T00:00:00.000Z" }), committed);
});
