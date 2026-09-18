/**
 * 环境检查（RY-001 §07 任务 52；owner 2026-09-19 提）。
 *
 * ## 为什么要有它
 *
 * owner 在真机上点了「安装」，失败了，重试还是失败 —— 然后他说了一句要紧的话：
 * **「我不能确认最终是不是成功还是失败」**。那正是这一块此前缺的东西：状态徽标
 * 说的是「我们记得装过没有」（一份回执），而用户想知道的是**此刻这台机器上到底
 * 有没有、是哪个版本**。这两件事可以不一致：回执没了、目录被杀毒清了、或者用户
 * 自己早就装了一个更新的。
 *
 * ## 它是「现场问一句」，不是读回执
 *
 * 每一条都真的把那个可执行文件拉起来问一次版本（`--version`），拿到什么写什么。
 * 问不到就说问不到 —— **不猜、不拿回执冒充**。一个说「已安装」而其实起不来的行，
 * 比一个说「没探到」的行糟得多。
 *
 * ## 两个来源分开报
 *
 * 随包/装好的那一份（`resources/node`、获取通道装下的 uv、uv 托管的 CPython），与
 * **本机 PATH 上已有的那一份**。后者是 owner 点名要的：他可能本来就装着更新的
 * node 或 python。两者都报，因为它们回答的是不同的问题 —— 「这个产品带的那套行不行」
 * 与「这台机器上还有什么可用的」。
 */

import { execFileSync } from "node:child_process";

export interface EnvProbeRow {
  /** 环境名（`node` / `python` / `uv`）—— 专名，界面不翻译。 */
  id: string;
  /** 随包或由我们装下的那一份。 */
  bundled?: { path: string; version?: string; error?: string };
  /** 本机 PATH 上已有的那一份（owner 2026-09-19 点名要的那一类）。 */
  system?: { version?: string; error?: string };
}

/** 问一次版本。**拿不到就返回 undefined**，绝不编一个。 */
export function probeVersion(
  exe: string,
  args: readonly string[] = ["--version"],
  run: (exe: string, args: readonly string[]) => string = defaultRun,
): { version?: string; error?: string } {
  try {
    const out = run(exe, args).trim();
    // 版本号常常混在一行字里（`uv 0.12.10 (abc 2026-01-01)`、`Python 3.13.15`）。
    // 取第一个像版本号的片段；取不到就把第一行原样给出去 —— **原样也比编一个强**。
    const m = /\d+\.\d+(\.\d+)?([-.\w]*)?/.exec(out);
    const first = out.split(/\r?\n/)[0] ?? "";
    return { version: m?.[0] ?? (first || undefined) };
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message.split(/\r?\n/)[0] : String(cause) };
  }
}

function defaultRun(exe: string, args: readonly string[]): string {
  return execFileSync(exe, [...args], { encoding: "utf8", windowsHide: true, timeout: 5000 });
}

export interface EnvProbeInput {
  /** 随包 node.exe 的绝对路径（没有就是这一版没装进来）。 */
  nodeExe?: string | undefined;
  /** 获取通道装下的 uv.exe（没有就是还没装）。 */
  uvExe?: string | undefined;
  /** uv 托管的 CPython 目录（用来问 python 的版本）。 */
  pythonExe?: string | undefined;
  run?: (exe: string, args: readonly string[]) => string;
}

/**
 * 现场探一遍。**纯粹是读**：不装任何东西、不改任何状态 —— 这条也写在接口文档上，
 * 免得有人把它当成「检查并修复」。
 */
export function probeEnvironments(input: EnvProbeInput): EnvProbeRow[] {
  const run = input.run;
  const ask = (exe: string, args?: readonly string[]) => (args ? probeVersion(exe, args, run) : probeVersion(exe, ["--version"], run));
  const rows: EnvProbeRow[] = [];

  rows.push({
    id: "node",
    ...(input.nodeExe ? { bundled: { path: input.nodeExe, ...ask(input.nodeExe) } } : {}),
    system: ask("node"),
  });
  rows.push({
    id: "python",
    ...(input.pythonExe ? { bundled: { path: input.pythonExe, ...ask(input.pythonExe) } } : {}),
    // Windows 上 `python` 可能是应用商店的那个占位程序（问版本会把人送进商店），
    // 所以问的是 `python --version`，拿不到就如实报错，不去猜 `python3`。
    system: ask("python"),
  });
  rows.push({
    id: "uv",
    ...(input.uvExe ? { bundled: { path: input.uvExe, ...ask(input.uvExe) } } : {}),
    system: ask("uv"),
  });
  return rows;
}
