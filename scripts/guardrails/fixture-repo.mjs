/**
 * 给守卫自测用的**假仓库**。
 *
 * 守卫脚本都从自己所在的位置反推仓库根（`new URL("../..", import.meta.url)`），
 * 有几支还直接用相对路径（`"docs"`，随 cwd 走）。所以要测一个守卫「在什么情况下
 * 会拒」，最干净的办法是：**把守卫原样复制进一棵临时目录树**，再在那棵树里摆好
 * 它要读的文件。守卫看到的仓库根就是那棵树。
 *
 * 这么做有一条实打实的好处：**跑的是那个真脚本，一个字没改**。把守卫的判断逻辑
 * 抄一份出来测，测过了也只说明那份副本对 —— 而 `pnpm lint:*` 跑的是原件。
 * （check-skill-manifest.test.mjs 的头注释里写的是同一条理由，这里沿用。）
 */

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** 一棵假仓库。用完调 `clean()`。 */
export function fixtureRepo(prefix = "ruyin-guard-") {
  const root = mkdtempSync(join(tmpdir(), prefix));
  // **假仓库也得是个 git 仓库。** check-package-versions 会 `git tag --list` 找
  // 基线，不是 git 检出时它直接被 git 的原始错误打断 —— 连它自己那条「还没发过
  // 任何版本，如实说明后通过」的路都走不到。守卫在真实环境里永远跑在检出里，
  // 所以这不是它的缺陷；但假仓库要像真的，才测得到那条路。
  spawnSync("git", ["init", "-q"], { cwd: root });
  return {
    root,
    /** 在假仓库里写一个文件（父目录自动建）。 */
    write(rel, content) {
      const full = join(root, rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content, "utf8");
      return full;
    },
    /** 写一个 JSON 文件。 */
    json(rel, value) {
      return this.write(rel, JSON.stringify(value, null, 2));
    },
    /**
     * 把守卫复制进这棵树再跑它。
     *
     * 复制而不是原地跑：守卫按**自己的位置**算仓库根，原地跑的话它读的是真仓库。
     * `cwd` 也设成假仓库根，因为有几支用的是相对路径。
     */
    run(guardName, args = [], area = "guardrails") {
      // 复制到与原件**同名的子目录**下：脚本用 `new URL("../..")` 反推仓库根，
      // 放错一层，它算出来的根就差一层，读的文件全都对不上。
      const dest = join(root, "scripts", area, guardName);
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(join(HERE, "..", area, guardName), dest);
      const res = spawnSync(process.execPath, [dest, ...args], {
        cwd: root,
        encoding: "utf8",
      });
      return { code: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
    },
    clean() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/**
 * 一行合法的技术债表行。`over` 覆盖其中任意一格。
 *
 * 五格：ID / 条目 / 原因 / 回收条件 / 状态。
 */
export function tdRow(over = {}) {
  const c = {
    id: "TD-001",
    item: "某件事",
    why: "某个原因",
    how: "某个回收条件",
    status: "open",
    ...over,
  };
  return `| ${c.id} | ${c.item} | ${c.why} | ${c.how} | ${c.status} |`;
}

/** 一份最小的、能通过的技术债表。 */
export function tdTable(rows) {
  return [
    "# 技术债",
    "",
    "| ID | 条目 | 原因 | 回收条件 | 状态 |",
    "|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

/**
 * 在假仓库里做一次提交（可选打 tag）。
 *
 * 给 check-package-versions 那半「拿基线比对内容」用 —— 它 `git show` 基线那一刻的
 * package.json、`git diff` 到 HEAD 的改动，没有真提交就一条都走不到。
 *
 * 提交身份用 `-c` 传：CI 上的 runner 没有全局 user.name / user.email，不带它
 * `git commit` 会直接失败，而失败的样子是「测试超时」而不是「缺配置」。
 */
export function commitAll(root, message, tag) {
  const id = [
    "-c", "user.name=fixture",
    "-c", "user.email=fixture@example.com",
    "-c", "commit.gpgsign=false",
  ];
  spawnSync("git", ["add", "-A"], { cwd: root });
  const res = spawnSync("git", [...id, "commit", "-q", "-m", message], {
    cwd: root,
    encoding: "utf8",
  });
  if (res.status !== 0) throw new Error(`fixture commit failed: ${res.stdout}${res.stderr}`);
  if (tag) spawnSync("git", ["tag", tag], { cwd: root });
}
