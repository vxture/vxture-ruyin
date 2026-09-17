#!/usr/bin/env node
/**
 * i18n 守卫（owner 2026-09-17：全面改造，当前中文 + 英文）。
 *
 * 管三件事：
 *
 * 1. **两门语言的键必须一一对应。** 类型已经在编译期管住了大部分，但类型只看
 *    `en` 有没有多/少键；这里再核一遍复数对（有 `_other` 就得有 `_one`），
 *    那是类型表达不了的。
 * 2. **英文目录里不许出现中文。** 漏翻一句时 `t()` 会回退到中文原句，界面上
 *    看得见，但如果有人把中文原句抄进英文目录，回退就再也发现不了了。
 * 3. **已经转换过的界面文件里不许再出现裸中文。** 这是防退化的那一条：
 *    下一个人加一句话时，很自然地就写成字面量了。
 *
 * 第 3 条带一份 `PENDING` 名单 —— 还没轮到的文件列在那里。**名单只许变短。**
 * 它不是豁免，是进度条：清空那天把这段和名单一起删掉。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const uiSrc = join(repoRoot, "apps", "ui-workspace", "src");
const HAN = /[一-鿿]/;

/**
 * 还没转换的界面文件。**只许变短。**
 *
 * `capability-groups.ts` 不在这里，它永远不进名单：那份关键词表是**匹配用的
 * 输入**，不是文案。翻译掉它，能力分组就会漂。`catalog.ts` 同理 —— 那是平台
 * 产品目录的快照，产品名与简介是产品方写的，我们不改也不猜。
 */
const PENDING = new Set(["settings.tsx", "workspace.tsx"]);

/** 本来就不是文案的文件。 */
const NOT_COPY = new Set([
  "capability-groups.ts",
  "catalog.ts",
  "third-party-list.ts",
  "vitest.setup.ts",
  // 语言自己的名字**故意不翻译**：「简体中文」在英文界面里也写「简体中文」，
  // 因为要换语言的人多半正读不懂当前这一门。
  "i18n.ts",
]);

const problems = [];

/* ---- 一、目录对账 -------------------------------------------------------- */

const zhSrc = readFileSync(join(uiSrc, "locales", "zh-CN.ts"), "utf8");
const enSrc = readFileSync(join(uiSrc, "locales", "en.ts"), "utf8");

/** 从目录源码里取键。不 import：这是个 .mjs 脚本，目录是 TypeScript。 */
function keysOf(src) {
  return new Set([...src.matchAll(/^\s{2}"([^"]+)":/gm)].map((m) => m[1]));
}
const zhKeys = keysOf(zhSrc);
const enKeys = keysOf(enSrc);

for (const k of zhKeys) {
  if (!enKeys.has(k)) problems.push(`英文目录少了一个键：${k}`);
}
for (const k of enKeys) {
  if (!zhKeys.has(k)) problems.push(`英文目录多了一个键（中文里没有）：${k}`);
}
for (const k of zhKeys) {
  if (k.endsWith("_other") && !zhKeys.has(k.replace(/_other$/, "_one"))) {
    problems.push(`带计数的句子只写了 _other，缺 _one：${k}`);
  }
}

/* ---- 二、英文目录里不许有中文 -------------------------------------------- */

for (const [i, line] of enSrc.split("\n").entries()) {
  // 注释里可以写中文（写给我们自己看的）；句子里不行。
  const text = line.replace(/\/\/.*$/, "").replace(/\/\*.*$/, "");
  if (HAN.test(text)) {
    problems.push(
      `en.ts:${i + 1} 英文目录里出现了中文 —— 漏翻时 t() 会自己回退到中文，` +
        `抄一份进来反而把漏翻藏起来了：${line.trim().slice(0, 60)}`,
    );
  }
}

/* ---- 三、转换过的文件里不许有裸中文 -------------------------------------- */

/** 去掉注释与 import，剩下的才是会渲染出去的东西。 */
function strip(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^import[\s\S]*?;$/gm, "");
}

for (const file of readdirSync(uiSrc)) {
  if (!/\.tsx?$/.test(file)) continue;
  if (file.includes(".test.")) continue;
  if (PENDING.has(file) || NOT_COPY.has(file)) continue;
  const body = strip(readFileSync(join(uiSrc, file), "utf8"));
  const lines = body.split("\n");
  for (const [i, line] of lines.entries()) {
    if (!HAN.test(line)) continue;
    problems.push(
      `${file}:${i + 1} 裸中文 —— 文案走 t("…")，键加在 locales/zh-CN.ts：` +
        `${line.trim().slice(0, 70)}`,
    );
  }
}

if (problems.length > 0) {
  console.error("[i18n] 不合规：");
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(
  `[i18n] OK - ${zhKeys.size} 个键，两门语言齐平；` +
    `${PENDING.size} 个文件待转换（名单只许变短）。`,
);
