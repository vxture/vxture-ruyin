#!/usr/bin/env node
/**
 * CSS token guardrail: every `var(--x)` in the app's own stylesheet must be a
 * token the design system actually defines.
 *
 * Why this exists (2026-09-04): four token names invented across the home /
 * card passes did not exist - `--font-size-body-sm|md|xs` (the DS spells it
 * `--body-sm-font-size`) and `--color-danger`. CSS does not complain: an
 * undefined custom property with no fallback makes the whole declaration
 * invalid at computed-value time, so the element quietly keeps the inherited
 * value, and one with a hardcoded fallback silently uses that instead of the
 * theme - which is how a warning note ended up bright amber on a white card
 * in light mode while looking fine in dark. **A stylesheet that says
 * `font-size: var(--font-size-body-sm)` and renders at the parent's size is
 * exactly the "says X, is actually Y" defect this repo hunts.**
 *
 * The authority is the DS token layer, read from its shipped CSS rather than
 * from a list kept here: a list would go stale the first time the DS adds a
 * token, and a stale allowlist reads exactly like a correct one.
 *
 * A `var(--x, fallback)` with a fallback is still checked: the fallback is a
 * safety net for an older DS, not a licence to invent a name.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const appCss = join(repoRoot, "apps/ui-workspace/src/app.css");
/**
 * 权威是 token 包本身（`@vxture/design-tokens` 的 src/styles），不是设计系统
 * 的 CSS —— 后者只 `@import` 它，变量一个都不写在那里。加上 design-system 与
 * design-ui 自己的样式，覆盖它们各自声明的少量局部变量。
 */
const tokenRoots = [
  "@vxture/design-tokens/src/styles",
  "@vxture/design-system/src/styles",
  "@vxture/design-ui/dist",
]
  .map((rel) => {
    // pnpm 把包软链进 apps/ui-workspace/node_modules，也可能只在 .pnpm 仓库里。
    const direct = join(repoRoot, "apps/ui-workspace/node_modules", rel);
    if (existsSync(direct)) return direct;
    const store = join(repoRoot, "node_modules/.pnpm");
    if (!existsSync(store)) return undefined;
    const [scope, name, ...tail] = rel.split("/");
    // .pnpm 的目录名保留 scope 的 @：`@vxture+design-tokens@3.0.0_...`。
    const prefix = `${scope}+${name}@`;
    const dir = readdirSync(store).find((d) => d.startsWith(prefix));
    if (!dir) return undefined;
    const viaStore = join(store, dir, "node_modules", scope, name, ...tail);
    return existsSync(viaStore) ? viaStore : undefined;
  })
  .filter((p) => p !== undefined);

if (tokenRoots.length === 0) {
  console.log("[css-tokens] design tokens not installed - skipping");
  process.exit(0);
}

/** Every custom property the DS (or Tailwind's theme layer) defines. */
const defined = new Set();
const collect = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collect(full);
    else if (entry.name.endsWith(".css")) {
      for (const m of readFileSync(full, "utf8").matchAll(/(--[a-z0-9-]+)\s*:/g)) {
        defined.add(m[1]);
      }
    }
  }
};
for (const root of tokenRoots) collect(root);

/**
 * Tailwind v4 mirrors every `--x` in `@theme` as `--color-x` / `--spacing-x`
 * and friends. Those aliases are generated, not written, so accept a name
 * whose suffix is a defined token.
 */
const aliasPrefixes = ["--color-", "--spacing-", "--radius-", "--text-", "--font-"];
const isDefined = (name) => {
  if (defined.has(name)) return true;
  for (const prefix of aliasPrefixes) {
    if (name.startsWith(prefix) && defined.has(`--${name.slice(prefix.length)}`)) return true;
  }
  return false;
};

const css = readFileSync(appCss, "utf8");
/** Declared locally in app.css itself (e.g. none today) still counts. */
for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/g)) defined.add(m[1]);

const problems = new Map();
for (const m of css.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
  const name = m[1];
  if (isDefined(name)) continue;
  const line = css.slice(0, m.index).split("\n").length;
  if (!problems.has(name)) problems.set(name, []);
  problems.get(name).push(line);
}

if (problems.size > 0) {
  console.error("[css-tokens] app.css references custom properties the design system does not define:");
  for (const [name, lines] of problems) {
    console.error(`  - ${name}  (app.css line ${lines.join(", ")})`);
  }
  console.error(
    "\n  An undefined property makes the declaration invalid at computed-value time:\n" +
      "  the element keeps whatever it inherited, and nothing reports it. With a\n" +
      "  hardcoded fallback it is worse - the value stops following the theme.\n" +
      "  Use the DS token (font sizes are `--body-sm-font-size`, not `--font-size-body-sm`).",
  );
  process.exit(1);
}

console.log(`[css-tokens] OK - every var() in app.css resolves to a design-system token (${defined.size} known).`);
