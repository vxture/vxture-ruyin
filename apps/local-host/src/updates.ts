/**
 * 更新检查（TD-021 的第一半）。
 *
 * **检查不需要 Electron。** electron-updater 的 generic provider feed 就是渠道
 * 目录下的一个 `latest.yml`：拉回来、比个版本号，普通 HTTP 而已。需要
 * electron-updater 的是**下载与安装**——那一半在壳里，且另有前置（见文末）。
 *
 * 放在守护进程里还有一个理由：界面是守护进程的纯 Web 客户端（无 preload、无
 * IPC，60 §4.2）。让检查走守护进程的 HTTP 面，界面照常读它，边界不动。
 *
 * **这里只回答「有没有新版本」，绝不下载、绝不安装。** 自动检查节奏、是否自动
 * 下载、渠道切换——都是策略，未定；未定的策略不该由实现替人默认掉。
 */

import { parse as parseYaml } from "yaml";
import { compareVersions } from "./installer.js";

/** 渠道目录基址。dl 主机未落地（liaison L2）前，可用它指向测试 feed。 */
export const DEFAULT_FEED_BASE = "https://dl.vxture.com/ruyin/stable";

export type UpdateCheck =
  /** 已是最新——**只有真拉到 feed 并比对过才会返回它**。 */
  | { status: "current"; current: string; latest: string; checkedAt: string }
  | {
      status: "available";
      current: string;
      latest: string;
      releasedAt?: string;
      checkedAt: string;
    }
  /**
   * 没查成。**不是「已是最新」**——把查不到说成最新，正是这个功能上一版做的事。
   */
  | { status: "unreachable"; current: string; reason: string; checkedAt: string };

export interface UpdateCheckOptions {
  currentVersion: string;
  feedBase?: string;
  fetchImpl?: typeof fetch;
  now?: () => string;
  timeoutMs?: number;
}

interface LatestYml {
  version?: unknown;
  releaseDate?: unknown;
}

export async function checkForUpdate(
  opts: UpdateCheckOptions,
): Promise<UpdateCheck> {
  const at = opts.now?.() ?? new Date().toISOString();
  const base = (opts.feedBase ?? DEFAULT_FEED_BASE).replace(/\/+$/, "");
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);

  let body: string;
  try {
    const res = await doFetch(`${base}/latest.yml`, {
      signal: controller.signal,
      headers: { accept: "text/yaml, application/yaml, text/plain" },
    });
    if (!res.ok) {
      return unreachable(opts.currentVersion, `feed returned ${res.status}`, at);
    }
    body = await res.text();
  } catch (cause) {
    return unreachable(
      opts.currentVersion,
      `feed unreachable: ${cause instanceof Error ? cause.message : String(cause)}`,
      at,
    );
  } finally {
    clearTimeout(timer);
  }

  let parsed: LatestYml;
  try {
    parsed = (parseYaml(body) ?? {}) as LatestYml;
  } catch (cause) {
    return unreachable(
      opts.currentVersion,
      `feed is not readable YAML: ${cause instanceof Error ? cause.message : String(cause)}`,
      at,
    );
  }
  const latest = typeof parsed.version === "string" ? parsed.version : "";
  if (!latest) {
    // 读不出版本就是没查成。**沉默地当作最新是这个功能原本的毛病。**
    return unreachable(opts.currentVersion, "feed carries no version", at);
  }

  const releasedAt =
    typeof parsed.releaseDate === "string" ? parsed.releaseDate : undefined;
  if (compareVersions(latest, opts.currentVersion) > 0) {
    return {
      status: "available",
      current: opts.currentVersion,
      latest,
      ...(releasedAt ? { releasedAt } : {}),
      checkedAt: at,
    };
  }
  return {
    status: "current",
    current: opts.currentVersion,
    latest,
    checkedAt: at,
  };
}

function unreachable(
  current: string,
  reason: string,
  checkedAt: string,
): UpdateCheck {
  return { status: "unreachable", current, reason, checkedAt };
}
