/**
 * i18n 地基本身的用例。
 *
 * 这一层没有界面，但它决定了**每一句话**长什么样，所以它的边界要逐条钉住：
 * 回退链、复数、插值、以及首次启动挑哪门语言。
 */
import { expect, test, vi } from "vitest";
import { preferredLocale, translate, type MessageKey } from "./i18n";
import { LANGUAGE_KEY, readLocale, writeLocale } from "./locale-provider";

test("translate: 两门语言各取各的句子", () => {
  expect(translate("zh-CN", "update.current")).toBe("已是最新版本");
  expect(translate("en", "update.current")).toBe("You're on the latest version");
});

test("translate: {占位} 按传进来的值替换", () => {
  expect(translate("zh-CN", "about.version", { version: "0.2.0" })).toBe("版本 0.2.0");
  expect(translate("en", "about.version", { version: "0.2.0" })).toBe("Version 0.2.0");
});

/**
 * 英文分单复数、中文不分 —— 这正是「一句话一个键」撑不住的地方，也是这层
 * 存在的理由。`#` 与 ICU 同一个记号，替换成计数本身。
 */
test("translate: 英文按 Intl.PluralRules 分单复数，中文两条一样", () => {
  expect(translate("en", "pending.waited.minutes", { count: 1 })).toBe("waiting 1 minute");
  expect(translate("en", "pending.waited.minutes", { count: 2 })).toBe("waiting 2 minutes");
  expect(translate("zh-CN", "pending.waited.minutes", { count: 1 })).toBe("已等 1 分钟");
  expect(translate("zh-CN", "pending.waited.minutes", { count: 2 })).toBe("已等 2 分钟");
});

/**
 * **漏翻不能变成空白。** 回退链是：这门语言 → 中文原句 → 键名本身。中文排在
 * 键名前面是有意的：屏幕上出现一句中文，比出现一个点号串更像话，也更容易被
 * 人看见并报上来。
 */
test("translate: 查不到的键回退到中文，再回退到键名，绝不返回空", () => {
  const missing = "no.such.key" as MessageKey;
  expect(translate("en", missing)).toBe("no.such.key");
  expect(translate("zh-CN", missing)).toBe("no.such.key");
  // 不认识的语言落回中文目录，而不是空白。
  expect(translate("de" as "en", "update.current")).toBe("已是最新版本");
});

test("preferredLocale: zh 开头算中文，en 开头算英文，都不认就中文", () => {
  expect(preferredLocale(["zh-CN", "en-US"])).toBe("zh-CN");
  // 繁体也落中文：给一门中文比给英文近（还没有繁体目录）。
  expect(preferredLocale(["zh-TW"])).toBe("zh-CN");
  expect(preferredLocale(["en-GB"])).toBe("en");
  expect(preferredLocale(["fr-FR", "en-US"])).toBe("en");
  expect(preferredLocale(["fr-FR"])).toBe("zh-CN");
  expect(preferredLocale([])).toBe("zh-CN");
});

test("readLocale: 存过就用存的；存了个不认识的值当作没存过", () => {
  localStorage.setItem(LANGUAGE_KEY, "en");
  expect(readLocale()).toBe("en");
  localStorage.setItem(LANGUAGE_KEY, "klingon");
  // 测试环境声明的是简体中文（vitest.setup.ts），所以落回它。
  expect(readLocale()).toBe("zh-CN");
  localStorage.clear();
  expect(readLocale()).toBe("zh-CN");
});

/** 私密窗口一类：读写都可能抛。**抛了也要能用**，只是记不住。 */
test("readLocale / writeLocale: localStorage 抛错时不崩，落回按系统猜", () => {
  const realGet = Storage.prototype.getItem;
  const realSet = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (
    this: Storage,
    key: string,
  ) {
    if (key === LANGUAGE_KEY) throw new DOMException("denied", "SecurityError");
    return realGet.call(this, key);
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
    this: Storage,
    key: string,
    value: string,
  ) {
    if (key === LANGUAGE_KEY) throw new DOMException("denied", "SecurityError");
    return realSet.call(this, key, value);
  });
  expect(readLocale()).toBe("zh-CN");
  expect(() => writeLocale("en")).not.toThrow();
  vi.restoreAllMocks();
});
