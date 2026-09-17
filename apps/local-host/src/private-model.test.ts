/**
 * 私有模型服务的接入配置（RY-001 §07 #41）。
 *
 * 两类断言值得盯：**口令不出守护进程**，以及**部署侧配了就钉死**。前者错了是
 * 泄漏，后者错了是用户能绕过运维的选择 —— 两种都不会有任何报错提醒我们。
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { PrivateModelStore, isLoopback, validate } from "./private-model.js";
import type { KeyManager } from "./keys.js";

function fakeKeys(): KeyManager {
  return {
    protection: "plaintext",
    seal: (data: Buffer) => Buffer.concat([Buffer.from("SEALED:"), data]),
    open: (blob: Buffer) => {
      if (blob.subarray(0, 7).toString() !== "SEALED:") throw new Error("not sealed by us");
      return blob.subarray(7);
    },
  } as unknown as KeyManager;
}

const makeDir = () => mkdtempSync(join(tmpdir(), "ruyin-pm-"));
const OK = { baseUrl: "http://127.0.0.1:11434/v1", model: "qwen2.5:14b" };

describe("isLoopback", () => {
  /**
   * 这个判定决定界面说哪一句：回环 → 上下文不出本机；否则 → 会离开这台机器。
   * **两句都对，但只有一句对得上用户的实际部署** —— 说错的那句是在替他做一个
   * 他没做过的承诺。
   */
  it("回环的几种写法都认得", () => {
    for (const u of [
      "http://127.0.0.1:11434/v1",
      "http://127.7.7.7:1/v1",
      "http://localhost:11434",
      "http://LOCALHOST:11434",
      "http://[::1]:11434/v1",
    ]) {
      assert.equal(isLoopback(u), true, u);
    }
  });

  it("局域网与公网地址不是回环 —— 那时上下文确实离开了这台机器", () => {
    for (const u of [
      "http://192.168.1.50:11434/v1",
      "http://10.0.0.8/v1",
      "https://gpu.corp.internal/v1",
    ]) {
      assert.equal(isLoopback(u), false, u);
    }
  });

  it("不是合法地址时按「非回环」算 —— 往安全的方向说", () => {
    assert.equal(isLoopback("not a url"), false);
  });
});

describe("validate", () => {
  /**
   * 地址与模型名**成对才算配了**：只给地址不给模型名，请求必然被提供方拒掉，
   * 而那种失败要到第一次跑任务时才看得见。入口就要成对。
   */
  it("地址与模型名缺一不可", () => {
    assert.equal(validate(OK), null);
    assert.match(validate({ baseUrl: OK.baseUrl }) ?? "", /模型名/);
    assert.match(validate({ model: OK.model }) ?? "", /服务地址/);
    assert.match(validate({ baseUrl: "  ", model: "m" }) ?? "", /服务地址/);
    assert.match(validate({ baseUrl: OK.baseUrl, model: "  " }) ?? "", /模型名/);
  });

  it("地址要合法，且只收 http / https", () => {
    assert.match(validate({ baseUrl: "not a url", model: "m" }) ?? "", /合法/);
    assert.match(validate({ baseUrl: "ftp://h/v1", model: "m" }) ?? "", /http/);
    assert.equal(validate({ baseUrl: "https://h/v1", model: "m" }), null);
  });

  it("超时给了就要是正数", () => {
    assert.equal(validate({ ...OK, timeoutMs: 1000 }), null);
    assert.match(validate({ ...OK, timeoutMs: 0 }) ?? "", /正数/);
    assert.match(validate({ ...OK, timeoutMs: -1 }) ?? "", /正数/);
    assert.match(validate({ ...OK, timeoutMs: Number.NaN }) ?? "", /正数/);
  });
});

describe("PrivateModelStore", () => {
  it("没配过：没有接入、来源是 none、可编辑", () => {
    const v = new PrivateModelStore(fakeKeys(), makeDir()).view();
    assert.deepEqual(v, { source: "none", editable: true });
    assert.equal(v.endpoint, undefined);
  });

  it("写进去读得回来，并标出是不是回环", () => {
    const store = new PrivateModelStore(fakeKeys(), makeDir());
    store.save({ ...OK, apiKey: "k" });

    assert.deepEqual(store.effective(), { ...OK, apiKey: "k" });
    assert.deepEqual(store.view(), {
      endpoint: { baseUrl: OK.baseUrl, model: OK.model, hasKey: true, loopback: true },
      source: "local",
      editable: true,
    });
  });

  it("局域网地址标成非回环", () => {
    const store = new PrivateModelStore(fakeKeys(), makeDir());
    store.save({ baseUrl: "http://192.168.1.50:11434/v1", model: "m" });
    assert.equal(store.view().endpoint?.loopback, false);
  });

  /**
   * **口令只出守护进程一次，就是写进去那一次。** 投影里只说有没有，不说是什么 ——
   * 界面拿不到它，也就没有第二个地方会把它漏出去。
   */
  it("投影里没有口令，只说有没有", () => {
    const store = new PrivateModelStore(fakeKeys(), makeDir());
    store.save({ ...OK, apiKey: "super-secret" });
    const raw = JSON.stringify(store.view());
    assert.ok(!raw.includes("super-secret"), "口令漏进了投影");
    assert.equal(store.view().endpoint?.hasKey, true);

    store.save({ ...OK });
    assert.equal(store.view().endpoint?.hasKey, false);
  });

  it("口令随主密钥封存，不以明文落盘", () => {
    const dir = makeDir();
    new PrivateModelStore(fakeKeys(), dir).save({ ...OK, apiKey: "super-secret" });
    const raw = readFileSync(join(dir, "models", "private-model.bin"));
    assert.equal(raw.subarray(0, 7).toString(), "SEALED:", "没有封存就落盘了");
  });

  it("撤掉之后回到没配", () => {
    const store = new PrivateModelStore(fakeKeys(), makeDir());
    store.save(OK);
    store.clear();
    assert.equal(store.effective(), undefined);
    assert.equal(store.view().source, "none");
  });

  describe("部署侧配了就钉死", () => {
    const deployed = { baseUrl: "http://gpu.corp:8000/v1", model: "qwen-72b" };

    /**
     * 私有化部署的运维选了哪台推理服务，**用户不该绕过去**。与「预置连接器卸不掉、
     * 只能停用」是同一条模式：谁配的谁说了算，比「后写的赢」好懂也更难出事。
     */
    it("来源是 deployment，且不可编辑", () => {
      const v = new PrivateModelStore(fakeKeys(), makeDir(), deployed).view();
      assert.equal(v.source, "deployment");
      assert.equal(v.editable, false);
      assert.equal(v.endpoint?.baseUrl, deployed.baseUrl);
    });

    it("写与撤都被拒", () => {
      const store = new PrivateModelStore(fakeKeys(), makeDir(), deployed);
      assert.throws(() => store.save(OK), /deployment-managed/);
      assert.throws(() => store.clear(), /deployment-managed/);
    });

    /** 本机早先配过、后来运维配了部署侧：**部署侧赢**，本机那份不生效也不被删。 */
    it("盖过本机已有的那份，而且不删它", () => {
      const dir = makeDir();
      new PrivateModelStore(fakeKeys(), dir).save(OK);
      const store = new PrivateModelStore(fakeKeys(), dir, deployed);
      assert.equal(store.effective()?.baseUrl, deployed.baseUrl);
      // 文件还在：运维哪天撤掉部署侧配置，用户原来那份就回来了。
      assert.equal(new PrivateModelStore(fakeKeys(), dir).effective()?.baseUrl, OK.baseUrl);
    });
  });

  describe("文件坏了", () => {
    /** 解不开（换过主密钥、被改过）就当没配 —— 不让半份配置带着去跑。 */
    it("解不开当没配，且不删文件", () => {
      const dir = makeDir();
      new PrivateModelStore(fakeKeys(), dir).save(OK);
      writeFileSync(join(dir, "models", "private-model.bin"), Buffer.from("garbage"));

      const store = new PrivateModelStore(fakeKeys(), dir);
      assert.equal(store.effective(), undefined);
      assert.equal(store.view().source, "none");
      // 不删：用户可能刚换机器，而一个解不开的文件不影响任何事。
      assert.ok(readFileSync(join(dir, "models", "private-model.bin")).length > 0);
    });

    it("解得开但内容不合法，同样当没配", () => {
      const dir = makeDir();
      const keys = fakeKeys();
      new PrivateModelStore(keys, dir).save(OK);
      writeFileSync(
        join(dir, "models", "private-model.bin"),
        keys.seal(Buffer.from(JSON.stringify({ baseUrl: "http://h/v1" }), "utf8")),
      );
      assert.equal(new PrivateModelStore(keys, dir).effective(), undefined);
    });
  });
});
