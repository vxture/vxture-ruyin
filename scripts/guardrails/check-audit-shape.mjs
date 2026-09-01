#!/usr/bin/env node
/**
 * 审计记录形状守卫。
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
 * 这道守卫只做一件事：两边的字段名必须一字不差。
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
  return [...clean.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\??\s*:/gm)].map(
    (m) => m[1],
  );
}

const kernel = readFileSync(
  join(repoRoot, "packages/runtime-core/src/ports.ts"),
  "utf8",
);
const ui = readFileSync(
  join(repoRoot, "apps/ui-workspace/src/api.ts"),
  "utf8",
);

const problems = [];
for (const name of ["AuditEvent", "LegacyAuditEvent"]) {
  const a = fieldsOf(kernel, name);
  const b = fieldsOf(ui, name);
  if (!a) {
    problems.push(`内核里找不到 interface ${name}`);
    continue;
  }
  if (!b) {
    problems.push(
      `界面里找不到 interface ${name} —— 它是本地重算哈希链的前提，不是可选的`,
    );
    continue;
  }
  const missing = a.filter((f) => !b.includes(f));
  const extra = b.filter((f) => !a.includes(f));
  if (missing.length) {
    problems.push(`${name}：界面少了 ${missing.join("、")}`);
  }
  if (extra.length) {
    problems.push(`${name}：界面多出 ${extra.join("、")}（内核里没有）`);
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
  console.error("[audit-shape] 不合规：");
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    "  修法：以 packages/runtime-core/src/ports.ts 为准。字段名对不上，界面的\n" +
      "  哈希重算就一定失败，而失败的样子是「哈希链断裂」——一句吓人且错误的话。",
  );
  process.exit(1);
}

console.log("[audit-shape] OK - 界面与内核的审计记录形状一致，两种链接字段都认。");
