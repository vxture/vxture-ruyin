/**
 * 「等搬家搬完」要等多久（TD-039）。
 *
 * 这个文件存在的理由是一次真实的缺陷：搬家发生在守护进程启动、开库之前，而壳
 * 等 `/health` 的上限原来是**固定 15 秒**。实测 136 MB / 4001 个文件的跨卷复制
 * + 逐文件核对要 11.7 秒 —— 也就是说超过约 180 MB 就会超时，而超时那条路是
 * `app.exit(1)`：**连窗口都没开过**。更糟的是下一次启动：目标里留着 `copying`
 * 标记，那份半成品被丢弃重来，又一次超时 —— 数据越多越必然，应用再也起不来。
 *
 * 所以时限不能是一个常数，它必须**跟着要搬的字节数走**。字节数在排队那一刻就
 * 已经算过（守护进程的 `checkTarget`），随指针一起记下来，壳读它。
 */

/** 按这个速率估时。故意取得保守 —— 机械盘、网络盘、杀毒软件扫描都比它慢。 */
const BYTES_PER_MS = 2 * 1024; // 约 2 MB/s

/** 无论数据多小都至少等这么久：进程起来、开库、原生绑定自检都要时间。 */
const FLOOR_MS = 60_000;

/** 上限。到这儿还没起来，多等也不会更好，而用户需要一个说法。 */
const CEILING_MS = 60 * 60_000; // 1 小时

/**
 * 搬 `bytes` 个字节，最多等多久。
 *
 * 拿不到字节数（老版本写的指针、或者刚好没记上）时按上限等 —— **宁可多等，也
 * 不要在搬家半途把进程杀掉**：那会留下一份要被丢弃的副本，下一次从头再来。
 */
export function moveWaitMs(bytes?: number): number {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return CEILING_MS;
  return Math.min(CEILING_MS, Math.max(FLOOR_MS, Math.ceil(bytes / BYTES_PER_MS)));
}

/** 「约 1.2 GB」这种话，给搬家那一屏用。 */
export function humanBytes(bytes?: number): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
