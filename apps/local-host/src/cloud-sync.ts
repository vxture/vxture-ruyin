/**
 * 数据目录**不能放在云同步目录里**（TD-051；owner 2026-09-07 定：拦截，并在界面上
 * 提醒）。
 *
 * ## 为什么这条比系统目录那条还要紧
 *
 * 系统目录（TD-039）挡的是「那地方会被系统清掉」。这一条挡的是两件更直接的事：
 *
 * 1. **同步客户端会把一个正在被打开的 SQLite 库改坏。** `project.db` 是 SQLCipher，
 *    运行期带着 `-wal` 与 `-shm`，三个文件必须彼此一致。同步客户端不知道这回事：
 *    它按自己的节奏上传、下载、覆盖，甚至在两台机器之间「合并」—— 而对一个数据库
 *    文件来说，被换掉半个 WAL 就是**整个库读不出来**。这不是「有可能」，是这类
 *    工具的正常工作方式撞上数据库文件的必然结果。
 * 2. **它会把这些数据传上云。** 而「数据不出本机」是这个产品的立身之本之一 ——
 *    契约、审计链、文件区里的原件、加密库本身，会在用户完全不知情的情况下被完整
 *    上传到一个第三方网盘。他做的动作只是「把数据目录设到我平时放文件的那个文件夹」。
 *
 * 第二条尤其要拦而不是提醒：**用户点「确定」时并不知道自己在同意什么**，而一旦传
 * 上去就收不回来了。
 *
 * ## 怎么认出来：三种手段，可信度依次下降
 *
 * 每一种单独都不够，合起来才覆盖得住常见的情况：
 *
 * 1. **客户端自己声明的根目录**（最可信）。OneDrive 会设 `%OneDrive%` /
 *    `%OneDriveConsumer%` / `%OneDriveCommercial%`；Dropbox 把真实路径写在
 *    `%APPDATA%/Dropbox/info.json` 里。这两处给的是**那台机器上真正的路径**，
 *    改过默认位置也认得出来。
 * 2. **同步工具在自己根目录里放的标记**。从目标往上一级级找：Dropbox 的
 *    `.dropbox`、Syncthing 的 `.stfolder`、Seafile 的 `.seafile-data`、坚果云的
 *    `.nutstore`。它认的是「这棵树是被同步的」，而不是「这个文件夹叫什么」。
 * 3. **路径里出现已知的名字**（最弱，但覆盖面最广）。多数网盘既不设环境变量也不
 *    留标记 —— 百度网盘、iCloud、Google Drive 都是。
 *
 * 第三种会误伤：一个手工建的、名叫 `Dropbox` 但根本没在同步的文件夹会被拒。这是
 * **有意接受的代价** —— 误伤的后果是「换一个目录」，漏判的后果是「加密库被改坏，
 * 或者全部数据被上传」。两者不对称，所以往严的方向偏。拒绝的话里说清是哪个名字
 * 命中的，用户看得懂，也就知道该怎么办。
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { HostEnvironment } from "./system-dirs.js";

/** 探针。抽出来是为了让测试在 ubuntu 上跑 Windows 的规则（与 TD-039 同一条理由）。 */
export interface CloudProbe {
  exists: (path: string) => boolean;
  readText: (path: string) => string | undefined;
}

export const realProbe: CloudProbe = {
  exists: (path) => existsSync(path),
  readText: (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return undefined;
    }
  },
};

/**
 * 同步工具在自己根目录里留下的标记。
 *
 * 认的是「这棵树是被同步的」，比认名字可靠 —— 用户把 Dropbox 根目录改名叫「工作」，
 * 这一条仍然命中。
 */
const MARKERS: ReadonlyArray<{ entry: string; service: string }> = [
  { entry: ".dropbox", service: "Dropbox" },
  { entry: ".dropbox.cache", service: "Dropbox" },
  { entry: ".stfolder", service: "Syncthing" },
  { entry: ".seafile-data", service: "Seafile" },
  { entry: ".nutstore", service: "坚果云" },
  { entry: ".icloud", service: "iCloud 云盘" },
];

/**
 * 路径里的已知名字。**按整段比**（不是子串）：`C:\work\Dropbox\x` 命中，
 * 而 `C:\DropboxNotes` 不命中 —— 后者只是名字里带了这几个字。
 */
const NAMES: ReadonlyArray<{ segment: string; service: string }> = [
  { segment: "onedrive", service: "OneDrive" },
  { segment: "dropbox", service: "Dropbox" },
  { segment: "google drive", service: "Google 云端硬盘" },
  { segment: "googledrive", service: "Google 云端硬盘" },
  { segment: "my drive", service: "Google 云端硬盘" },
  { segment: "icloud drive", service: "iCloud 云盘" },
  { segment: "iclouddrive", service: "iCloud 云盘" },
  { segment: "坚果云", service: "坚果云" },
  { segment: "nutstore", service: "坚果云" },
  { segment: "百度网盘", service: "百度网盘" },
  { segment: "baidunetdisk", service: "百度网盘" },
  { segment: "baidusyncdisk", service: "百度网盘" },
  { segment: "阿里云盘", service: "阿里云盘" },
  { segment: "aliyundrive", service: "阿里云盘" },
  { segment: "天翼云盘", service: "天翼云盘" },
  { segment: "wps云盘", service: "WPS 云盘" },
  { segment: "wpsdrive", service: "WPS 云盘" },
  { segment: "seafile", service: "Seafile" },
  { segment: "syncthing", service: "Syncthing" },
  { segment: "megasync", service: "MEGA" },
  { segment: "pcloud", service: "pCloud" },
  { segment: "box sync", service: "Box" },
  { segment: "yandexdisk", service: "Yandex.Disk" },
  { segment: "creative cloud files", service: "Adobe Creative Cloud" },
];

function norm(p: string, platform: NodeJS.Platform): string {
  const s = p.replaceAll("\\", "/").replace(/\/+$/, "");
  return platform === "win32" ? s.toLowerCase() : s;
}

/** a 在 b 里面（或就是 b）。按整段比。 */
function within(a: string, b: string): boolean {
  if (!b) return false;
  return a === b || a.startsWith(b.endsWith("/") ? b : b + "/");
}

/** 客户端自己声明的根目录 —— 这些给的是这台机器上真正的路径。 */
function declaredRoots(
  host: HostEnvironment,
  probe: CloudProbe,
): Array<{ path: string; service: string }> {
  const out: Array<{ path: string; service: string }> = [];
  for (const key of ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"]) {
    const value = host.env[key];
    if (value?.trim()) out.push({ path: norm(value, host.platform), service: "OneDrive" });
  }
  // Dropbox 把真实路径写在这里。改过默认位置也认得出来。
  const appData = host.env["APPDATA"] ?? host.env["HOME"];
  if (appData) {
    const raw = probe.readText(join(appData, "Dropbox", "info.json"));
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Record<string, { path?: string }>;
        for (const account of Object.values(parsed)) {
          if (account?.path) out.push({ path: norm(account.path, host.platform), service: "Dropbox" });
        }
      } catch {
        // info.json 读不动就当没有这一条 —— 后面还有标记与名字两道。
      }
    }
  }
  return out;
}

/**
 * 这个目标是不是在一个云同步目录里。
 *
 * 返回一句给用户看的话，或 `undefined` 表示没问题。话里**必须点名是哪个服务**：
 * 一句「不能用云同步目录」会让用户去猜是哪个文件夹出的问题。
 */
export function cloudSyncRefusal(
  target: string,
  host: HostEnvironment,
  probe: CloudProbe = realProbe,
): string | undefined {
  const dst = norm(target, host.platform);
  const why = (service: string, how: string): string =>
    `这个位置在 ${service} 的同步范围内（${how}）。数据目录不能放在云同步目录里：` +
    `同步客户端会在数据库正被使用时改动它的文件，那会让整个加密库读不出来；` +
    `而且它会把契约、审计链与你收进项目的原件整份上传到云端 —— ` +
    `而这个客户端的前提是数据不出本机。请选一个不被同步的本地目录。`;

  // ① 客户端自己声明的根目录 —— 最可信，先问它。
  for (const root of declaredRoots(host, probe)) {
    if (within(dst, root.path)) return why(root.service, "客户端自己声明的同步目录");
  }

  // ② 从目标往上一级级找同步工具留下的标记。认的是「这棵树在被同步」，
  //    所以用户把根目录改成别的名字也仍然命中。
  const parts = target.replaceAll("\\", "/").replace(/\/+$/, "").split("/");
  for (let i = parts.length; i > 0; i--) {
    const dir = parts.slice(0, i).join("/");
    if (!dir) continue;
    for (const marker of MARKERS) {
      if (probe.exists(join(dir, marker.entry))) {
        return why(marker.service, `${dir} 下有 ${marker.entry}`);
      }
    }
  }

  // ③ 路径里出现已知的名字。最弱的一道，但覆盖面最广 —— 多数网盘既不设环境变量
  //    也不留标记。误伤的代价是换一个目录，漏判的代价是数据被改坏或被上传。
  // 名字这一道**一律不分大小写**，与平台无关：macOS/Linux 上那些目录也叫
  // 「Dropbox」「OneDrive」，只是 norm() 在非 Windows 上不会替我们转小写。
  for (const segment of dst.split("/")) {
    const lower = segment.toLowerCase();
    const hit = NAMES.find((n) => lower === n.segment);
    if (hit) return why(hit.service, `路径里有「${segment}」这一段`);
  }
  return undefined;
}
