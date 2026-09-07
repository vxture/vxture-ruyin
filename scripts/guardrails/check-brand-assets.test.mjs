/**
 * check-brand-assets.mjs 自己的测试。
 *
 * 这道守卫的起因是一个真实的错误：`public/icon.svg` 曾经是**上一轮会话自己画
 * 的** —— 既不是 Vxture 的品牌资产，也不出自任何图标库，却以页签图标、启动页
 * 标记、登录页标记三种身份出现在界面上。自创视觉资产的问题不在于难看，在于
 * **它会被当成品牌**。
 *
 * 现在那份 logo 是从设计系统复制来的，而复制就会漂：设计系统改了图标，这边不会
 * 知道。守卫补的就是那件事。
 *
 * 它自己坏掉的方式很具体：`a.equals(b)` 写成别的比较、或者读不到文件时静静跳过 ——
 * 于是两个版本的 logo 在不同产品里各自活着，而 CI 一直是绿的。所以这里连
 * 「读不到源文件」和「读不到副本」都各钉一条：**它们必须红，不能被当成通过**。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { fixtureRepo } from "./fixture-repo.mjs";

const GUARD = "check-brand-assets.mjs";
const COPY = "apps/ui-workspace/public/logo.svg";
const SOURCE = "assets/brands/vx-brand/vxture-logo-icon.svg";
/** 守卫从 apps/ui-workspace 解析这个包，所以假包要装在它的 node_modules 里。 */
const DS = "apps/ui-workspace/node_modules/@vxture/design-system";

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/></svg>\n`;

/**
 * `copy` / `source` 给 `null` 表示那个文件不存在（用来测两条「读不到」的路）；
 * `ds` 给 false 表示连设计系统都没装。
 */
function check({ copy = LOGO, source = LOGO, ds = true } = {}) {
  const repo = fixtureRepo("ruyin-brand-");
  try {
    if (copy !== null) repo.write(COPY, copy);
    if (ds) {
      // 一个最小可解析的包：守卫只 resolve `.` 这一个出口，再往上找 package.json。
      repo.json(`${DS}/package.json`, {
        name: "@vxture/design-system",
        version: "0.0.0",
        main: "index.js",
      });
      repo.write(`${DS}/index.js`, "export {};\n");
      if (source !== null) repo.write(`${DS}/${SOURCE}`, source);
    }
    return repo.run(GUARD);
  } finally {
    repo.clean();
  }
}

void test("逐字节一致就通过", () => {
  const r = check();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /OK - 1 份品牌资源与设计系统逐字节一致/);
});

void test("**差一个字节就要红** —— 品牌资产不是「差不多就行」", () => {
  // 只差一个空格：肉眼看不出来，而它意味着两份 logo 已经不是同一份了。
  const r = check({ copy: LOGO.replace("16v16", "16v16 ") });
  assert.equal(r.code, 1);
  assert.match(r.out, /与设计系统的源文件不一致/);
  assert.match(r.out, /修复：cp /, "要直接给出可以照抄的修复命令");
  assert.match(r.out, /不要改副本去迁就本地/, "**方向要说清**：源头在设计系统那边");
  // 两边的字节数都要报出来 —— 一眼能看出是多了还是少了。
  assert.match(r.out, /源：.*（\d+ 字节）/);
  assert.match(r.out, /副本：\d+ 字节/);
});

void test("副本不见了要红，不能当成「没有副本就没有漂移」", () => {
  const r = check({ copy: null });
  assert.equal(r.code, 1);
  assert.match(r.out, new RegExp(`缺少副本：${COPY}`));
});

void test("**源文件不见了也要红** —— 资源被改名时不许就地改副本", () => {
  const r = check({ source: null });
  assert.equal(r.code, 1);
  assert.match(r.out, /设计系统里找不到源文件/);
  assert.match(r.out, /设计系统根目录：/, "要报出它找到的包根，否则无从排查");
  assert.match(r.out, /不要就地改副本/, "改名时的正确做法是先确认新路径");
});

void test("设计系统没装时**报错退出，不是静静通过**", () => {
  const r = check({ ds: false });
  assert.notEqual(r.code, 0, "解析不到包就该红 —— 否则「没装依赖」看起来像「一致」");
});
