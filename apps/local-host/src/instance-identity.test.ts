/**
 * 实例身份与 DPoP 证明（RY-104 §03，阶段 3a）。
 *
 * 这套东西今天还没有对端，所以**用例是它唯一的验证**。两类断言值得盯：
 * 规范细节（指纹的规范化、JWS 的签名编码、htu 的去参），以及私钥永不外泄。
 * 规范细节错了都是同一种症状：本地怎么测都像对的，**到联调那天对方一律验不过**。
 */

import assert from "node:assert/strict";
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  verify as verifyBuffer,
} from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  InstanceIdentity,
  base64url,
  jwkThumbprint,
  normalizeHtu,
  type PublicJwk,
} from "./instance-identity.js";
import type { KeyManager } from "./keys.js";

/** 真加密不是重点，**封存过**才是：用例要能断言落盘的不是明文。 */
function fakeKeys(): KeyManager {
  return {
    protection: "plaintext",
    seal: (data: Buffer) => Buffer.concat([Buffer.from("SEALED:"), data]),
    open: (blob: Buffer) => {
      const head = blob.subarray(0, 7).toString();
      if (head !== "SEALED:") throw new Error("not sealed by us");
      return blob.subarray(7);
    },
  } as unknown as KeyManager;
}

const dirs: string[] = [];
function makeDir(): string {
  const d = mkdtempSync(join(tmpdir(), "ruyin-inst-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  /* 临时目录留着不删也无妨（系统会清），删失败更不该让用例红。 */
});

function decode(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

describe("jwkThumbprint", () => {
  /**
   * RFC 7638 的向量。成员顺序与无空白是**规范规定的**，不是风格 —— 顺序错了
   * 算出来就是另一个指纹，而两边各算各的、谁都不报错。
   */
  it("按 RFC 7638 的规范化算，成员顺序固定为 crv/kty/x/y", () => {
    const jwk: PublicJwk = {
      kty: "EC",
      crv: "P-256",
      x: "f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU",
      y: "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0",
    };
    const expected = base64url(
      createHash("sha256")
        .update(
          '{"crv":"P-256","kty":"EC","x":"f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU","y":"x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0"}',
          "utf8",
        )
        .digest(),
    );
    assert.equal(jwkThumbprint(jwk), expected);
  });

  it("换一个坐标就换一个指纹", () => {
    const a: PublicJwk = { kty: "EC", crv: "P-256", x: "aaa", y: "bbb" };
    const b: PublicJwk = { kty: "EC", crv: "P-256", x: "aaa", y: "ccc" };
    assert.notEqual(jwkThumbprint(a), jwkThumbprint(b));
  });

  it("指纹是 base64url —— 不含 + / =，可以直接进 URL 与头部", () => {
    const t = jwkThumbprint({ kty: "EC", crv: "P-256", x: "aaa", y: "bbb" });
    assert.match(t, /^[A-Za-z0-9_-]+$/);
  });
});

describe("normalizeHtu", () => {
  /**
   * 不去掉查询串的后果很安静：同一个端点带不同参数就成了不同的 `htu`，对方
   * 按规范比对时全部不匹配 —— 症状是「有时候能过有时候不能」。
   */
  it("去掉查询串与片段", () => {
    assert.equal(normalizeHtu("https://h/runtime/v1/report?x=1#f"), "https://h/runtime/v1/report");
    assert.equal(normalizeHtu("https://h/a/b"), "https://h/a/b");
  });

  it("不是合法地址时原样返回，不抛 —— 签一份证明不该因为一个地址崩掉调用方", () => {
    assert.equal(normalizeHtu("not a url"), "not a url");
  });
});

describe("InstanceIdentity", () => {
  it("首次加载生成密钥并封存；私钥不以明文落盘", () => {
    const dir = makeDir();
    const id = InstanceIdentity.load(fakeKeys(), dir);

    assert.equal(id.publicJwk.kty, "EC");
    assert.equal(id.publicJwk.crv, "P-256");
    assert.equal(id.jkt, jwkThumbprint(id.publicJwk));

    const raw = readFileSync(join(dir, "platform", "instance-key.bin"));
    assert.ok(raw.subarray(0, 7).toString() === "SEALED:", "私钥没有经过封存就落盘了");
    // 明文 PEM 的特征串一个都不该出现在文件里。
    assert.ok(!raw.toString("utf8").includes("BEGIN PRIVATE KEY"), "私钥以 PEM 明文落盘");
  });

  /** 身份必须跨重启稳定 —— 不稳定的话它就不是「这一次安装」的身份。 */
  it("第二次加载拿回同一个身份", () => {
    const dir = makeDir();
    const keys = fakeKeys();
    const first = InstanceIdentity.load(keys, dir);
    const second = InstanceIdentity.load(keys, dir);

    assert.equal(second.jkt, first.jkt);
    assert.deepEqual(second.publicJwk, first.publicJwk);
    assert.equal(second.createdAt, first.createdAt);
  });

  /**
   * 坏掉的密钥文件**不让守护进程起不来**：丢掉一个还没有任何对端认识的身份，
   * 代价是零；为了它拒绝启动，代价是整个应用。等实例凭据真的存在之后，这条
   * 要改成「报出来并要求重新注册」—— 那时丢身份就不是零代价了。
   */
  it("密钥文件损坏时重新生成一把，而不是让启动失败", () => {
    const dir = makeDir();
    const keys = fakeKeys();
    const before = InstanceIdentity.load(keys, dir);
    writeFileSync(join(dir, "platform", "instance-key.bin"), Buffer.from("garbage"));

    const after = InstanceIdentity.load(keys, dir);
    assert.notEqual(after.jkt, before.jkt, "损坏之后应当是一把新钥匙");
    assert.match(after.jkt, /^[A-Za-z0-9_-]+$/);
  });

  /**
   * 封存文件里塞一把**别的曲线**的密钥：解得开、是合法私钥，但不是 P-256。
   *
   * 这条路不是假想的：将来若要换曲线或换算法，旧机器上躺着的就是这种文件。
   * 拒绝它、重新生成一把，比拿着一把算不出正确 `jkt` 的钥匙继续跑要好 ——
   * 后者会一路走到联调那天才暴露，而那时症状是「对方说我的指纹不对」。
   */
  it("密钥不是 EC P-256 时当作坏文件处理，重新生成", () => {
    const dir = makeDir();
    const keys = fakeKeys();
    const before = InstanceIdentity.load(keys, dir);

    const wrong = generateKeyPairSync("ed25519").privateKey;
    writeFileSync(
      join(dir, "platform", "instance-key.bin"),
      keys.seal(
        Buffer.from(
          JSON.stringify({
            pkcs8: wrong.export({ format: "der", type: "pkcs8" }).toString("base64"),
            createdAt: new Date().toISOString(),
          }),
          "utf8",
        ),
      ),
    );

    const after = InstanceIdentity.load(keys, dir);
    assert.equal(after.publicJwk.crv, "P-256");
    assert.notEqual(after.jkt, before.jkt);
  });

  describe("dpopProof", () => {
    const at = new Date(1789600000 * 1000);

    it("头部带公钥本身，typ 与 alg 按 RFC 9449", () => {
      const id = InstanceIdentity.load(fakeKeys(), makeDir());
      const [h] = id.dpopProof({ htm: "post", htu: "https://h/runtime/v1/report" }, at).split(".");
      const header = decode(h!);
      assert.equal(header["typ"], "dpop+jwt");
      assert.equal(header["alg"], "ES256");
      assert.deepEqual(header["jwk"], id.publicJwk);
    });

    it("载荷绑住方法与地址；方法大写、地址去掉查询串", () => {
      const id = InstanceIdentity.load(fakeKeys(), makeDir());
      const [, p] = id
        .dpopProof({ htm: "post", htu: "https://h/runtime/v1/report?a=1" }, at)
        .split(".");
      const payload = decode(p!);
      assert.equal(payload["htm"], "POST");
      assert.equal(payload["htu"], "https://h/runtime/v1/report");
      assert.equal(payload["iat"], 1789600000);
    });

    it("给了凭据才有 ath，且是它的 sha256", () => {
      const id = InstanceIdentity.load(fakeKeys(), makeDir());
      const without = decode(id.dpopProof({ htm: "GET", htu: "https://h/a" }, at).split(".")[1]!);
      assert.equal(without["ath"], undefined);

      const withTok = decode(
        id.dpopProof({ htm: "GET", htu: "https://h/a", accessToken: "tok" }, at).split(".")[1]!,
      );
      assert.equal(
        withTok["ath"],
        base64url(createHash("sha256").update("tok", "utf8").digest()),
      );
    });

    /** `jti` 每次新的：控制面拿它挡重放。重复了就等于给了一次重放机会。 */
    it("每次签一个新的 jti", () => {
      const id = InstanceIdentity.load(fakeKeys(), makeDir());
      const a = decode(id.dpopProof({ htm: "GET", htu: "https://h/a" }, at).split(".")[1]!);
      const b = decode(id.dpopProof({ htm: "GET", htu: "https://h/a" }, at).split(".")[1]!);
      assert.notEqual(a["jti"], b["jti"]);
    });

    /**
     * **这条是最容易错、也最难自己发现的一条。**
     *
     * JWS 的 ES256 要的是原始 R||S（64 字节），Node 的 `sign` 默认给 DER 包装。
     * 给错了本地怎么测都像对的 —— 它确实是一个有效签名，只是编码不对 ——
     * 而对方按 JWS 验永远不过。所以这里**按 JWS 的规矩验一遍**：长度必须是 64，
     * 并且用 ieee-p1363 验得过。
     */
    it("签名是 JWS 要的原始 R||S（64 字节），不是 DER", () => {
      const id = InstanceIdentity.load(fakeKeys(), makeDir());
      const proof = id.dpopProof({ htm: "GET", htu: "https://h/a" }, at);
      const [h, p, sig] = proof.split(".");
      const raw = Buffer.from(sig!, "base64url");
      assert.equal(raw.length, 64, "签名不是 64 字节的 R||S —— 多半是 DER 包装");

      const ok = verifyBuffer(
        "sha256",
        Buffer.from(`${h}.${p}`, "ascii"),
        {
          key: createPublicKey({ key: id.publicJwk as never, format: "jwk" }),
          dsaEncoding: "ieee-p1363",
        },
        raw,
      );
      assert.ok(ok, "用头部里那把公钥验不过自己签的证明");
    });

    it("改一个字节就验不过 —— 证明真的绑住了内容", () => {
      const id = InstanceIdentity.load(fakeKeys(), makeDir());
      const [h, p, sig] = id.dpopProof({ htm: "GET", htu: "https://h/a" }, at).split(".");
      const tampered = decode(p!);
      tampered["htu"] = "https://evil/a";
      const ok = verifyBuffer(
        "sha256",
        Buffer.from(`${h}.${base64url(Buffer.from(JSON.stringify(tampered)))}`, "ascii"),
        {
          key: createPublicKey({ key: id.publicJwk as never, format: "jwk" }),
          dsaEncoding: "ieee-p1363",
        },
        Buffer.from(sig!, "base64url"),
      );
      assert.equal(ok, false, "改了地址还验得过，证明没有绑住载荷");
    });

    it("三段式，每段都是 base64url", () => {
      const id = InstanceIdentity.load(fakeKeys(), makeDir());
      const parts = id.dpopProof({ htm: "GET", htu: "https://h/a" }, at).split(".");
      assert.equal(parts.length, 3);
      for (const part of parts) assert.match(part, /^[A-Za-z0-9_-]+$/);
    });

    /** 私钥不该出现在证明的任何一处 —— 头部只放公开成员。 */
    it("证明里没有私钥成分（JWK 只有公开部分）", () => {
      const id = InstanceIdentity.load(fakeKeys(), makeDir());
      const [h] = id.dpopProof({ htm: "GET", htu: "https://h/a" }, at).split(".");
      const jwk = decode(h!)["jwk"] as Record<string, unknown>;
      // `d` 是 EC 私钥成分。它出现在这里就是私钥出网了。
      assert.equal(jwk["d"], undefined, "私钥成分 d 进了 DPoP 头部");
      assert.deepEqual(Object.keys(jwk).sort(), ["crv", "kty", "x", "y"]);
    });
  });
});
