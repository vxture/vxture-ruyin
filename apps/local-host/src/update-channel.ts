/**
 * 更新渠道的偏好（owner 2026-09-18；RY-001 §07 任务 49）。
 *
 * ## 用户那一侧不叫「渠道」
 *
 * 界面上是**偏好设置里的一个开关：「抢先体验新功能」**。「渠道」是发布侧的词，
 * 而用户要做的决定只有一个 —— 想不想早点用上新功能，代价是更可能遇到问题。
 * 这个文件里保留技术叫法，因为它要和发布目录、feed 地址逐字对上。
 *
 * ## 为什么落在数据目录而不是 location.json
 *
 * 语言在 `location.json` 里，理由很硬：**壳**要用它（原生对话框、搬家那一屏都在
 * 守护进程起来之前）。渠道没有这个需要 —— 只有守护进程查更新时用得上，所以它
 * 和别的策略文件放一起（`capabilities/routing.json` 的同一个路子）：
 * `<dataDir>/updates.json`，只有偏好，没有秘密。
 *
 * ## 认不出来的值一律当默认，而不是拒绝
 *
 * 这份文件是用户的机器上的一个 JSON，可能被手改坏、可能是更早或更晚版本写的。
 * 读不出来就按 `stable` 走：**默认正式版**是这条设计里最不会出错的一边，而一个
 * 因为偏好文件坏了就查不了更新的客户端，坏得毫无必要。写入那一侧照旧严格 ——
 * 接口只收认识的值（见 server.ts）。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { UPDATE_CHANNELS, type UpdateChannel } from "./updates.js";

export const DEFAULT_CHANNEL: UpdateChannel = "stable";

export function updatePrefsFile(dataDir: string): string {
  return join(dataDir, "updates.json");
}

export function isUpdateChannel(value: unknown): value is UpdateChannel {
  return typeof value === "string" && (UPDATE_CHANNELS as string[]).includes(value);
}

/** 这台机器上此刻的偏好。读不出来 = 正式版。 */
export function readUpdateChannel(dataDir: string): UpdateChannel {
  try {
    const parsed = JSON.parse(readFileSync(updatePrefsFile(dataDir), "utf8")) as { channel?: unknown };
    return isUpdateChannel(parsed.channel) ? parsed.channel : DEFAULT_CHANNEL;
  } catch {
    return DEFAULT_CHANNEL;
  }
}

/**
 * 写下偏好。**只写认识的值** —— 调用方（接口层）已经校验过，这里再挡一次是因为
 * 一个写坏的偏好文件会让这台机器从此查不到更新，而那种坏法很难被想到。
 */
export function writeUpdateChannel(dataDir: string, channel: UpdateChannel): UpdateChannel {
  if (!isUpdateChannel(channel)) return readUpdateChannel(dataDir);
  const file = updatePrefsFile(dataDir);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ channel }, null, 2)}\n`);
  return channel;
}

/** 有没有写过偏好（界面用它区分「默认就是正式版」与「用户选过正式版」）。 */
export function hasUpdateChannelPreference(dataDir: string): boolean {
  return existsSync(updatePrefsFile(dataDir));
}
