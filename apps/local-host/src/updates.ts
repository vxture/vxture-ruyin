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

/**
 * 安装闸门与意图（TD-021 策略 1、2，owner 定 2026-09-01）。
 *
 * **策略 1：有任务在跑就不装。** 安装要重启，重启会打断正在跑的回合——虽然
 * 恢复得回来，但人在回路的确认会被扰，而用户并没有要求这件事发生。
 *
 * **策略 2：操作权归用户。** 运行时只做两件事——告诉用户有新版本、在他点了之后
 * 记下这个意图。**绝不自行下载、绝不自行安装、绝不自行挑时机。**
 *
 * 闸门放在守护进程，因为**只有它知道有没有任务在跑**。壳在真正安装前会再问一次
 * ——用户点下去到壳开始装之间任务可能刚起来，只在按钮上禁用是不够的。
 */
export interface InstallGate {
  installable: boolean;
  /** 不可安装时的人可读原因；可安装时缺省。 */
  reason?: string;
  runningTasks: number;
}

export function installGate(runningTasks: number): InstallGate {
  if (runningTasks > 0) {
    return {
      installable: false,
      reason: `有 ${runningTasks} 个任务正在运行；安装需要重启，会打断它们`,
      runningTasks,
    };
  }
  return { installable: true, runningTasks };
}

/** 用户已请求安装的版本，或 null。壳轮询它。 */
export interface InstallIntent {
  version: string;
  requestedAt: string;
}

/**
 * 用户的安装意图，只存在内存里。
 *
 * 不落盘是刻意的：**这是一次点击，不是一条设置。** 守护进程重启后意图就没了，
 * 而那正对——用户是在看着「有新版本」那一刻点的，不是在授权一条长期规则。
 */
export class InstallIntentBox {
  private intent: InstallIntent | null = null;

  request(version: string, at: string): InstallIntent {
    this.intent = { version, requestedAt: at };
    return this.intent;
  }

  peek(): InstallIntent | null {
    return this.intent;
  }

  /** 壳取走它去执行；取走即清，避免重启后重复触发。 */
  take(): InstallIntent | null {
    const held = this.intent;
    this.intent = null;
    return held;
  }

  clear(): void {
    this.intent = null;
  }
}
