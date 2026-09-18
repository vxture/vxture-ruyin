/**
 * 环境检查（任务 52）。这里钉的是**它不许编**：问不到就说问不到，别拿回执或猜测
 * 冒充 —— 一个说「已安装」而其实起不来的行，比一个说「没探到」的行糟得多。
 */

import { strict as assert } from "node:assert";
import test from "node:test";

import { probeEnvironments, probeVersion } from "./env-probe.js";

test("版本号从一行字里挑出来（uv / python 的输出形状都不一样）", () => {
  assert.equal(probeVersion("x", ["--version"], () => "uv 0.12.10 (abc 2026-01-01)\n").version, "0.12.10");
  assert.equal(probeVersion("x", ["--version"], () => "Python 3.13.15\n").version, "3.13.15");
  assert.equal(probeVersion("x", ["--version"], () => "v22.20.0\n").version, "22.20.0");
  // 挑不出版本号时**原样给第一行** —— 原样也比编一个强。
  assert.equal(probeVersion("x", ["--version"], () => "some build\n").version, "some build");
});

test("起不来就报错，不返回版本", () => {
  const got = probeVersion("nope", ["--version"], () => {
    throw new Error("spawn nope ENOENT\n第二行不该被带出去");
  });
  assert.equal(got.version, undefined);
  assert.equal(got.error, "spawn nope ENOENT");
});

test("两个来源分开报：随包 / 装好的那一份，与本机 PATH 上已有的", () => {
  const seen: string[] = [];
  const rows = probeEnvironments({
    nodeExe: "C:/app/resources/node/node.exe",
    uvExe: "C:/data/c/python.uv/0.12.10/uv/uv.exe",
    pythonExe: undefined,
    run: (exe) => {
      seen.push(exe);
      if (exe === "python") throw new Error("spawn python ENOENT");
      return exe.includes("uv") ? "uv 0.12.10" : "v22.20.0";
    },
  });
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(byId["node"]?.bundled?.version, "22.20.0");
  assert.equal(byId["node"]?.system?.version, "22.20.0");
  assert.equal(byId["uv"]?.bundled?.version, "0.12.10");
  // 没装的那一个**没有 bundled 这一段**（不是 bundled: { version: undefined }）——
  // 「没有这一份」与「有但问不出版本」是两件事，界面要分开说。
  assert.equal(byId["python"]?.bundled, undefined);
  assert.match(byId["python"]?.system?.error ?? "", /ENOENT/);
  assert.deepEqual(seen.includes("python"), true, "本机那一份也要真问一次");
});

test("这一版没随包 node：那一行只报本机的，不假装有一份", () => {
  const rows = probeEnvironments({ nodeExe: undefined, run: () => "v20.0.0" });
  assert.equal(rows.find((r) => r.id === "node")?.bundled, undefined);
  assert.equal(rows.find((r) => r.id === "node")?.system?.version, "20.0.0");
});
