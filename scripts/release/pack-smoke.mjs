/**
 * pack.mjs 冒烟输出的判读，抽出来只为了能被 node:test 钉住。
 *
 * pack.mjs 顶层就跑 pnpm install / build / electron-builder，import 不得；而它的
 * 断言第一次真正执行是在 CI 的 windows-latest 上 —— 本地打包被
 * SeCreateSymbolicLinkPrivilege 挡着（TD-025）—— 一处正则笔误在合并前没有任何别的
 * 网能接住。pack 本身仍照旧不自测，由 packaged-smoke 端到端走（TD-053）；这里只有
 * 「给一段冒烟输出，判它过不过」这一层，零依赖、纯函数。命名照 apps/shell 的
 * pdf-protocol.ts：`parseXxxSelfCheck(输出)`，读的是守护进程打的标记行。
 *
 * 另外两支（snapshotTree / diffTree）给「冒烟不许往安装目录里写」那条断言用：只读
 * 文件系统，不写；判定本身是纯的。
 */

import { lstatSync, readdirSync, readlinkSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * 工作台界面自检那一行（TD-061）。
 *
 * 守护进程在 `RUYIN_SMOKE=1` 下自己当一次浏览器：取 `/`，再把页面引用的每个文件取
 * 一遍（apps/local-host/src/ui-self-check.ts），端得出来就打 ok。在打包冒烟里这一行
 * **只认 ok**：pack 每次都 `pnpm -r build`，界面必然构建过，「没有可端的界面」在这里
 * 不成立 —— 那是壳没把 RUYIN_UI_DIR 传过去的样子。404 / 文件缺失 / MIME 不对不会走到
 * 这里：守护进程直接退出 1，pack 在 `[shell-smoke] OK` 那一关已经红了。
 *
 * 目录那一段用 `(.+)` 收到行尾：Windows 路径带反斜杠、空格与括号（`Program Files (x86)`），
 * 而 spawnSync 拿到的输出行尾是 `\r\n` —— `.` 不吃换行，`\r` 会跟在收尾的 `)` 之后，
 * 所以 `\)` 仍能对上最后那个括号。pack-smoke.test.mjs 两种行尾都钉着。
 *
 * @param {string} smokeOut 打包后应用 `--smoke` 的 stdout + stderr
 * @returns {{ ok: true, detail: string, assets: number, bytes: number, dir: string } | { ok: false, message: string }}
 */
export function parseUiSelfCheck(smokeOut) {
  const line = /\[ruyin\] ui self-check: (ok \((\d+) asset\(s\), (\d+) bytes, (.+)\)|no built workspace ui to serve)/.exec(
    smokeOut,
  );
  if (!line) {
    return {
      ok: false,
      message:
        '[pack] FAILED: 守护进程没有报工作台界面自检（缺 "[ruyin] ui self-check" 这一行）—— ' +
        "多半是它排到了 PDF 自检之后、被壳截断了（apps/local-host/src/main.ts 的冒烟顺序）。",
    };
  }
  if (!line[1].startsWith("ok")) {
    return {
      ok: false,
      message:
        "[pack] FAILED: 打包后的守护进程端出来的是 Dev Console，不是工作台界面 —— 多半是壳没把 RUYIN_UI_DIR " +
        "传过去（或传的是空串，apps/shell/src/main.ts 的 startDaemon）。pack 每次都构建界面，「没有可端的界面」在这里不成立。",
    };
  }
  return { ok: true, detail: line[1], assets: Number(line[2]), bytes: Number(line[3]), dir: line[4] };
}

/**
 * 一棵目录树的快照：相对路径 -> { kind, size, mtimeMs }（软链记目标，不跟进去）。
 *
 * 给「冒烟前后 `resources/` 一个字节都不该变」用（TD-062）：uvx 形态曾把缓存写进
 * 随包目录，一次冒烟一万多个文件；装到只读位置首次使用就会失败。比把目录设只读再
 * 冒烟更平台无关 —— Windows 上目录的只读位挡不住建文件，得改 ACL。
 *
 * @param {string} root
 * @returns {Map<string, { kind: "file" | "dir" | "link", size: number, mtimeMs: number }>}
 */
export function snapshotTree(root) {
  const out = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = relative(root, full).split(sep).join("/");
      const st = lstatSync(full);
      if (st.isSymbolicLink()) {
        out.set(rel, { kind: "link", size: Buffer.byteLength(readlinkSync(full)), mtimeMs: 0 });
      } else if (st.isDirectory()) {
        out.set(rel, { kind: "dir", size: 0, mtimeMs: 0 });
        walk(full);
      } else {
        out.set(rel, { kind: "file", size: st.size, mtimeMs: st.mtimeMs });
      }
    }
  };
  walk(root);
  return out;
}

/**
 * 两份快照的差：多了什么、少了什么、变了什么（大小或 mtime）。
 *
 * @param {ReturnType<typeof snapshotTree>} before
 * @param {ReturnType<typeof snapshotTree>} after
 * @returns {{ added: string[], removed: string[], changed: string[], clean: boolean }}
 */
export function diffTree(before, after) {
  const added = [];
  const removed = [];
  const changed = [];
  for (const [rel, b] of before) {
    const a = after.get(rel);
    if (!a) removed.push(rel);
    else if (a.kind !== b.kind || a.size !== b.size || a.mtimeMs !== b.mtimeMs) changed.push(rel);
  }
  for (const rel of after.keys()) if (!before.has(rel)) added.push(rel);
  added.sort();
  removed.sort();
  changed.sort();
  return { added, removed, changed, clean: added.length === 0 && removed.length === 0 && changed.length === 0 };
}

/**
 * 把 diffTree 的结果说成 pack 那一行人话；clean 时返回 undefined。
 *
 * @param {ReturnType<typeof diffTree>} diff
 * @returns {string | undefined}
 */
export function describeTreeWrites(diff) {
  if (diff.clean) return undefined;
  const sample = (xs) => xs.slice(0, 6).join("、") + (xs.length > 6 ? ` …（共 ${xs.length} 个）` : "");
  const parts = [];
  if (diff.added.length) parts.push(`新增 ${diff.added.length} 个：${sample(diff.added)}`);
  if (diff.changed.length) parts.push(`改动 ${diff.changed.length} 个：${sample(diff.changed)}`);
  if (diff.removed.length) parts.push(`删除 ${diff.removed.length} 个：${sample(diff.removed)}`);
  return (
    "[pack] FAILED: 冒烟往安装目录 resources/ 里写了东西 —— " +
    parts.join("；") +
    "。装到只读位置（Program Files）首次使用就会失败（TD-062）。可写的东西应落在数据目录（apps/local-host/src/tool-servers.ts 的 uvx 缓存那一段）。"
  );
}
