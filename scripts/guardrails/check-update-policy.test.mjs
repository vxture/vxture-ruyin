/**
 * check-update-policy.mjs 自己的测试。
 *
 * 这支守卫和别的不一样：**它守的是 owner 的决定，不是实现细节**（TD-021 那几条）。
 * 「不做自动更新」「查不到必须是一个独立状态」「下载地址只能来自刚校验过的那份
 * feed」「只有用户点了才下载」—— 每一条被推翻的方式都不是报错，而是某次改动顺手
 * 把它抹掉，而抹掉之后一切照常工作。
 *
 * 所以这里造一份**满足全部规则的干净基线**，再每次只坏一处。第一版写不出这份基线
 * 本身就说明了问题：十五条规则散在四个文件里，谁也记不住「合规」长什么样。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { fixtureRepo } from "./fixture-repo.mjs";

const GUARD = "check-update-policy.mjs";

/** 获取通道的八种失败 —— 组件库与设置页都得认全。 */
const STATES = [
  "unreachable",
  "gone",
  "payload-missing",
  "mismatch",
  "no-space",
  "license-missing",
  "refused-origin",
  "cancelled",
];

/** 一份处处合规的基线。`over` 覆盖其中某个文件，用来「只坏一处」。 */
function baseline(over = {}) {
  const states = STATES.map((s) => `"${s}"`).join(", ");
  return {
    "apps/shell/src/main.ts": `// 壳里不引入任何自动更新器\nexport const x = 1;\n`,
    "apps/local-host/src/updates.ts": `
      export type Check = { status: "current" | "available" | "unreachable" };
      const url = new URL(parsed.path, feedBase);
    `,
    "apps/ui-workspace/src/settings.tsx": `
      {check.status === "unreachable" && <p>没查到</p>}
      <span>{result.channel}</span>
      <span>{c.downloadBytes}</span>
      const STATE_LABEL = { ${STATES.map((s) => `"${s}": "…"`).join(", ")} };
    `,
    "apps/local-host/src/component-store.ts": `
      const res = await doFetch(url, { redirect: "manual" });
      if (url.protocol !== "https:") throw new ComponentError("refused-origin", "…");
      const STATES = [${states}];
    `,
    ...over,
  };
}

function check(files) {
  const repo = fixtureRepo("ruyin-updpol-");
  try {
    for (const [rel, body] of Object.entries(files)) repo.write(rel, body);
    return repo.run(GUARD);
  } finally {
    repo.clean();
  }
}

void test("处处合规的基线要通过 —— 造不出这份基线，下面每一条都无从谈起", () => {
  const r = check(baseline());
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /OK - 不做自动更新/);
});

void test("**自动更新不许回来** —— 整段拆掉是一个决定，不是一次清理", () => {
  for (const needle of ["electron-updater", "autoUpdater"]) {
    const r = check(baseline({ "apps/shell/src/main.ts": `import { x } from "${needle}";` }));
    assert.equal(r.code, 1, `${needle} 应该被拦`);
    assert.match(r.out, /MVP 阶段不做自动更新/);
    assert.match(r.out, /本仓不签名/, "要说清为什么：它默认校验签名，而我们不签");
  }
});

void test("查不到必须是独立状态 —— 折叠进「已是最新」就是把没问到说成问过了", () => {
  const noState = check(
    baseline({ "apps/local-host/src/updates.ts": `const url = new URL(parsed.path, b);` }),
  );
  assert.equal(noState.code, 1);
  assert.match(noState.out, /没有 `unreachable` 状态/);
  assert.match(noState.out, /把「没问到」说成「问过了/);

  // 状态有了但界面不呈现，等于没有这个状态。
  const noUi = check(baseline({ "apps/ui-workspace/src/settings.tsx": `<span>{result.channel}</span><span>{c.downloadBytes}</span>` }));
  assert.equal(noUi.code, 1);
  assert.match(noUi.out, /设置页没有呈现「没查到」这一路/);
});

void test("下载地址必须来自 feed，且必须写明渠道", () => {
  const noPath = check(
    baseline({ "apps/local-host/src/updates.ts": `type C = { status: "unreachable" };` }),
  );
  assert.equal(noPath.code, 1);
  assert.match(noPath.out, /不再从 feed 的 `path` 拼下载地址/);
  assert.match(noPath.out, /检查 stable、下到 beta/, "要说清后果");

  const hardcoded = check(
    baseline({
      "apps/ui-workspace/src/settings.tsx":
        baseline()["apps/ui-workspace/src/settings.tsx"] +
        `\n<a href="https://dl.vxture.com/ruyin/beta/Ruyin-Setup-0.1.0.exe">下载</a>`,
    }),
  );
  assert.equal(hardcoded.code, 1);
  assert.match(hardcoded.out, /写死的安装包地址/);

  const noChannel = check(
    baseline({
      "apps/ui-workspace/src/settings.tsx": `没查到 <span>{c.downloadBytes}</span> ${STATES.map((s) => `"${s}"`).join(" ")}`,
    }),
  );
  assert.equal(noChannel.code, 1);
  assert.match(noChannel.out, /不写明渠道的下载链接是有害的/);
});

void test("**三条路径都不许 acquire** —— 一次悄悄发生的下载没有报错，只是它自己动了", () => {
  for (const [file, expect] of [
    ["apps/local-host/src/main.ts", /启动路径/],
    ["apps/local-host/src/tool-executor.ts", /工具执行路径/],
    ["packages/runtime-core/src/harness.ts", /任务循环/],
  ]) {
    const r = check(baseline({ [file]: `await components.acquire("chromium");` }));
    assert.equal(r.code, 1, `${file} 里的 acquire 应该被拦`);
    assert.match(r.out, expect);
  }
  // 声明依赖不算，调用才算 —— 否则装配线上那一行 `components: componentStore` 会被误伤。
  const declared = check(
    baseline({ "apps/local-host/src/main.ts": `const deps = { components: componentStore };` }),
  );
  assert.equal(declared.code, 0, declared.out);
});

void test("下载必须 redirect: manual —— 缺省的 follow 让白名单只挡住第一跳", () => {
  const r = check(
    baseline({
      "apps/local-host/src/component-store.ts": `
        // 注释里写着 redirect: "manual" 但调用里没有
        const res = await doFetch(url, {});
        if (url.protocol !== "https:") throw new Error("x");
        const S = [${STATES.map((s) => `"${s}"`).join(", ")}];
      `,
    }),
  );
  assert.equal(r.code, 1, "**注释里写了不算** —— 查的是那次调用");
  assert.match(r.out, /缺省的 follow 允许跳 20 次/);
});

void test("必须查 protocol —— 光比 origin 会让一条 http 的 pin 从 http 白名单项过去", () => {
  const r = check(
    baseline({
      "apps/local-host/src/component-store.ts": `
        const res = await doFetch(url, { redirect: "manual" });
        const S = [${STATES.map((s) => `"${s}"`).join(", ")}];
      `,
    }),
  );
  assert.equal(r.code, 1);
  assert.match(r.out, /字节走明文，而回执上写的是 https/);
});

void test("八种失败每一种都要有、且都要在界面上呈现", () => {
  for (const missing of ["gone", "mismatch", "cancelled"]) {
    // 组件库里没有这一种。
    const store = check(
      baseline({
        "apps/local-host/src/component-store.ts": `
          const res = await doFetch(url, { redirect: "manual" });
          if (url.protocol !== "https:") throw new Error("x");
          const S = [${STATES.filter((s) => s !== missing).map((s) => `"${s}"`).join(", ")}];
        `,
      }),
    );
    assert.equal(store.code, 1, `${missing} 缺失应该被拦`);
    assert.match(store.out, new RegExp(`没有 ${missing} 这一种失败`));

    // 有了但界面不呈现。
    const ui = check(
      baseline({
        "apps/ui-workspace/src/settings.tsx": `
          没查到 <span>{result.channel}</span> <span>{c.downloadBytes}</span>
          const L = { ${STATES.filter((s) => s !== missing).map((s) => `"${s}": "…"`).join(", ")} };
        `,
      }),
    );
    assert.equal(ui.code, 1, `${missing} 不呈现应该被拦`);
    assert.match(ui.out, new RegExp(`设置页没有呈现 ${missing} 这一路`));
  }
});

void test("点之前必须看得见要下多少 —— 不写体积的下载按钮在按流量计费的网络上有害", () => {
  const r = check(
    baseline({
      "apps/ui-workspace/src/settings.tsx": `
        没查到 <span>{result.channel}</span>
        const L = { ${STATES.map((s) => `"${s}": "…"`).join(", ")} };
      `,
    }),
  );
  assert.equal(r.code, 1);
  assert.match(r.out, /没有显示组件的体积/);
});

void test("没有 component-store.ts 时第四段整段跳过 —— 前三段照查", () => {
  const files = baseline();
  delete files["apps/local-host/src/component-store.ts"];
  const clean = check(files);
  assert.equal(clean.code, 0, clean.out);
  // 而前三段的规则仍然管用。
  const broken = check({ ...files, "apps/shell/src/main.ts": `import "electron-updater";` });
  assert.equal(broken.code, 1);
});

void test("拒绝时要说清这是 owner 的决定，不是实现细节", () => {
  const r = check(baseline({ "apps/shell/src/main.ts": `autoUpdater.checkForUpdates();` }));
  assert.match(r.out, /这些是 owner 的决定（TD-021），不是实现细节。要改先改决定。/);
});
