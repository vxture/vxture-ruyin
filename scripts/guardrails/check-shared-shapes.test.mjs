/**
 * check-shared-shapes.mjs 自己的测试。
 *
 * 这道守卫拦的是**服务端与界面之间的类型漂移**：界面复制了一份类型，源头加了个
 * 字段，界面那份没跟上。TypeScript 一个字都不会说 —— 两边各自编译得好好的，只是
 * 界面从此少显示一件事，而那件事往往正是新加的那个功能。
 *
 * 它自己坏掉的方式也一样安静：`fieldsOf` 抠不出字段时返回 null。哪天正则漏掉一种
 * 写法，它会把「字段没对上」报成「找不到类型」；更糟的是两边都抠出空数组，然后
 * **一致地通过**。
 *
 * 所以这里造一份**处处对得上的基线**（十一个接口 + 一个联合 + 事件词表 + 标题栏
 * 高度），再每次只坏一处。那份基线本身就是这道守卫的说明书。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { fixtureRepo } from "./fixture-repo.mjs";

const GUARD = "check-shared-shapes.mjs";

/** 界面复制的那些类型：[界面名, 源头名, 源头文件]，与守卫里的表一一对应。 */
const SHARED = [
  ["AuditEvent", "AuditEvent", "packages/runtime-core/src/ports.ts"],
  ["LegacyAuditEvent", "LegacyAuditEvent", "packages/runtime-core/src/ports.ts"],
  ["ProductInfo", "ProductView", "apps/local-host/src/product-registry.ts"],
  ["ContextItemMeta", "ContextItemMeta", "packages/runtime-core/src/ports.ts"],
  ["Binding", "Binding", "packages/runtime-core/src/ports.ts"],
  ["ConnectorGrant", "ConnectorGrant", "packages/runtime-core/src/ports.ts"],
  ["SkillView", "SkillView", "apps/local-host/src/skill-registry.ts"],
  ["SkillLayerInfo", "SkillLayerInfo", "apps/local-host/src/skill-registry.ts"],
  ["SkillListing", "SkillListing", "apps/local-host/src/skill-registry.ts"],
  ["ToolView", "ToolView", "apps/local-host/src/tool-registry.ts"],
  ["ComponentStatus", "ComponentStatus", "apps/local-host/src/component-store.ts"],
];

const STATES = ["idle", "acquiring", "ready", "unreachable"];
const EVENT_KINDS = ["task", "pending", "component"];

/** 事件词表在三处各写一遍（守护进程发、界面收、壳收），三份必须一致。 */
const eventUnion = (kinds) =>
  `export type RuntimeEvent =\n${kinds.map((k) => `  | { kind: "${k}" }`).join("\n")};\n`;

/**
 * 一份处处对得上的基线。`over` 覆盖其中某个文件，用来「只坏一处」。
 *
 * 每个接口只给一个字段 —— 这道守卫比的是**字段名的集合**，一个字段就足以让
 * 「对上」和「没对上」区分开，写满真实字段只会让哪一处被改动变得难看清。
 */
function baseline(over = {}) {
  const bySource = new Map();
  for (const [, sourceName, from] of SHARED) {
    if (!bySource.has(from)) bySource.set(from, []);
    bySource.get(from).push(`export interface ${sourceName} {\n  id: string;\n}\n`);
  }
  const files = {};
  for (const [from, decls] of bySource) files[from] = decls.join("\n");

  // 源头那一侧还要有 ComponentState 这个联合。
  files["apps/local-host/src/component-store.ts"] +=
    `\nexport type ComponentState = ${STATES.map((s) => `"${s}"`).join(" | ")};\n`;

  files["apps/ui-workspace/src/api.ts"] =
    SHARED.map(([uiName]) => `export interface ${uiName} {\n  id: string;\n}\n`).join("\n") +
    `\nexport type ComponentState = ${STATES.map((s) => `"${s}"`).join(" | ")};\n` +
    eventUnion(EVENT_KINDS);

  files["apps/local-host/src/events.ts"] = eventUnion(EVENT_KINDS);
  files["apps/shell/src/daemon-events.ts"] = eventUnion(EVENT_KINDS);
  // 标题栏高度两处要相等：界面用档位（md = 48），壳用像素。
  files["apps/ui-workspace/src/workbench.tsx"] = `<ShellHeader height="md" />\n`;
  files["apps/shell/src/caption-overlay.ts"] = `export const CAPTION_HEIGHT = 48;\n`;
  files["apps/shell/src/main.ts"] = `import { CAPTION_HEIGHT } from "./caption-overlay.js";\n`;
  // 链校验要认**两种形状**的链接字段：新记录写 prevHash，X-3 之前的旧记录写
  // prev_hash。只认一种，等于对另一种谎报「链断了」。
  files["apps/ui-workspace/src/chain.ts"] = `const prev = e.prevHash ?? e.prev_hash;\n`;
  return { ...files, ...over };
}

function check(files) {
  const repo = fixtureRepo("ruyin-shapes-");
  try {
    for (const [rel, body] of Object.entries(files)) repo.write(rel, body);
    return repo.run(GUARD);
  } finally {
    repo.clean();
  }
}

void test("处处对得上的基线要通过 —— 造不出它，下面每一条都无从谈起", () => {
  const r = check(baseline());
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /11 个共享接口/);
});

void test("**源头加了字段、界面没跟上** —— 这正是它存在的那件事", () => {
  const base = baseline();
  const r = check({
    ...base,
    "packages/runtime-core/src/ports.ts": base["packages/runtime-core/src/ports.ts"].replace(
      "export interface Binding {\n  id: string;\n}",
      "export interface Binding {\n  id: string;\n  connector: string;\n}",
    ),
  });
  assert.equal(r.code, 1);
  assert.match(r.out, /Binding：界面少了 connector/);
  assert.match(r.out, /多半是一个还没被发现的功能/, "要说清「少了」通常意味着什么");
});

void test("界面多出源头没有的字段也要拦", () => {
  const base = baseline();
  const r = check({
    ...base,
    "apps/ui-workspace/src/api.ts": base["apps/ui-workspace/src/api.ts"].replace(
      "export interface ToolView {\n  id: string;\n}",
      "export interface ToolView {\n  id: string;\n  imagined: string;\n}",
    ),
  });
  assert.equal(r.code, 1);
  assert.match(r.out, /ToolView：界面多出 imagined/);
});

void test("两边名字不同但字段要一样 —— 名字是称呼，字段是契约", () => {
  const r = check(
    baseline({
      "apps/local-host/src/product-registry.ts":
        "export interface ProductView {\n  id: string;\n  entitled: boolean;\n}\n",
    }),
  );
  assert.equal(r.code, 1);
  assert.match(r.out, /ProductInfo <- ProductView：界面少了 entitled/);
});

void test("源头或界面里整个类型没了，要说清是哪一边没有", () => {
  const noSource = check(
    baseline({ "apps/local-host/src/tool-registry.ts": "// ToolView 被谁删了\n" }),
  );
  assert.equal(noSource.code, 1);
  assert.match(noSource.out, /里找不到 interface ToolView/);

  const base = baseline();
  const noUi = check({
    ...base,
    "apps/ui-workspace/src/api.ts": base["apps/ui-workspace/src/api.ts"].replace(
      "export interface SkillView {\n  id: string;\n}\n",
      "",
    ),
  });
  assert.equal(noUi.code, 1);
  assert.match(noUi.out, /界面里找不到 interface SkillView/);
});

void test("联合类型比成员：界面少一种、或多一种拼错的，都要拦", () => {
  const base = baseline();
  const missing = check({
    ...base,
    "apps/ui-workspace/src/api.ts": base["apps/ui-workspace/src/api.ts"].replace(
      ` | "unreachable"`,
      "",
    ),
  });
  assert.equal(missing.code, 1, "界面少一种状态要拦");

  const typo = check({
    ...base,
    "apps/ui-workspace/src/api.ts": base["apps/ui-workspace/src/api.ts"].replace(
      `"unreachable"`,
      `"unreachible"`,
    ),
  });
  assert.equal(typo.code, 1, "拼错的那一种编译得过，但它永远不会被匹配到");
});

void test("事件词表三处必须一致 —— 有人发没人收，或有人收而没人发", () => {
  const base = baseline();
  // 拿**中间**那一种来删：最后一种那行结尾是 `};`，按 `}\n` 去替换是个空操作 ——
  // 而空操作会让这条用例安静地通过，测的是「什么都没改也没报错」。
  const uiMissing = check({
    ...base,
    "apps/ui-workspace/src/api.ts": base["apps/ui-workspace/src/api.ts"].replace(
      `  | { kind: "pending" }\n`,
      "",
    ),
  });
  assert.equal(uiMissing.code, 1, "界面少一种事件应该被拦");
  assert.match(uiMissing.out, /pending/);

  const shellExtra = check(
    baseline({ "apps/shell/src/daemon-events.ts": eventUnion([...EVENT_KINDS, "nobody-emits"]) }),
  );
  assert.equal(shellExtra.code, 1);
  assert.match(shellExtra.out, /没人会发/);
});

void test("**标题栏高度两处必须相等** —— 不一致只在打包形态下看得见", () => {
  const r = check(
    baseline({ "apps/shell/src/caption-overlay.ts": `export const CAPTION_HEIGHT = 56;\n` }),
  );
  assert.equal(r.code, 1);
});

void test("读不到高度时**报错而不是当成通过** —— 那正是它搬家那天抓到的事", () => {
  const r = check(
    baseline({ "apps/shell/src/caption-overlay.ts": `// 高度被搬到别处了\n` }),
  );
  assert.equal(r.code, 1, "读不到就该红，不能默认一致");
});
