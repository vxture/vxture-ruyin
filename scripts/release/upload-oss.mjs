#!/usr/bin/env node
/**
 * 把一次发布推到下载主机（阿里云 OSS，`oss.ruyin.work`）。
 *
 * 为什么不是 worker-01：那台机器的出口是**固定 3 Mbps**，一个 156 MB 的安装包要走
 * 七分钟，而那七分钟里 console / atlas / accounts 跟它抢同一条管子。下载路径因此
 * 整个挪到对象存储上，worker-01 只管它原来那些服务（owner 2026-09-18）。
 *
 * 为什么不用 ossutil：那是一个要从网上取回来的二进制，而本仓对「随构建取回的字节」
 * 有一条现成的规矩 —— 钉死 sha256、验过再用（`component-store.ts` / `seed-node-runtime.mjs`）。
 * 为了上传几个文件去背一套「取 + 校验 + 版本升级」的负担不划算，而 OSS 的签名是
 * HMAC-SHA1 + 一个字符串，加起来比那套护栏短。**所以这里自己签**，零依赖。
 *
 * ## 顺序就是这份脚本的全部要害
 *
 * OSS 没有「目录原子改名」。所以自洽靠顺序保证：
 *
 *   1. 先传**带版本号**的 exe / blockmap —— 新对象，现网一个字节都没变；
 *   2. 再覆盖 `Ruyin-Setup-latest.exe`（固定地址那一个，服务端 copy，不重传）；
 *   3. **最后**覆盖 `latest.yml` / `manifest.json` / `SHA256SUMS`。
 *
 * 指针最后改。中途断在任何一步，用户拿到的都还是上一版**完整**的一套。反面教材是
 * 实测过的：2026-09-18 发 beta 时 GitHub 的上传端回了一个 500，而那条路是「先删旧的
 * 再传新的」，于是渠道停在一个安装包都没有的状态上（见 release.yml 里那段注释）。
 *
 * ## 缓存头错了不会报错，只会让所有人停在上一版
 *
 * 带版本号的对象内容永不变，长缓存；**三个指针必须 `no-cache`** —— 它们就是「谁是
 * 最新」的唯一答案。这一条错了的症状是「发布成功，但所有人还在下上一版」，而且没有
 * 任何一处会告诉你。
 *
 * ## 传完要真的拉一次
 *
 * 「传上去了」与「没人能下」长得一模一样。所以末尾把 `latest.yml` 原样拉回来逐字节
 * 比对，再对固定地址那条发一次 Range 请求。`OSS_PUBLIC_BASE` 给了就连公开域名一起
 * 验（那才是用户真正走的那条路）；没给就只验桶端点，并且**把这件事说出来**，不装作
 * 验过了。
 *
 * 用法：node scripts/release/upload-oss.mjs <stable|beta> <version> <目录>
 * 环境：OSS_KEY_ID / OSS_KEY_SECRET / OSS_ENDPOINT / OSS_BUCKET [/ OSS_PUBLIC_BASE]
 */

import { createHmac } from "node:crypto";
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";

/** 上传时带的头：内容不变的长缓存，指针一律不缓存。 */
export function headersFor(key) {
  const name = posix.basename(key);
  const pointer = name === "Ruyin-Setup-latest.exe" || /^(latest\.yml|manifest\.json|SHA256SUMS|index\.json)$/.test(name);
  return {
    "Content-Type": contentTypeFor(name),
    // `no-cache` 不是「不缓存」，是「每次都回源问一句」—— 对几百字节的指针文件，
    // 这点开销换来的是「发布完立刻生效」。带版本号的那些则永不变，可以钉死一年。
    "Cache-Control": pointer ? "no-cache" : "public, max-age=31536000, immutable",
  };
}

export function contentTypeFor(name) {
  if (name.endsWith(".exe")) return "application/octet-stream";
  if (name.endsWith(".blockmap")) return "application/octet-stream";
  if (name.endsWith(".ruyinpkg")) return "application/octet-stream";
  if (name.endsWith(".yml") || name.endsWith(".yaml")) return "text/yaml; charset=utf-8";
  if (name.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

/**
 * 一次发布要上传的对象，**按必须的先后排好**（见文件头「顺序就是全部要害」）。
 * 纯函数：给一份文件名清单，回一份 `{ from, key, stage }`，好让它能被测。
 */
export function planUpload(channel, files) {
  const versioned = files.filter((f) => /^Ruyin-Setup-.+\.exe(\.blockmap)?$/.test(f) && !f.startsWith("Ruyin-Setup-latest"));
  // 指针之间**也有先后**：`latest.yml` 最后。它是客户端检查更新真正读的那一份，
  // 一旦它翻到新版本，旁边的校验和与清单就必须已经是新的 —— 反过来的那半秒里，
  // 有人拿到的会是「新版本号 + 旧校验和」。
  const RANK = { SHA256SUMS: 0, "manifest.json": 1, "latest.yml": 2 };
  const pointers = files.filter((f) => f in RANK).sort((a, b) => RANK[a] - RANK[b]);
  const out = [];
  for (const f of versioned) out.push({ from: f, key: `${channel}/${f}`, stage: "versioned" });
  for (const f of pointers) out.push({ from: f, key: `${channel}/${f}`, stage: "pointer" });
  return out;
}

/**
 * 版本先后。**不能按字符串排** —— 实测（2026-09-18 真跑一遍抓到的）：字符串序里
 * `"0.0.10" < "0.0.9"`，于是第三次发布时它留下了 0.0.9、删掉了 0.0.10，而 0.0.10
 * 正是回滚要用的那一版。删错的那一刻什么都不会说：发布照样绿，直到某天要回滚才发现
 * 字节没了。
 *
 * 按数字段比；段数不同的短的补 0（`1.2` < `1.2.1`）；带后缀的（`1.2.0-rc1`）数字段
 * 相同时排在正式版**前面**，与 semver 一致。
 */
export function compareVersions(a, b) {
  const parts = (v) => (v.split(/[-+]/)[0] ?? "").split(".").map((x) => Number(x) || 0);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  const sa = a.includes("-") ? a.slice(a.indexOf("-")) : "";
  const sb = b.includes("-") ? b.slice(b.indexOf("-")) : "";
  if (sa === sb) return 0;
  if (sa === "") return 1;
  if (sb === "") return -1;
  return sa < sb ? -1 : 1;
}

/**
 * 留哪几版、删哪几版。**留当前版与上一版**：回滚就是把三个指针覆盖回上一版，
 * 而回滚的前提是那一版的字节还在。再老的删掉，省存储。
 *
 * 传进来的是 `<channel>/Ruyin-Setup-<版本>.exe[.blockmap]` 这些键。
 */
export function planPrune(keys, keepVersions) {
  const byVersion = new Map();
  for (const key of keys) {
    const m = /Ruyin-Setup-(\d+\.\d+\.\d+[^/]*?)\.exe(\.blockmap)?$/.exec(key);
    if (!m) continue;
    const v = m[1];
    if (!byVersion.has(v)) byVersion.set(v, []);
    byVersion.get(v).push(key);
  }
  const drop = [];
  for (const [v, list] of byVersion) if (!keepVersions.includes(v)) drop.push(...list);
  return drop.sort();
}

// ---------------------------------------------------------------------------
// 以下是真要联网的那一半
// ---------------------------------------------------------------------------

const need = (name) => {
  const v = process.env[name];
  if (!v) {
    console.error(`[upload-oss] 缺环境变量 ${name}`);
    process.exit(2);
  }
  return v;
};

/**
 * OSS 的签名（V1）：`VERB\nContent-MD5\nContent-Type\nDate\nCanonicalizedOSSHeaders + CanonicalizedResource`
 * 取 HMAC-SHA1 再 base64。**单列出来是为了能测** —— 签名错的症状是 403，而 403 有
 * 好几种来路（签名不对、权限没挂、桶名写错），分不清就只能瞎试。
 */
export function stringToSign({ verb, contentType = "", contentMd5 = "", date, headers = {}, resource }) {
  // **只有 `x-oss-` 开头的头进签名。** 别的头（Cache-Control、Content-Disposition…）
  // 照发不误，但签名里不能有它们 —— 多签一个，OSS 算出来的就和我们不一样，而它报的
  // 是 SignatureDoesNotMatch，那句话不会告诉你多签了哪一个。
  const canonical = Object.entries(headers)
    .map(([k, v]) => [k.toLowerCase(), v])
    .filter(([k]) => k.startsWith("x-oss-"))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}:${v}\n`)
    .join("");
  return `${verb}\n${contentMd5}\n${contentType}\n${date}\n${canonical}${resource}`;
}

function sign(secret, text) {
  return createHmac("sha1", secret).update(text).digest("base64");
}


/**
 * 真联网的那一半。包在 main() 里，是为了让上面那几个纯函数能被 import 进测试而
 * **不会顺带跑一次真上传** —— 与 third-party.mjs 同一个写法。
 */
async function main(argv) {
  async function ossRequest({ verb, key, body, contentType, headers: extra = {}, query = "" }) {
    const date = new Date().toUTCString();
    // **查询串不进签名。** `?prefix=` / `?max-keys=` 这类不是 OSS 的「子资源」，
    // 签进去就对不上 —— 实测（2026-09-18）：上传全过，列目录那一步回
    // SignatureDoesNotMatch。要签的只有路径，列桶时是 `/<桶>/`。
    const resource = `/${BUCKET}/${key}`;
    const text = stringToSign({ verb, contentType: contentType ?? "", date, headers: extra, resource });
    const headers = {
      Date: date,
      Authorization: `OSS ${KEY_ID}:${sign(KEY_SECRET, text)}`,
      ...(contentType ? { "Content-Type": contentType } : {}),
      ...extra,
    };
    const url = `https://${BUCKET}.${ENDPOINT}/${key}${query}`;
    const res = await fetch(url, { method: verb, headers, ...(body ? { body } : {}) });
    return { status: res.status, text: await res.text().catch(() => ""), headers: res.headers };
  }

  /** 失败要说清是哪一件、哪一步、OSS 自己怎么说的 —— 一句「上传失败」排不了障。 */
  function must(res, what) {
    if (res.status >= 200 && res.status < 300) return res;
    const code = /<Code>([^<]*)<\/Code>/.exec(res.text)?.[1] ?? "";
    const msg = /<Message>([^<]*)<\/Message>/.exec(res.text)?.[1] ?? res.text.slice(0, 200);
    console.error(`[upload-oss] ${what} 失败：HTTP ${res.status} ${code} ${msg}`);
    process.exit(1);
  }

  const [channel, version, dir] = argv;
  if (!channel || !["stable", "beta"].includes(channel) || !version || !dir) {
    console.error("usage: upload-oss.mjs <stable|beta> <version> <dir>");
    process.exit(2);
  }

  const KEY_ID = need("OSS_KEY_ID");
  const KEY_SECRET = need("OSS_KEY_SECRET");
  const ENDPOINT = need("OSS_ENDPOINT");
  const BUCKET = need("OSS_BUCKET");
  const PUBLIC_BASE = (process.env["OSS_PUBLIC_BASE"] ?? "").replace(/\/+$/, "");

  const files = readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile());
  const plan = planUpload(channel, files);
  if (!plan.some((p) => p.stage === "versioned" && p.key.endsWith(".exe"))) {
    console.error(`[upload-oss] ${dir} 里没有带版本号的安装包 —— 不上传半份发布`);
    process.exit(1);
  }

  // 1. 带版本号的先上去：新对象，现网无感。
  for (const item of plan.filter((p) => p.stage === "versioned")) {
    const body = readFileSync(join(dir, item.from));
    const h = headersFor(item.key);
    must(
      await ossRequest({
        verb: "PUT",
        key: item.key,
        body,
        contentType: h["Content-Type"],
        headers: { "Cache-Control": h["Cache-Control"] },
      }),
      `上传 ${item.key}`,
    );
    console.log(`[upload-oss] ${item.key} (${(body.length / 1048576).toFixed(1)} MB)`);
  }

  // 2. 固定地址那一个：**服务端 copy，不重传** —— 同一段字节没必要走两遍网络。
  //    缓存头要显式换成 no-cache（copy 默认连头一起抄，抄来的是那条 immutable）。
  {
    const src = plan.find((p) => p.stage === "versioned" && p.key.endsWith(".exe"));
    const key = `${channel}/Ruyin-Setup-latest.exe`;
    must(
      await ossRequest({
        verb: "PUT",
        key,
        contentType: "application/octet-stream",
        headers: {
          "x-oss-copy-source": `/${BUCKET}/${src.key}`,
          "x-oss-metadata-directive": "REPLACE",
          "Cache-Control": "no-cache",
        },
      }),
      `复制 ${key}`,
    );
    console.log(`[upload-oss] ${key} ← ${src.key}（服务端复制）`);
  }

  // 3. 指针最后改。断在这之前，用户拿到的还是上一版完整的一套。
  for (const item of plan.filter((p) => p.stage === "pointer")) {
    const body = readFileSync(join(dir, item.from));
    const h = headersFor(item.key);
    must(
      await ossRequest({
        verb: "PUT",
        key: item.key,
        body,
        contentType: h["Content-Type"],
        headers: { "Cache-Control": h["Cache-Control"] },
      }),
      `上传 ${item.key}`,
    );
    console.log(`[upload-oss] ${item.key} (${body.length} B, no-cache)`);
  }

  // 4. 静态产品库（TD-037 的那一半）。两道门：
  //
  //    - **只有 stable 传**：产品库的地址不分渠道（客户端的 DEFAULT_REGISTRY_BASE
  //      是一条），beta 传上去会盖掉稳定用户的那一份；
  //    - **要显式开**（RUYIN_PUBLISH_REGISTRY=1）：仓里现在唯一的产品是那个测试
  //      夹具（TD-006 / TD-033），把它发到公开的产品登记册上等于对外说「这里有一个
  //      可以装的产品」，而那不是真的（owner 2026-09-18）。有真产品要分发时打开它。
  if (channel === "stable" && process.env["RUYIN_PUBLISH_REGISTRY"] === "1") {
    const productsDir = join(dir, "products");
    const uploads = [];
    const walk = (d, prefix) => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, entry.name);
        if (entry.isDirectory()) walk(full, `${prefix}${entry.name}/`);
        else uploads.push({ key: `products/${prefix}${entry.name}`, full, h: headersFor(entry.name) });
      }
    };
    try {
      walk(productsDir, "");
    } catch {
      console.log("[upload-oss] 这一版没有静态产品库（release/products 不在），跳过");
    }
    for (const u of uploads) {
      must(
        await ossRequest({
          verb: "PUT",
          key: u.key,
          body: readFileSync(u.full),
          contentType: u.h["Content-Type"],
          headers: { "Cache-Control": u.h["Cache-Control"] },
        }),
        `上传 ${u.key}`,
      );
    }
    if (uploads.length) console.log(`[upload-oss] 静态产品库 ${uploads.length} 个对象`);
  }

  // 5. 清理：留当前版与上一版（回滚要靠上一版的字节还在），再老的删。
  {
    const list = await ossRequest({ verb: "GET", key: "", query: `?prefix=${encodeURIComponent(`${channel}/`)}&max-keys=1000` });
    must(list, "列出渠道目录");
    // 只要键名。XML 就这一处，用不着为它背一个解析器。
    const keys = [...list.text.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
    const previous = [...new Set(keys.map((k) => /Ruyin-Setup-(\d+\.\d+\.\d+[^/]*?)\.exe/.exec(k)?.[1]).filter(Boolean))]
      .filter((v) => v !== version)
      .sort(compareVersions)
      .slice(-1);
    const drop = planPrune(keys, [version, ...previous]);
    for (const key of drop) {
      must(await ossRequest({ verb: "DELETE", key }), `删除 ${key}`);
      console.log(`[upload-oss] 删掉旧版本 ${key}`);
    }
    console.log(`[upload-oss] 保留：${[version, ...previous].join("、") || version}`);
  }

  // 6. 真的拉一次。「传上去了」和「没人能下」长得一模一样。
  {
    const local = readFileSync(join(dir, "latest.yml"), "utf8");
    const bases = [`https://${BUCKET}.${ENDPOINT}`];
    if (PUBLIC_BASE) bases.push(PUBLIC_BASE);
    else console.log("[upload-oss] 注意：OSS_PUBLIC_BASE 没给，**公开域名这条路没有验过** —— 只验了桶端点");
    for (const base of bases) {
      const feedUrl = `${base}/${channel}/latest.yml`;
      const got = await fetch(feedUrl);
      const body = await got.text();
      if (!got.ok || body !== local) {
        console.error(`[upload-oss] 自检失败：${feedUrl} 回 ${got.status}，内容${body === local ? "一致" : "与刚上传的不一致"}`);
        process.exit(1);
      }
      // 固定地址那条也要真发一次请求：Range 只取头 1 KB，够证明它可下载、可续传。
      const exeUrl = `${base}/${channel}/Ruyin-Setup-latest.exe`;
      const head = await fetch(exeUrl, { headers: { Range: "bytes=0-1023" } });
      if (head.status !== 206) {
        console.error(`[upload-oss] 自检失败：${exeUrl} 对 Range 请求回 ${head.status}（要 206，断点续传靠它）`);
        process.exit(1);
      }
      console.log(`[upload-oss] 自检通过：${base}/${channel}/`);
    }
  }

  console.log(`[upload-oss] OK - ${channel} 渠道已是 ${version}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  await main(process.argv.slice(2));
}
