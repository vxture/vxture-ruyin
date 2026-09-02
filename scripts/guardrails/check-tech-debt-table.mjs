#!/usr/bin/env node
/**
 * 技术债表的可解析性守卫。
 *
 * 这张表是**工具读的**，不是给人扫的：谁还开着、谁在等谁、哪条该关，都要靠机器
 * 数出来。所以它坏掉的方式很安静 —— 表格照常渲染，只是某一行多切了一列。
 *
 * 2026-09-02 一次清点里，四行都是坏的：`tier!=null||bundled`、
 * `continuous | project`（两处）、`activate|deactivate` —— **代码里的管道没转义**。
 * GFM 的表格即使在反引号里也照样按 `|` 切列，必须写成 `\|`。TD-018 还另外少了
 * 一个列分隔符，条目和原因被并成了一格。
 *
 * 后果不是难看，是**数错**：那次统计连着两次把 open 数少报了一条，而少报的那条
 * （TD-018）恰好是 MVP 旅程里还亮着黄灯的一项。一张会算错的账，比没有账更危险，
 * 因为它看起来是有账的。
 *
 * 于是这道守卫只管一件事：**每一行都能被机器正确切成五格**。内容对不对不归它
 * 管，那是人的事；能不能被数清楚，归它。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const FILE = join(repoRoot, "docs", "60-operations", "10-tech-debt.md");
const STATUSES = new Set(["open", "closed", "standing"]);

/** 按 `|` 切列，但尊重 `\|` 转义 —— 不尊重它就会把代码里的管道当成列分隔符。 */
function cells(line) {
  const out = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\" && line[i + 1] === "|") {
      cur += "|";
      i++;
      continue;
    }
    if (line[i] === "|") {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += line[i];
  }
  out.push(cur);
  // 首尾是表格边界带来的空格子。
  return out
    .map((x) => x.trim())
    .filter((x, i, a) => !((i === 0 || i === a.length - 1) && x === ""));
}

const rows = readFileSync(FILE, "utf8")
  .split(/\r?\n/)
  .map((line, i) => ({ line, no: i + 1 }))
  .filter(({ line }) => /^\| TD-\d+/.test(line));

if (rows.length === 0) {
  console.error("[tech-debt] 一行 TD 都没解析到 —— 表格结构变了？");
  process.exit(1);
}

const problems = [];
const seen = new Map();
const tally = { open: 0, closed: 0, standing: 0 };

for (const { line, no } of rows) {
  const c = cells(line);
  const id = c[0] ?? "(?)";
  if (c.length !== 5) {
    problems.push(
      `第 ${no} 行 ${id}：切出 ${c.length} 格，应为 5（ID / 条目 / 原因 / 回收条件 / 状态）。\n` +
        `    多半是正文里有没转义的 \`|\` —— 代码片段里的管道也要写成 \\| ，反引号救不了它。\n` +
        `    也可能是少了一个列分隔符（条目与原因被并成一格）。`,
    );
    continue;
  }
  const status = c[4];
  if (!STATUSES.has(status)) {
    problems.push(
      `第 ${no} 行 ${id}：状态是 ${JSON.stringify(status.slice(0, 40))}，` +
        `只允许 ${[...STATUSES].join(" / ")}。`,
    );
    continue;
  }
  tally[status]++;
  if (seen.has(id)) {
    problems.push(`${id} 重复出现（第 ${seen.get(id)} 行与第 ${no} 行）——编号不复用。`);
  }
  seen.set(id, no);
}

if (problems.length > 0) {
  console.error("[tech-debt] 表格解析不干净：\n");
  for (const p of problems) console.error("  - " + p + "\n");
  console.error(
    "  这张表是给工具读的：切不干净就会数错，而数错的账比没有账更危险。",
  );
  process.exit(1);
}

console.log(
  `[tech-debt] OK - ${rows.length} 条均可解析；` +
    `open ${tally.open} / closed ${tally.closed} / standing ${tally.standing}。`,
);
