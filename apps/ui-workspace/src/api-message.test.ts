/**
 * 守护进程的错误 → 界面说什么（api-message.ts）。
 *
 * 这一层的分寸是全部：**接管通用的那几类，放过点名了具体东西的那些。**
 */
import { expect, test } from "vitest";
import { ApiError } from "./api";
import { describeError } from "./api-message";
import { translate, type TKey, type Vars } from "./i18n";

const tzh = (k: TKey, v?: Vars) => translate("zh-CN", k, v);
const ten = (k: TKey, v?: Vars) => translate("en", k, v);

test("认得的通用码按语言说，不再露出守护进程那份中文", () => {
  const e = new ApiError(503, {
    code: "CONNECTORS_NOT_AVAILABLE",
    message: "当前版本暂不提供连接器",
  });
  expect(describeError(tzh, e)).toBe("当前版本暂不提供连接器");
  expect(describeError(ten, e)).toBe("This build does not offer connectors");
});

/**
 * **点名了具体东西的那些原话照旧。** `POLICY_DENIED` 说清了缺哪个权限码、
 * `FILE_NOT_GRANTED` 说清了是哪个文件夹 —— 那比这里能写的任何一句都具体，
 * 翻译掉反而变笼统。
 */
test("认不出的码回退到守护进程的原话，不吞成一句笼统的", () => {
  const e = new ApiError(403, {
    code: "POLICY_DENIED",
    message: "缺少 tenant.billing.read",
  });
  expect(describeError(tzh, e)).toBe("缺少 tenant.billing.read");
  expect(describeError(ten, e)).toBe("缺少 tenant.billing.read");
});

/** 连守护进程都没问到（断网、没起来）：能做的只有一件事，就说那一件。 */
test("不是 ApiError 时也要有话说，不端出 fetch failed 那种原话", () => {
  expect(describeError(tzh, new TypeError("fetch failed"))).toBe(
    "暂时连不上本机的运行环境，请稍后再试",
  );
  expect(describeError(ten, new TypeError("fetch failed"))).toContain("not reachable");
});

/** 封套里连 message 都没有时不返回空 —— 空白比任何一句话都糟。 */
test("封套残缺时仍然有一句话", () => {
  expect(describeError(tzh, new ApiError(500, {}))).toBe("HTTP 500");
});
