/**
 * 语言下拉 —— **登录页也要有**（owner 2026-09-17）。
 *
 * 设置页那个开关进不去：要改语言得先登录，而看不懂界面的人正卡在登录页。
 * 这是本地化里一个经典的顺序问题 —— 语言的入口必须排在任何门槛**前面**。
 *
 * 做成图标 + 下拉（不是一排按钮）：登录页只有一个动作（登录），语言是次要的，
 * 不该在版面上与它抢。放在右上角，与桌面应用的惯例一致。
 *
 * 每门语言用**它自己**写名字（简体中文 / English）—— 要换语言的人多半正读不懂
 * 当前这一门，这也是它不进 i18n 目录的理由（见 `i18n.ts` 的 `LOCALE_NAMES`）。
 */

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Icon,
} from "@vxture/design-system";
import { LOCALE_NAMES, LOCALES, useLocale, useT } from "./i18n";
import { useSetLocale } from "./locale-provider";

export function LanguageMenu({ className }: { className?: string }) {
  const t = useT();
  const locale = useLocale();
  const setLocale = useSetLocale();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={className ? `language-menu ${className}` : "language-menu"}
          aria-label={t("prefs.language")}
          title={t("prefs.language")}
        >
          <Icon name="globe" size="sm" />
          <span className="language-menu-name">{LOCALE_NAMES[locale]}</span>
          <Icon name="caret-up-down" size="xs" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {LOCALES.map((l) => (
          <DropdownMenuItem key={l} onSelect={() => setLocale(l)}>
            {/* 当前那一门打勾；不打勾的话，点开只看得见两个名字，看不见自己在哪 */}
            <Icon name={l === locale ? "check" : "circle-dashed"} size="xs" />
            {LOCALE_NAMES[l]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
