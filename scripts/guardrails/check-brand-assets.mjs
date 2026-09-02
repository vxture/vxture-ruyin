#!/usr/bin/env node
/**
 * 品牌资源守卫：`public/` 里那份 logo，必须和设计系统里的源头逐字节一致。
 *
 * 起因是一个真实的错误。此前 `public/icon.svg` 是**上一轮会话自己画的**——深色
 * 圆角砖 + 一个汉字「如」+ 一个蓝点，既不是 Vxture 的品牌资产，也不出自任何图
 * 标库。它以页签图标、启动页标记、登录页标记三种身份出现在界面上，看起来像是
 * 有出处的，其实没有。而 `@vxture/design-system` 从一开始就带着真正的品牌图标
 * （`assets/brands/vx-brand/`）。
 *
 * 自创视觉资产的问题不在于难看，在于**它会被当成品牌**：用户看到的每一处标记
 * 都在替公司做身份表达，而这份表达没有经过任何人批准。
 *
 * 为什么是复制而不是 import：设计系统的 `package.json` 里 `exports` 只导出了
 * `.` / `./server` / `./styles/*` / `./tokens` / `./types`，**没有 `./assets/*`**，
 * 所以 `import "@vxture/design-system/assets/..."` 解析不到（`files` 里有
 * `assets`，包确实带着它们，只是没开子路径出口）。于是只能复制一份进 `public/`。
 *
 * 复制就会漂：设计系统改了图标，这边不会知道。这道守卫就是补上那件事——源头一
 * 变，构建当场红，而不是让两个版本的 logo 在不同产品里各自活着。
 *
 * 设计系统开出 `./assets/*` 出口之后，这个脚本连同 `public/` 里的副本一起删掉，
 * 改成直接 import。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const require = createRequire(import.meta.url);

/** 副本 -> 设计系统里的源路径（相对包根）。 */
const COPIES = [
  {
    copy: "apps/ui-workspace/public/logo.svg",
    source: "assets/brands/vx-brand/vxture-logo-icon.svg",
  },
];

function designSystemRoot() {
  // 从包的主入口反推包根：pnpm 的目录名带 hash，写死路径必然会随版本失效。
  //
  // 不能 resolve `@vxture/design-system/package.json` —— `exports` 里连
  // package.json 都没开出口，会直接 ERR_PACKAGE_PATH_NOT_EXPORTED。所以解析
  // `.` 这个唯一保证存在的出口，再往上走到带 package.json 的那一层。
  const entry = require.resolve("@vxture/design-system", {
    paths: [join(repoRoot, "apps", "ui-workspace")],
  });
  let dir = dirname(entry);
  for (let i = 0; i < 5; i++) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      if (pkg.name === "@vxture/design-system") return dir;
    } catch {
      /* 这一层没有 package.json，继续往上 */
    }
    dir = dirname(dir);
  }
  throw new Error(`从 ${entry} 往上找不到 @vxture/design-system 的包根`);
}

let failed = 0;
const dsRoot = designSystemRoot();

for (const { copy, source } of COPIES) {
  const copyPath = join(repoRoot, copy);
  const srcPath = join(dsRoot, source);
  let a, b;
  try {
    a = readFileSync(copyPath);
  } catch {
    console.error(`[brand-assets] 缺少副本：${copy}`);
    failed++;
    continue;
  }
  try {
    b = readFileSync(srcPath);
  } catch {
    console.error(
      `[brand-assets] 设计系统里找不到源文件：${source}\n` +
        `  设计系统根目录：${dsRoot}\n` +
        `  资源被移动或改名了——先确认新路径，不要就地改副本。`,
    );
    failed++;
    continue;
  }
  if (!a.equals(b)) {
    console.error(
      `[brand-assets] ${copy} 与设计系统的源文件不一致。\n` +
        `  源：${source}（${b.length} 字节）\n` +
        `  副本：${a.length} 字节\n` +
        `  修复：cp "${srcPath}" "${copyPath}"\n` +
        `  **不要改副本去迁就本地**——品牌资产的源头在设计系统那边。`,
    );
    failed++;
  }
}

if (failed > 0) process.exit(1);
console.log(
  `[brand-assets] OK - ${COPIES.length} 份品牌资源与设计系统逐字节一致。`,
);
