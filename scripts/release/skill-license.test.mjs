/**
 * skill-license.mjs 的测试。
 *
 * 每个用例都钉着一件在 2026-09-09 实际核过的事实，而不是一个想象出来的形状 ——
 * 判定逻辑一旦放宽，先垮的就是这几条：
 *
 * - `xberg-io/xberg`：仓库级 MIT，技能前言 Elastic-2.0。它曾以 default 档随包
 *   默认启用（清单只读了仓库级那一读）。
 * - `anthropics/skills` 的 11 条：前言写的是一句散文 `Complete terms in
 *   LICENSE.txt`。把散文当第二个说法比对，会把 11 条合规技能全部误杀。
 * - 同一个仓里 docx / pdf / pptx / xlsx 四条自带的 LICENSE.txt 是专有条款，
 *   而仓库级是 Apache-2.0 —— 只读仓库级会把它们收进来。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { asSpdx, identifyLicenseText, licenseVerdict } from "./skill-license.mjs";

const APACHE = "                                 Apache License\n                           Version 2.0, January 2004\n";
const PROPRIETARY = "Copyright 2026 Example Inc.\nAll rights reserved.\nYou may not retain copies or redistribute.\n";
const GPL = "                    GNU GENERAL PUBLIC LICENSE\n                       Version 3, 29 June 2007\n";

test("xberg：仓库级说 MIT，技能自己说 Elastic-2.0 —— 拒", () => {
  const v = licenseVerdict({ declared: "MIT", frontMatter: "Elastic-2.0" });
  assert.equal(v.ok, false);
  assert.match(v.reason, /多个许可证说法/);
  assert.match(v.reason, /Elastic-2\.0/);
});

test("anthropics：前言是一句散文，不当作第二个说法", () => {
  const v = licenseVerdict({
    declared: "Apache-2.0",
    frontMatter: "Complete terms in LICENSE.txt",
    licenseText: APACHE,
  });
  assert.equal(v.ok, true);
  assert.equal(v.license, "Apache-2.0");
  assert.match(v.note, /不是 SPDX 标识/);
});

test("仓库级 Apache-2.0，技能自带的正文是专有条款 —— 正文单独定案", () => {
  const v = licenseVerdict({ declared: "Apache-2.0", licenseText: PROPRIETARY });
  assert.equal(v.ok, false);
  assert.match(v.reason, /专有条款/);
});

test("三处说法一致 —— 通过，且记下读了哪几处", () => {
  const v = licenseVerdict({ declared: "Apache-2.0", frontMatter: "Apache-2.0", licenseText: APACHE });
  assert.equal(v.ok, true);
  assert.deepEqual(v.reads, ["清单", "技能前言", "技能自带许可证正文"]);
  assert.equal(v.note, undefined);
});

test("只有清单一处说法 —— 通过，但 reads 如实只有一条", () => {
  const v = licenseVerdict({ declared: "MIT" });
  assert.equal(v.ok, true);
  assert.deepEqual(v.reads, ["清单"]);
});

test("说法一致但不在宽松白名单里 —— 照样拒（一致不等于可以随包分发）", () => {
  const v = licenseVerdict({ declared: "Elastic-2.0", frontMatter: "Elastic-2.0" });
  assert.equal(v.ok, false);
  assert.match(v.reason, /不在随包分发的宽松白名单/);
});

test("copyleft 正文与仓库级冲突 —— 拒", () => {
  const v = licenseVerdict({ declared: "MIT", licenseText: GPL });
  assert.equal(v.ok, false);
  assert.match(v.reason, /多个许可证说法/);
});

test("复合式 `MIT OR Apache-2.0` 两半都在白名单里 —— 通过", () => {
  assert.equal(licenseVerdict({ declared: "MIT OR Apache-2.0" }).ok, true);
});

test("复合式里有一半不在白名单 —— 拒", () => {
  const v = licenseVerdict({ declared: "MIT OR SSPL-1.0" });
  assert.equal(v.ok, false);
  assert.match(v.reason, /不在随包分发的宽松白名单/);
});

test("清单声明本身读不成 SPDX —— 拒（守卫拦不住的形状，这里兜底）", () => {
  const v = licenseVerdict({ declared: "见 README" });
  assert.equal(v.ok, false);
  assert.match(v.reason, /读不成 SPDX/);
});

test("asSpdx：散文不是标识，标识是标识", () => {
  assert.equal(asSpdx("Complete terms in LICENSE.txt"), undefined);
  assert.equal(asSpdx("see the LICENSE file"), undefined);
  assert.equal(asSpdx("Elastic-2.0"), "Elastic-2.0");
  assert.equal(asSpdx("mit"), "MIT");
  assert.equal(asSpdx('"Apache-2.0"'), "Apache-2.0");
  assert.equal(asSpdx("Apache 2.0"), "Apache-2.0");
  assert.equal(asSpdx(undefined), undefined);
});

test("identifyLicenseText：认得出的认，认不出的不猜", () => {
  assert.equal(identifyLicenseText(APACHE), "Apache-2.0");
  assert.equal(identifyLicenseText(PROPRIETARY), "proprietary");
  assert.equal(identifyLicenseText(GPL), "GPL");
  assert.equal(identifyLicenseText("Elastic License 2.0\n\nAcceptance"), "Elastic-2.0");
  // MIT 与 ISC 的正文开头几乎一样。不猜 —— 宁可漏判一次留痕，不可误杀。
  assert.equal(identifyLicenseText("Permission is hereby granted, free of charge, to any person"), undefined);
  assert.equal(identifyLicenseText(""), undefined);
});

test("认不出的正文只留 note，不否定别处的说法", () => {
  const v = licenseVerdict({ declared: "ISC", licenseText: "Permission is hereby granted, free of charge, to any person" });
  assert.equal(v.ok, true);
  assert.match(v.note, /认不出/);
});
