/**
 * 系统目录拒绝清单（TD-039）。
 *
 * **Windows 那几条规则在这里是被真跑的**，即使这套测试在 ubuntu 上跑 —— 环境是
 * 传进去的，不是从 `process` 里摸的。这一点是特意设计的：摸 `process.platform`
 * 的话，占清单绝大部分的 Windows 规则在 CI 里一次都不会被执行，而没被执行的规则
 * 坏了和好了长得一模一样。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { systemDirRefusal, currentHost, type HostEnvironment } from "./system-dirs.js";

const win: HostEnvironment = {
  platform: "win32",
  env: {
    SystemRoot: "C:\\Windows",
    ProgramFiles: "C:\\Program Files",
    "ProgramFiles(x86)": "C:\\Program Files (x86)",
    ProgramData: "C:\\ProgramData",
    APPDATA: "C:\\Users\\amy\\AppData\\Roaming",
    LOCALAPPDATA: "C:\\Users\\amy\\AppData\\Local",
    USERPROFILE: "C:\\Users\\amy",
    SystemDrive: "C:",
  },
  execPath: "C:\\Program Files\\Ruyin\\Ruyin.exe",
};

const posix: HostEnvironment = {
  platform: "linux",
  env: { HOME: "/home/amy" },
  execPath: "/opt/ruyin/ruyin",
};

const refused = (target: string, host = win): string => {
  const reason = systemDirRefusal(target, host);
  assert.ok(reason, `应当拒绝：${target}`);
  return reason;
};
const allowed = (target: string, host = win): void => {
  assert.equal(systemDirRefusal(target, host), undefined, `不该拒绝：${target}`);
};

void test("盘符根与 POSIX 根：一棵 GB 级的树不该直接摊在根上", () => {
  for (const p of ["C:\\", "D:\\", "d:", "E:/"]) refused(p);
  assert.match(refused("D:\\"), /盘符根目录/);
  refused("/", posix);
});

void test("Windows 系统目录：连子目录一起拒 —— 可写恰恰是它最危险的地方", () => {
  // C:\Windows\Temp 可写、空间充足、同卷，探测一路绿灯 —— 这正是清单存在的理由。
  assert.match(refused("C:\\Windows\\Temp\\RuyinData"), /Windows 系统目录/);
  refused("C:\\Windows");
  refused("C:\\Windows\\System32\\config");
});

void test("系统目录跟着环境变量走，不写死盘符 —— 系统装在 D 盘的机器上也要命中", () => {
  const dDrive: HostEnvironment = {
    ...win,
    env: { ...win.env, SystemRoot: "D:\\Windows", SystemDrive: "D:" },
  };
  refused("D:\\Windows\\Temp", dDrive);
  // 而这台机器上 C:\Windows 只是个普通目录，不该被那条规则拒。
  allowed("C:\\Windows\\Temp", dDrive);
});

void test("程序目录与应用自己的安装目录：**卸载会把数据一起删掉**", () => {
  assert.match(refused("C:\\Program Files\\RuyinData"), /安装目录/);
  refused("C:\\Program Files (x86)\\RuyinData");
  // 应用装在别处时，那棵树也要拒 —— 理由与盘符无关。
  const elsewhere: HostEnvironment = { ...win, execPath: "D:\\Apps\\Ruyin\\Ruyin.exe" };
  assert.match(refused("D:\\Apps\\Ruyin\\data", elsewhere), /卸载会把数据一起删掉/);
});

void test("ProgramData：拒绝的理由是**密钥作用域**，不是权限 —— 用户不可能自己想到", () => {
  const reason = refused("C:\\ProgramData\\Ruyin");
  assert.match(reason, /DPAPI/);
  assert.match(reason, /换个用户登录就解不开/);
});

void test("AppData 与用户主目录：只拒它们**本身**，不拒下面的目录", () => {
  refused("C:\\Users\\amy\\AppData\\Local");
  refused("C:\\Users\\amy\\AppData\\Roaming");
  refused("C:\\Users\\amy");
  // 这一条最要紧：**默认数据目录就在 LocalAppData 下面**。整棵树拒掉，等于拒掉
  // 默认位置本身 —— 那会让应用连自己的缺省都不接受。
  allowed("C:\\Users\\amy\\AppData\\Local\\Ruyin\\data");
  allowed("C:\\Users\\amy\\Documents\\RuyinData");
});

void test("按整段比，不按前缀 —— ProgramData2 不在 ProgramData 里面", () => {
  allowed("C:\\ProgramData2\\Ruyin");
  allowed("C:\\Windows2\\Ruyin");
  allowed("C:\\Program Files Extra\\Ruyin");
});

void test("Windows 上不分大小写、斜杠两种都认 —— 用户是粘贴路径进来的", () => {
  refused("c:\\windows\\temp");
  refused("C:/Windows/Temp");
  refused("C:\\PROGRAM FILES\\Ruyin");
  refused("C:\\Windows\\");
});

void test("回收站与系统卷信息：它们在每个盘上都有", () => {
  refused("C:\\$Recycle.Bin\\Ruyin");
  assert.match(refused("C:\\System Volume Information"), /系统卷/);
});

void test("普通目标一律放行 —— 清单不是白名单", () => {
  allowed("D:\\RuyinData");
  allowed("C:\\Users\\amy\\Desktop\\ruyin");
  allowed("E:\\work\\ruyin\\data");
  allowed("/home/amy/ruyin-data", posix);
  allowed("/mnt/data/ruyin", posix);
});

void test("POSIX：系统目录与主目录本身", () => {
  for (const p of ["/usr/local/ruyin", "/etc/ruyin", "/var/ruyin", "/bin"]) refused(p, posix);
  refused("/home/amy", posix);
  allowed("/home/amy/data", posix);
  // 大小写在 POSIX 上是有意义的：/USR 不是 /usr。
  allowed("/USR/ruyin", posix);
});

void test("macOS 独有的那几处", () => {
  const mac: HostEnvironment = {
    platform: "darwin",
    env: { HOME: "/Users/amy" },
    execPath: "/Applications/Ruyin.app/Contents/MacOS/Ruyin",
  };
  refused("/System/ruyin", mac);
  refused("/Library/ruyin", mac);
  refused("/Applications/RuyinData", mac);
  allowed("/Users/amy/RuyinData", mac);
});

void test("环境变量缺了也不炸，只是那几条规则不存在", () => {
  const bare: HostEnvironment = { platform: "win32", env: {}, execPath: "C:\\x\\y.exe" };
  // 没有 SystemRoot 时回落到 C:\Windows —— 一个空环境不该等于「什么都不拦」。
  assert.ok(systemDirRefusal("C:\\Windows\\Temp", bare));
  allowed("D:\\RuyinData", bare);
});

void test("currentHost() 报的是这个进程真实的环境", () => {
  const host = currentHost();
  assert.equal(host.platform, process.platform);
  assert.equal(host.execPath, process.execPath);
});
