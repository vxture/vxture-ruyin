/**
 * 构建印（build-info.ts）。
 *
 * 这几条钉的都是同一件事的不同侧面：**读不通就说「不知道」，不要冒充一个结论**。
 * 界面据此决定要不要在底部提醒「安装包未签名」—— 把一次读失败当成「未签名」，
 * 等于对着一个签过名的包喊未签名；反过来当成「已签名」更糟。
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { BUILD_INFO_FILE, readBuildInfo, resolveCodeSigning } from "./build-info.js";

function withDir(body: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "ruyin-buildinfo-"));
  try {
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

void test("readBuildInfo: 没有这个文件 = 开发态，不是「未签名」", () => {
  withDir((dir) => {
    // 仓里直接跑的时候根本没有安装包可谈。把它算成「未签名」，开发机上会常年
    // 挂着一条讲 SmartScreen 的提醒 —— 而那时用户什么都没安装。
    assert.equal(readBuildInfo(dir).codeSigning, "unpackaged");
  });
});

void test("readBuildInfo: 打了包没签 / 打了包签了，各自照实读出来", () => {
  withDir((dir) => {
    writeFileSync(join(dir, BUILD_INFO_FILE), JSON.stringify({ codeSigning: "unsigned" }));
    assert.equal(readBuildInfo(dir).codeSigning, "unsigned");
    writeFileSync(join(dir, BUILD_INFO_FILE), JSON.stringify({ codeSigning: "signed" }));
    assert.equal(readBuildInfo(dir).codeSigning, "signed");
  });
});

void test("readBuildInfo: 坏 JSON / 不认识的值 一律落到开发态，不抛也不猜", () => {
  withDir((dir) => {
    writeFileSync(join(dir, BUILD_INFO_FILE), "{ 这不是 JSON");
    assert.equal(readBuildInfo(dir).codeSigning, "unpackaged");

    // 「不认识的值」单列一条：将来若有人往里写 `"partial"` 之类的东西，界面
    // 不该把它当成两种已知状态里的任何一种。
    writeFileSync(join(dir, BUILD_INFO_FILE), JSON.stringify({ codeSigning: "partial" }));
    assert.equal(readBuildInfo(dir).codeSigning, "unpackaged");

    writeFileSync(join(dir, BUILD_INFO_FILE), JSON.stringify({ somethingElse: true }));
    assert.equal(readBuildInfo(dir).codeSigning, "unpackaged");
  });
});

/**
 * 环境变量优先 —— 这个开关的存在理由是**让那条路走得到**。
 *
 * 仓里直接跑时构建印不存在，恒为 `unpackaged`，于是界面上那条「未签名」提醒
 * 在开发态一次都不显示（owner 2026-09-10 就是这样报的「提醒没有出现」）。
 * 看不见的那一支正是最容易坏掉的那一支。
 */
void test("resolveCodeSigning: 环境变量能把三种状态各自拨出来", () => {
  withDir((dir) => {
    for (const v of ["signed", "unsigned", "unpackaged"] as const) {
      assert.equal(resolveCodeSigning(dir, { RUYIN_CODE_SIGNING: v }), v);
    }
  });
});

/** 不认识的值不该被当成一种状态 —— 落回构建印，而不是猜。 */
void test("resolveCodeSigning: 认不出的值忽略掉，回到构建印", () => {
  withDir((dir) => {
    writeFileSync(join(dir, BUILD_INFO_FILE), JSON.stringify({ codeSigning: "signed" }));
    assert.equal(resolveCodeSigning(dir, { RUYIN_CODE_SIGNING: "yes" }), "signed");
    assert.equal(resolveCodeSigning(dir, {}), "signed");
  });
});
