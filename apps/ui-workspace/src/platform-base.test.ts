/**
 * 两个基址的取法（0b）。用例的重点不是「?? 会不会工作」，而是**两个基址不能串**
 * —— 这一类错已经在生产上发生过两次（「用户中心」「配额用量」误拼到官网）。
 */

import { expect, test } from "vitest";
import {
  DEFAULT_CONSOLE_APP_BASE,
  DEFAULT_CONSOLE_BASE,
  consoleAppBaseOf,
  consoleBaseOf,
} from "./platform-base";

test("两个缺省值不是同一个主机 —— 串了就是把人送去 404", () => {
  expect(DEFAULT_CONSOLE_BASE).not.toBe(DEFAULT_CONSOLE_APP_BASE);
  expect(new URL(DEFAULT_CONSOLE_BASE).host).not.toBe(
    new URL(DEFAULT_CONSOLE_APP_BASE).host,
  );
});

test("会话给了就用会话的 —— 私有部署据此指向自己的控制面", () => {
  expect(consoleBaseOf({ consoleBase: "https://ruyin.acme.internal" })).toBe(
    "https://ruyin.acme.internal",
  );
  expect(consoleAppBaseOf({ consoleAppBase: "https://console.acme.internal" })).toBe(
    "https://console.acme.internal",
  );
});

test("没有会话 / 字段缺席 / 空串都落到生产缺省，而不是空地址", () => {
  for (const session of [undefined, null, {} as never]) {
    expect(consoleBaseOf(session)).toBe(DEFAULT_CONSOLE_BASE);
    expect(consoleAppBaseOf(session)).toBe(DEFAULT_CONSOLE_APP_BASE);
  }
  // 空串是「守护进程还没接通」的真实取值，不能拼出 `/profile` 这种相对地址。
  expect(consoleBaseOf({ consoleBase: "" })).toBe(DEFAULT_CONSOLE_BASE);
  expect(consoleAppBaseOf({ consoleAppBase: "" })).toBe(DEFAULT_CONSOLE_APP_BASE);
});
