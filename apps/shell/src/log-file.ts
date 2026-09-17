/**
 * 把守护进程与壳说过的话落到文件（TD-066，RY-001 §07 #37）。
 *
 * ## 这个文件存在的理由
 *
 * 守护进程的 stdout / stderr 此前只转写到壳自己的 stdout / stderr。开发态从终端
 * 起看得见；**安装版双击启动没有控制台，这些输出直接丢掉**。后果很具体：用户
 * 报「登录转圈」「产品打不开」时，我们拿不到任何现场 —— 连启动那句
 * `capability surface: NOT configured` 装机之后都无人可见。
 *
 * ## 落点为什么不是数据目录
 *
 * TD-066 的回收条件建议写的是「数据目录下」，那条建议标着「未经 owner 定」。
 * 这里选 Electron 的 `app.getPath("logs")`，理由有三条，都跟本仓已有的设计撞过：
 *
 * 1. **数据目录可以被搬走**（TD-039）。搬家发生在守护进程开库之前，期间由一个
 *    临时服务顶替。日志跟着数据跑，恰好会在**最需要它的那一刻不在手边** ——
 *    搬家失败正是最难查的一类。
 * 2. 数据目录可能落在移动盘或网络盘上。那盘不在时，解释「为什么起不来」的那份
 *    日志也跟着不在。
 * 3. 日志是**应用**的事，不是**数据**的事。用户导出自己的项目时不该连带拿到一堆
 *    运行日志，反过来删数据也不该把排障记录一起删掉。
 *
 * ## 落盘之前必须脱敏
 *
 * 守护进程启动时把**回环会话令牌**打在 stdout 上（`local-host/src/main.ts` 的
 * `session token:` 那一行）。不脱敏就等于把一份凭据写进一个长期存在的文件 ——
 * 「客户端零秘密」这条硬规矩的直接延伸：秘密不进仓，也不该进日志。
 *
 * 脱敏是**纯函数**，与文件读写分开，因为它是这个模块里唯一会被盯着看的逻辑：
 * 漏掉一种写法，那条秘密就安静地躺在用户的磁盘上，而一切看起来都正常。
 */

/**
 * 一行里可能出现的秘密。
 *
 * 按**键名**匹配而不是按值：值是什么样我们事先不知道（随机十六进制、base64、
 * JWT 都可能），而键名是我们自己写的，数得过来。这样新加一行播报只要沿用同样的
 * 键名，就自动被盖住。
 *
 * 末尾那一段有意写得宽：`[^\s,;）)]+` —— 一直吃到空白或分隔符。令牌里不会有空格，
 * 而把后面的正常文字一起盖掉，比漏掉半截令牌要安全。
 */
const SECRET_KEYS = [
  "session token",
  "token",
  "secret",
  "deviceSecret",
  "rpsid",
  "apiKey",
  "api key",
  "password",
  "authorization",
];

const SECRET_PATTERNS = SECRET_KEYS.map(
  (k) =>
    new RegExp(
      `(${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[:=]\\s*)([^\\s,;）)]+)`,
      "gi",
    ),
);

/** Bearer 凭据：键名不一定在同一行，但这个形状本身就说明了它是什么。 */
const BEARER = /\b(Bearer\s+)([A-Za-z0-9._~+/-]{8,}=*)/gi;

export const REDACTED = "***";

/**
 * 盖掉一行里的秘密。
 *
 * **只盖值，不盖键名**：日志要还能读出「这里本来有一个会话令牌」，否则排障的人
 * 连该问什么都不知道。
 */
export function redact(line: string): string {
  let out = line;
  for (const re of SECRET_PATTERNS) out = out.replace(re, `$1${REDACTED}`);
  return out.replace(BEARER, `$1${REDACTED}`);
}

/** 文件名按天：`ruyin-YYYY-MM-DD.log`。排序即时间序，肉眼也读得懂。 */
export function logFileName(at: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `ruyin-${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}.log`;
}

/** 行首时间戳。用本地时间：读日志的人和出问题的人在同一个时区。 */
export function stamp(at: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(at.getHours())}:${p(at.getMinutes())}:${p(at.getSeconds())}`;
}

/**
 * 一段输出（可能是半行、可能是好几行）格式化成要写进文件的文本。
 *
 * 管道给的是**字节块，不是行**：一次 `data` 可能切在一行中间。所以这里只负责给
 * 完整的行加前缀，**残缺的尾巴留给调用方攒着** —— 在半行上做脱敏，等于给了秘密
 * 一个横跨两次写入就能漏出去的机会。
 */
export function formatChunk(
  chunk: string,
  source: "daemon" | "shell",
  at: Date,
): { text: string; rest: string } {
  const parts = chunk.split("\n");
  const rest = parts.pop() ?? "";
  if (parts.length === 0) return { text: "", rest };
  const prefix = `${stamp(at)} [${source}] `;
  const text = parts.map((l) => prefix + redact(l) + "\n").join("");
  return { text, rest };
}

/**
 * 哪些旧日志该删。
 *
 * 两条一起用，因为它们各管一种失控：**按天数**管「装了一年的机器」，**按总量**
 * 管「一天里疯狂刷屏的一次故障」。只有天数限制时，一次死循环能在一天内写满磁盘；
 * 只有总量限制时，一台每天只开五分钟的机器会留着两年前的日志。
 *
 * 总是保留**最新那一份**，哪怕它自己就超了上限 —— 删掉今天的日志去满足一个配额，
 * 正好删掉了唯一有用的那份。
 */
export function filesToPrune(
  files: Array<{ name: string; bytes: number }>,
  opts: { keepDays: number; maxTotalBytes: number },
): string[] {
  /* 按名字倒序 = 按日期从新到旧（文件名里的日期是零填充的定长格式）。 */
  const sorted = [...files].sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  const doomed: string[] = [];
  let total = 0;
  sorted.forEach((f, i) => {
    if (i === 0) {
      total += f.bytes;
      return;
    }
    if (i >= opts.keepDays || total + f.bytes > opts.maxTotalBytes) {
      doomed.push(f.name);
      return;
    }
    total += f.bytes;
  });
  return doomed;
}
