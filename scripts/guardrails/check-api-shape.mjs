#!/usr/bin/env node
/**
 * 本地 API 形状守卫（《产品接入通则》D-3：可自动判定的部分应由仓内守卫脚本校验）。
 *
 * 查三件 X-1/B-3 里能机器判定的事：
 *
 *   1. 错误响应不得再用旧的 `{ error: "..." }` 形状
 *   2. 错误码必须是 SCREAMING_SNAKE
 *   3. 不得出现通则词表里 Ruyin 不会发出的拒绝码
 *
 * 第 3 条不是洁癖：通则说得很直接——**加一个永不抛出的码，消费方会写一条永不
 * 触发的分支**。Ruyin 不做配额门控（配额在 SaaS，ADR-006），所以
 * QUOTA_EXCEEDED 在这里永远不会发生，写进来只会骗到读代码的人。
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = "apps/local-host/src";
/** 通则 X-1 的四个拒绝码里，Ruyin 会发出的那三个。 */
const ALLOWED_REJECTIONS = new Set([
  "NOT_ENTITLED",
  "POLICY_DENIED",
  "APPROVAL_REQUIRED",
]);
const FORBIDDEN_REJECTIONS = new Set(["QUOTA_EXCEEDED"]);

const problems = [];

function scan(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      scan(full);
      continue;
    }
    if (!e.name.endsWith(".ts") || e.name.endsWith(".test.ts")) continue;
    const text = readFileSync(full, "utf8");
    text.split("\n").forEach((line, i) => {
      const at = `${full}:${i + 1}`;
      // 1. 旧封套
      if (/\berror:\s*"/.test(line)) {
        problems.push(`${at} 旧错误形状 { error: "..." }；X-1 要求 { code, message, retryable }`);
      }
      // 2. 码的大小写
      for (const m of line.matchAll(/apiError\(\s*"([^"]+)"/g)) {
        if (!/^[A-Z][A-Z0-9_]*$/.test(m[1])) {
          problems.push(`${at} 错误码 "${m[1]}" 不是 SCREAMING_SNAKE（X-1）`);
        }
      }
      // 3. 永不抛出的拒绝码
      for (const code of FORBIDDEN_REJECTIONS) {
        if (line.includes(`"${code}"`)) {
          problems.push(
            `${at} 用了 ${code}：Ruyin 不做配额门控，这个码永远不会发生。` +
              `加一个永不抛出的码，消费方会写一条永不触发的分支（X-1）`,
          );
        }
      }
    });
  }
}

scan(SRC);

// 4. 拒绝词表必须照抄，不得自造同义词
const errors = readFileSync(join(SRC, "errors.ts"), "utf8");
for (const code of ALLOWED_REJECTIONS) {
  if (!errors.includes(code)) {
    problems.push(`errors.ts 缺少拒绝码 ${code}（X-1 词表，照抄不自造）`);
  }
}

if (problems.length > 0) {
  console.error("[api-shape] 不合规：");
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log("[api-shape] OK - 错误封套与拒绝词表符合通则 X-1 / B-3。");
