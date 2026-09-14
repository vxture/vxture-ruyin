/**
 * pack.mjs 冒烟输出的判读，抽出来只为了能被 node:test 钉住。
 *
 * pack.mjs 顶层就跑 pnpm install / build / electron-builder，import 不得；而它的
 * 断言第一次真正执行是在 CI 的 windows-latest 上 —— 本地打包被
 * SeCreateSymbolicLinkPrivilege 挡着（TD-025）—— 一处正则笔误在合并前没有任何别的
 * 网能接住。pack 本身仍照旧不自测，由 packaged-smoke 端到端走（TD-053）；这里只有
 * 「给一段冒烟输出，判它过不过」这一层，零依赖、纯函数。命名照 apps/shell 的
 * pdf-protocol.ts：`parseXxxSelfCheck(输出)`，读的是守护进程打的标记行。
 */

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
