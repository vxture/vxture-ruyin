/**
 * 更新渠道的偏好（RY-001 §07 任务 49）。界面上它叫「抢先体验新功能」。
 *
 * 这里钉的是两句话：**默认正式版**，以及**坏掉的偏好文件不许让人查不了更新**。
 */

import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DEFAULT_CHANNEL,
  hasUpdateChannelPreference,
  isUpdateChannel,
  readUpdateChannel,
  updatePrefsFile,
  writeUpdateChannel,
} from "./update-channel.js";
import { feedBaseFor, DEFAULT_FEED_BASE } from "./updates.js";

function rig() {
  const dir = mkdtempSync(join(tmpdir(), "ruyin-chan-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("没选过就是正式版 —— 默认不把人放进测试版", () => {
  const { dir, cleanup } = rig();
  try {
    assert.equal(readUpdateChannel(dir), "stable");
    assert.equal(DEFAULT_CHANNEL, "stable");
    assert.equal(hasUpdateChannelPreference(dir), false, "没写过文件");
  } finally {
    cleanup();
  }
});

test("写了就读得回来，而且落在数据目录下那一个文件里", () => {
  const { dir, cleanup } = rig();
  try {
    assert.equal(writeUpdateChannel(dir, "beta"), "beta");
    assert.equal(readUpdateChannel(dir), "beta");
    assert.equal(hasUpdateChannelPreference(dir), true);
    assert.equal(existsSync(updatePrefsFile(dir)), true);
    assert.equal(writeUpdateChannel(dir, "stable"), "stable");
    assert.equal(readUpdateChannel(dir), "stable");
  } finally {
    cleanup();
  }
});

test("偏好文件坏了 / 值不认识 —— 按正式版走，**不是**让这台机器从此查不了更新", () => {
  const { dir, cleanup } = rig();
  try {
    mkdirSync(dir, { recursive: true });
    for (const bad of ["{not json", '{"channel":"nightly"}', '{"channel":123}', "{}"]) {
      writeFileSync(updatePrefsFile(dir), bad);
      assert.equal(readUpdateChannel(dir), "stable", `${bad} 应当落到正式版`);
    }
    // 写入那一侧照旧严格：认不出来的值不落盘。
    writeUpdateChannel(dir, "nightly" as never);
    assert.equal(readUpdateChannel(dir), "stable");
  } finally {
    cleanup();
  }
});

test("渠道就是 feed 地址的目录名 —— 检查哪个渠道就下哪个渠道", () => {
  assert.equal(isUpdateChannel("beta"), true);
  assert.equal(isUpdateChannel("nightly"), false);
  assert.match(feedBaseFor("beta"), /\/beta$/);
  assert.match(feedBaseFor("stable"), /\/stable$/);
  assert.equal(DEFAULT_FEED_BASE, feedBaseFor("stable"));
  // 两条基址只差最后一段：**同一台主机**。差了主机，界面显示的渠道就不再是
  // 它真正问过的那一个。
  assert.equal(
    feedBaseFor("beta").slice(0, -"beta".length),
    feedBaseFor("stable").slice(0, -"stable".length),
  );
});
