/**
 * 构建期落下的事实（`resources/daemon/build-info.json`，由 `scripts/release/pack.mjs` 写）。
 *
 * **为什么要有这个文件，而不是在代码里写死一个 `false`。**
 *
 * 界面底部那条「安装包未签名」的提醒，owner 要的是「后续签了就自动消失」。写死
 * 常量的话它永远不会消失 —— 那条路从此没人走得到，而坏了和好了长得一模一样。
 * 所以这个事实必须由**决定要不要签的那同一个条件**产出：pack.mjs 在打包时看
 * 有没有配证书，看到什么就写什么。
 *
 * **缺文件不是「未签名」，也不是「已签名」—— 是开发态。** 仓里跑 `pnpm start`
 * 时根本没有安装包可谈，这个文件不存在。三种情况在界面上不该长一个样：只有
 * 明确知道「打了包、而且没签」时才提醒，其余两种什么都不说（同 `capabilitySurface`
 * 的纪律：**缺失 ≠ 否定**）。
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 代码签名状态。
 *
 * - `signed`：打了包且配了证书
 * - `unsigned`：打了包但没配证书（当前状态，TD-001：owner 定不采购证书）
 * - `unpackaged`：不是安装包，是从仓里直接跑的开发态
 */
export type CodeSigning = "signed" | "unsigned" | "unpackaged";

export interface BuildInfo {
  codeSigning: CodeSigning;
}

/** 落在守护进程自己的目录旁边 —— 它跟着 `out/daemon` 一起被打进 resources。 */
export const BUILD_INFO_FILE = "build-info.json";

/**
 * 读构建期事实。**任何读不通的情况都落到 `unpackaged`**：文件不在、JSON 坏了、
 * 值不认识 —— 一个读坏了的构建印不该让界面去断言「未签名」，那是在拿一次读失败
 * 冒充一个结论。
 */
/**
 * 生效的签名状态：**环境变量优先，其次构建印**。
 *
 * 为什么要有这个开关：仓里直接跑时永远是 `unpackaged`，于是界面上那条「未签名」
 * 提醒**在开发态一次都走不到** —— 而看不见的那一支正是最容易坏掉的那一支
 * （owner 2026-09-10 就是这样报的「提醒没有出现」）。给它一个开发/验收用的开关，
 * 那条路才走得到。
 *
 * **这不是一个能骗过什么的东西**：它只影响界面上一句提醒的显隐，不参与任何
 * 校验、不放松任何门。装机态没人会去设它，设了也只是让自己少看/多看一句话。
 */
export function resolveCodeSigning(dir: string, env: NodeJS.ProcessEnv): CodeSigning {
  const forced = env["RUYIN_CODE_SIGNING"];
  if (forced === "signed" || forced === "unsigned" || forced === "unpackaged") return forced;
  return readBuildInfo(dir).codeSigning;
}

export function readBuildInfo(dir: string): BuildInfo {
  const path = join(dir, BUILD_INFO_FILE);
  if (!existsSync(path)) return { codeSigning: "unpackaged" };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const v = raw["codeSigning"];
    if (v === "signed" || v === "unsigned") return { codeSigning: v };
    return { codeSigning: "unpackaged" };
  } catch {
    return { codeSigning: "unpackaged" };
  }
}
