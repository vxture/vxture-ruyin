/**
 * 地址 → 分区。这层只有三条规则，但它们都是**别人已经拿着的链接**能不能打开
 * 的问题：旧地址（`privacy`，内容早搬走了）、侧栏里没有的地址（添加连接器）、
 * 以及谁也不认识的地址。三条各钉一次，不靠界面用例顺带覆盖。
 */
import { expect, test } from "vitest";
import { SETTINGS_SECTIONS, resolveSection } from "./settings-sections";

void test("resolveSection: 旧地址 privacy 落到通用设置，而不是白屏", () => {
  expect(resolveSection("privacy")).toBe("general");
});

void test("resolveSection: 添加连接器不在侧栏里，但它是一个能直接打开的地址", () => {
  expect(SETTINGS_SECTIONS.some((s) => s.id === "connectors-add")).toBe(false);
  expect(resolveSection("connectors-add")).toBe("connectors-add");
});

void test("resolveSection: 侧栏里的分区照原样通过；不认识的地址回账户，不是空白", () => {
  for (const s of SETTINGS_SECTIONS) expect(resolveSection(s.id)).toBe(s.id);
  expect(resolveSection("no-such-section")).toBe("account");
  expect(resolveSection("")).toBe("account");
});
