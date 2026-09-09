/**
 * 逐技能许可证判定 —— 预置层的「两读」（vxture/vxture-ruyin#201 §d/§e）。
 *
 * 为什么要两读：**仓库级 LICENSE 不管辖技能自己的声明**。2026-09-09 的实例是
 * `xberg-io/xberg` —— 仓库级 LICENSE 是 MIT，而 `plugin/skills/xberg/SKILL.md`
 * 的前言写 `license: Elastic-2.0`（source-available）。同一批字节两个说法，而清单
 * 只读了仓库级那一读，于是它以 `default` 档随包默认启用了。Runos 侧独立判出同一
 * 结论。反过来也成立：`anthropics/skills` 仓库级是 Apache-2.0，里面 docx / pdf /
 * pptx / xlsx 四条自带的 LICENSE.txt 是「All rights reserved」的专有条款 —— 只读
 * 仓库级会把它们收进来。
 *
 * 所以这里读三处，任意两处说法冲突就**失败关闭**：
 *
 *   1. 清单声明（`resources/skill-manifest.json` 的 `license`，来源仓那一级）
 *   2. 技能前言里的 `license:`（SKILL.md front matter，agentskills.io 的可选字段）
 *   3. 技能自己带的许可证文件正文（LICENSE / LICENCE / COPYING，紧挨 SKILL.md）
 *
 * 两条刻意的保守取舍：
 *
 * - **前言里认不出是 SPDX 的值不当作声明。** `anthropics/skills` 的 11 条写的是
 *   `license: Complete terms in LICENSE.txt` —— 那是一句散文，是指向文件的指针，
 *   不是第二个说法。把它当声明比对，会把 11 条合规技能全部误判成冲突。
 * - **正文认不出来的不判定。** 许可证正文识别只认少数几种确定的形态；认不出的
 *   记一条 note 交给人看，不拿它去否定别处的说法。宁可漏判一次留痕，不可误杀。
 *
 * 判定是**白名单**制：宽松许可之外的一律拒，包括 copyleft 与 source-available。
 * 这不是说它们不能用，是说它们不能这样用 —— 随安装包分发、默认启用。
 */

/** 可以随安装包分发、默认启用的宽松许可。白名单之外一律拒。 */
export const PERMISSIVE = new Set([
  "Apache-2.0",
  "MIT",
  "MIT-0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
  "Unlicense",
  "CC0-1.0",
  "BlueOak-1.0.0",
]);

/** 常见的大小写 / 别名写法归一到 SPDX 标识。 */
const ALIASES = new Map([
  ["apache 2.0", "Apache-2.0"],
  ["apache-2", "Apache-2.0"],
  ["apache2", "Apache-2.0"],
  ["apache license 2.0", "Apache-2.0"],
  ["bsd-3", "BSD-3-Clause"],
  ["bsd 3-clause", "BSD-3-Clause"],
  ["bsd-2", "BSD-2-Clause"],
  ["mit license", "MIT"],
  ["the unlicense", "Unlicense"],
]);

/** SPDX 标识长什么样（含 `A OR B` / `A AND B` 复合式）。 */
const SPDX_SHAPE = /^[A-Za-z0-9][A-Za-z0-9.+-]{1,40}(?:\s+(?:OR|AND|or|and)\s+[A-Za-z0-9][A-Za-z0-9.+-]{1,40})*$/;

/**
 * 把前言里的 `license:` 值读成一个 SPDX 标识；读不成就返回 undefined。
 *
 * **读不成不是错误。** 前言里写一句散文（"Complete terms in LICENSE.txt"）是
 * 合法的写法，只是它没有给出第二个可比对的说法。
 */
export function asSpdx(value) {
  if (typeof value !== "string") return undefined;
  const v = value.trim().replace(/^["']|["']$/g, "");
  if (!v) return undefined;
  const alias = ALIASES.get(v.toLowerCase());
  if (alias) return alias;
  if (!SPDX_SHAPE.test(v)) return undefined;
  // 大小写归一到白名单里的写法（`mit` → `MIT`）。
  for (const known of PERMISSIVE) if (known.toLowerCase() === v.toLowerCase()) return known;
  return v;
}

/**
 * 从许可证文件正文认出它是哪一种。只认确定的形态，认不出返回 undefined。
 *
 * `proprietary` 是唯一一个**由正文单独定案**的结论：一份写着 all rights reserved
 * 且没有任何宽松许可特征的文件，不需要第二个说法来佐证它不能分发。
 */
export function identifyLicenseText(text) {
  if (typeof text !== "string" || !text.trim()) return undefined;
  const head = text.slice(0, 4000);
  const flat = head.replace(/\s+/g, " ").toLowerCase();
  if (/apache license\b/.test(flat) && /version 2\.0/.test(flat)) return "Apache-2.0";
  if (/permission is hereby granted, free of charge/.test(flat) && /mit/.test(head.toLowerCase().slice(0, 200))) return "MIT";
  if (/permission is hereby granted, free of charge/.test(flat) && !/mit/.test(head.toLowerCase().slice(0, 200))) {
    // MIT 与 ISC 的正文开头几乎一样；不猜，交给别处的说法。
    return undefined;
  }
  if (/redistribution and use in source and binary forms/.test(flat)) {
    if (/neither the name of/.test(flat)) return "BSD-3-Clause";
    return "BSD-2-Clause";
  }
  if (/elastic license/.test(flat)) return "Elastic-2.0";
  if (/business source license/.test(flat)) return "BUSL-1.1";
  if (/server side public license/.test(flat)) return "SSPL-1.0";
  if (/gnu general public license/.test(flat)) return /lesser/.test(flat) ? "LGPL" : /affero/.test(flat) ? "AGPL" : "GPL";
  if (/all rights reserved/.test(flat)) return "proprietary";
  return undefined;
}

/**
 * 一条技能的许可证判定。
 *
 * @param {object} input
 * @param {string} input.declared      清单里那一级的声明（来源仓的 license）
 * @param {string} [input.frontMatter] 技能前言里的 `license:` 原值
 * @param {string} [input.licenseText] 技能自己带的许可证文件正文（没有就不传）
 * @returns {{ok: true, license: string, reads: string[], note?: string}
 *          | {ok: false, reason: string}}
 */
export function licenseVerdict({ declared, frontMatter, licenseText }) {
  const reads = ["清单"];
  const declaredSpdx = asSpdx(declared);
  if (!declaredSpdx) return { ok: false, reason: `清单声明 ${JSON.stringify(declared ?? null)} 读不成 SPDX 标识` };

  const notes = [];
  const claims = new Map([[declaredSpdx, "清单"]]);

  const fmSpdx = asSpdx(frontMatter);
  if (frontMatter !== undefined) {
    if (fmSpdx) {
      reads.push("技能前言");
      if (!claims.has(fmSpdx)) claims.set(fmSpdx, "技能前言");
    } else {
      // 散文值：留痕，不当作说法（anthropics 的 11 条就是这种写法）。
      notes.push(`前言的 license 不是 SPDX 标识（${JSON.stringify(frontMatter)}），未作为独立说法`);
    }
  }

  const fromText = identifyLicenseText(licenseText);
  if (licenseText !== undefined) {
    if (fromText) {
      reads.push("技能自带许可证正文");
      if (!claims.has(fromText)) claims.set(fromText, "技能自带许可证正文");
    } else {
      notes.push("技能自带的许可证正文认不出是哪一种，未作为独立说法");
    }
  }

  // 专有正文单独定案 —— 不需要第二个说法佐证。
  if (fromText === "proprietary") {
    return { ok: false, reason: "技能自带的许可证正文是专有条款（all rights reserved），不能随包分发" };
  }

  if (claims.size > 1) {
    const said = [...claims].map(([lic, who]) => `${who}=${lic}`).join("，");
    return { ok: false, reason: `同一批字节上多个许可证说法（${said}）—— 管辖的是限制性的那个，失败关闭` };
  }

  // 说法一致，但得在白名单里才能随包分发、默认启用。
  const license = [...claims.keys()][0];
  for (const part of license.split(/\s+(?:OR|AND|or|and)\s+/)) {
    if (!PERMISSIVE.has(part)) {
      return { ok: false, reason: `许可证 ${license} 不在随包分发的宽松白名单里` };
    }
  }
  return { ok: true, license, reads, ...(notes.length ? { note: notes.join("；") } : {}) };
}
