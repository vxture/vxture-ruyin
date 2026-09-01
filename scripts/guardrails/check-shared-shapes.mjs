#!/usr/bin/env node
/**
 * 跨进程共享形状守卫：界面手里那份服务端类型的副本，必须和源头一字不差。
 *
 * 界面要在本地重算哈希链，而**链的哈希是按存进去时的字段名算的**。所以界面
 * 手里那份 `AuditEvent` 不是一个方便的类型声明，是重算的前提：字段名一旦和
 * 内核对不上，重算必然失败。
 *
 * 这不是假想。X-3 改名（`kind`->`action`、`timestamp`->`occurredAt`、
 * `prev_hash`->`prevHash`…）之后，界面那份没跟上，于是：
 *
 *   - 审计表读 `e.kind` / `e.timestamp`，全是 undefined，整页显示空白
 *   - 链校验读 `event.prev_hash`，第一条就对不上
 *   - 徽章因此对**每一条完好的链**都亮「哈希链断裂」
 *
 * 一个永远喊狼来了的完整性指示器，比没有这个指示器更糟：它训练用户忽略它，
 * 而它真正响的那一次也就没人看了。
 *
 * 同一类漂移当天出现了第二次：服务端的 `ProductInfo` 早就带着 `versions`
 * （§18.4 回滚要用的版本列表），界面那份没有它 —— 于是「版本回滚做不了，因为
 * 拿不到版本列表」被当成事实写进了技术债，而它是假的。
 *
 * 所以这道守卫不只管审计：**凡是界面复制了一份服务端类型的地方，都在这里对。**
 * 界面多出源头没有的字段，一定是错的；界面少了源头有的字段，多半是一个还没
 * 被发现的功能。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/** 从一份 .ts 源里抠出某个 interface 的字段名（按声明顺序）。 */
function fieldsOf(source, name) {
  const start = source.indexOf(`interface ${name} {`);
  if (start < 0) return null;
  const open = source.indexOf("{", start);
  let depth = 0;
  let end = open;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = source.slice(open + 1, end);
  // 去掉注释，再取每个「名字[?]:」
  const clean = body
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  // 只收顶层字段：内联的对象字面量（比如 `subscription: { status; tier; … }`）
  // 里的名字不是这个类型的字段，算进来会把一次比较变成一堆假报警。
  const out = [];
  let nesting = 0;
  for (const line of clean.split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\??\s*:/.exec(line);
    if (nesting === 0 && m) out.push(m[1]);
    nesting +=
      (line.match(/[{[]/g) ?? []).length - (line.match(/[}\]]/g) ?? []).length;
  }
  return out;
}

const ui = readFileSync(
  join(repoRoot, "apps/ui-workspace/src/api.ts"),
  "utf8",
);

/**
 * 界面复制了哪些类型：[界面里的名字, 源头里的名字, 源头文件]。
 *
 * 两边名字可以不同（界面叫 ProductInfo，服务端叫 ProductView），**但字段必须
 * 一样** —— 名字是称呼，字段是契约。
 */
const SHARED = [
  ["AuditEvent", "AuditEvent", "packages/runtime-core/src/ports.ts"],
  ["LegacyAuditEvent", "LegacyAuditEvent", "packages/runtime-core/src/ports.ts"],
  ["ProductInfo", "ProductView", "apps/local-host/src/product-registry.ts"],
];

const sources = new Map();
const problems = [];
for (const [uiName, sourceName, from] of SHARED) {
  if (!sources.has(from)) {
    sources.set(from, readFileSync(join(repoRoot, from), "utf8"));
  }
  const a = fieldsOf(sources.get(from), sourceName);
  const b = fieldsOf(ui, uiName);
  const name = uiName === sourceName ? uiName : `${uiName} <- ${sourceName}`;
  if (!a) {
    problems.push(`${from} 里找不到 interface ${sourceName}`);
    continue;
  }
  if (!b) {
    problems.push(
      `界面里找不到 interface ${uiName}（源头：${from} 的 ${sourceName}）`,
    );
    continue;
  }
  const missing = a.filter((f) => !b.includes(f));
  const extra = b.filter((f) => !a.includes(f));
  if (missing.length) {
    problems.push(
      `${name}：界面少了 ${missing.join("、")} —— 源头有而界面没有的字段，` +
        `多半是一个还没被发现的功能`,
    );
  }
  if (extra.length) {
    problems.push(`${name}：界面多出 ${extra.join("、")}（${from} 里没有）`);
  }
}

// 链校验必须认两种形状的链接字段，只认一种等于对另一种谎报断裂。
const chain = readFileSync(
  join(repoRoot, "apps/ui-workspace/src/chain.ts"),
  "utf8",
);
for (const field of ["prevHash", "prev_hash"]) {
  if (!chain.includes(field)) {
    problems.push(`chain.ts 没有读 ${field} —— 那一种形状的链会被判成断裂`);
  }
}

if (problems.length > 0) {
  console.error("[shared-shapes] 不合规：");
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    "  修法：以源头为准改界面。审计记录尤其不能含糊 —— 字段名对不上，界面的" +
      "哈希重算就一定失败，而失败的样子是「哈希链断裂」，一句吓人且错误的话。",
  );
  process.exit(1);
}

console.log(
  `[shared-shapes] OK - ${SHARED.length} 个共享类型与源头一致，链校验两种链接字段都认。`,
);
