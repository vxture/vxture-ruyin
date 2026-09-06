#!/usr/bin/env node
/**
 * 核对获取通道每一条组件的 sha256（ADR-018 §7.2；TD-042）。
 *
 * ## 谁在跑它，什么时候（照实说，不许写成一句没人执行的承诺）
 *
 *   - **`.github/workflows/components-verify.yml`，每周一 03:17 UTC。** 那份
 *     workflow 就跑这一句。GitHub 的 `schedule` **只在默认分支上触发**，所以它是
 *     从这段代码合进 main 那一刻起才开始跑的；在分支上要么用 workflow 的手动触发
 *     （workflow_dispatch），要么本地 `pnpm components:verify`。
 *   - 失败的样子也照实说：Actions 里一条红的定时任务，加上 GitHub 给「默认分支上
 *     最后改过这份 workflow 的人」发的那封失败邮件。**没有人会被呼叫**。
 *   - **不进每次 CI**：它要真下 120 MB，放进每次提交的检查里只会让人去关掉它。
 *
 * 上一版这里写的是「按周核对」，而当时没有任何东西在排它 —— 一句读起来像自动化、
 * 实际靠人记得的话，比明说「这事没人做」更糟：它让下一个人以为有人在看着。
 *
 * ## 为什么必须有这支定期核对
 *
 * **Chrome for Testing 不发布任何校验和**（`.sha256` / `SHA256SUMS` 一律 404，
 * known-good-versions 的 JSON 里只有 url），我们清单里记的那一条是**唯一**的钉子；
 * 而上游会删旧构建。没有它，那一行会悄悄烂到用户点下去为止 —— 而那一刻用户看到的
 * 是「上游已经没有这一版了」，一句正确但来得太晚的话。
 *
 * 只读、不落盘、不解压：流式取回来算一次摘要就丢。origin 白名单与运行时同一份，
 * 协议同样只走 https（运行时那道 `url.protocol !== "https:"` 的同一条纪律）。
 *
 * 用法：pnpm components:verify [--only <id>]
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const manifest = JSON.parse(readFileSync(join(repoRoot, "resources", "skill-manifest.json"), "utf8"));
const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;
const allowed = new Set((manifest.allowedOrigins ?? []).map((o) => new URL(o).origin));
const components = (manifest.components ?? []).filter((c) => !only || c.id === only);

if (components.length === 0) {
  console.log("[components:verify] 清单里没有组件 —— 这一版没有获取通道，没什么可核的。");
  process.exit(0);
}

let bad = 0;
for (const c of components) {
  const url = new URL(c.source.url);
  if (url.protocol !== "https:" || !allowed.has(url.origin)) {
    console.error(`[components:verify] ${c.id}: ${url.origin} 不是 https，或不在 allowedOrigins 里`);
    bad++;
    continue;
  }
  process.stdout.write(`[components:verify] ${c.id} ${c.version} … `);
  try {
    // 与运行时同一条：不跟重定向。跟着跳，核的就不是白名单上那台主机发的字节了。
    const res = await fetch(url, { redirect: "manual" });
    if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
      throw new Error(`上游把请求重定向到 ${res.headers.get("location") ?? "（未给 Location）"} —— 这里不跟跳`);
    }
    if (res.status === 404 || res.status === 410) {
      throw new Error(`HTTP ${res.status} —— **上游已经删了这个构建**，pin 必须更新（这正是这支脚本存在的理由）`);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of res.body) {
      bytes += chunk.length;
      hash.update(chunk);
      // 与运行时同一条纪律：超过清单说的就停，不替对方把字节读完。
      if (bytes > c.size) throw new Error(`上游发来的已超过清单说的 ${c.size} 字节`);
    }
    const digest = hash.digest("hex");
    if (bytes !== c.size) throw new Error(`${bytes} 字节，清单说 ${c.size}`);
    if (digest !== c.sha256) throw new Error(`sha256 ${digest}，清单说 ${c.sha256}`);
    console.log("OK");
  } catch (cause) {
    console.log("FAILED");
    console.error(`[components:verify]   ${cause instanceof Error ? cause.message : String(cause)}`);
    bad++;
  }
}

if (bad) {
  console.error(
    `[components:verify] ${bad} 条对不上。**先查上游是不是删了这个构建**（Chrome for Testing 会删旧版本），` +
      `再决定是换一条钉死的版本、还是这一条组件下线。改摘要之前必须先弄清为什么变了。`,
  );
  process.exit(1);
}
console.log(`[components:verify] OK - ${components.length} 条组件的字节与清单一致。`);
