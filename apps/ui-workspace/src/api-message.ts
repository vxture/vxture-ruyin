/**
 * 守护进程的错误 → 界面说什么。
 *
 * ## 为什么需要这一层
 *
 * 本地 API 的错误封套是 `{ code, message, retryable }`，而 `message` 同时服务
 * 两类读者：**排障的人**要看到「feed unreachable: ECONNREFUSED」，**最终用户**
 * 要看到「暂时无法检查更新」。一句话满足不了两边。
 *
 * 做 i18n 时这件事再也绕不过去：守护进程只有一份中文，英文界面照样会露出中文。
 * 所以由界面按 `code` 决定说什么，`message` 退回诊断。
 *
 * ## 什么时候仍然用守护进程的原话
 *
 * **它点名了具体的东西时。** 比如未授权的路径（`FILE_NOT_GRANTED` 说清了是哪个
 * 文件夹）、权限不足（`POLICY_DENIED` 点名了缺哪个权限码）—— 那些话比我们这里
 * 能写的任何一句都具体，翻译掉反而变笼统。这一层只接管**通用**的那几类：
 * 「这套装配没接某个子系统」「登录状态失效了」这种。
 *
 * 认不出的 `code` 一律回退到 `message`：漏一条时屏幕上出现一句中文，比出现一个
 * 点号串强，也更容易被人看见并报上来。
 */

import { ApiError } from "./api";
import type { MessageKey, TFn } from "./i18n";

/**
 * 接管翻译的那些码。**只放通用的** —— 点名了具体对象的码不在这里，见文件头。
 */
const CODE_KEY: Record<string, MessageKey> = {
  CAPABILITY_CATALOG_NOT_CONFIGURED: "err.notConfigured.catalog",
  CAPABILITY_ROUTING_NOT_CONFIGURED: "err.notConfigured.routing",
  COMPONENTS_NOT_AVAILABLE: "err.notConfigured.components",
  CONNECTORS_NOT_AVAILABLE: "err.notConfigured.connectors",
  HARDWARE_INFO_NOT_CONFIGURED: "err.notConfigured.hardware",
  PRIVATE_MODEL_NOT_CONFIGURED: "err.notConfigured.privateModel",
  SKILLS_NOT_AVAILABLE: "err.notConfigured.skills",
  TOOLS_NOT_AVAILABLE: "err.notConfigured.tools",
  EVENTS_UNAVAILABLE: "err.notConfigured.events",
  PLATFORM_SESSION_NOT_CONFIGURED: "err.notConfigured.platform",
  LANGUAGE_NOT_CONFIGURED: "err.notConfigured.language",
  AUTH_REQUIRED: "err.authRequired",
  UNAUTHORIZED: "err.authRequired",
  MIGRATING: "err.migrating",
};

/**
 * 一句可以直接摆到界面上的话。
 *
 * 不是 `ApiError`（网络断了、守护进程没起来）时也要有话说：那一类用户能做的
 * 只有一件事 —— 过会儿再来，所以就说这一件，不端出 `fetch failed` 那种原话。
 */
export function describeError(t: TFn, e: unknown): string {
  if (!(e instanceof ApiError)) return t("err.unreachable");
  const key = CODE_KEY[e.body.code ?? ""];
  return key ? t(key) : (e.message ?? t("err.unreachable"));
}
