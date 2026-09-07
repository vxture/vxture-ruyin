/**
 * 云同步目录拒绝（TD-051）。
 *
 * 与 TD-039 同一条设计：环境与文件系统都是**传进来的**，不从 `process` 里摸 ——
 * 否则占清单绝大部分的 Windows 规则在 ubuntu 的 CI 上一次都不会被执行。
 *
 * 三道认法各测一遍，外加两件容易被想当然的事：**整段比而不是子串比**（一个叫
 * `DropboxNotes` 的普通文件夹不该被拒），以及**拒绝的话要点名是哪个服务**（一句
 * 「不能用云同步目录」会让用户去猜是哪个文件夹出的问题）。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { cloudSyncRefusal, realProbe, type CloudProbe } from "./cloud-sync.js";
import type { HostEnvironment } from "./system-dirs.js";

/** 什么都不在、什么都读不到 —— 只留名字那一道。 */
const noProbe: CloudProbe = { exists: () => false, readText: () => undefined };

const win = (env: NodeJS.ProcessEnv = {}): HostEnvironment => ({
  platform: "win32",
  env: { USERPROFILE: "C:\\Users\\amy", APPDATA: "C:\\Users\\amy\\AppData\\Roaming", ...env },
  execPath: "C:\\Program Files\\Ruyin\\Ruyin.exe",
});

const refused = (target: string, host = win(), probe = noProbe): string => {
  const reason = cloudSyncRefusal(target, host, probe);
  assert.ok(reason, `应当拒绝：${target}`);
  return reason;
};
const allowed = (target: string, host = win(), probe = noProbe): void => {
  assert.equal(cloudSyncRefusal(target, host, probe), undefined, `不该拒绝：${target}`);
};

void test("① 客户端自己声明的根目录：OneDrive 设了环境变量，整棵树都拒", () => {
  const host = win({ OneDrive: "C:\\Users\\amy\\OneDrive - 某公司" });
  const reason = refused("C:\\Users\\amy\\OneDrive - 某公司\\RuyinData", host);
  assert.match(reason, /OneDrive/);
  assert.match(reason, /客户端自己声明的同步目录/);
  // **改过默认位置也认得出来** —— 这正是读环境变量而不是认名字的理由。
  const moved = win({ OneDriveCommercial: "D:\\云\\公司盘" });
  refused("D:\\云\\公司盘\\ruyin", moved);
  allowed("D:\\云\\别的\\ruyin", moved);
});

void test("① Dropbox 把真实路径写在 info.json 里 —— 读它，而不是猜文件夹叫什么", () => {
  const probe: CloudProbe = {
    exists: () => false,
    readText: (p) =>
      p.replaceAll("\\", "/").endsWith("Dropbox/info.json")
        ? JSON.stringify({ personal: { path: "E:\\我的资料" } })
        : undefined,
  };
  // 这个文件夹叫「我的资料」，名字那一道一个字都碰不到它。
  const reason = refused("E:\\我的资料\\ruyin", win(), probe);
  assert.match(reason, /Dropbox/);
  allowed("E:\\别的资料\\ruyin", win(), probe);
});

void test("① info.json 坏了不炸，退回后面两道", () => {
  const probe: CloudProbe = { exists: () => false, readText: () => "{ 不是 JSON" };
  allowed("D:\\RuyinData", win(), probe);
  refused("D:\\Dropbox\\ruyin", win(), probe); // 名字那一道仍然管用
});

void test("② 标记：认的是「这棵树在被同步」，所以改了名也命中", () => {
  const probe: CloudProbe = {
    exists: (p) => p.replaceAll("\\", "/") === "D:/工作/.dropbox",
    readText: () => undefined,
  };
  const reason = refused("D:\\工作\\项目\\ruyin", win(), probe);
  assert.match(reason, /Dropbox/);
  assert.match(reason, /\.dropbox/, "要说清是在哪儿发现的");
  allowed("D:\\别的\\ruyin", win(), probe);
});

void test("② 各家的标记都认", () => {
  for (const [entry, service] of [
    [".stfolder", /Syncthing/],
    [".seafile-data", /Seafile/],
    [".nutstore", /坚果云/],
  ] as const) {
    const probe: CloudProbe = {
      exists: (p) => p.replaceAll("\\", "/") === `D:/sync/${entry}`,
      readText: () => undefined,
    };
    assert.match(refused("D:\\sync\\ruyin", win(), probe), service);
  }
});

void test("③ 名字：常见的几家都拒，且**按整段比不按子串**", () => {
  assert.match(refused("C:\\Users\\amy\\OneDrive\\ruyin"), /OneDrive/);
  assert.match(refused("C:\\Users\\amy\\Dropbox\\ruyin"), /Dropbox/);
  assert.match(refused("C:\\Users\\amy\\Google Drive\\ruyin"), /Google/);
  assert.match(refused("C:\\Users\\amy\\坚果云\\ruyin"), /坚果云/);
  assert.match(refused("D:\\百度网盘\\ruyin"), /百度网盘/);
  assert.match(refused("D:\\阿里云盘\\x"), /阿里云盘/);

  // 这几个只是名字里带了那几个字，不是同步目录 —— 拒了就是误伤。
  allowed("C:\\Users\\amy\\DropboxNotes\\ruyin");
  allowed("D:\\OneDriveBackupScripts\\ruyin");
  allowed("D:\\我的坚果云备份说明\\ruyin");
});

void test("③ 不分大小写，两种斜杠都认 —— 用户是粘贴路径进来的", () => {
  refused("c:\\users\\amy\\onedrive\\ruyin");
  refused("C:/Users/amy/DROPBOX/ruyin");
  // POSIX 上那些目录也叫 Dropbox/OneDrive，虽然那一侧路径本身区分大小写。
  const mac: HostEnvironment = {
    platform: "darwin",
    env: { HOME: "/Users/amy" },
    execPath: "/Applications/Ruyin.app/Contents/MacOS/Ruyin",
  };
  refused("/Users/amy/Dropbox/ruyin", mac);
  refused("/Users/amy/Library/CloudStorage/OneDrive/ruyin", mac);
  allowed("/Users/amy/RuyinData", mac);
});

void test("拒绝的话要说清三件事：哪个服务、怎么认出来的、为什么不行", () => {
  const reason = refused("C:\\Users\\amy\\OneDrive\\ruyin");
  assert.match(reason, /OneDrive/, "哪个服务");
  assert.match(reason, /路径里有/, "怎么认出来的");
  assert.match(reason, /读不出来/, "为什么不行：库会被改坏");
  assert.match(reason, /上传/, "为什么不行：数据会出本机");
  assert.match(reason, /请选一个不被同步的本地目录/, "下一步做什么");
});

void test("普通目录一律放行 —— 这是黑名单，不是白名单", () => {
  allowed("D:\\RuyinData");
  allowed("C:\\Users\\amy\\Documents\\ruyin");
  allowed("E:\\work\\data");
});

void test("realProbe：读得到的读，读不到的说读不到，不抛", () => {
  assert.equal(realProbe.exists("C:\\一定不存在的路径\\x"), false);
  assert.equal(realProbe.readText("C:\\一定不存在的路径\\x.json"), undefined);
});
