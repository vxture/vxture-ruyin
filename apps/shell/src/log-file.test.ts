/**
 * 日志落文件的纯逻辑（TD-066）。
 *
 * 脱敏那几条是本文件的重点：**漏掉一种写法，那条秘密就安静地躺在用户磁盘上，
 * 而一切看起来都正常**。没有任何报错会提醒我们。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  REDACTED,
  filesToPrune,
  formatChunk,
  logFileName,
  redact,
  stamp,
} from "./log-file.js";

describe("redact", () => {
  /**
   * 守护进程真的会打这一行（`local-host/src/main.ts`）—— **行的形状照抄，令牌的值
   * 必须是合成的**。
   *
   * 这条注释是买来的：写这条用例时我把当时跑着的那个守护进程的真实令牌粘了进来，
   * 提交被 gitleaks 当场拦下。用例要证明的是「这个形状的行会被盖住」，用真值证明
   * 不了更多，却把一份凭据永久写进了仓库历史。
   */
  it("盖掉守护进程启动时打的会话令牌", () => {
    const fake = "0".repeat(48);
    const out = redact(`[ruyin] session token: ${fake}`);
    assert.ok(!out.includes(fake), "令牌漏进了日志");
    assert.equal(out, `[ruyin] session token: ${REDACTED}`);
  });

  it("只盖值不盖键名 —— 排障的人要看得出这里本来有什么", () => {
    assert.match(redact("rpsid=abc123"), /rpsid/);
    assert.match(redact("rpsid=abc123"), /\*\*\*/);
    assert.ok(!redact("rpsid=abc123").includes("abc123"));
  });

  it("冒号与等号、大小写、多余空格都盖得住", () => {
    for (const line of [
      "token: abc123",
      "TOKEN=abc123",
      "Token   :   abc123",
      "deviceSecret: abc123",
      "apiKey=abc123",
      "api key: abc123",
      "password: abc123",
      "authorization: abc123",
    ]) {
      assert.ok(!redact(line).includes("abc123"), line);
    }
  });

  it("Bearer 凭据按形状盖 —— 键名不在同一行也认得出", () => {
    const out = redact("GET /system authorization Bearer eyJhbGciOi.payload.sig");
    assert.ok(!out.includes("eyJhbGciOi"), "Bearer 令牌漏了");
    assert.match(out, /Bearer \*\*\*/);
  });

  it("一行里有两个秘密时两个都盖", () => {
    const out = redact("token: aaa111 rpsid: bbb222");
    assert.ok(!out.includes("aaa111"));
    assert.ok(!out.includes("bbb222"));
  });

  /**
   * 盖到分隔符为止，不吃掉整行。一行里秘密后面往往还跟着有用的信息
   * （端口、耗时），那些正是排障要看的。
   */
  it("盖到分隔符为止，后面的正常内容留着", () => {
    const out = redact("token: abc123, port=7420");
    assert.ok(!out.includes("abc123"));
    assert.match(out, /port=7420/);
  });

  it("没有秘密的行原样通过 —— 不做多余改写", () => {
    const line = "[ruyin] listening on http://127.0.0.1:7420";
    assert.equal(redact(line), line);
  });

  /** 空值不该把后面的文字当成秘密吃掉。 */
  it("键名后面没有值时不误伤", () => {
    assert.equal(redact("token:"), "token:");
  });
});

describe("formatChunk", () => {
  const at = new Date(2026, 8, 17, 9, 5, 3);

  it("完整行加时间戳与来源前缀", () => {
    const { text, rest } = formatChunk("hello\n", "daemon", at);
    assert.equal(text, "09:05:03 [daemon] hello\n");
    assert.equal(rest, "");
  });

  it("多行一次写完，每行各自带前缀", () => {
    const { text } = formatChunk("a\nb\n", "shell", at);
    assert.equal(text, "09:05:03 [shell] a\n09:05:03 [shell] b\n");
  });

  /**
   * **这条是安全相关的，不只是整洁问题。** 管道给的是字节块不是行，一次
   * `data` 可能切在令牌中间。半行不写出去、攒到下一块，脱敏才拿得到完整的
   * 一行去匹配 —— 否则秘密可以横跨两次写入漏出去。
   */
  it("残缺的尾巴不写出去，留给下一块", () => {
    const first = formatChunk("session token: abc", "daemon", at);
    assert.equal(first.text, "", "半行被写出去了");
    assert.equal(first.rest, "session token: abc");

    const second = formatChunk(first.rest + "123\n", "daemon", at);
    assert.ok(!second.text.includes("abc123"), "跨块的令牌漏了");
    assert.match(second.text, /session token: \*\*\*/);
  });

  it("空块什么都不产出", () => {
    assert.deepEqual(formatChunk("", "daemon", at), { text: "", rest: "" });
  });
});

describe("logFileName / stamp", () => {
  it("文件名按天且零填充 —— 字典序即时间序", () => {
    assert.equal(logFileName(new Date(2026, 0, 5)), "ruyin-2026-01-05.log");
    assert.equal(logFileName(new Date(2026, 11, 31)), "ruyin-2026-12-31.log");
    // 字典序必须与时间序一致，轮转与清理都依赖这一点。
    assert.ok(logFileName(new Date(2026, 0, 5)) < logFileName(new Date(2026, 11, 31)));
  });

  it("时间戳零填充", () => {
    assert.equal(stamp(new Date(2026, 8, 17, 9, 5, 3)), "09:05:03");
  });
});

describe("filesToPrune", () => {
  const f = (name: string, bytes = 100) => ({ name, bytes });
  const OPTS = { keepDays: 3, maxTotalBytes: 1000 };

  it("超出保留天数的旧文件被删", () => {
    const doomed = filesToPrune(
      ["ruyin-2026-09-17.log", "ruyin-2026-09-16.log", "ruyin-2026-09-15.log", "ruyin-2026-09-14.log"].map((n) => f(n)),
      OPTS,
    );
    assert.deepEqual(doomed, ["ruyin-2026-09-14.log"]);
  });

  it("总量超限时从最旧的开始删", () => {
    const doomed = filesToPrune(
      [f("ruyin-2026-09-17.log", 600), f("ruyin-2026-09-16.log", 600), f("ruyin-2026-09-15.log", 600)],
      { keepDays: 30, maxTotalBytes: 1000 },
    );
    assert.deepEqual(doomed, ["ruyin-2026-09-16.log", "ruyin-2026-09-15.log"]);
  });

  /**
   * 最新那一份永远留着，哪怕它自己就超了上限 —— 删掉今天的日志去满足一个配额，
   * 正好删掉了唯一有用的那份。
   */
  it("最新的一份永远保留，哪怕它自己就超上限", () => {
    const doomed = filesToPrune([f("ruyin-2026-09-17.log", 99999)], { keepDays: 3, maxTotalBytes: 1000 });
    assert.deepEqual(doomed, []);
  });

  it("没到上限时一个都不删", () => {
    const doomed = filesToPrune([f("ruyin-2026-09-17.log"), f("ruyin-2026-09-16.log")], OPTS);
    assert.deepEqual(doomed, []);
  });

  it("空目录不报错", () => {
    assert.deepEqual(filesToPrune([], OPTS), []);
  });

  /** 输入顺序不影响结果：目录读回来的顺序不保证。 */
  it("输入乱序也按日期判定", () => {
    const names = ["ruyin-2026-09-14.log", "ruyin-2026-09-17.log", "ruyin-2026-09-15.log", "ruyin-2026-09-16.log"];
    assert.deepEqual(filesToPrune(names.map((n) => f(n)), OPTS), ["ruyin-2026-09-14.log"]);
  });
});
