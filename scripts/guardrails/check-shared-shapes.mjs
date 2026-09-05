#!/usr/bin/env node
/**
 * 跨进程共享形状守卫：界面手里那份服务端类型的副本，必须和源头一字不差。
 *
 * 界面要在本地重算哈希链，而**链的哈希是按存进去时的字段名算的**。所以界面
 * 手里那份 `AuditEvent` 不是一个方便的类型声明，是重算的前提：字段名一旦和
 * 内核对不上，重算必然失败。
 *
 * 这不是假想。X-3 改名（`kind`->`action`、`timestamp`->`occurredAt`、
 * `prev_hash`->`prevHash`…）之后，界面那份没跟上，于是：
 *
 *   - 审计表读 `e.kind` / `e.timestamp`，全是 undefined，整页显示空白
 *   - 链校验读 `event.prev_hash`，第一条就对不上
 *   - 徽章因此对**每一条完好的链**都亮「哈希链断裂」
 *
 * 一个永远喊狼来了的完整性指示器，比没有这个指示器更糟：它训练用户忽略它，
 * 而它真正响的那一次也就没人看了。
 *
 * 同一类漂移当天出现了第二次：服务端的 `ProductInfo` 早就带着 `versions`
 * （§18.4 回滚要用的版本列表），界面那份没有它 —— 于是「版本回滚做不了，因为
 * 拿不到版本列表」被当成事实写进了技术债，而它是假的。
 *
 * 所以这道守卫不只管审计：**凡是界面复制了一份服务端类型的地方，都在这里对。**
 * 界面多出源头没有的字段，一定是错的；界面少了源头有的字段，多半是一个还没
 * 被发现的功能。
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/** 从一份 .ts 源里抠出某个 interface 的字段名（按声明顺序）。 */
function fieldsOf(source, name) {
  const start = source.indexOf(`interface ${name} {`);
  if (start < 0) return null;
  const open = source.indexOf("{", start);
  let depth = 0;
  let end = open;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = source.slice(open + 1, end);
  // 去掉注释，再取每个「名字[?]:」
  const clean = body
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  // 只收顶层字段：内联的对象字面量（比如 `subscription: { status; tier; … }`）
  // 里的名字不是这个类型的字段，算进来会把一次比较变成一堆假报警。
  const out = [];
  let nesting = 0;
  for (const line of clean.split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\??\s*:/.exec(line);
    if (nesting === 0 && m) out.push(m[1]);
    nesting +=
      (line.match(/[{[]/g) ?? []).length - (line.match(/[}\]]/g) ?? []).length;
  }
  return out;
}

const ui = readFileSync(
  join(repoRoot, "apps/ui-workspace/src/api.ts"),
  "utf8",
);

/**
 * 界面复制了哪些类型：[界面里的名字, 源头里的名字, 源头文件]。
 *
 * 两边名字可以不同（界面叫 ProductInfo，服务端叫 ProductView），**但字段必须
 * 一样** —— 名字是称呼，字段是契约。
 */
const SHARED = [
  ["AuditEvent", "AuditEvent", "packages/runtime-core/src/ports.ts"],
  ["LegacyAuditEvent", "LegacyAuditEvent", "packages/runtime-core/src/ports.ts"],
  ["ProductInfo", "ProductView", "apps/local-host/src/product-registry.ts"],
  // ADR-005 把 connector 记到条目上、把 source 放宽到契约的来源种类 —— 界面那两份
  // 副本此前一份少 ref、一份少 source，都是「源头有而界面没有」的那类漂移。
  ["ContextItemMeta", "ContextItemMeta", "packages/runtime-core/src/ports.ts"],
  ["Binding", "Binding", "packages/runtime-core/src/ports.ts"],
  ["ConnectorGrant", "ConnectorGrant", "packages/runtime-core/src/ports.ts"],
  // 能力平台（ADR-018）：界面那份技能 / 工具视图必须和守护进程的一字不差。
  ["SkillView", "SkillView", "apps/local-host/src/skill-registry.ts"],
  ["SkillLayerInfo", "SkillLayerInfo", "apps/local-host/src/skill-registry.ts"],
  ["SkillListing", "SkillListing", "apps/local-host/src/skill-registry.ts"],
  ["ToolView", "ToolView", "apps/local-host/src/tool-registry.ts"],
];

const sources = new Map();
const problems = [];
for (const [uiName, sourceName, from] of SHARED) {
  if (!sources.has(from)) {
    sources.set(from, readFileSync(join(repoRoot, from), "utf8"));
  }
  const a = fieldsOf(sources.get(from), sourceName);
  const b = fieldsOf(ui, uiName);
  const name = uiName === sourceName ? uiName : `${uiName} <- ${sourceName}`;
  if (!a) {
    problems.push(`${from} 里找不到 interface ${sourceName}`);
    continue;
  }
  if (!b) {
    problems.push(
      `界面里找不到 interface ${uiName}（源头：${from} 的 ${sourceName}）`,
    );
    continue;
  }
  const missing = a.filter((f) => !b.includes(f));
  const extra = b.filter((f) => !a.includes(f));
  if (missing.length) {
    problems.push(
      `${name}：界面少了 ${missing.join("、")} —— 源头有而界面没有的字段，` +
        `多半是一个还没被发现的功能`,
    );
  }
  if (extra.length) {
    problems.push(`${name}：界面多出 ${extra.join("、")}（${from} 里没有）`);
  }
}

/**
 * 事件种类：守护进程发、界面收、壳也收 —— **同一个词表抄了三份**。
 *
 * 抄多了就会漏。漏掉一种事件的后果不是报错，是那一类变化再也不会被察觉：
 * 壳不再弹通知、界面不再刷新，而两者看起来都和「没有事情发生」一模一样。
 */
function eventKinds(source) {
  const start = source.search(/(type RuntimeEvent|type DaemonEventKind)\s*=/);
  if (start < 0) return null;
  // 结尾是**深度为 0 的那个分号**：联合成员自己就带分号
  // （`{ kind: "task"; projectId: string }`），只找第一个 `;` 会在第一个成员
  // 里就停下 —— 于是守卫只看得见一种事件，然后对其余全部报「没人会发」。
  let depth = 0;
  let end = source.length;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === ";" && depth === 0) {
      end = i;
      break;
    }
  }
  return [
    ...new Set(
      [...source.slice(start, end).matchAll(/"([a-z][a-z-]*)"/g)].map(
        (m) => m[1],
      ),
    ),
  ].sort();
}

const EVENT_SOURCES = [
  ["apps/local-host/src/events.ts", "守护进程（发）"],
  ["apps/ui-workspace/src/api.ts", "界面（收）"],
  // 壳的词表本来声明在 main.ts；那一半改由 daemon-events.ts 声明并被
  // main.ts 引入，因为 main.ts 顶层 import "electron"，node:test 加载不了
  // 它——SSE 解析要能被直接测，就不能和事件种类的声明挤在同一个文件里。
  ["apps/shell/src/daemon-events.ts", "壳（收）"],
];
const kindSets = EVENT_SOURCES.map(([file, who]) => {
  const kinds = eventKinds(readFileSync(join(repoRoot, file), "utf8"));
  if (!kinds) problems.push(`${file} 里找不到事件种类的声明`);
  return [who, kinds];
});
const authoritative = kindSets[0]?.[1];
if (authoritative) {
  for (const [who, kinds] of kindSets.slice(1)) {
    if (!kinds) continue;
    const missing = authoritative.filter((k) => !kinds.includes(k));
    const extra = kinds.filter((k) => !authoritative.includes(k));
    if (missing.length) {
      problems.push(
        `事件种类：${who}少了 ${missing.join("、")} —— 那一类变化它再也不会察觉，` +
          `而「察觉不到」和「没有发生」长得一模一样`,
      );
    }
    if (extra.length) {
      problems.push(`事件种类：${who}多出 ${extra.join("、")}（没人会发）`);
    }
  }
}

/**
 * 标题栏高度在两处各写一遍，必须相等。
 *
 * 界面用 ShellHeader 的 `height` 档位，壳用 Electron 的
 * `titleBarOverlay.height` 给 Windows 的窗口按钮留位。**两个数不一致，按钮
 * 就会错位或压住内容 —— 而这只在打包形态下看得见**，开发时怎么点都正常。
 */
const HEADER_PX = { sm: 40, md: 48, lg: 56, xl: 64 };
const workbench = readFileSync(
  join(repoRoot, "apps/ui-workspace/src/workbench.tsx"),
  "utf8",
);
const shellMain = readFileSync(join(repoRoot, "apps/shell/src/main.ts"), "utf8");
const band = /height="(sm|md|lg|xl)"/.exec(workbench)?.[1];
/**
 * 壳这一侧的高度 2026-09-04 从 main.ts 的内联字面量搬到了 caption-overlay.ts
 * 的 `CAPTION_HEIGHT`（窗口按钮要随主题换色，颜色表抽出去才能脱离 Electron
 * 测）。两处形状都认：搬家不该让这条不变量悄悄失效 —— 那正是这道守卫当天
 * 抓到的（读不到高度它直接报错，而不是当成通过）。
 */
const captionOverlaySrc = existsSync(
  join(repoRoot, "apps/shell/src/caption-overlay.ts"),
)
  ? readFileSync(join(repoRoot, "apps/shell/src/caption-overlay.ts"), "utf8")
  : "";
const overlay =
  /CAPTION_HEIGHT\s*=\s*(\d+)/.exec(captionOverlaySrc)?.[1] ??
  /titleBarOverlay:\s*\{[^}]*height:\s*(\d+)/s.exec(shellMain)?.[1];
if (!band) {
  problems.push("workbench.tsx 里读不到 ShellHeader 的 height 档位");
} else if (!overlay) {
  problems.push("读不到壳那边的标题栏高度（caption-overlay.ts 的 CAPTION_HEIGHT，或 main.ts 的 titleBarOverlay.height）");
} else if (Number(overlay) !== HEADER_PX[band]) {
  problems.push(
    `标题栏高度对不上：界面是 ${band}（${HEADER_PX[band]}px），壳的 ` +
      `titleBarOverlay 是 ${overlay}px —— Windows 的窗口按钮会错位，而这只在` +
      "打包形态下看得见",
  );
}

// 链校验必须认两种形状的链接字段，只认一种等于对另一种谎报断裂。
const chain = readFileSync(
  join(repoRoot, "apps/ui-workspace/src/chain.ts"),
  "utf8",
);
for (const field of ["prevHash", "prev_hash"]) {
  if (!chain.includes(field)) {
    problems.push(`chain.ts 没有读 ${field} —— 那一种形状的链会被判成断裂`);
  }
}

if (problems.length > 0) {
  console.error("[shared-shapes] 不合规：");
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    "  修法：以源头为准改界面。审计记录尤其不能含糊 —— 字段名对不上，界面的" +
      "哈希重算就一定失败，而失败的样子是「哈希链断裂」，一句吓人且错误的话。",
  );
  process.exit(1);
}

console.log(
  `[shared-shapes] OK - ${SHARED.length} 个共享类型 + 事件词表 + 标题栏高度一致。`,
);
