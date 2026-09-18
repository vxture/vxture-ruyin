/**
 * upload-oss.mjs 的纯函数。**联网那一半不在这里测**——它在真桶上跑过一遍才算数
 * （2026-09-18 真跑了四轮，见下面每条用例开头记的那一句）；这里钉的是那几个
 * 「算错了也照样绿」的判断。
 *
 * import 这个模块**不会**触发一次真上传：CLI 那一半包在 main() 里（与
 * third-party.mjs 同一个写法）。这条本身也值得一测 —— 见最后一条。
 */
import { strict as assert } from "node:assert";
import test from "node:test";

import { compareVersions, contentTypeFor, headersFor, planPrune, planUpload, stringToSign } from "./upload-oss.mjs";

test("缓存头：带版本号的长缓存，三个指针一律 no-cache", () => {
  // 这一条错了的症状是「发布成功，但所有人还在下上一版」，而且没有任何一处会报错。
  assert.equal(headersFor("beta/Ruyin-Setup-0.1.0.exe")["Cache-Control"], "public, max-age=31536000, immutable");
  for (const p of ["beta/Ruyin-Setup-latest.exe", "beta/latest.yml", "beta/manifest.json", "beta/SHA256SUMS", "products/index.json"]) {
    assert.equal(headersFor(p)["Cache-Control"], "no-cache", `${p} 是指针，必须回源`);
  }
  // 固定名那一个**内容会变**，所以它和带版本号的那一个虽然字节一样，缓存口径相反。
  assert.notEqual(
    headersFor("beta/Ruyin-Setup-latest.exe")["Cache-Control"],
    headersFor("beta/Ruyin-Setup-0.1.0.exe")["Cache-Control"],
  );
});

test("Content-Type：yml 不能被当成下载文件，exe 不能被当成文本", () => {
  assert.equal(contentTypeFor("latest.yml"), "text/yaml; charset=utf-8");
  assert.equal(contentTypeFor("manifest.json"), "application/json; charset=utf-8");
  assert.equal(contentTypeFor("Ruyin-Setup-0.1.0.exe"), "application/octet-stream");
  assert.equal(contentTypeFor("x.ruyinpkg"), "application/octet-stream");
  assert.equal(contentTypeFor("SHA256SUMS"), "application/octet-stream");
});

test("上传顺序：带版本号的先走，指针最后 —— 断在中间，用户拿到的还是上一版完整的一套", () => {
  const files = ["latest.yml", "Ruyin-Setup-0.1.0.exe", "SHA256SUMS", "Ruyin-Setup-0.1.0.exe.blockmap", "manifest.json"];
  const plan = planUpload("beta", files);
  const stages = plan.map((p) => p.stage);
  assert.equal(stages.lastIndexOf("versioned") < stages.indexOf("pointer"), true, "指针不许排在带版本号的前面");
  assert.deepEqual(
    plan.map((p) => p.key),
    [
      "beta/Ruyin-Setup-0.1.0.exe",
      "beta/Ruyin-Setup-0.1.0.exe.blockmap",
      "beta/SHA256SUMS",
      "beta/manifest.json",
      // feed 最后：它翻到新版本时，旁边的校验和与清单必须已经是新的。
      "beta/latest.yml",
    ],
  );
  // 固定名那一个不在上传计划里：它是服务端 copy 出来的，不重传一遍 156 MB。
  assert.equal(plan.some((p) => p.key.includes("latest.exe")), false);
});

test("版本序按数字段比 —— 字符串序里 0.0.10 < 0.0.9，而那会删掉回滚要用的那一版", () => {
  // **这是真跑一遍抓到的**（2026-09-18）：第三次发布时它留下 0.0.9、删掉 0.0.10。
  // 删错的那一刻什么都不说，直到某天要回滚才发现字节没了。
  assert.deepEqual(["0.0.9", "0.0.10", "0.1.0", "1.0.0"].sort(compareVersions), ["0.0.9", "0.0.10", "0.1.0", "1.0.0"]);
  assert.equal(compareVersions("0.0.10", "0.0.9") > 0, true);
  assert.equal(compareVersions("1.2", "1.2.1") < 0, true, "段数不同的短的补 0");
  assert.equal(compareVersions("1.0.0-rc1", "1.0.0") < 0, true, "预发布排在正式版前面");
  assert.equal(compareVersions("0.1.0", "0.1.0"), 0);
});

test("清理：当前版与上一版都留着 —— 回滚的前提是那一版的字节还在", () => {
  const keys = [
    "beta/Ruyin-Setup-0.0.9.exe",
    "beta/Ruyin-Setup-0.0.9.exe.blockmap",
    "beta/Ruyin-Setup-0.0.11.exe",
    "beta/Ruyin-Setup-0.0.12.exe",
    "beta/Ruyin-Setup-0.0.12.exe.blockmap",
    // 指针与别的东西**永远不该被清理逻辑碰到**。
    "beta/latest.yml",
    "beta/Ruyin-Setup-latest.exe",
    "beta/manifest.json",
  ];
  assert.deepEqual(planPrune(keys, ["0.0.12", "0.0.11"]), [
    "beta/Ruyin-Setup-0.0.9.exe",
    "beta/Ruyin-Setup-0.0.9.exe.blockmap",
  ]);
  // 一版都不删的情形要安静地什么都不做，而不是把所有东西算成「旧的」。
  assert.deepEqual(planPrune(keys, ["0.0.12", "0.0.11", "0.0.9"]), []);
});

test("签名串：只有 x-oss- 开头的头进签名，别的头照发不进", () => {
  // 多签一个头，OSS 报的是 SignatureDoesNotMatch —— 那句话不会告诉你多签了哪一个。
  const text = stringToSign({
    verb: "PUT",
    contentType: "application/octet-stream",
    date: "Thu, 18 Sep 2026 00:00:00 GMT",
    headers: {
      "Cache-Control": "no-cache",
      "x-oss-metadata-directive": "REPLACE",
      "x-oss-copy-source": "/ruyin-download/beta/Ruyin-Setup-0.1.0.exe",
    },
    resource: "/ruyin-download/beta/Ruyin-Setup-latest.exe",
  });
  assert.equal(
    text,
    "PUT\n\napplication/octet-stream\nThu, 18 Sep 2026 00:00:00 GMT\n" +
      "x-oss-copy-source:/ruyin-download/beta/Ruyin-Setup-0.1.0.exe\n" +
      "x-oss-metadata-directive:REPLACE\n" +
      "/ruyin-download/beta/Ruyin-Setup-latest.exe",
  );
  assert.equal(text.includes("Cache-Control"), false, "Cache-Control 不进签名");
  // 列桶那一次：资源是 `/<桶>/`，查询串不进去（实测栽过，见脚本里的注释）。
  assert.equal(
    stringToSign({ verb: "GET", date: "D", resource: "/ruyin-download/" }),
    "GET\n\n\nD\n/ruyin-download/",
  );
});

test("import 这个模块不会跑一次真上传 —— 纯函数都在，CLI 包在 main 里", async () => {
  const m = await import("./upload-oss.mjs");
  assert.deepEqual(Object.keys(m).sort(), [
    "compareVersions",
    "contentTypeFor",
    "headersFor",
    "planPrune",
    "planUpload",
    "stringToSign",
  ]);
});
