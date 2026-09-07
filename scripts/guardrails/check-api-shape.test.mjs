/**
 * check-api-shape.mjs 自己的测试。
 *
 * 这道守卫钉的是**接口通则 X-1 / B-3** —— 错误封套的形状、错误码的写法、以及
 * 「不做配额门控」这条产品口径在代码里的落点。它拦的东西有一个共同点：**写错了
 * 也能跑**。旧封套 `{ error: "..." }` 是合法的 JS；小写的错误码是合法的字符串；
 * 一个永远不会发生的 `QUOTA_EXCEEDED` 更是连运行时都碰不到 —— 它只会让消费方
 * 写下一条永不触发的分支，然后一直留在那儿。
 *
 * 所以四条规则各验一遍，每次只坏一处；再加一条反向的：**合规的写法不能被误伤**。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { fixtureRepo } from "./fixture-repo.mjs";

const GUARD = "check-api-shape.mjs";
const SRC = "apps/local-host/src";

/** X-1 词表齐全的 errors.ts —— 第四条规则要的就是它。 */
const ERRORS_TS = `
export const REJECTION = {
  NOT_ENTITLED: "NOT_ENTITLED",
  POLICY_DENIED: "POLICY_DENIED",
  APPROVAL_REQUIRED: "APPROVAL_REQUIRED",
} as const;
`;

/** files 是 { 相对 src 的文件名: 内容 }；errors.ts 默认给一份合规的。 */
function check(files = {}, errors = ERRORS_TS) {
  const repo = fixtureRepo("ruyin-apishape-");
  try {
    repo.write(`${SRC}/errors.ts`, errors);
    for (const [name, body] of Object.entries(files)) repo.write(`${SRC}/${name}`, body);
    return repo.run(GUARD);
  } finally {
    repo.clean();
  }
}

void test("合规的写法要通过 —— 误伤正确的代码比漏掉错的更糟", () => {
  const r = check({
    "server.ts": `
      send(res, 404, apiError("PROJECT_NOT_FOUND", "项目不存在"));
      send(res, 403, apiError(REJECTION.POLICY_DENIED, msg));
    `,
    "nested/deep.ts": `send(res, 400, apiError("BINDING_INVALID", m));`,
  });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /OK - 错误封套与拒绝词表符合通则 X-1 \/ B-3/);
});

/**
 * **已知的宽松处，钉住而不是假装它精确。**
 *
 * 这道守卫是按行扫文本的，不解析 AST。所以注释里、字符串里提到 `error: "..."`
 * 也会被当成违规。写这条用例是因为：知道它会这样，比以为它精确要好 —— 哪天有人
 * 被误伤，看到这条用例就知道这是有意接受的，而不是一个 bug。
 *
 * 接受它的理由：守卫的误伤代价是「换个写法」，而做成 AST 感知要引一整个解析器
 * 进来。对一支 79 行的守卫，不值。
 */
void test("按行扫文本：注释里提到旧封套也会被拦（有意接受的宽松处）", () => {
  const r = check({ "server.ts": `// 历史上这里写的是 { error: "旧的" }，现在不这么写了` });
  assert.equal(r.code, 1, "它确实会拦注释 —— 这是当前行为，不是缺陷");
  assert.match(r.out, /旧错误形状/);
});

void test("旧封套 { error: \"...\" } 要拦 —— 它是合法的 JS，不写守卫没人会发现", () => {
  const r = check({ "server.ts": `send(res, 400, { error: "出错了" });` });
  assert.equal(r.code, 1);
  assert.match(r.out, /旧错误形状/);
  assert.match(r.out, /code, message, retryable/, "要说清正确的形状是什么");
  assert.match(r.out, /server\.ts:1/, "要点名文件与行号");
});

void test("错误码必须是 SCREAMING_SNAKE", () => {
  for (const bad of ["notFound", "Not_Found", "not-found", "404"]) {
    const r = check({ "server.ts": `apiError("${bad}", m)` });
    assert.equal(r.code, 1, `${bad} 应该被拒`);
    assert.match(r.out, /不是 SCREAMING_SNAKE/);
  }
  for (const good of ["NOT_FOUND", "A", "TASK_REJECTED", "HTTP_503"]) {
    const r = check({ "server.ts": `apiError("${good}", m)` });
    assert.equal(r.code, 0, `${good} 应该被接受：${r.out}`);
  }
});

void test("QUOTA_EXCEEDED 要拦 —— **Ruyin 不做配额门控，这个码永远不会发生**", () => {
  const r = check({ "server.ts": `apiError("QUOTA_EXCEEDED", "超额")` });
  assert.equal(r.code, 1);
  assert.match(r.out, /Ruyin 不做配额门控/);
  assert.match(r.out, /永不触发的分支/, "要说清后果：消费方会写一条死分支");
});

void test("errors.ts 少了任何一个拒绝码都要拦 —— 词表照抄，不自造同义词", () => {
  for (const missing of ["NOT_ENTITLED", "POLICY_DENIED", "APPROVAL_REQUIRED"]) {
    const errors = ERRORS_TS.replaceAll(missing, "SOMETHING_ELSE");
    const r = check({}, errors);
    assert.equal(r.code, 1, `${missing} 缺失应该被拒`);
    assert.match(r.out, new RegExp(`缺少拒绝码 ${missing}`));
  }
});

void test("只扫 .ts，且跳过 .test.ts —— 测试里为了测坏形状而写的坏形状不算违规", () => {
  const r = check({
    "server.test.ts": `assert(body, { error: "旧形状" }); apiError("lowercase", m)`,
    "notes.md": `{ error: "这是文档" }`,
    "app.css": `.x { error: "不是代码" }`,
  });
  assert.equal(r.code, 0, r.out);
});

void test("多处违规一次全报出来 —— 一次修一个来回太多", () => {
  const r = check({
    "a.ts": `send(res, 400, { error: "x" });`,
    "b.ts": `apiError("lowercase", m)`,
    "c.ts": `apiError("QUOTA_EXCEEDED", m)`,
  });
  assert.equal(r.code, 1);
  for (const expect of [/旧错误形状/, /SCREAMING_SNAKE/, /配额门控/]) {
    assert.match(r.out, expect);
  }
});
