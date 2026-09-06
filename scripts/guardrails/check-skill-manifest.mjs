#!/usr/bin/env node
/**
 * check-skill-manifest.mjs —— resources/skill-manifest.json 的护栏（ADR-018 §2.3）。
 *
 * 这份清单同时驱动两件事：ruyin 构建时按它拉取预置进安装包，Runos 按它注册台账
 * （vxture-foundation/vxture-runos#14）。所以它必须**机器可信**。原有五条硬规则：
 *
 *   1. 许可证不许是 none / NOASSERTION / 空 —— 进安装包就是分发，没有许可证就没有分发权。
 *      仓库级拿不到、逐包核过的，写明 licenseSource（来源与核实日期）。
 *   2. commit 必须是 40 位十六进制 —— 钉死的是内容，不是会漂的分支名。
 *   3. tier 只能是清单自己声明的档位之一（owner 2026-09-05 定三档；§7.2 加第四档）。
 *   4. id 全局唯一。
 *   5. repo 必须是 GitHub URL —— 来源要能被 gh api 复核。
 *
 * 2026-09-06（ADR-018 §7.2 获取通道）又加一组，全部是**字段测试**：不联网、不判断、
 * 不猜。它们要钉的一句话是「**档位与装没装进包是同一件事**」—— 上一版清单里 10 条
 * 记为「默认启用」，而在一台干净机器上真能起来的只有 3 条（三个 vendored 的 node
 * 服务器）；剩下 7 条里 5 条要本机自己装 uv、2 条连启动规格都没有。那不是降级，是
 * 一个已经为假的事实一直挂在清单上，而 Runos 台账（vxture-runos#14）从同一份清单读。
 *
 * 人读版是 docs/40-implementation/20-tools-skills-catalog-v1.md；两边要一致，但这里只
 * 检查机器可读那一份的自洽 —— 文档与清单的对账是评审的事，不是脚本的事。
 */
import { readFileSync } from "node:fs";
import { argv, exit } from "node:process";

/** copyleft：不许静默进包，必须随件给 source offer。 */
const COPYLEFT = /\b(GPL|LGPL|AGPL|MPL|EPL|CDDL)\b/i;
/** 我们自己的主机 —— download-only 的组件不许指向它们（镜像本身就是再分发）。 */
const OWN_HOSTS = /(^|\.)vxture\.com$/i;

const path = argv[2] ?? "resources/skill-manifest.json";
const m = JSON.parse(readFileSync(path, "utf8"));
const tiers = new Set(Object.keys(m.tiers ?? {}));
const errors = [];
const seen = new Set();
for (const e of [...(m.skills ?? []), ...(m.servers ?? [])]) {
  const where = `${e.kind}:${e.id}`;
  if (!e.license || e.license === "none" || e.license === "NOASSERTION") errors.push(`${where}: 许可证 ${e.license ?? "缺失"} —— 不能分发`);
  if (!e.licenseSource) errors.push(`${where}: 缺 licenseSource（许可证是从哪核到的）`);
  if (!/^[0-9a-f]{40}$/.test(e.commit ?? "")) errors.push(`${where}: commit 不是 40 位十六进制`);
  if (!tiers.has(e.tier)) errors.push(`${where}: tier ${e.tier} 不在清单声明的档位之内`);
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
    if (l.requiresComponent !== undefined && !(Array.isArray(l.requiresComponent) && l.requiresComponent.length > 0)) {
      errors.push(`${where}: requiresComponent 要是非空数组`);
    }
  } else if (!e.launchNote) {
    errors.push(`${where}: 没有 launch 就要写 launchNote（为什么本机起不了）`);
  }
}

// --- 获取通道（ADR-018 §7.2）---------------------------------------------
const components = m.components ?? [];
const componentIds = new Set(components.map((c) => c.id));
const serverIds = new Set((m.servers ?? []).map((s) => s.id));
const seedIds = new Set(m.pythonRuntime?.seed ?? []);
let allowedOrigins;
try {
  allowedOrigins = new Set((m.allowedOrigins ?? []).map((o) => new URL(o).origin));
} catch {
  allowedOrigins = new Set();
  errors.push("allowedOrigins 里有不是合法 URL 的项");
}
// 白名单本身必须全是 https。一条写成 http 的白名单项会让 `new URL("http://…").origin`
// 匹配上 —— 运行时那道 origin 比对就成了明文取字节的许可，而回执上照写 https。
for (const o of m.allowedOrigins ?? []) {
  let proto = "";
  try {
    proto = new URL(o).protocol;
  } catch {
    continue;
  }
  if (proto !== "https:") errors.push(`allowedOrigins: ${o} 不是 https —— 明文的来源不许进白名单`);
}

for (const s of m.servers ?? []) {
  const where = `${s.kind}:${s.id}`;
  const l = s.launch;
  for (const id of l?.requiresComponent ?? []) {
    if (!componentIds.has(id)) errors.push(`${where}: requiresComponent ${id} 不在 components[] 里`);
  }

  // 1. 档位与「装没装进包」是同一件事（ADR-018 §2.3「首启离线可用」的机器版）。
  //    一台干净的、断网的机器上起不来的东西，不许写「默认启用」。
  if (s.tier === "default") {
    if (!l) {
      errors.push(`${where}: tier default 却没有 launch —— 起不来的东西不许记为默认启用`);
    } else {
      if (l.runtime === "node" && !s.vendored?.bundled) {
        errors.push(`${where}: node 形态的 default 档必须有 vendored.bundled（随安装包走），否则干净机器上没有它`);
      }
      if (l.runtime === "uvx") {
        if (l.offline?.cacheSeeded !== true) errors.push(`${where}: uvx 形态的 default 档必须 launch.offline.cacheSeeded = true（wheel 已预取进随包的 uv cache）`);
        if (!seedIds.has(s.id)) errors.push(`${where}: uvx 形态的 default 档必须列进 pythonRuntime.seed，否则构建时不会有人去预取它的 wheel`);
        if (!m.pythonRuntime?.uv?.version) errors.push(`${where}: uvx 形态的 default 档要求 pythonRuntime.uv 存在 —— 机器上没有 uv，侧载来的 wheel 也跑不了`);
      }
      if (l.requiresComponent) errors.push(`${where}: default 档不许有 requiresComponent —— 要先下载才能起的，不是「不下载任何字节就能起」`);
    }
  }
  // 2. acquire-on-demand 得真有东西可获取。
  if (s.tier === "acquire-on-demand" && !(l?.requiresComponent?.length > 0)) {
    errors.push(`${where}: tier acquire-on-demand 却没有 launch.requiresComponent —— 那要用户点什么？`);
  }
  // 3. 密钥不进本机，载荷也不进（既有规则的自然延长）。
  if ((s.tier === "runos-registered" || s.needsKey) && l?.requiresComponent) {
    errors.push(`${where}: 经 Runos 注册 / 需密钥的服务器不许有 requiresComponent`);
  }
  // 9. 目录（预置工具名对照表，TD-034 的那一半）。空数组读起来是「它什么都不暴露」。
  if (s.tools !== undefined) {
    if (!(Array.isArray(s.tools) && s.tools.length > 0 && s.tools.every((t) => typeof t === "string" && t.length > 0))) {
      errors.push(`${where}: tools 要是去重的非空字符串数组（探不到就别写这个字段，写 toolsUnprobed）`);
    } else if (new Set(s.tools).size !== s.tools.length) {
      errors.push(`${where}: tools 里有重复的工具名`);
    }
  }
}

for (const c of components) {
  const where = `component:${c.id}`;
  // 4. 逐条形状。sha256 与 registry-client.ts 的 isEntry 同一条形状检查。
  if (!c.id || seen.has(c.id) || serverIds.has(c.id)) errors.push(`${where}: id 缺失或与别的条目相撞`);
  seen.add(c.id);
  if (!/^[0-9a-f]{64}$/.test(c.sha256 ?? "")) {
    errors.push(`${where}: sha256 不是 64 位小写十六进制 —— 没有真摘要的载荷不许写进清单，占位符会把这道守卫变成摆设`);
  }
  for (const [k, v] of [["size", c.size], ["unpackedBytes", c.unpackedBytes]]) {
    if (!Number.isInteger(v) || v < 0) errors.push(`${where}: ${k} 要是非负整数`);
  }
  if (Number.isInteger(c.size) && Number.isInteger(c.unpackedBytes) && c.unpackedBytes < c.size) {
    errors.push(`${where}: unpackedBytes 小于 size —— 至少有一个数是错的`);
  }
  let origin = "";
  try {
    const u = new URL(c.source?.url ?? "");
    origin = u.origin;
    // 协议在这里就查一次，不等运行时。origin 只比 scheme+host+port 的字符串，
    // 而一条 http 的 pin 配上一条 http 的白名单项**是能对上的** —— 那时字节走的是
    // 明文，中间任何人都能换掉它，而我们只有一条随包的 sha256 能事后发现。
    if (u.protocol !== "https:") errors.push(`${where}: source.url 不是 https（${u.protocol}）—— 获取通道只走 https`);
  } catch {
    errors.push(`${where}: source.url 不是合法 URL`);
  }
  if (origin && !allowedOrigins.has(origin)) errors.push(`${where}: source.url 的 origin ${origin} 不在 allowedOrigins 里`);
  if (!c.license || c.license === "none" || c.license === "NOASSERTION") errors.push(`${where}: 许可证 ${c.license ?? "缺失"} —— 不能分发`);
  if (!c.licenseSource) errors.push(`${where}: 缺 licenseSource`);
  // 许可证正文必须随树同行。这条顺手把完整 chrome-win64 挡在门外 ——
  // 195.6 MB、压缩包里 308 个条目、零个许可证文件。
  if (!(Array.isArray(c.licenseFile) && c.licenseFile.length > 0 && c.licenseFile.every((f) => typeof f === "string" && f.length > 0))) {
    errors.push(`${where}: licenseFile 要是非空数组 —— 一个许可证文件都没有的载荷不许存在`);
  }
  // 5. copyleft 要 source offer。
  if (COPYLEFT.test(c.license ?? "") && !c.sourceOffer) {
    errors.push(`${where}: 许可证是 copyleft（${c.license}）却没有 sourceOffer`);
  }
  // 6. download-only 不许指向我们自己的主机 —— 镜像本身就是再分发。
  if (c.redistribution === "download-only" && origin) {
    if (OWN_HOSTS.test(new URL(c.source.url).hostname)) errors.push(`${where}: redistribution 是 download-only，却指向我们自己的主机`);
  }
  if (!["redistributable", "download-only"].includes(c.redistribution)) {
    errors.push(`${where}: redistribution 只能是 redistributable / download-only`);
  }
  // 7. 双向闭合：孤儿载荷 = 会进索引却没人用的下载。
  if (!(Array.isArray(c.unlocks) && c.unlocks.length > 0)) {
    errors.push(`${where}: unlocks 要是非空数组（这份载荷解锁了谁）`);
  } else {
    for (const id of c.unlocks) if (!serverIds.has(id)) errors.push(`${where}: unlocks 里的 ${id} 不在 servers 里`);
  }
  // 8. 这条通道只走公开 URL，零秘密（CLAUDE.md 硬规则）。
  for (const field of ["headers", "auth", "token", "credentials"]) {
    if (c.source && field in c.source) errors.push(`${where}: source.${field} —— 获取通道不带任何凭据`);
    if (field in c) errors.push(`${where}: ${field} —— 获取通道不带任何凭据`);
  }
  // browser / program 形态的载荷是二进制，不暴露 MCP 工具。
  if (["browser", "program"].includes(c.kind) && c.tools !== undefined) {
    errors.push(`${where}: kind ${c.kind} 的组件不该带 tools`);
  }
}
if (errors.length) {
  console.error(`[skill-manifest] ${errors.length} 处不合规：\n  - ` + errors.join("\n  - "));
  exit(1);
}
const servers = m.servers ?? [];
const launchable = servers.filter((e) => e.launch).length;
const offlineDefault = servers.filter((e) => e.tier === "default").length;
// 随包 ≠ 开箱即起：要环境变量或外部程序的那几条，随包但点下去起不来。
// 这两个数字必须分开报 —— 合成一个数就是「预置 10 个」那个错的小一号版本。
const needsSetup = (m.servers ?? []).filter(
  (e) => e.tier === "default" && e.launch && ((e.launch.requiresEnv ?? []).length > 0 || e.launch.requiresBin),
).length;
console.log(
  `[skill-manifest] OK - 技能来源 ${(m.skills ?? []).length} 个、MCP 服务器 ${servers.length} 个` +
    `（${launchable} 个带本机启动规格；${offlineDefault} 个默认档随包、不下载任何字节${needsSetup ? `，其中 ${needsSetup} 条要先配置才能起` : "，且都开箱即起"}）、` +
    `获取通道组件 ${(m.components ?? []).length} 个，全部有许可证与来源、commit 与 sha256 已钉死。`,
);
