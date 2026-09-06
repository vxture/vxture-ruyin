/**
 * 工具登记册的视图（tool-registry.ts）：**三处来源合成一张表，各说各的状态**。
 *
 * 这里盯的是两件之前不成立的事（ADR-018 §7.2）：
 *
 *   1. 停着的服务器一个工具名都不显示 —— `view.tools` 只在 live 分支里赋值，
 *      而契约作者要照着这些名字写 `provider: connector` 的声明；
 *   2. 缺一件要下载的载荷时，行上**一个可点的东西都没有**（按钮由 `launchable`
 *      门控，而这类服务器只设 `detail`），于是只剩一个中性的「已登记」徽标。
 */

import { strict as assert } from "node:assert";
import test from "node:test";

import { ToolRegistryView, type ToolRegistrySources, type ToolView } from "./tool-registry.js";
import type { BundledServer } from "./tool-servers.js";

const NEEDS_PAYLOAD: BundledServer = {
  id: "x.needs-payload",
  tier: "acquire-on-demand",
  license: "MIT",
  launch: { runtime: "node", package: "p", version: "1.0.0", bin: "cli.js", requiresComponent: ["node-bundle.p"] },
  tools: ["p_read", "p_write"],
};

function componentStatus(state: "not-acquired" | "acquiring"): NonNullable<ToolView["component"]> {
  return {
    id: "node-bundle.p",
    state,
    downloadBytes: 24_979_105,
    diskBytes: 24_979_105,
    license: "Apache-2.0",
    origin: "github.com",
    ...(state === "acquiring" ? { receivedBytes: 1024, totalBytes: 24_979_105 } : {}),
  };
}

function view(over: Partial<ToolRegistrySources> = {}) {
  return new ToolRegistryView({
    supportsBuiltin: () => true,
    hasSkills: () => true,
    bundledServers: () => [NEEDS_PAYLOAD],
    ...over,
  });
}

test("目录来的工具名：停着的服务器也列，未获取的也列 —— 用户在下载之前就看得见会多出哪些工具", async () => {
  const items = await view().list();
  const row = items.find((t) => t.id === NEEDS_PAYLOAD.id)!;
  assert.deepEqual(row.tools, ["p_read", "p_write"]);
});

test("探不到工具名时写一句原因，绝不写空数组（空数组读起来是「它什么都不暴露」）", async () => {
  const items = await view({
    bundledServers: () => [{ ...NEEDS_PAYLOAD, tools: undefined, toolsUnprobed: "构建机上起不来" }],
  }).list();
  const row = items.find((t) => t.id === NEEDS_PAYLOAD.id)!;
  assert.equal(row.tools, undefined);
  assert.equal(row.toolsUnprobed, "构建机上起不来");
});

test("缺一件可获取的载荷是它自己的状态：needs-acquisition，行上带体积 / 许可证 / 来源主机", async () => {
  const items = await view({
    planFor: () => ({ ok: false, reason: "未获取：需下载 23.8 MB", needsComponent: "node-bundle.p" }),
    componentStatus: () => componentStatus("not-acquired"),
  }).list();
  const row = items.find((t) => t.id === NEEDS_PAYLOAD.id)!;
  assert.equal(row.status, "needs-acquisition");
  assert.equal(row.detail, "未获取：需下载 23.8 MB");
  assert.equal(row.component?.downloadBytes, 24_979_105);
  assert.equal(row.component?.origin, "github.com");
});

test("正在获取时是 acquiring，带进度", async () => {
  const items = await view({
    planFor: () => ({ ok: false, reason: "未获取", needsComponent: "node-bundle.p" }),
    componentStatus: () => componentStatus("acquiring"),
  }).list();
  const row = items.find((t) => t.id === NEEDS_PAYLOAD.id)!;
  assert.equal(row.status, "acquiring");
  assert.equal(row.component?.receivedBytes, 1024);
});

test("载荷不在这一版的组件表里：不假装有一个可点的按钮，状态照旧", async () => {
  const items = await view({
    planFor: () => ({ ok: false, reason: "未获取", needsComponent: "node-bundle.p" }),
    componentStatus: () => undefined,
  }).list();
  const row = items.find((t) => t.id === NEEDS_PAYLOAD.id)!;
  assert.equal(row.component, undefined);
  assert.notEqual(row.status, "needs-acquisition");
});

test("起得来的服务器不带载荷那一段 —— 一个能起的东西不该显示「未获取」", async () => {
  const items = await view({ planFor: () => ({ ok: true }), componentStatus: () => componentStatus("not-acquired") }).list();
  const row = items.find((t) => t.id === NEEDS_PAYLOAD.id)!;
  assert.equal(row.component, undefined);
});
