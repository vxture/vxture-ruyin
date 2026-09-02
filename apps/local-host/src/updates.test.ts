/**
 * 更新检查（TD-021）。
 *
 * 这些用例守的是同一条：**没查到不是「已是最新」**。这个功能的上一版不发任何
 * 请求就断言「当前已是最新」并附时间戳——用户会信它。所以每一种查不成的情形
 * 都必须落在 `unreachable` 上，一种都不许折叠。
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { checkForUpdate } from "./updates.js";

const BASE = { currentVersion: "0.1.0", feedBase: "https://dl.test/ruyin/stable" };

function feed(body: string, status = 200): typeof fetch {
  return (async () =>
    new Response(body, {
      status,
      headers: { "content-type": "text/yaml" },
    })) as unknown as typeof fetch;
}

void test("检查：feed 版本更高 → available", async () => {
  const r = await checkForUpdate({
    ...BASE,
    fetchImpl: feed("version: 0.2.0\nreleaseDate: '2026-09-01T00:00:00Z'\n"),
  });
  assert.equal(r.status, "available");
  assert.equal(r.status === "available" && r.latest, "0.2.0");
  assert.equal(r.status === "available" && r.releasedAt, "2026-09-01T00:00:00Z");
});

void test("检查：feed 版本相同 → current，且带上比对过的版本号", async () => {
  const r = await checkForUpdate({ ...BASE, fetchImpl: feed("version: 0.1.0\n") });
  assert.equal(r.status, "current");
  // latest 必须在场：它是「真比对过」的凭据。
  assert.equal(r.status === "current" && r.latest, "0.1.0");
});

void test("检查：feed 版本更低 → 也算 current，不谎报有更新", async () => {
  const r = await checkForUpdate({ ...BASE, fetchImpl: feed("version: 0.0.9\n") });
  assert.equal(r.status, "current");
});

void test("检查：网络不通 → unreachable，绝不是「已是最新」", async () => {
  const r = await checkForUpdate({
    ...BASE,
    fetchImpl: (async () => {
      throw new Error("ENOTFOUND dl.test");
    }) as unknown as typeof fetch,
  });
  assert.equal(r.status, "unreachable");
  assert.match(r.status === "unreachable" ? r.reason : "", /unreachable/);
});

void test("检查：feed 返回 404 / 500 → unreachable", async () => {
  for (const status of [404, 500]) {
    const r = await checkForUpdate({ ...BASE, fetchImpl: feed("nope", status) });
    assert.equal(r.status, "unreachable", `status ${status}`);
  }
});

void test("检查：feed 不是可读 YAML → unreachable", async () => {
  const r = await checkForUpdate({ ...BASE, fetchImpl: feed("\tversion: [oops\n") });
  assert.equal(r.status, "unreachable");
});

void test("检查：feed 里没有版本号 → unreachable，不静默当作最新", async () => {
  const r = await checkForUpdate({ ...BASE, fetchImpl: feed("files: []\n") });
  assert.equal(r.status, "unreachable");
  assert.match(r.status === "unreachable" ? r.reason : "", /no version/);
});

void test("检查：任何情况下都带当前版本，界面不必自己猜", async () => {
  for (const impl of [feed("version: 0.9.0\n"), feed("x", 500)]) {
    const r = await checkForUpdate({ ...BASE, fetchImpl: impl });
    assert.equal(r.current, "0.1.0");
    assert.ok(r.checkedAt);
  }
});

/**
 * 下载地址与渠道（2026-09-02，MVP 不做自动更新之后新增）。
 *
 * 地址不另立契约：它由**刚校验过的那份 feed** 自己的 `path` 拼出，落在同一个
 * 渠道目录里。检查哪个渠道就下载哪个渠道，两者不可能不一致 —— 而另存一个下载
 * 地址再去对齐它，迟早会不一致。
 */
void test("下载：地址由 feed 自己的 path 拼出，落在同一个渠道目录", async () => {
  const r = await checkForUpdate({
    currentVersion: "1.0.0",
    feedBase: "https://dl.example.com/ruyin/stable",
    fetchImpl: feed("version: 1.2.0\npath: Ruyin-Setup-1.2.0.exe\n"),
    now: () => "2026-09-02T00:00:00Z",
  });
  assert.equal(r.status, "available");
  if (r.status === "available") {
    assert.equal(
      r.downloadUrl,
      "https://dl.example.com/ruyin/stable/Ruyin-Setup-1.2.0.exe",
    );
    assert.equal(r.channel, "stable");
  }
});

void test("下载：feed 里没有 path → 不给地址，而不是拼一个猜的", async () => {
  const r = await checkForUpdate({
    currentVersion: "1.0.0",
    feedBase: "https://dl.example.com/ruyin/stable",
    fetchImpl: feed("version: 1.2.0\n"),
    now: () => "2026-09-02T00:00:00Z",
  });
  assert.equal(r.status, "available");
  // 猜出来的下载地址比没有地址糟：用户点下去拿到 404，而他以为那是产品的问题。
  if (r.status === "available") assert.equal(r.downloadUrl, undefined);
});

void test("渠道：beta 目录检查出来的就是 beta —— 不写明渠道的下载链接是有害的", async () => {
  const r = await checkForUpdate({
    currentVersion: "1.0.0",
    feedBase: "https://dl.example.com/ruyin/beta/",
    fetchImpl: feed("version: 1.3.0-beta.1\npath: Ruyin-Setup-1.3.0-beta.1.exe\n"),
    now: () => "2026-09-02T00:00:00Z",
  });
  assert.equal(r.channel, "beta");
  if (r.status === "available") {
    assert.match(r.downloadUrl ?? "", /\/ruyin\/beta\//);
  }
});

void test("渠道：feed 基址没有路径时留空，不把主机名当渠道名", async () => {
  const r = await checkForUpdate({
    currentVersion: "1.0.0",
    // 测试 feed 常常就长这样。早先的实现会把 "127.0.0.1:18080" 当成渠道名，
    // 界面于是一本正经地显示「127.0.0.1:18080 渠道」。
    feedBase: "http://127.0.0.1:18080",
    fetchImpl: feed("version: 1.2.0\npath: Ruyin-Setup-1.2.0.exe\n"),
    now: () => "2026-09-02T00:00:00Z",
  });
  assert.equal(r.channel, "", "渠道名宁可空着也不能猜");
  if (r.status === "available") {
    assert.equal(r.downloadUrl, "http://127.0.0.1:18080/Ruyin-Setup-1.2.0.exe");
  }
});
