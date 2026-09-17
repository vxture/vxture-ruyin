/**
 * 平台基址的**唯一**来源（0b，RY-100 A12 / RY-103 §02）。
 *
 * ## 为什么要有这个文件
 *
 * 界面上通往平台的每一条深链（去订阅、用户中心、配额用量、隐私政策……）都要先知道
 * 两个基址，而它们**长得很像却不是同一个主机**：
 *
 *   consoleBase      官网，例如 https://vxture.com          —— 法律条款、市场页
 *   consoleAppBase   console-bff 本体，例如 https://console.vxture.com —— 订阅、用户中心、配额
 *
 * 权威值由守护进程在 `/auth/session` 里给出，它自己读的是 `RUYIN_CONSOLE_BASE` /
 * `RUYIN_CONSOLE_API_BASE`（**都可配置**，生产值只是缺省）。界面要做的只是转述。
 *
 * 在此之前，两个缺省值被抄在六个文件的七处。**这种抄写已经出过两次错**：「用户中心」
 * 与「配额用量」都曾误拼到官网上（owner 2026-09-16 现场纠），因为在调用点上
 * `consoleBase` 是手边最顺的那个名字。一处写错不会报错，只会安静地把人送到一个
 * 404 —— 而且只在生产上才看得见。收成一处之后，要错也只错一次，而那一次有注释拦着。
 *
 * ## 缺省值仍然是生产地址，这是有意的
 *
 * 桌面应用装到用户机器上就得能用，不能要求先配环境变量。所以缺省 = 生产。
 *
 * ## 已知限制（RY-103 阶段 3 收敛）
 *
 * 私有部署把守护进程指向自己的控制面之后，**会话读回来之前**的那一小段时间里，
 * 这里给出的仍是 vxture.com。今天影响面很小（那一段只有几百毫秒，且首屏不渲染
 * 深链），但它是真实的不一致：正确的做法是基址随实例配置一起下发、开机即知，
 * 而不是等一次会话读。目标态里控制面基址属于实例注册时就确定的东西
 * （RY-100 A12），那时这两个缺省值可以整个删掉。
 */

import type { SessionInfo } from "./api";

/** 官网基址的生产缺省。守护进程侧同名缺省在 `platform.ts`。 */
export const DEFAULT_CONSOLE_BASE = "https://vxture.com";
/** console-bff 本体的生产缺省。守护进程侧同名缺省在 `main.ts`。 */
export const DEFAULT_CONSOLE_APP_BASE = "https://console.vxture.com";

/**
 * 官网基址：法律条款、市场页、应用中心。
 *
 * **不要拿它拼订阅 / 用户中心 / 配额** —— 那三条在 console-bff 上，用
 * {@link consoleAppBaseOf}。
 */
export function consoleBaseOf(session?: Pick<SessionInfo, "consoleBase"> | null): string {
  return session?.consoleBase || DEFAULT_CONSOLE_BASE;
}

/**
 * console-bff 基址：订阅、用户中心、配额用量、个人资料。
 *
 * 未登录的会话可能没有这个字段（守护进程还没接通 `PlatformSession`），此时落到
 * 生产缺省 —— 与守护进程侧的缺省一致，不是另编一个。
 */
export function consoleAppBaseOf(
  session?: Pick<SessionInfo, "consoleAppBase"> | null,
): string {
  return session?.consoleAppBase || DEFAULT_CONSOLE_APP_BASE;
}
