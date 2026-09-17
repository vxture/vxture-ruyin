/**
 * 界面的 i18n 地基（owner 2026-09-17 定：全面改造，当前支持简体中文与英文）。
 *
 * ## 为什么是自己写的，不是 i18next
 *
 * 设计系统那边已经把话说死了：**「DS 零文案，各门户走各自的 i18n」**。所以
 * 需要的只是「键 → 这个语言的那句话」，外加插值与英文复数。这三件事加起来
 * 是下面这一百来行，而一个通用框架要多背进来四十来 KB —— 界面主包已经一兆，
 * 而这个仓发布 npm 包，少一个依赖是长期立场。
 *
 * 真到了要 ICU 全套（性别、序数、嵌套选择）那天再换：`t()` 的调用形状与
 * i18next 故意长得一样（`t(key, vars)`、`key_one` / `key_other` 的复数约定），
 * 换的是这一个文件，不是八百处调用点。
 *
 * ## 中文是源语言
 *
 * `zh-CN` 是**类型的来源**：英文目录声明成 `Catalog`，少一个键、多一个键都在
 * **编译期**就红 —— 不靠任何人记得去跑对账脚本。查不到的键回退到中文原句而不是
 * 回退到键名：界面上看见一句中文，比看见 `settings.general.title` 更像话，也
 * 更容易被发现。
 *
 * ## 不翻译什么
 *
 * - **产品自己的文案**（契约里的任务名、目标、产品名与简介）：那是产品方写的，
 *   我们不改也不猜，它是什么语言就显示什么语言。
 * - **能力分组的关键词表**（`capability-groups.ts`）：那不是文案，是**匹配用的
 *   输入**。把它翻译掉，分组就会漂。
 * - **守护进程的日志与启动横幅**：那是给排障的人看的，不是给用户看的。
 */

import { createContext, useContext } from "react";
import { zhCN } from "./locales/zh-CN";
import { en } from "./locales/en";

export type Locale = "zh-CN" | "en";

/** 界面语言的显示名，用**它自己那门语言**写 —— 选语言的人未必读得懂当前这门。 */
export const LOCALE_NAMES: Record<Locale, string> = {
  "zh-CN": "简体中文",
  en: "English",
};

export const LOCALES = Object.keys(LOCALE_NAMES) as Locale[];

/** 中文目录是源语言，键集合由它定。 */
export type MessageKey = keyof typeof zhCN;
export type Catalog = Record<MessageKey, string>;

/**
 * 带计数的句子在目录里是**两条**（`…_one` / `…_other`），调用点写的却是**去掉
 * 后缀的那个基名** —— 调用的人不该去想这门语言有几种复数形，那是 `t()` 的事。
 * 这里把基名从目录里推出来，于是拼错一个基名照样是编译错误。
 */
export type PluralBase =
  MessageKey extends infer K
    ? K extends `${infer Base}_other`
      ? Base
      : never
    : never;

/** `t()` 收得下的键：普通键，或带计数句子的基名。 */
export type TKey = MessageKey | PluralBase;

const CATALOGS: Record<Locale, Catalog> = { "zh-CN": zhCN, en };

export type Vars = Record<string, string | number>;

/**
 * 英文的复数：`Intl.PluralRules` 是运行时自带的，不需要额外的表。
 * 中文没有复数分支，`other` 永远命中，所以中文两条逐字一样。
 */
function pluralize(locale: Locale, key: string, count: number): string {
  const rule = new Intl.PluralRules(locale).select(count);
  return `${key}_${rule}`;
}

/**
 * 取一句话。
 *
 * - `{name}` 按 `vars` 替换；`#` 替换成 `vars.count`（与 ICU 同一个记号）。
 * - 传了 `count` 时先找 `key_one` / `key_other`，找不到再退回 `key` 本身 ——
 *   所以只有真的分单复数的句子才需要写两条。
 */
export function translate(locale: Locale, key: TKey, vars?: Vars): string {
  const catalog = CATALOGS[locale] ?? zhCN;
  let raw: string | undefined;
  if (vars && typeof vars.count === "number") {
    const pk = pluralize(locale, key, vars.count) as MessageKey;
    raw = catalog[pk] ?? zhCN[pk];
  }
  // 回退链：这门语言的这一句 → 中文原句 → 键名。**中文在前**是有意的：
  // 漏翻一句时屏幕上出现一句中文，比出现一个点号串更像话，也更容易被看见。
  raw ??= catalog[key as MessageKey] ?? zhCN[key as MessageKey] ?? key;
  if (!vars) return raw;
  let out = raw;
  if (typeof vars.count === "number") out = out.split("#").join(String(vars.count));
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{${k}}`).join(String(v));
  }
  return out;
}

/**
 * 读得懂的语言里，哪一门最接近浏览器/系统说的那门。首次启动时用，之后以用户
 * 自己选的为准。`zh` 开头的都算简体中文（`zh-TW` 也落这里——繁体还没有目录，
 * 给一门中文比给英文近）。
 */
export function preferredLocale(tags: readonly string[]): Locale {
  for (const tag of tags) {
    const low = tag.toLowerCase();
    if (low.startsWith("zh")) return "zh-CN";
    if (low.startsWith("en")) return "en";
  }
  return "zh-CN";
}

export const LocaleContext = createContext<Locale>("zh-CN");

/** 组件里取翻译函数。语言变了，用到它的组件跟着重渲染。 */
export type TFn = (key: TKey, vars?: Vars) => string;

export function useT(): TFn {
  const locale = useContext(LocaleContext);
  return (key, vars) => translate(locale, key, vars);
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}
