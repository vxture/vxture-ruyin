/**
 * 更新检查（TD-021）。
 *
 * **检查不需要 Electron。** 渠道目录下的一个 `latest.yml`：拉回来、比个版本号，
 * 普通 HTTP 而已。放在守护进程里还有一个理由：界面是守护进程的纯 Web 客户端
 * （无 preload、无 IPC，60 §4.2），让检查走它的 HTTP 面，边界不动。
 *
 * **MVP 阶段不做自动更新（2026-09-02，owner 定）。** 曾经接过 electron-updater
 * 的下载与安装，现已整段拆掉 —— 它在 Windows 上默认校验更新包签名，而 owner 定
 * 了不采购证书（TD-001 转 standing）。于是只剩两条路：关掉那道校验，等于让更新
 * 通道接受任何来自 feed 的包；或者不做自动安装。**选了后者** —— 为一个 MVP 阶段
 * 还不需要的便利去降一条安全底线，不划算。
 *
 * 所以这里回答的是「有没有新版本、去哪儿拿」：`downloadUrl` 由**刚校验过的这份
 * feed** 自己的 `path` 字段拼出，不另立一套下载地址契约，也不猜 URL。用户在浏览
 * 器里下载、自己安装。
 */

import { parse as parseYaml } from "yaml";
import { compareVersions } from "./installer.js";

/**
 * 渠道。**用户那一侧不叫这个名字**（界面上是「抢先体验新功能」，owner 2026-09-18）——
 * 「渠道」是发布侧的词，用户要做的决定只是想不想早点用上新功能。这里保留技术叫法，
 * 因为它要和发布目录、feed 地址逐字对上。
 */
export type UpdateChannel = "stable" | "beta";

export const UPDATE_CHANNELS: UpdateChannel[] = ["stable", "beta"];

/**
 * 下载主机（owner 2026-09-18 定：阿里云 OSS）。
 *
 * 2026-09-18 证书就位后换成了这条好看的域名（此前写的是桶自己的那个长域名）。
 * 两者指向同一个桶，所以已经装出去的那些客户端不会断 —— 它们继续走桶域名，
 * 一样取得到。
 */
export const DOWNLOAD_HOST = "https://oss.ruyin.work";

/**
 * 渠道目录基址：`<主机>/<渠道>`。**渠道就是目录名** —— 检查哪个渠道就下哪个渠道，
 * 两者不可能不一致（`checkForUpdate` 从这个地址的末段反推渠道名显示给用户）。
 * `RUYIN_UPDATE_FEED` 可覆盖（开发与测试用）。
 */
export function feedBaseFor(channel: UpdateChannel): string {
  return `${DOWNLOAD_HOST}/${channel}`;
}

/** 没有偏好时就是正式版（owner 2026-09-18：默认正式版，不主动推测试版）。 */
export const DEFAULT_FEED_BASE = feedBaseFor("stable");

export type UpdateCheck =
  /** 已是最新——**只有真拉到 feed 并比对过才会返回它**。 */
  | {
      status: "current";
      current: string;
      latest: string;
      /**
       * 这个渠道此刻那份安装包的地址。**「已是最新」也要带着它**（2026-09-18）：
       * 关掉「抢先体验新功能」的用户本机装着测试版，而正式版的版本号更低 ——
       * 这一路返回的正是 `current`，而他需要的恰恰是那条地址（手动装一次才能
       * 真的回到正式版）。地址仍然只从刚校验过的那份 feed 拼出，界面不写死。
       */
      downloadUrl?: string;
      channel: string;
      checkedAt: string;
    }
  | {
      status: "available";
      current: string;
      latest: string;
      releasedAt?: string;
      /**
       * 安装包地址，由 feed 自己的 `path` 拼出。**feed 里没有 path 就没有这个
       * 字段** —— 界面据此退回一句「去下载页自己找」，而不是拼一个猜出来的地址
       * 递给用户点。
       */
      downloadUrl?: string;
      /** 这次检查的是哪个渠道。不写明渠道的下载链接是有害的。 */
      channel: string;
      checkedAt: string;
    }
  /**
   * 没查成。**不是「已是最新」**——把查不到说成最新，正是这个功能上一版做的事。
   *
   * 但「没查成」有两种，界面要说的话完全不同，所以这里必须**分开给出**
   * （owner 2026-09-17）：渠道上压根没有发布过任何版本，与这一次问不到。
   * 前者对用户就是「已经是最新版本」——他装的确实是现存最新的那一版，没有
   * 别的可装；后者才是「暂时查不到，稍后再试」。此前两者都落进同一句
   * 「没查到新版本：feed returned 404」，把**运维事实**端到了用户面前。
   *
   * `reason` 留着，但它是**给日志与排障看的**；界面一个字都不渲染，只认
   * `reasonCode`。
   */
  | {
      status: "unreachable";
      current: string;
      /** 界面据此选措辞。诊断细节在 `reason` 里，不进界面。 */
      reasonCode: UpdateUnreachableReason;
      reason: string;
      channel: string;
      checkedAt: string;
    };

/**
 * - `no-release` —— 这个渠道上没有发布过任何版本（feed 不存在，或存在但没写
 *   版本号）。用户手上的就是现存最新的那一版，界面说「已是最新版本」。
 * - `unavailable` —— 这一次没问到：断网、超时、服务端出错、feed 读不动。
 *   下次可能就好了，界面说「暂时无法检查更新」。
 */
export type UpdateUnreachableReason = "no-release" | "unavailable";

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
  /** electron-builder 写进 feed 的安装包文件名。 */
  path?: unknown;
}

export async function checkForUpdate(
  opts: UpdateCheckOptions,
): Promise<UpdateCheck> {
  const at = opts.now?.() ?? new Date().toISOString();
  const base = (opts.feedBase ?? DEFAULT_FEED_BASE).replace(/\/+$/, "");
  // 渠道就是发布目录的末段：检查哪个渠道，就下载哪个渠道，两者不可能不一致。
  //
  // **只看 pathname**。早先这里是 `base.split("/").pop()`，base 若没有路径
  // （测试 feed 常常就是 `http://127.0.0.1:18080`），末段就成了主机名，界面会
  // 一本正经地显示「127.0.0.1:18080 渠道」。**渠道名宁可空着也不能猜** —— 空着
  // 界面就不提渠道，猜一个则是拿一句错话冒充事实。
  let channel = "";
  try {
    const segs = new URL(base).pathname.split("/").filter(Boolean);
    channel = segs[segs.length - 1] ?? "";
  } catch {
    /* base 不是合法 URL：留空，下面的 fetch 自会失败并报 unreachable */
  }
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
      // 404 / 410 = 这个渠道还没发布过东西，不是故障；其余状态码是服务端
      // 这一刻不对劲，下次可能就好了。
      const code =
        res.status === 404 || res.status === 410 ? "no-release" : "unavailable";
      return unreachable(
        opts.currentVersion,
        code,
        `feed returned ${res.status}`,
        at,
        channel,
      );
    }
    body = await res.text();
  } catch (cause) {
    return unreachable(
      opts.currentVersion,
      "unavailable",
      `feed unreachable: ${cause instanceof Error ? cause.message : String(cause)}`,
      at,
      channel,
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
      "unavailable",
      `feed is not readable YAML: ${cause instanceof Error ? cause.message : String(cause)}`,
      at,
      channel,
    );
  }
  const latest = typeof parsed.version === "string" ? parsed.version : "";
  if (!latest) {
    // 读不出版本就是没查成。**沉默地当作最新是这个功能原本的毛病。**
    // 但 feed 在、里面没有版本号，事实就是这个渠道还没发布过东西 ——
    // 对用户与 404 是同一件事。
    return unreachable(
      opts.currentVersion,
      "no-release",
      "feed carries no version",
      at,
      channel,
    );
  }

  const releasedAt =
    typeof parsed.releaseDate === "string" ? parsed.releaseDate : undefined;
  // 下载地址由 feed 自己的 path 拼出，不另立契约。**path 缺了就不给这个字段** ——
  // 宁可让界面退回「去下载页自己找」，也不拼一个猜出来的地址让用户点下去。
  const rel = typeof parsed.path === "string" ? parsed.path.trim() : "";
  const downloadUrl = rel ? `${base}/${encodeURIComponent(rel)}` : undefined;
  if (compareVersions(latest, opts.currentVersion) > 0) {
    return {
      status: "available",
      current: opts.currentVersion,
      latest,
      ...(releasedAt ? { releasedAt } : {}),
      ...(downloadUrl ? { downloadUrl } : {}),
      channel,
      checkedAt: at,
    };
  }
  return {
    status: "current",
    current: opts.currentVersion,
    latest,
    ...(downloadUrl ? { downloadUrl } : {}),
    channel,
    checkedAt: at,
  };
}

function unreachable(
  current: string,
  reasonCode: UpdateUnreachableReason,
  reason: string,
  checkedAt: string,
  channel: string,
): UpdateCheck {
  return {
    status: "unreachable",
    current,
    reasonCode,
    reason,
    channel,
    checkedAt,
  };
}
