/**
 * 路径包含判断（path-guard.ts）。
 *
 * 最要紧的是第二条：**名字以根目录名开头的兄弟目录**。旧写法
 * `full.startsWith(root)` 在那里放行，而产品界面服务器按产品 id 各放一个兄弟目录
 * —— `bidproposal` 与 `bidproposal2` —— 正是会被它咬到的形状。
 */

import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";
import { isInside } from "./path-guard.js";

const ROOT = resolve("C:/x/product-ui/bidproposal");

void test("isInside: 根自己、根下的文件、根下的深层目录 —— 都算在里面", () => {
  assert.equal(isInside(ROOT, ROOT), true);
  assert.equal(isInside(ROOT, join(ROOT, "index.html")), true);
  assert.equal(isInside(ROOT, join(ROOT, "assets", "deep", "a.js")), true);
});

/**
 * **这一条是这个文件存在的理由。** 旧写法 `startsWith` 在这两个样本上都放行 ——
 * 一个产品能读到另一个产品的界面包，而读的时候一切都显得正常。
 */
void test("isInside: 名字以根目录名开头的兄弟目录不算在里面（旧写法在这里放行）", () => {
  assert.equal(isInside(ROOT, resolve(ROOT, "../bidproposal2/secret.js")), false);
  assert.equal(isInside(ROOT, resolve(ROOT, "../bidproposal-evil/x")), false);
});

void test("isInside: 往上走出去的、别的盘符的 —— 都不算", () => {
  assert.equal(isInside(ROOT, resolve(ROOT, "../other/x")), false);
  assert.equal(isInside(ROOT, resolve(ROOT, "../../../../etc/passwd")), false);
  if (process.platform === "win32") {
    // 跨盘符时 relative 直接给回绝对路径。
    assert.equal(isInside(ROOT, "D:/elsewhere/x"), false);
  }
});

/** 一个真叫 `..foo` 的目录名是合法的 —— 只看第一段是不是恰好 `..`，别误伤它。 */
void test("isInside: 名字以两个点开头的普通目录不被误伤", () => {
  assert.equal(isInside(ROOT, join(ROOT, "..hidden", "a.js")), true);
});
