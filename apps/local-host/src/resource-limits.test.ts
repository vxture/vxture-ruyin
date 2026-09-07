/**
 * 本机资源上限的取值与措辞（TD-046）。
 *
 * 措辞也在这里测，因为判据里那一半是「**说得出是谁超的**」—— 一句「资源超限」
 * 对用户等于没说，而一句没有名字的错误信息和一句有名字的，在代码里长得一样。
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_RESOURCE_LIMITS,
  overLimitMessage,
  resourceLimitsFromEnv,
} from "./resource-limits.js";

test("没配就是缺省，且不打任何日志 —— 缺省值天天报一行，人会学会忽略它", () => {
  const { limits, notes } = resourceLimitsFromEnv({});
  assert.deepEqual(limits, DEFAULT_RESOURCE_LIMITS);
  assert.deepEqual(notes, []);
});

test("每一条都能被改，且单位按变量名（KB / MB / 个）换算", () => {
  const { limits } = resourceLimitsFromEnv({
    RUYIN_MAX_TOOL_SERVERS: "2",
    RUYIN_MAX_SERVER_LINE_KB: "64",
    RUYIN_MAX_TOOL_RESULT_KB: "32",
    RUYIN_MAX_INDEX_ITEMS: "10",
    RUYIN_MAX_INDEX_MB: "5",
  });
  assert.equal(limits.maxToolServers, 2);
  assert.equal(limits.maxServerLineBytes, 64 * 1024);
  assert.equal(limits.maxToolResultBytes, 32 * 1024);
  assert.equal(limits.maxIndexItems, 10);
  assert.equal(limits.maxIndexBytes, 5 * 1024 * 1024);
});

test("改动过的才进日志，且日志说得出改了哪一条", () => {
  const { notes } = resourceLimitsFromEnv({ RUYIN_MAX_TOOL_SERVERS: "2" });
  assert.deepEqual(notes, ["RUYIN_MAX_TOOL_SERVERS=2"]);
});

test("非正整数回落到缺省，**并说出来** —— 一个被忽略的配置不该是静默的", () => {
  for (const bad of ["0", "-1", "abc", "1.5"]) {
    const { limits, notes } = resourceLimitsFromEnv({ RUYIN_MAX_TOOL_SERVERS: bad });
    assert.equal(
      limits.maxToolServers,
      DEFAULT_RESOURCE_LIMITS.maxToolServers,
      `"${bad}" 该回落到缺省`,
    );
    assert.match(notes[0] ?? "", /不是正整数/);
  }
});

test("没有「不限」的写法：这三条护的是用户的机器，拆掉它不该只是一个环境变量的事", () => {
  const { limits } = resourceLimitsFromEnv({ RUYIN_MAX_TOOL_SERVERS: "unlimited" });
  assert.equal(limits.maxToolServers, DEFAULT_RESOURCE_LIMITS.maxToolServers);
});

test("超限的那句话里有名字 —— 「已达上限」不告诉用户该去停哪一个", () => {
  const msg = overLimitMessage("同时运行的工具服务器", 2, ["filesystem", "playwright"]);
  assert.match(msg, /filesystem/);
  assert.match(msg, /playwright/);
  assert.match(msg, /2/);
});

test("一个名字都没记到时也不假装知道", () => {
  const msg = overLimitMessage("同时运行的工具服务器", 2, []);
  assert.match(msg, /没有记录到是谁/);
});
