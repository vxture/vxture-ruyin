/**
 * 预置层（技能与工具）在开发态该去哪儿找。
 *
 * 曾经是 `resolve("resources/skills")` —— **按当前工作目录找**。从仓根手起守护
 * 进程时它对；而壳把守护进程当子进程拉起来时 cwd 不是仓根，于是两个预置层双双
 * 落空，启动日志如实报「no bundled layer」。
 *
 * **这个缺陷之所以能活下来，是因为它长得和「还没跑过 `pnpm skills:pull`」一模
 * 一样。**两种情况下界面都是空的、日志都是同一句话，而后者是开发态的正常状态，
 * 所以没有人会去查。打包态也看不见它：壳在 `app.isPackaged` 时显式给
 * `RUYIN_SKILLS_DIR` / `RUYIN_TOOLS_DIR`，所以 `packaged-smoke` 一路是绿的。
 *
 * 改法不是让壳在开发态也传这两个环境变量 —— 那只修好「从壳启动」这一条路，
 * 而 cwd 不是仓根的启动方式不止这一种。缺省值本来就该与 cwd 无关：同一个
 * `main.ts` 里 UI 目录的缺省一直是按**模块自身位置**算的（`import.meta.url`），
 * 三个同类缺省里两种写法，对的那个是它。这里改成同一种。
 */

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/**
 * 仓内 `resources/` —— 从**本模块**算，不从 cwd 算。
 *
 * 编译产物落在 `apps/local-host/dist/`，所以上溯三级到仓根。它与 `main.ts` 里
 * UI 缺省的算法是同一种，两者也在同一个目录里编译出来，所以这个层级数与那边
 * 的一致（改动目录布局时两处一起动）。
 */
const REPO_RESOURCES = new URL("../../../resources/", import.meta.url);

/** 仓内 `resources/<name>` 的绝对路径。 */
export function repoResource(name: string): string {
  return resolve(fileURLToPath(new URL(name, REPO_RESOURCES)));
}

/**
 * 预置技能层（ADR-018 §2.3）。装机态由壳给出；开发态是仓内 `resources/skills`
 * —— 拉过（`pnpm skills:pull`）才有，没拉过就是真的没有预置层。
 *
 * 空串按「没设置」算，不按「明确设成空」算：一个手滑设成空的变量会把
 * `bundledToolsDir` 的兄弟位置推算（`<tools>/../uv`）带回相对路径，也就是把
 * 刚修掉的这个缺陷从另一扇门放回来。
 */
export function bundledSkillsDir(env: NodeJS.ProcessEnv = process.env): string {
  return env["RUYIN_SKILLS_DIR"]?.trim() || repoResource("skills");
}

/**
 * 预置的 MCP 服务器（ADR-018 §2.2）。同上，开发态要 `pnpm tools:pull`。
 * 随包的 Python 引导件按这个目录的兄弟位置找（见 `tool-servers.ts` 的 `uvHome()`），
 * 所以这两个缺省必须指向同一个 `resources/`，不能各算各的。
 */
export function bundledToolsDir(env: NodeJS.ProcessEnv = process.env): string {
  return env["RUYIN_TOOLS_DIR"]?.trim() || repoResource("tools");
}
