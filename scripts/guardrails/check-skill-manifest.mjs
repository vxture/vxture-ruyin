#!/usr/bin/env node
/**
 * check-skill-manifest.mjs —— resources/skill-manifest.json 的护栏（ADR-018 §2.3）。
 *
 * 这份清单同时驱动两件事：ruyin 构建时按它拉取预置进安装包，Runos 按它注册台账
 * （vxture-foundation/vxture-runos#14）。所以它必须**机器可信**，五条硬规则：
 *
 *   1. 许可证不许是 none / NOASSERTION / 空 —— 进安装包就是分发，没有许可证就没有分发权。
 *      仓库级拿不到、逐包核过的，写明 licenseSource（来源与核实日期）。
 *   2. commit 必须是 40 位十六进制 —— 钉死的是内容，不是会漂的分支名。
 *   3. tier 只能是清单自己声明的三档之一（owner 2026-09-05 定）。
 *   4. id 全局唯一。
 *   5. repo 必须是 GitHub URL —— 来源要能被 gh api 复核。
 *
 * 人读版是 docs/40-implementation/20-tools-skills-catalog-v1.md；两边要一致，但这里只
 * 检查机器可读那一份的自洽 —— 文档与清单的对账是评审的事，不是脚本的事。
 */
import { readFileSync } from "node:fs";

const path = "resources/skill-manifest.json";
const m = JSON.parse(readFileSync(path, "utf8"));
const tiers = new Set(Object.keys(m.tiers ?? {}));
const errors = [];
const seen = new Set();
for (const e of [...(m.skills ?? []), ...(m.servers ?? [])]) {
  const where = `${e.kind}:${e.id}`;
  if (!e.license || e.license === "none" || e.license === "NOASSERTION") errors.push(`${where}: 许可证 ${e.license ?? "缺失"} —— 不能分发`);
  if (!e.licenseSource) errors.push(`${where}: 缺 licenseSource（许可证是从哪核到的）`);
  if (!/^[0-9a-f]{40}$/.test(e.commit ?? "")) errors.push(`${where}: commit 不是 40 位十六进制`);
  if (!tiers.has(e.tier)) errors.push(`${where}: tier ${e.tier} 不在三档之内`);
  if (seen.has(e.id)) errors.push(`${where}: id 重复`);
  seen.add(e.id);
  if (!e.repo?.startsWith("https://github.com/")) errors.push(`${where}: repo 不是 GitHub URL`);
}
// launch（本机启动规格，ADR-018 §2.2 / TD-042）：有就得说清 runtime / 包 / 版本 / 入口；
// 经 Runos 注册的不许有 launch（密钥不进本机）；没有 launch 的要写 launchNote 说为什么。
for (const e of m.servers ?? []) {
  const where = `${e.kind}:${e.id}`;
  const l = e.launch;
  if (l) {
    if (e.tier === "runos-registered" || e.needsKey) errors.push(`${where}: 经 Runos 注册 / 需密钥的服务器不能有 launch`);
    if (!["node", "uvx"].includes(l.runtime)) errors.push(`${where}: launch.runtime 只能是 node / uvx`);
    if (!l.package || typeof l.package !== "string") errors.push(`${where}: launch.package 缺失`);
    if (!/^[0-9]+\.[0-9]+(\.[0-9]+)?([.-][0-9A-Za-z.]+)?$/.test(l.version ?? "")) errors.push(`${where}: launch.version 不是钉死的版本号`);
    if (l.runtime === "node" && !l.bin) errors.push(`${where}: node 形态要给包内入口 bin`);
    if (l.args !== undefined && !Array.isArray(l.args)) errors.push(`${where}: launch.args 要是数组`);
    if (l.requiresEnv !== undefined && !(Array.isArray(l.requiresEnv) && l.requiresEnv.every((k) => /^[A-Z][A-Z0-9_]*$/.test(k)))) errors.push(`${where}: requiresEnv 要是大写变量名数组`);
  } else if (!e.launchNote) {
    errors.push(`${where}: 没有 launch 就要写 launchNote（为什么本机起不了）`);
  }
}
const launchable = (m.servers ?? []).filter((e) => e.launch).length;
if (errors.length) {
  console.error(`[skill-manifest] ${errors.length} 处不合规：\n  - ` + errors.join("\n  - "));
  process.exit(1);
}
console.log(`[skill-manifest] OK - 技能来源 ${m.skills.length} 个、MCP 服务器 ${m.servers.length} 个（${launchable} 个带本机启动规格），全部有许可证与来源、commit 已钉死。`);
