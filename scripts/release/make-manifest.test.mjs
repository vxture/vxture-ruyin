/**
 * make-manifest.mjs 自己的测试。
 *
 * 这支脚本的产出**就是网站下载页看到的东西**：`manifest.json` 是唯一的数据源
 * （30-design/70 §7.3），`SHA256SUMS` 是用户校验安装包的依据。它出错的方式很具体
 * 也很难看 —— 哈希算错、大小写错、URL 拼错，页面照样渲染，而下载下来的东西校验
 * 不过，或者根本下不到。
 *
 * 所以这里**逐字节地验**：拿一个已知内容的假安装包，把脚本算出来的 sha256 和
 * size 与自己算的比对。只断言「文件生成了」是没有意义的 —— 内容错了它也生成。
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { fixtureRepo } from "../guardrails/fixture-repo.mjs";

const SCRIPT = "make-manifest.mjs";
const REL = "apps/shell/release";

/** 造一棵带假安装包的仓库并跑脚本。 */
function run(installers, args) {
  const repo = fixtureRepo("ruyin-manifest-");
  try {
    for (const [name, content] of Object.entries(installers)) {
      repo.write(`${REL}/${name}`, content);
    }
    // 这支脚本在 scripts/release/ 下，所以要复制到那儿才算得对仓库根。
    const res = repo.run(SCRIPT, args, "release");
    const read = (f) => {
      try {
        return readFileSync(join(repo.root, REL, f), "utf8");
      } catch {
        return undefined;
      }
    };
    return { ...res, manifest: read("manifest.json"), sums: read("SHA256SUMS") };
  } finally {
    repo.clean();
  }
}

void test("哈希与大小要**逐字节算对** —— 它们是用户校验安装包的依据", () => {
  const body = "假装这是一个安装包的字节".repeat(100);
  const r = run({ "Ruyin-Setup-0.1.0.exe": body }, ["beta", "0.1.0"]);
  assert.equal(r.code, 0, r.out);

  const expected = createHash("sha256").update(Buffer.from(body, "utf8")).digest("hex");
  const m = JSON.parse(r.manifest);
  assert.equal(m.platforms["win32-x64"].sha256, expected, "哈希必须等于文件真实内容的 sha256");
  assert.equal(m.platforms["win32-x64"].size, Buffer.byteLength(body, "utf8"));
  // SHA256SUMS 的格式是给 sha256sum -c 读的：两个空格分隔。
  assert.equal(r.sums.trim(), `${expected}  Ruyin-Setup-0.1.0.exe`);
});

void test("渠道与版本原样进 manifest，URL 按渠道拼", () => {
  const r = run({ "Ruyin-Setup-1.2.3.exe": "x" }, ["stable", "1.2.3"]);
  const m = JSON.parse(r.manifest);
  assert.equal(m.product, "ruyin");
  assert.equal(m.channel, "stable");
  assert.equal(m.version, "1.2.3");
  assert.equal(
    m.platforms["win32-x64"].url,
    "https://dl.vxture.com/ruyin/stable/Ruyin-Setup-1.2.3.exe",
  );
  assert.match(m.releasedAt, /^\d{4}-\d{2}-\d{2}T/);
});

void test("baseUrl 可覆盖，且**结尾的斜杠不该拼出两道杠**", () => {
  const r = run({ "a.exe": "x" }, ["beta", "0.1.0", "https://example.com/dl/"]);
  const m = JSON.parse(r.manifest);
  assert.equal(m.platforms["win32-x64"].url, "https://example.com/dl/a.exe");
  assert.doesNotMatch(m.platforms["win32-x64"].url, /\/\/a\.exe/);
});

void test("用法错退 2、没有安装包退 1 —— 两者是不同的问题", () => {
  for (const args of [[], ["nightly", "0.1.0"], ["beta"]]) {
    const r = run({ "a.exe": "x" }, args);
    assert.equal(r.code, 2, `${JSON.stringify(args)} 应该是用法错`);
    assert.match(r.out, /usage: make-manifest/);
  }
  // 渠道版本都对，但目录里一个 .exe 都没有：这是构建出了问题，不是命令写错了。
  const none = run({ "note.txt": "不是安装包" }, ["beta", "0.1.0"]);
  assert.equal(none.code, 1);
  assert.match(none.out, /no \.exe found/);
});

void test("只认 .exe —— 目录里别的文件不进 SHA256SUMS", () => {
  const r = run(
    { "Ruyin-Setup-0.1.0.exe": "installer", "latest.yml": "y", "note.txt": "n" },
    ["beta", "0.1.0"],
  );
  assert.equal(r.code, 0, r.out);
  assert.equal(r.sums.trim().split("\n").length, 1);
  assert.match(r.sums, /Ruyin-Setup-0\.1\.0\.exe/);
  assert.doesNotMatch(r.sums, /latest\.yml|note\.txt/);
});
