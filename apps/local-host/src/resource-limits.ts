/**
 * 本机资源上限（TD-046）。
 *
 * ## 为什么这件事在桌面上比在服务器上要紧
 *
 * 一个跑飞的智能体在服务器上是一次运维事故：有人看板告警、重启、扩容。在这里
 * 它是**把用户的电脑拖住** —— 而那台电脑上还开着他的会、他的文档、他的浏览器。
 * 他没有看板，也不会去重启一个他不知道存在的守护进程；他只会看到风扇转起来、
 * 别的程序开始卡，然后怀疑是别的东西坏了。
 *
 * 在此之前这三处一个上限都没有：能同时起多少个工具服务器（每个都是一个完整的
 * Node/Python 进程）、一个服务器一条消息能有多大、一次索引重建往内存里读多少。
 *
 * ## 这些数字是怎么来的：**猜的，而且这里就这么写着**
 *
 * 与 `DEFAULT_MAX_CONCURRENT_TASKS` 那条同一个态度。没有人在真实机器上量过一个
 * MCP 服务器常驻多少内存、一次索引读多少文件会让守护进程变慢 —— 量之前，写一个
 * 「多半够用、且明显在保护人」的数，比写一个装作有依据的数诚实。
 *
 * 三条选数的思路，写下来是为了下一个人改它时知道在权衡什么：
 *
 * - **上限要够高，高到正常使用碰不到它。** 一个天天挡路的保护会被关掉，关掉之后
 *   它保护的就是零。
 * - **超限要说得出是谁超的。** 这是判据里点名的一条。「资源超限」这四个字对用户
 *   等于没说 —— 他要知道是哪个服务器、哪个目录，才能去处理它。
 * - **每一条都能被环境变量改。** 猜出来的数至少要能被改。
 */

/** 同时在跑的工具服务器（MCP 子进程）数。每个都是一个完整的解释器进程。 */
const DEFAULT_MAX_TOOL_SERVERS = 6;

/**
 * 一个服务器一条 JSON-RPC 消息的字节上限。
 *
 * **这是三条里唯一一个真正的内存爆点**，别的两条是「多了慢」，这一条是「一条消息
 * 就能把守护进程撑爆」：stdio 传输按行读，而按行读没有长度限制 —— 一个吐出一行
 * 一 GB 的服务器（或者一个把二进制往 stdout 里写的坏服务器），会让读行的那一侧
 * 把这一 GB 原样攒在内存里，攒完才发现它不是 JSON。
 */
const DEFAULT_MAX_SERVER_LINE_BYTES = 8 * 1024 * 1024;

/** 一次工具调用返回内容的字节上限。超出的截断并**明说截了**。 */
const DEFAULT_MAX_TOOL_RESULT_BYTES = 1024 * 1024;

/** 一次索引重建读进来的条目数。 */
const DEFAULT_MAX_INDEX_ITEMS = 5000;

/** 一次索引重建累计读进来的字节数。条目数与字节数要一起管：一万份便签与十份光盘镜像是两种超法。 */
const DEFAULT_MAX_INDEX_BYTES = 256 * 1024 * 1024;

export interface ResourceLimits {
  maxToolServers: number;
  maxServerLineBytes: number;
  maxToolResultBytes: number;
  maxIndexItems: number;
  maxIndexBytes: number;
}

export const DEFAULT_RESOURCE_LIMITS: ResourceLimits = {
  maxToolServers: DEFAULT_MAX_TOOL_SERVERS,
  maxServerLineBytes: DEFAULT_MAX_SERVER_LINE_BYTES,
  maxToolResultBytes: DEFAULT_MAX_TOOL_RESULT_BYTES,
  maxIndexItems: DEFAULT_MAX_INDEX_ITEMS,
  maxIndexBytes: DEFAULT_MAX_INDEX_BYTES,
};

/** 环境变量名 → 落在哪条上限上，以及它的单位。 */
const OVERRIDES: ReadonlyArray<{
  env: string;
  key: keyof ResourceLimits;
  scale: number;
}> = [
  { env: "RUYIN_MAX_TOOL_SERVERS", key: "maxToolServers", scale: 1 },
  { env: "RUYIN_MAX_SERVER_LINE_KB", key: "maxServerLineBytes", scale: 1024 },
  { env: "RUYIN_MAX_TOOL_RESULT_KB", key: "maxToolResultBytes", scale: 1024 },
  { env: "RUYIN_MAX_INDEX_ITEMS", key: "maxIndexItems", scale: 1 },
  { env: "RUYIN_MAX_INDEX_MB", key: "maxIndexBytes", scale: 1024 * 1024 },
];

export interface ResolvedLimits {
  limits: ResourceLimits;
  /** 被改动过的那几条，给启动日志用。没改过就是空的 —— 不刷屏。 */
  notes: string[];
}

/**
 * 从环境变量取上限。
 *
 * **非正整数一律回落到缺省**，与 `maxConcurrentFromEnv` 同一条理由：0 在这里
 * 会把上限变成「一个都不许」，那是把应用变成砖头，一个手滑不该静默生效。
 * 这里没有「不限」的写法 —— 上下文预算那条有（预算调大是用户自己的成本决定），
 * 而这三条护的是**这台机器**，把它整个拆掉不该只是一个环境变量的事。
 */
export function resourceLimitsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ResolvedLimits {
  const limits: ResourceLimits = { ...DEFAULT_RESOURCE_LIMITS };
  const notes: string[] = [];
  for (const { env: name, key, scale } of OVERRIDES) {
    const raw = env[name]?.trim();
    if (!raw) continue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
      notes.push(`${name}="${raw}" 不是正整数，按缺省处理`);
      continue;
    }
    limits[key] = n * scale;
    notes.push(`${name}=${raw}`);
  }
  return { limits, notes };
}

/**
 * 超限时说给用户听的那句话里，**谁占着名额**。
 *
 * 单独拎出来是因为它容易被写成「资源超限」四个字，而那四个字对用户等于没说：
 * 他要知道是哪几个服务器占着，才能去停掉一个。
 */
export function overLimitMessage(
  what: string,
  limit: number,
  holders: readonly string[],
): string {
  const who = holders.length > 0 ? holders.join("、") : "（没有记录到是谁）";
  return `${what}已达上限 ${limit} —— 正占着的是：${who}。停用其中一个再试，或调高上限。`;
}
