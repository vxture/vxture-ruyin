/**
 * 界面语言的持有者。
 *
 * 语言是**本机偏好**，与账号无关 —— 同一个账号在公司那台用英文、家里那台用
 * 中文，都是合理的。所以它存在 `localStorage`，与主题、密度同一档。
 *
 * 首次启动没有存过的时候，按系统/浏览器说的那门语言挑一个读得懂的；读不懂的
 * 落到中文。**不做「跟随系统」这一档**：语言不是主题，跟着系统变会让人在一次
 * 系统更新之后突然看到一屏英文，而他从没要求过。选过一次就固定下来。
 *
 * 切换**当场生效**（整棵树跟着 context 重渲染），不要求重启 —— 桌面应用让人
 * 「重启以应用语言」是上个时代的事。
 *
 * 守护进程与壳那一侧还没有接（壳的原生对话框、系统通知仍按 Electron 自己的
 * 语言走）。那要一个两个进程都读得到的设置，是下一步；这里先把界面这一侧做完，
 * 并且**写入口只留一处**（`writeLocale`），将来在那里加一行写回守护进程即可。
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { LocaleContext, LOCALES, preferredLocale, type Locale } from "./i18n";

export const LANGUAGE_KEY = "ruyin-language";

function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as string[]).includes(v);
}

/** 读偏好；没存过 / 存了个不认识的值 / 存储不可用，都落到「按系统猜一个」。 */
export function readLocale(): Locale {
  try {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch {
    /* 私密窗口一类读不到 —— 猜一个就是了，不是错误。 */
  }
  return preferredLocale(navigator.languages ?? [navigator.language]);
}

/** **只有这一处**写语言偏好。 */
export function writeLocale(locale: Locale): void {
  try {
    localStorage.setItem(LANGUAGE_KEY, locale);
  } catch {
    /* 存不进去就不存：这一次会话仍然是切过的，只是下次启动记不住。 */
  }
}

/**
 * 读与写分两个 context：**读的人遍布全树，写的人只有设置页那一个下拉。**
 * 合成一个对象放进同一个 context 的话，任何拿得到语言的组件都顺手拿到了改
 * 语言的权力 —— 一个只需要读的组件不该有那个能力。
 */
const SetLocaleContext = createContext<(next: Locale) => void>(() => {});

export function useSetLocale(): (next: Locale) => void {
  return useContext(SetLocaleContext);
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readLocale);

  // `<html lang>` 要跟着走：屏幕阅读器按它选发音，浏览器按它断行与选字体。
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    writeLocale(next);
    setLocaleState(next);
  }, []);

  return (
    <LocaleContext.Provider value={locale}>
      <SetLocaleContext.Provider value={setLocale}>{children}</SetLocaleContext.Provider>
    </LocaleContext.Provider>
  );
}
