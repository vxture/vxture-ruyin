#!/usr/bin/env node
/**
 * 从品牌 SVG 生成 Windows 应用图标（`apps/shell/icons/icon.ico`）。
 *
 * 为什么需要这个脚本：设计系统里那三个现成的 .ico 没有一个能直接用。
 * `favicon-platform.ico` 只有单张 64、`favicon-products.ico` 单张 32，而
 * electron-builder 要求 Windows 图标至少含一张 256 —— 只有 `favicon-admin.ico`
 * 是多尺寸的，但那是「admin」那条线的资产，语义上不属于 ruyin。
 *
 * 所以从**矢量源**重新渲染：`favicon-platform.ico` 里的图形和
 * `vxture-logo-icon.svg` 是同一个编织标，从 SVG 出的 256 是真清晰的，把 64 拉大
 * 到 256 只会糊。尺寸档位与编码（7 档全 PNG、32bpp）照抄设计系统自己那份
 * `favicon-admin.ico` 的惯例，不另立一套。
 *
 * 渲染器用 Electron —— 它就是 Chromium，仓库里本来就有（打包要用），不必为一张
 * 图标引入 sharp/resvg 这类带原生二进制的依赖。
 *
 * 产物**是签入仓库的**，不在打包时现生成：`packaged-smoke` 是必须永远上报的
 * 必需检查，往它里面塞一个「起一个 Electron 去画图」的步骤，是拿那道闸门的可靠
 * 性换一件一年也不会变一次的事。
 *
 * 什么时候要重跑：品牌 SVG 变了的时候。`pnpm lint:brand-assets` 会在源头和
 * `public/logo.svg` 不一致时报错 —— 修完那个之后，跑一次这个脚本把图标一起更新：
 *
 *     pnpm gen:app-icon
 */

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { app, BrowserWindow } from "electron";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const SOURCE_SVG = join(repoRoot, "apps", "ui-workspace", "public", "logo.svg");
// 放在 icons/ 而不是 electron-builder 惯例的 build/：`build/` 在 .gitignore 里
// 是整目录忽略的（那一条管的是各包的构建产物），而 git **无法在被忽略的目录里
// 单独放行一个文件** —— 父目录被排除，里面的 `!` 规则不生效。这张图标是签入
// 仓库的源资产，不是构建产物，所以换个不打架的位置，并在 electron-builder.yml
// 里显式指过去。
const OUT_ICO = join(repoRoot, "apps", "shell", "icons", "icon.ico");

/** 与设计系统 favicon-admin.ico 同一组档位。 */
const SIZES = [16, 24, 32, 48, 64, 128, 256];

/**
 * 组装 ICO 容器。
 *
 * 结构：6 字节文件头 + 每张 16 字节目录项 + 各张图像数据。目录项里的宽高是
 * **单字节**，所以 256 要写成 0 —— 这是 ICO 格式里最容易踩的一处，写 256 会被
 * 截断成 0 之外的垃圾值，Windows 那一档就直接不认。
 */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = icon
  header.writeUInt16LE(images.length, 4);

  const dir = Buffer.alloc(16 * images.length);
  let offset = header.length + dir.length;
  images.forEach(({ size, png }, i) => {
    const o = i * 16;
    dir[o] = size === 256 ? 0 : size; // width
    dir[o + 1] = size === 256 ? 0 : size; // height
    dir[o + 2] = 0; // palette colours (0 = truecolour)
    dir[o + 3] = 0; // reserved
    dir.writeUInt16LE(1, o + 4); // colour planes
    dir.writeUInt16LE(32, o + 6); // bits per pixel
    dir.writeUInt32LE(png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });

  return Buffer.concat([header, dir, ...images.map((i) => i.png)]);
}

async function main() {
  await app.whenReady();

  const svg = readFileSync(SOURCE_SVG, "utf8");
  const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

  const win = new BrowserWindow({
    show: false,
    width: 320,
    height: 320,
    webPreferences: { offscreen: true },
  });
  await win.loadURL("data:text/html,<body></body>");

  const encoded = await win.webContents.executeJavaScript(`
    (async () => {
      const img = new Image();
      img.src = ${JSON.stringify(dataUri)};
      await img.decode();
      const out = [];
      for (const size of ${JSON.stringify(SIZES)}) {
        const c = document.createElement("canvas");
        c.width = size;
        c.height = size;
        const ctx = c.getContext("2d");
        // 高质量缩放：默认的最近邻在 16px 上会把编织的交叉处啃掉一块。
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, size, size);
        out.push({ size, dataUrl: c.toDataURL("image/png") });
      }
      return out;
    })()
  `);

  const images = encoded.map(({ size, dataUrl }) => ({
    size,
    png: Buffer.from(dataUrl.split(",")[1], "base64"),
  }));

  for (const { size, png } of images) {
    if (png[0] !== 0x89 || png[1] !== 0x50) {
      throw new Error(`${size}px 渲染结果不是 PNG`);
    }
  }

  mkdirSync(dirname(OUT_ICO), { recursive: true });
  writeFileSync(OUT_ICO, buildIco(images));

  const total = images.reduce((n, i) => n + i.png.length, 0);
  console.log(
    `[app-icon] ${OUT_ICO}\n` +
      `[app-icon] ${images.length} 档：${images.map((i) => `${i.size}(${i.png.length}B)`).join(" ")}\n` +
      `[app-icon] 图像数据合计 ${total}B，源：${SOURCE_SVG}`,
  );

  win.destroy();
  app.quit();
}

main().catch((err) => {
  console.error("[app-icon] 失败：", err);
  app.exit(1);
});
