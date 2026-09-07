/**
 * 数据目录的**系统目录拒绝清单**（TD-039 最后一条）。
 *
 * 换数据目录这条路上已经有可写探测、卷检测、空间检测、空目录检测。它们挡住的是
 * 「搬不过去」，挡不住「搬过去了，但那是个不该放的地方」—— 而后者恰恰是**探测
 * 全部通过**的：`C:\Windows\Temp` 可写、空间充足、同卷。一路绿灯，然后数据躺在
 * 一个下次系统清理就会被扫掉的地方。
 *
 * ## 为什么是拒绝而不是警告
 *
 * 这几处的共同点是**用户看不出后果，而后果不可逆**：
 *
 * - 装在 `Program Files` 或应用自己的安装目录里 → **卸载会连数据一起删**。用户
 *   卸载时以为自己在删一个程序。
 * - `C:\Windows` 及其子目录 → 系统更新与清理工具会动那里；而且它需要管理员权限，
 *   拿得到权限的那台机器出的事更大。
 * - `ProgramData`（全机器共用）→ 主密钥是 **DPAPI 按当前用户封装**的，放到一个
 *   机器级目录里，换个 Windows 用户登录就解不开 —— 数据在，但打不开。这不是权限
 *   问题，是密钥作用域问题，用户不可能从「目录可写」推出这一条。
 * - 盘符根目录 → 一棵 GB 级的树直接摊在 `D:\` 下，而且日后再也分不清哪些是它的。
 * - `AppData` / 用户主目录**本身**（不是它下面的某个子目录）→ 同上，且这两处是
 *   别的程序会去枚举的地方。
 *
 * 一句「你确定吗」在这里没有意义：用户点确定时并不知道自己在同意什么。
 *
 * ## 规则从环境里读，不在调用点读
 *
 * 每一条规则都从传进来的 `HostEnvironment` 算，而不是在函数里摸 `process.env` 与
 * `process.platform`。两个理由，第二个才是重点：
 *
 * 1. `%SystemRoot%` 不一定是 `C:\Windows`，`%ProgramFiles%` 也可以被改。写死盘符
 *    的清单在一台把系统装在 D 盘的机器上一条都不命中。
 * 2. **CI 的测试跑在 ubuntu 上。** 摸 `process.platform` 的话，Windows 那几条规则
 *    在 CI 里一次都不会被执行 —— 而没被执行的规则，坏了和好了长得一模一样。这一
 *    批已经数出六次这个模式，这次从一开始就不给它机会。
 */

export interface HostEnvironment {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  /** 应用自己在哪儿跑（`process.execPath`）。它所在的那棵树是卸载会删掉的。 */
  execPath: string;
}

/** 一条规则：这个目录（连同它下面的一切）不能当数据目录，以及为什么。 */
interface Rule {
  path: string;
  reason: string;
  /**
   * `subtree` 连子目录一起拒；`exact` 只拒它本身。
   *
   * 这个区分是必须的：默认数据目录就在 `%LOCALAPPDATA%` **下面**
   * （`%LOCALAPPDATA%\Ruyin\data`）—— 把 LOCALAPPDATA 整棵树拒掉，等于拒掉默认
   * 位置本身。
   */
  scope: "subtree" | "exact";
}

/**
 * 统一成可比较的形式：分隔符归一、去掉结尾的斜杠、Windows 上不分大小写。
 *
 * **不用 `path.resolve`**：在 Linux 上 `resolve("C:\\Windows")` 会得到
 * `/当前目录/C:\Windows` —— 而 Windows 规则的测试正是在 Linux 上跑的。这里要的
 * 是字符串归一，不是「相对当前进程解析」。
 */
function norm(p: string, platform: NodeJS.Platform): string {
  let s = p.replaceAll("\\", "/");
  // 结尾的斜杠去掉，但盘符根（`c:/`）与 POSIX 根（`/`）要留着 —— 去掉之后
  // `c:` 与 `c:/foo` 就没法区分了。
  if (s.length > 1 && s.endsWith("/") && !/^[A-Za-z]:\/$/.test(s)) {
    s = s.replace(/\/+$/, "");
  }
  return platform === "win32" ? s.toLowerCase() : s;
}

/** a 是不是 b 本身或 b 下面的东西。按整段比，`C:/ProgramData2` 不算在 `C:/ProgramData` 里。 */
function within(a: string, b: string): boolean {
  if (a === b) return true;
  const base = b.endsWith("/") ? b : b + "/";
  return a.startsWith(base);
}

/** 盘符根（`C:/`）或 POSIX 根（`/`）。 */
function isRoot(p: string): boolean {
  return p === "/" || /^[A-Za-z]:\/?$/.test(p);
}

/** 应用安装目录：`process.execPath` 的上一级。卸载删的是这棵树。 */
function installDir(execPath: string, platform: NodeJS.Platform): string | undefined {
  const s = norm(execPath, platform);
  const at = s.lastIndexOf("/");
  return at > 0 ? s.slice(0, at) : undefined;
}

function rulesFor(host: HostEnvironment): Rule[] {
  const { platform, env } = host;
  const out: Rule[] = [];
  const add = (raw: string | undefined, reason: string, scope: Rule["scope"] = "subtree"): void => {
    if (raw && raw.trim()) out.push({ path: norm(raw, platform), reason, scope });
  };

  const app = installDir(host.execPath, platform);
  add(app, "这是应用自己的安装目录 —— **卸载会把数据一起删掉**，而卸载时用户以为自己在删一个程序。");

  if (platform === "win32") {
    add(env["SystemRoot"] ?? env["windir"] ?? "C:\\Windows", "这是 Windows 系统目录：系统更新与磁盘清理会动这里。");
    add(env["ProgramFiles"], "这是程序安装目录 —— 装卸程序时会被改动，而且它归管理员管，不是放个人数据的地方。");
    add(env["ProgramFiles(x86)"], "这是程序安装目录 —— 装卸程序时会被改动，而且它归管理员管，不是放个人数据的地方。");
    add(env["ProgramW6432"], "这是程序安装目录 —— 装卸程序时会被改动，而且它归管理员管，不是放个人数据的地方。");
    add(
      env["ProgramData"],
      "这是全机器共用的目录，而主密钥是按**当前 Windows 用户**封装的（DPAPI）—— " +
        "放在这里，换个用户登录就解不开：数据还在，但打不开。",
    );
    // 这两处是系统自己的，放进去会被系统工具当成垃圾或干脆看不见。
    for (const drive of driveLetters(env)) {
      add(`${drive}:/$Recycle.Bin`, "这是回收站，不是一个可以放东西的目录。");
      add(`${drive}:/System Volume Information`, "这是系统卷信息目录，归系统自己管。");
    }
    // AppData 与用户主目录**本身**：默认位置就在 LocalAppData 下面，所以只拒它们自己。
    add(env["APPDATA"], "别直接摊在 AppData 根下 —— 在它下面新建一个自己的目录（例如 %APPDATA%\\RuyinData）。", "exact");
    add(env["LOCALAPPDATA"], "别直接摊在 AppData 根下 —— 在它下面新建一个自己的目录（例如 %LOCALAPPDATA%\\RuyinData）。", "exact");
    add(env["USERPROFILE"], "别直接摊在用户主目录下 —— 在它下面新建一个自己的目录。", "exact");
    return out;
  }

  // macOS / Linux。桌面端目前只发 Windows，但开发与测试在这两个平台上跑，
  // 而一条只在别处生效的保护，等于在这里没有保护。
  for (const p of ["/bin", "/sbin", "/usr", "/etc", "/var", "/boot", "/dev", "/proc", "/sys", "/lib"]) {
    add(p, "这是系统目录，归系统包管理器管。");
  }
  if (platform === "darwin") {
    add("/System", "这是 macOS 系统目录，受系统完整性保护。");
    add("/Library", "这是全机器共用的库目录，不是放个人数据的地方。");
    add("/Applications", "这是应用安装目录 —— 卸载时会被改动。");
  }
  add(env["HOME"], "别直接摊在用户主目录下 —— 在它下面新建一个自己的目录。", "exact");
  return out;
}

/** 环境里出现过的盘符（用来拼回收站等每盘一份的目录）。 */
function driveLetters(env: NodeJS.ProcessEnv): string[] {
  const seen = new Set<string>();
  for (const key of ["SystemDrive", "SystemRoot", "ProgramFiles", "USERPROFILE", "LOCALAPPDATA"]) {
    const m = /^([A-Za-z]):/.exec(env[key] ?? "");
    if (m) seen.add(m[1]!.toLowerCase());
  }
  if (seen.size === 0) seen.add("c");
  return [...seen];
}

/**
 * 这个目标是不是一个不该放数据的系统位置。
 *
 * 返回一句给用户看的话，或者 `undefined` 表示没问题。**话里要说清是哪一类地方、
 * 会出什么事**：一句「不允许的位置」会让用户接着试下一个同样不行的位置。
 */
export function systemDirRefusal(
  target: string,
  host: HostEnvironment,
): string | undefined {
  const dst = norm(target, host.platform);
  if (isRoot(dst)) {
    return "别把数据目录设成盘符根目录 —— 在它下面新建一个目录（例如 D:\\RuyinData）。";
  }
  for (const rule of rulesFor(host)) {
    const hit = rule.scope === "exact" ? dst === rule.path : within(dst, rule.path);
    if (hit) return rule.reason;
  }
  return undefined;
}

/** 当前进程所在的环境。生产调用点用它；测试传自己造的。 */
export function currentHost(): HostEnvironment {
  return { platform: process.platform, env: process.env, execPath: process.execPath };
}
