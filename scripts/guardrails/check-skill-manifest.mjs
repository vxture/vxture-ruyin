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
if (errors.length) {
  console.error(`[skill-manifest] ${errors.length} 处不合规：\n  - ` + errors.join("\n  - "));
  process.exit(1);
}
console.log(`[skill-manifest] OK - 技能来源 ${m.skills.length} 个、MCP 服务器 ${m.servers.length} 个，全部有许可证与来源、commit 已钉死。`);
