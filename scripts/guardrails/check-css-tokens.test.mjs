/**
 * check-css-tokens.mjs 自己的测试。
 *
 * 这道守卫拦的是 CSS 里最安静的一种错：**引用一个设计系统没有的自定义属性**。
 * CSS 不会报错 —— 整条声明在计算值那一步作废，元素继续用它继承来的值，页面看起来
 * 只是「有点不对」；写了硬编码回退的话更糟，那个值从此不跟主题走了。
 *
 * 它自己坏掉同样安静：token 目录找不到时它**直接跳过并退 0**（那是有意的，见下面
 * 那条用例），所以「装错了依赖」和「一切正常」在 CI 上长得一模一样 —— 这正是最该
 * 被钉住的一条。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";

import { fixtureRepo } from "./fixture-repo.mjs";

const GUARD = "check-css-tokens.mjs";
const CSS = "apps/ui-workspace/src/app.css";
/** 守卫优先找这条直连路径（pnpm 把包软链到这儿）。 */
const TOKENS = "apps/ui-workspace/node_modules/@vxture/design-tokens/src/styles";

/**
 * `tokens` 是 token 包里那份 CSS 的内容；给 `null` 表示**根本没装**（用来测跳过
 * 那条路）。
 *
 * 用 `null` 而不是 `undefined`：JS 里显式传 `undefined` 会落到默认参数上，
 * 于是「没装」那条用例照样把 token 写了进去 —— 它会绿，而且绿得毫无道理。
 */
function check(appCss, tokens = ":root { --border: #ccc; --text-primary: #000; }") {
  const repo = fixtureRepo("ruyin-csstok-");
  try {
    repo.write(CSS, appCss);
    if (tokens !== null) repo.write(`${TOKENS}/tokens.css`, tokens);
    return repo.run(GUARD);
  } finally {
    repo.clean();
  }
}

void test("引用设计系统里有的 token 就通过，并报出认得几个", () => {
  const r = check(`.a { border-color: var(--border); color: var(--text-primary); }`);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /OK - every var\(\) in app\.css resolves/);
  assert.match(r.out, /\(2 known\)/, "认得几个要报出来 —— 这个数掉下去说明依赖变了");
});

void test("引用一个不存在的 token 要拦，**并说出是哪一行**", () => {
  const r = check(`.a { color: var(--text-primary); }\n.b { border: 1px solid var(--border-soft); }`);
  assert.equal(r.code, 1);
  assert.match(r.out, /--border-soft/);
  assert.match(r.out, /app\.css line 2/, "要给行号，否则得在几千行样式里找");
  assert.match(r.out, /invalid at computed-value time/, "要说清后果：声明整条作废");
});

void test("**带回退值的也照查** —— 回退是对旧版设计系统的保险，不是造名字的许可", () => {
  const r = check(`.a { color: var(--not-a-token, #ff0000); }`);
  assert.equal(r.code, 1);
  assert.match(r.out, /--not-a-token/);
});

void test("同一个错名出现多次，行号合并成一条报出来", () => {
  const r = check(`.a { color: var(--nope); }\n.b { color: var(--nope); }\n.c { color: var(--nope); }`);
  assert.equal(r.code, 1);
  assert.match(r.out, /--nope\s+\(app\.css line 1, 2, 3\)/);
});

void test("app.css 自己声明的属性也算数 —— 局部变量不该被当成违规", () => {
  const r = check(`:root { --local-only: 4px; }\n.a { padding: var(--local-only); }`);
  assert.equal(r.code, 0, r.out);
});

void test("Tailwind 的生成别名要认：--color-x 认作 --x", () => {
  const tokens = `:root { --border: #ccc; --brand: #123; --md: 8px; }`;
  const r = check(
    `.a { color: var(--color-brand); border-radius: var(--radius-md); border-color: var(--border); }`,
    tokens,
  );
  assert.equal(r.code, 0, r.out);
  // 但别名的后缀必须真的存在 —— 不能因为前缀对就放行。
  const bad = check(`.a { color: var(--color-nonexistent); }`, tokens);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /--color-nonexistent/);
});

/**
 * **这一条是这套用例里最要紧的。**
 *
 * token 包没装时守卫会跳过并退 0 —— 那是有意的（别的仓库借这支脚本、或者还没
 * `pnpm install` 时不该当场红）。但代价是：**「依赖装错了」和「一切正常」在 CI 上
 * 都是绿的**。所以它至少要把「我跳过了」说出来，而这条用例钉的就是那句话。
 *
 * 哪天有人把跳过时的那行日志删掉，或者改成一句看起来像通过的话，这里会红。
 */
void test("token 包没装时**明说自己跳过了**，不装作检查过", () => {
  const r = check(`.a { color: var(--anything); }`, null);
  assert.equal(r.code, 0, "没装依赖不该当场红");
  assert.match(r.out, /design tokens not installed - skipping/);
  assert.doesNotMatch(r.out, /OK - every var/, "**绝不能报成检查通过**");
});

/**
 * ---------------------------------------------------------------------------
 * 下面这几条钉的是**它怎么找到 token 包**（2026-09-14 修）。
 *
 * 原来的找法是按前缀在 `.pnpm` 里取第一个匹配目录。真实仓库里同时躺着两个版本
 * 时——比如一次失败的安装留下的空壳——它取的是目录名排序的第一个，与 lockfile
 * 说的那个毫无关系。当天实测：空壳排在前面，于是 app.css 里每一个 var() 都被报成
 * 「设计系统没有定义」，四十多条假红。**反过来也成立**：旧版本留在仓库里、而新
 * 版本删掉了某个 token，它会假绿——假绿没有人会去查。
 *
 * 所以这几条测的都是同一件事的不同侧面：**用的必须是真实安装关系铺出来的那一份，
 * 并且它得说出来用的是哪一份。**
 */

/** 在假仓库里铺一棵 pnpm 形状的 node_modules（软链 + 同级依赖），返回 repo。 */
function pnpmLayout(repo, { stale = true } = {}) {
  const store = "node_modules/.pnpm";
  const dsHome = `${store}/@vxture+design-system@12.7.0/node_modules/@vxture`;
  // 传递依赖：pnpm 把它铺在锚点包的**同级**。
  repo.json(`${dsHome}/design-tokens/package.json`, { name: "@vxture/design-tokens", version: "3.2.0" });
  repo.write(`${dsHome}/design-tokens/src/styles/tokens.css`, ":root { --real-only: 2px; }");
  repo.json(`${dsHome}/design-system/package.json`, { name: "@vxture/design-system", version: "12.7.0" });
  repo.write(`${dsHome}/design-system/src/styles/globals.css`, ":root { --ds-local: 1px; }");
  // 仓库里另躺着一个**排在前面**的旧版本——老找法会取到它。
  if (stale) {
    repo.json(`${store}/@vxture+design-tokens@0.0.1/node_modules/@vxture/design-tokens/package.json`, {
      name: "@vxture/design-tokens",
      version: "0.0.1",
    });
    repo.write(
      `${store}/@vxture+design-tokens@0.0.1/node_modules/@vxture/design-tokens/src/styles/tokens.css`,
      ":root { --stale-only: 9px; }",
    );
  }
  // 直连依赖是软链——真实 pnpm 就是这个形状，也是 realpath 那一步要走的路。
  const link = join(repo.root, "apps/ui-workspace/node_modules/@vxture/design-system");
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(join(repo.root, dsHome, "design-system"), link, "dir");
  return repo;
}

void test("传递依赖顺着锚点包的同级找（pnpm 的真实形状），不是在 .pnpm 里按前缀挑", () => {
  const repo = pnpmLayout(fixtureRepo("ruyin-csstok-"));
  try {
    repo.write(CSS, `.a { padding: var(--real-only); margin: var(--ds-local); }`);
    const r = repo.run(GUARD);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /@vxture\/design-tokens@3\.2\.0/, "要报出用的是哪一个版本");
  } finally {
    repo.clean();
  }
});

void test("**仓库里排在前面的旧版本不算数** —— 老找法会拿它当权威，于是假绿/假红", () => {
  const repo = pnpmLayout(fixtureRepo("ruyin-csstok-"));
  try {
    repo.write(CSS, `.a { padding: var(--stale-only); }`);
    const r = repo.run(GUARD);
    assert.equal(r.code, 1, `残渣版本里的 token 必须被判为不存在\n${r.out}`);
    assert.match(r.out, /--stale-only/);
    assert.doesNotMatch(r.out, /0\.0\.1/, "更不该把残渣版本当成权威来源报出来");
  } finally {
    repo.clean();
  }
});

void test("装了一半（有设计系统、没有 token 包）要红，并说清缺的是谁", () => {
  const repo = fixtureRepo("ruyin-csstok-");
  try {
    repo.write("apps/ui-workspace/node_modules/@vxture/design-system/src/styles/globals.css", ":root { --ds-local: 1px; }");
    repo.write(CSS, `.a { color: var(--foreground); }`);
    const r = repo.run(GUARD);
    assert.equal(r.code, 1, "**不能拿半套定义判全套引用** —— 那正是假红的形状");
    assert.match(r.out, /@vxture\/design-tokens/, "要点名缺的是 token 包");
    assert.doesNotMatch(r.out, /OK - every var/);
  } finally {
    repo.clean();
  }
});

void test("目录在、里面一个定义都没有：报根因，不是把每个 var() 列成违规", () => {
  const repo = fixtureRepo("ruyin-csstok-");
  try {
    // 残渣目录：路径在，CSS 一个字节都没有。
    repo.write(`${TOKENS}/.keep`, "");
    repo.write(CSS, `.a { color: var(--foreground); }\n.b { padding: var(--spacing-sm); }`);
    const r = repo.run(GUARD);
    assert.equal(r.code, 1);
    assert.match(r.out, /没有任何自定义属性定义/, "要指向真正的根因：装歪了");
    assert.doesNotMatch(r.out, /--foreground/, "**不该列成一长串「未定义」** —— 那份报告会把人带到 app.css 去改");
  } finally {
    repo.clean();
  }
});

void test("通过时报出用的是哪一份（包名 + 版本 + 路径）", () => {
  const repo = fixtureRepo("ruyin-csstok-");
  try {
    repo.json("apps/ui-workspace/node_modules/@vxture/design-tokens/package.json", {
      name: "@vxture/design-tokens",
      version: "3.2.0",
    });
    repo.write(`${TOKENS}/tokens.css`, ":root { --border: #ccc; }");
    repo.write(CSS, `.a { border-color: var(--border); }`);
    const r = repo.run(GUARD);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /权威来源/);
    assert.match(r.out, /@vxture\/design-tokens@3\.2\.0/, "版本不对时，这一行是唯一能当场看出来的东西");
  } finally {
    repo.clean();
  }
});
