#!/usr/bin/env node
/**
 * 随包第三方组件的许可声明（TD-058）。
 *
 * **RUYIN 本身是闭源商业软件 —— 这件事与我们的授权无关。** 安装包里**重新分发**了
 * 别人的开源组件，MIT / BSD / Apache-2.0 这些许可证都带署名条款：分发就得附上它们的
 * 版权与许可声明。这不是可选项，是那些许可证里写着的要求。
 *
 * 随包的四类东西，这里管其中两类的汇总，外加 Electron：
 *   ① 技能源码、② MCP 服务器 —— 早已逐条登记在 `resources/skill-manifest.json` 与
 *      工具的 index.json 里，并显示在「能力平台」页上，不在这里重复；
 *   ③ Electron / Chromium —— Electron 自带 `LICENSE` 与 `LICENSES.chromium.html`，打包时
 *      随 exe 放在安装目录（pack.mjs 核它们在）。这里只列一条 Electron，指向那两份；
 *   ④ 守护进程的整棵依赖树、以及打进界面包里的依赖 —— **这里扫**。
 *
 * 用法：
 *   node scripts/release/third-party.mjs            重生成清单（提交进仓）
 *   node scripts/release/third-party.mjs --check    CI 用：清单过期、或有许可证不合规，就红
 *   node scripts/release/third-party.mjs --full <文件>  pack 用：写出带许可证全文的声明
 *
 * **清单必须是确定的**（tool-name-doc.mjs 吃过的亏）：同一份依赖，什么时候跑都一字
 * 不差 —— 不写日期、按名字排序。否则一个每天都会红一次的检查，会教所有人忽略它。
 */

import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** 随包的三棵根：守护进程（整棵依赖树随包）、界面（依赖打进包里）、壳（运行时零依赖）。 */
export const ROOTS = {
  daemon: "apps/local-host",
  ui: "apps/ui-workspace",
  shell: "apps/shell",
};

/** 我们自己的包：闭源、同一个主体，不是「第三方」。 */
const OURS = /^@vxture\//;

/**
 * 允许随包分发的许可证（都是宽松许可：附上声明即可再分发）。
 *
 * 不在这里的 —— 尤其是 GPL / AGPL / LGPL / SSPL / MPL 这些 copyleft —— 一律不过，
 * 要人看过、写明理由才能加进来：闭源软件随包分发一个 copyleft 组件，是要先想清楚的事，
 * 不是依赖升级时顺手带进来的事。
 */
export const ALLOWED = new Set([
  "MIT",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "Apache-2.0",
  "Zlib",
  "BlueOak-1.0.0",
  "OFL-1.1",
  "WTFPL",
  "Unlicense",
  "CC0-1.0",
  "CC-BY-4.0",
  "Python-2.0",
]);

/**
 * 一条 SPDX 表达式能不能随包。`A OR B`：挑一个允许的就行（我们选它）；`A AND B`：
 * 每一个都得允许。只认这两种组合 —— 更复杂的写法按不认得处理，交给人看。
 */
export function licenseAllowed(expr) {
  if (!expr) return false;
  const bare = expr.trim().replace(/^\((.*)\)$/, "$1");
  if (/\(|\)/.test(bare)) return false;
  if (/ OR /.test(bare)) return bare.split(/ OR /).some((x) => licenseAllowed(x));
  if (/ AND /.test(bare)) return bare.split(/ AND /).every((x) => licenseAllowed(x));
  return ALLOWED.has(bare);
}

/** package.json 里的许可证写法有三种：字符串、`{type}`、旧式 `licenses: [{type}]`。 */
function licenseOf(meta) {
  if (typeof meta.license === "string") return meta.license;
  if (meta.license && typeof meta.license.type === "string") return meta.license.type;
  if (Array.isArray(meta.licenses)) return meta.licenses.map((l) => l.type).join(" OR ");
  return undefined;
}

function packageJsonOf(name, fromDir) {
  try {
    return realpathSync(createRequire(join(fromDir, "noop.js")).resolve(`${name}/package.json`));
  } catch {
    // `exports` 把 package.json 藏起来的包：沿 node_modules 往上找。
    for (let d = fromDir; ; ) {
      const cand = join(d, "node_modules", name, "package.json");
      if (existsSync(cand)) return realpathSync(cand);
      const up = dirname(d);
      if (up === d) return undefined;
      d = up;
    }
  }
}

/**
 * 扫三棵根的**生产**依赖（不含 devDependencies —— 那些不随包），按 name@version 去重。
 * 返回按名字排好的条目；`dir` 是包的真实目录，只给 --full 读许可证文件用，不进清单。
 */
export function collect(repoRoot) {
  const seen = new Map();
  const walk = (dir, usedBy, isRoot) => {
    const pj = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const deps = { ...(pj.dependencies ?? {}), ...(isRoot ? {} : (pj.optionalDependencies ?? {})) };
    for (const name of Object.keys(deps)) {
      const p = packageJsonOf(name, dir);
      if (!p) continue; // 没装上的可选依赖
      const meta = JSON.parse(readFileSync(p, "utf8"));
      const key = `${meta.name}@${meta.version}`;
      const hit = seen.get(key);
      if (hit) {
        // 第二棵根也走到了它：记上，并且**往下再走一遍** —— 不然它的依赖只记在第一棵根
        // 名下（界面也随包的东西被记成「只随运行时」）。已经记过这棵根的就停，环也就断了。
        if (hit.usedBy.has(usedBy)) continue;
        hit.usedBy.add(usedBy);
        walk(hit.dir, usedBy, false);
        continue;
      }
      seen.set(key, { name: meta.name, version: meta.version, license: licenseOf(meta), usedBy: new Set([usedBy]), dir: dirname(p) });
      walk(dirname(p), usedBy, false);
    }
  };
  for (const [usedBy, rel] of Object.entries(ROOTS)) walk(join(repoRoot, rel), usedBy, true);

  // Electron 是壳的开发依赖（electron-builder 把它的二进制打进安装包），扫生产依赖扫不到，
  // 单独记一条。Chromium 及其组件的声明是 Electron 自带的 LICENSES.chromium.html。
  const electron = packageJsonOf("electron", join(repoRoot, ROOTS.shell));
  if (electron) {
    const meta = JSON.parse(readFileSync(electron, "utf8"));
    seen.set(`electron@${meta.version}`, { name: "electron", version: meta.version, license: licenseOf(meta), usedBy: new Set(["shell"]), dir: dirname(electron) });
  }

  return [...seen.values()]
    .filter((e) => !OURS.test(e.name))
    .map((e) => ({ ...e, usedBy: [...e.usedBy].sort() }))
    .sort((a, b) => (a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name)));
}

/** 许可证不合规的条目（缺许可证、或不在允许清单里）。 */
export function policyProblems(entries) {
  return entries
    .filter((e) => !licenseAllowed(e.license))
    .map((e) => `${e.name}@${e.version}: ${e.license ?? "（没有许可证字段）"}`);
}

/** 提交进仓、给「关于」页读的那份清单：一个确定的 TS 模块（不写日期）。 */
export function renderSummaryModule(entries) {
  const rows = entries.map(
    (e) => `  { name: ${JSON.stringify(e.name)}, version: ${JSON.stringify(e.version)}, license: ${JSON.stringify(e.license)}, usedBy: ${JSON.stringify(e.usedBy)} },`,
  );
  return [
    "/**",
    " * 随包的第三方组件清单（TD-058）。**生成物，不要手改**：",
    " *   node scripts/release/third-party.mjs",
    " * CI 用 --check 比对，过期就红。许可证全文随安装包（resources/THIRD-PARTY-NOTICES.txt）。",
    " */",
    "",
    "export interface ThirdPartyEntry {",
    "  name: string;",
    "  version: string;",
    "  license: string;",
    "  /** 随哪一块分发：daemon（守护进程）/ ui（界面）/ shell（壳，即 Electron）。 */",
    "  usedBy: string[];",
    "}",
    "",
    "export const THIRD_PARTY: ThirdPartyEntry[] = [",
    ...rows,
    "];",
    "",
  ].join("\n");
}

const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.[a-z0-9]+)?$/i;

/** 带许可证全文的声明（pack 时写进安装包）。包里没附许可证文件的，照实写一句。 */
export function renderFullText(entries, readDir = readdirSync, readFile = readFileSync) {
  const parts = [
    "RUYIN — 第三方组件许可声明 / Third-party notices",
    "",
    "RUYIN 本身是闭源商业软件。以下是随安装包分发的第三方开源组件及其许可证 ——",
    "这些声明是那些组件的许可证所要求的署名。",
    "Chromium 及其组件的声明见安装目录下的 LICENSES.chromium.html（随 Electron 分发）。",
    "",
  ];
  for (const e of entries) {
    parts.push("=".repeat(78), `${e.name}@${e.version}  —  ${e.license ?? "?"}  (${e.usedBy.join(", ")})`, "=".repeat(78));
    const files = e.dir ? readDir(e.dir).filter((f) => LICENSE_FILE.test(f)).sort() : [];
    if (files.length === 0) parts.push(`（包内未附许可证文件；许可证：${e.license ?? "未声明"}）`);
    for (const f of files) parts.push(`--- ${f} ---`, String(readFile(join(e.dir, f), "utf8")).trimEnd());
    parts.push("");
  }
  return parts.join("\n");
}

export const SUMMARY_PATH = "apps/ui-workspace/src/third-party-list.ts";

function main(argv) {
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  const entries = collect(repoRoot);
  const problems = policyProblems(entries);
  if (problems.length > 0) {
    console.error(
      `[third-party] 许可证不合规（${problems.length}）：\n  ${problems.join("\n  ")}\n` +
        "  不在允许清单里的许可证要人看过、写明理由才能加进 ALLOWED —— 闭源软件随包分发\n" +
        "  copyleft 组件是要先想清楚的事，不是依赖升级时顺手带进来的事。",
    );
    return 1;
  }
  const summary = renderSummaryModule(entries);
  const target = join(repoRoot, SUMMARY_PATH);
  if (argv.includes("--check")) {
    const current = existsSync(target) ? readFileSync(target, "utf8").replace(/\r\n/g, "\n") : "";
    if (current !== summary) {
      console.error(`[third-party] ${SUMMARY_PATH} 过期了：依赖变了而清单没重生成。跑一次 node scripts/release/third-party.mjs 并提交。`);
      return 1;
    }
    console.log(`[third-party] OK - ${entries.length} 个随包第三方组件，许可证都在允许清单里，清单是新的。`);
    return 0;
  }
  const fullAt = argv.indexOf("--full");
  if (fullAt >= 0) {
    const out = argv[fullAt + 1];
    if (!out) {
      console.error("[third-party] --full 要跟一个输出文件");
      return 1;
    }
    writeFileSync(out, renderFullText(entries), "utf8");
    console.log(`[third-party] 许可声明全文 -> ${out}（${entries.length} 个组件）`);
    return 0;
  }
  writeFileSync(target, summary, "utf8");
  console.log(`[third-party] ${SUMMARY_PATH} <- ${entries.length} 个组件`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  process.exit(main(process.argv.slice(2)));
}
