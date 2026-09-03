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
 * 渠道目录基址。**过渡（2026-09-03）**：dl 主机未落地（liaison L2）前，发布流水线
 * 把每个渠道的最新构建放在 GitHub 的滚动 release 上（tag 就叫 stable / beta），
 * 于是 `<base>/latest.yml` 与 `<base>/<安装包>` 有固定地址；末段仍是渠道名，
 * 界面显示的渠道不用另猜。L2 落地后改回 dl 主机的渠道目录（TD-038）。
 * `RUYIN_UPDATE_FEED` 可覆盖。
 */
export const DEFAULT_FEED_BASE =
  "https://github.com/vxture/vxture-ruyin/releases/download/stable";

export type UpdateCheck =
  /** 已是最新——**只有真拉到 feed 并比对过才会返回它**。 */
  | {
      status: "current";
      current: string;
      latest: string;
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
   */
  | {
      status: "unreachable";
      current: string;
      reason: string;
      channel: string;
      checkedAt: string;
    };

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
      return unreachable(opts.currentVersion, `feed returned ${res.status}`, at, channel);
    }
    body = await res.text();
  } catch (cause) {
    return unreachable(
      opts.currentVersion,
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
      `feed is not readable YAML: ${cause instanceof Error ? cause.message : String(cause)}`,
      at,
      channel,
    );
  }
  const latest = typeof parsed.version === "string" ? parsed.version : "";
  if (!latest) {
    // 读不出版本就是没查成。**沉默地当作最新是这个功能原本的毛病。**
    return unreachable(opts.currentVersion, "feed carries no version", at, channel);
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
    channel,
    checkedAt: at,
  };
}

function unreachable(
  current: string,
  reason: string,
  checkedAt: string,
  channel: string,
): UpdateCheck {
  return { status: "unreachable", current, reason, channel, checkedAt };
}
