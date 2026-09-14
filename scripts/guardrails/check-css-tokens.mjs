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

import { readFileSync, readdirSync, existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const appCss = join(repoRoot, "apps/ui-workspace/src/app.css");
const consumerModules = join(repoRoot, "apps/ui-workspace/node_modules");

const real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

/**
 * 一个包在本机的真实位置。
 *
 * **不按前缀在 .pnpm 里挑。** 先前这里是
 * `readdirSync(store).find((d) => d.startsWith("@vxture+design-tokens@"))` ——
 * 仓库里同时躺着两个版本时，它取的是**目录名排序的第一个**，与 lockfile 说的那
 * 一个毫无关系。2026-09-14 实测：一次失败安装留下的 `@vxture+design-tokens@3.0.0`
 * 空壳排在 `3.2.0` 前面，守卫于是拿一份没有任何定义的目录当权威，把 app.css 里
 * 每一个 var() 都报成「设计系统没有定义」—— 四十多条假红。**反过来一样成立**：
 * 仓库里留着旧版本、而新版本删掉了某个 token，它会假绿，而假绿没人会去查。
 *
 * 改成顺着**真实的安装关系**走：直连依赖看消费方的 node_modules（pnpm 的软链在
 * 那儿），传递依赖看锚点包自己的同级目录（pnpm 把一个包的依赖铺在它旁边）。两条
 * 都是 pnpm 按 lockfile 铺出来的，版本对不上的可能性不存在。
 */
function packageDir(pkg, anchor) {
  const direct = join(consumerModules, pkg);
  if (existsSync(direct)) return real(direct);
  // anchor 形如 <...>/node_modules/@vxture/design-system，它的依赖是自己的同级。
  if (anchor) {
    const sibling = join(anchor, "..", "..", pkg);
    if (existsSync(sibling)) return real(sibling);
  }
  return undefined;
}

const versionOf = (dir) => {
  try {
    return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
  } catch {
    return undefined;
  }
};

/** 直连依赖，同时也是两个传递依赖的锚点。 */
const designSystem = packageDir("@vxture/design-system");
/**
 * 权威是 token 包本身（`@vxture/design-tokens` 的 src/styles），不是设计系统
 * 的 CSS —— 后者只 `@import` 它，变量一个都不写在那里。加上 design-system 与
 * design-ui 自己的样式，覆盖它们各自声明的少量局部变量。
 */
const sources = [
  { pkg: "@vxture/design-tokens", dir: packageDir("@vxture/design-tokens", designSystem), sub: "src/styles", authority: true },
  { pkg: "@vxture/design-system", dir: designSystem, sub: "src/styles" },
  { pkg: "@vxture/design-ui", dir: packageDir("@vxture/design-ui", designSystem), sub: "dist" },
]
  .map((s) => (s.dir ? { ...s, styles: join(s.dir, s.sub) } : s))
  .filter((s) => s.styles !== undefined && existsSync(s.styles));

if (sources.length === 0) {
  console.log("[css-tokens] design tokens not installed - skipping");
  process.exit(0);
}

/**
 * **装了一半不许放行。**
 *
 * 只找到 design-system 就开查，等于拿半套定义判全套引用 —— 那正是上面那四十多条
 * 假红的形状。「没装」是一回事（上一段已经跳过并说明了），「装歪了」是另一回事，
 * 后者必须响：它和「一切正常」在 CI 上长得一模一样，而这道守卫存在的全部理由就是
 * 不让「说 X、实际是 Y」的东西安静地过去。
 */
if (!sources.some((s) => s.authority)) {
  console.error(
    "[css-tokens] 找到了设计系统，却没找到 token 包（@vxture/design-tokens）——\n" +
      "  变量定义全在 token 包里，缺了它这道检查只会把每个 var() 都报成未定义。\n" +
      `  找到的：${sources.map((s) => s.pkg).join("、")}\n` +
      "  多半是装了一半，或 node_modules 里留着旧版本残渣：重跑一次 pnpm install。",
  );
  process.exit(1);
}

const tokenRoots = sources.map((s) => s.styles);
// **把用的是哪一份说出来。** 版本不对时，这一行是唯一能让人当场看出来的东西。
console.log(
  "[css-tokens] 权威来源：\n" +
    sources
      .map((s) => {
        const where = s.styles.startsWith(repoRoot) ? s.styles.slice(repoRoot.length) : s.styles;
        return `  - ${s.pkg}@${versionOf(s.dir) ?? "?"}  ${where}`;
      })
      .join("\n"),
);

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
 * 目录在、里面一个定义都没有 —— 那是残渣目录或半截安装，不是「设计系统真的什么
 * 都没定义」。照常往下走的话，下面会把 app.css 里每个 var() 都列成违规：报告长得
 * 像一场灾难，根因却只是装歪了。**报告的形状要指向真正的根因。**
 */
if (defined.size === 0) {
  console.error(
    `[css-tokens] 取到了 token 目录，里面却没有任何自定义属性定义：\n` +
      sources.map((s) => `  - ${s.pkg}@${versionOf(s.dir) ?? "?"}  ${s.styles}`).join("\n") +
      "\n  这是残渣目录或半截安装，不是设计系统真的什么都没定义。重跑 pnpm install。",
  );
  process.exit(1);
}

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
