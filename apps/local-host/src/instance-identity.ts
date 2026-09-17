/**
 * 这一次安装的身份（RY-100 §03 A2 / A3，RY-104 §03，RY-103 阶段 3a）。
 *
 * @package @vxture/ruyin-local-host
 *
 * ## 它回答哪个问题
 *
 * 三种正交主体里的第二种：**用户**是谁在操作，**产品**是哪个智能体在跑，而这里
 * 是**哪一台运行时**。三者各有身份、各有凭据、各自可吊销。
 *
 * 运行时必须有自己的身份，理由是一句话：**无人值守**。智能体每天早上自动生成
 * 草稿、跑一整晚的长任务、用户锁屏之后继续 —— 这不是边缘场景，是智能体产品的
 * 核心形态。如果身份只有用户令牌，令牌过期 = 任务死。
 *
 * ## 今天它还没有对端
 *
 * **诚实说清楚：这个文件今天不产生任何用户可见的效果。** 没有任何端点收 DPoP
 * 证明，控制面还不存在（RY-103 阶段 1 在平台侧）。它是地基，不是功能。
 *
 * 那为什么现在建：
 *
 * 1. **每一种候选设计都要它。** 不像能力路由那样取决于一条可能永远不长成现在
 *    这样的云端通路 —— 运行时身份是 RY-100 骨架里的必需项，R1–R4 怎么定都不改
 *    这件事。
 * 2. **形状由 RFC 定，不由平台定。** DPoP 是 RFC 9449，指纹是 RFC 7638。平台
 *    那边怎么接，不影响这段代码长什么样。
 * 3. 它提前暴露阶段 3 最大的未知数：`platform-session.ts` 那次重构有多伤筋动骨。
 *
 * 唯一的当下收益很小但是真的：指纹（`jkt`）进 `/system`，配合日志文件（TD-066）
 * 给出一个**稳定的安装标识** —— 用户报障时对得上是哪一台。
 *
 * ## 私钥
 *
 * **永不出本机、永不进日志、永不进任何响应。** 随主密钥封存（win32 下主密钥受
 * DPAPI 保护），与平台会话用的是同一套 `KeyManager`。目标态升 TPM / Secure
 * Enclave 时，签名挪进硬件而 `jkt` 不变 —— 换的只是签名器，公钥与指纹是同一个。
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign as signBuffer,
  type KeyObject,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { KeyManager } from "./keys.js";

// ============================================================================
// Types
// ============================================================================

/** 公钥的 JWK 表示（EC P-256）。**只有公开部分** —— 这个对象可以出网。 */
export interface PublicJwk {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
}

/** 一次 DPoP 证明要绑住的东西（RFC 9449 §4.2）。 */
export interface DpopClaims {
  /** HTTP 方法，大写。 */
  htm: string;
  /** 目标地址，**不含查询串与片段**（规范要求）。 */
  htu: string;
  /** 绑定到某张具体凭据时给：`ath = base64url(sha256(凭据))`。 */
  accessToken?: string | undefined;
}

interface PersistedKey {
  /** PKCS#8 DER，base64。封存之后才落盘。 */
  pkcs8: string;
  createdAt: string;
}

const KEY_FILE = "instance-key.bin";

// ============================================================================
// 编码
// ============================================================================

export function base64url(b: Buffer): string {
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * JWK 指纹（RFC 7638）。
 *
 * **成员顺序与字符串形式是规范规定的，不是风格**：必填成员按字典序（EC 是
 * `crv` / `kty` / `x` / `y`）、无空白、无多余成员。顺序错了算出来就是另一个
 * 指纹，而两边各算各的、谁都不报错 —— 那种不一致要到联调时才看得见。
 */
export function jwkThumbprint(jwk: PublicJwk): string {
  const canonical = `{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}","y":"${jwk.y}"}`;
  return base64url(createHash("sha256").update(canonical, "utf8").digest());
}

function publicJwkOf(publicKey: KeyObject): PublicJwk {
  const jwk = publicKey.export({ format: "jwk" }) as {
    kty?: string;
    crv?: string;
    x?: string;
    y?: string;
  };
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y) {
    throw new Error("instance key is not an EC P-256 key");
  }
  return { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y };
}

// ============================================================================
// InstanceIdentity
// ============================================================================

export class InstanceIdentity {
  private constructor(
    private readonly privateKey: KeyObject,
    readonly publicJwk: PublicJwk,
    /** 公钥指纹。实例凭据将绑在它上面（`cnf.jkt`）。 */
    readonly jkt: string,
    readonly createdAt: string,
  ) {}

  /**
   * 取出这台机器的身份；没有就建一个。
   *
   * **坏掉的密钥文件不让守护进程起不来**：读不出来就重新生成一把。丢掉一个
   * 还没有任何对端认识的身份，代价是零；而为了它拒绝启动，代价是整个应用。
   * 等到实例凭据真的存在之后，这条要改成「报出来并要求重新注册」—— 那时
   * 丢身份就不是零代价了。
   */
  static load(keys: KeyManager, dataDir: string): InstanceIdentity {
    const path = join(dataDir, "platform", KEY_FILE);
    if (existsSync(path)) {
      try {
        return InstanceIdentity.restore(keys, path);
      } catch (cause) {
        console.warn(
          `[ruyin] instance key unreadable, generating a new one: ${
            cause instanceof Error ? cause.message : cause
          }`,
        );
        rmSync(path, { force: true });
      }
    }
    return InstanceIdentity.create(keys, path);
  }

  private static restore(keys: KeyManager, path: string): InstanceIdentity {
    const saved = JSON.parse(
      keys.open(readFileSync(path)).toString("utf8"),
    ) as PersistedKey;
    const privateKey = createPrivateKey({
      key: Buffer.from(saved.pkcs8, "base64"),
      format: "der",
      type: "pkcs8",
    });
    const jwk = publicJwkOf(createPublicKey(privateKey));
    return new InstanceIdentity(privateKey, jwk, jwkThumbprint(jwk), saved.createdAt);
  }

  private static create(keys: KeyManager, path: string): InstanceIdentity {
    /* ES256 而不是 RSA：密钥小、签得快，而运行时**每个请求都要签一次**证明。 */
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    const createdAt = new Date().toISOString();
    const value: PersistedKey = {
      pkcs8: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
      createdAt,
    };
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, keys.seal(Buffer.from(JSON.stringify(value), "utf8")));
    const jwk = publicJwkOf(publicKey);
    return new InstanceIdentity(privateKey, jwk, jwkThumbprint(jwk), createdAt);
  }

  /**
   * 签一份 DPoP 证明（RFC 9449）。
   *
   * 头部带**公钥本身**，载荷绑住方法与地址；给了凭据就再绑住那张凭据（`ath`）。
   * 于是抄走凭据的人签不出证明 —— 这正是把「持不住令牌」变成「持住了也没用」
   * 的那一步，也是旧决策 D4 两条理由里的第一条被解掉的地方（RY-104 §03）。
   *
   * `jti` 每次新的：控制面留存一小段时间用来挡重放。
   */
  dpopProof(claims: DpopClaims, now: Date = new Date()): string {
    const header = {
      typ: "dpop+jwt",
      alg: "ES256",
      jwk: this.publicJwk,
    };
    const payload: Record<string, unknown> = {
      htm: claims.htm.toUpperCase(),
      htu: normalizeHtu(claims.htu),
      iat: Math.floor(now.getTime() / 1000),
      jti: randomUUID(),
      ...(claims.accessToken
        ? {
            ath: base64url(
              createHash("sha256").update(claims.accessToken, "utf8").digest(),
            ),
          }
        : {}),
    };
    const signingInput = `${base64url(Buffer.from(JSON.stringify(header)))}.${base64url(
      Buffer.from(JSON.stringify(payload)),
    )}`;
    /* JWS 的 ES256 要的是原始 R||S（64 字节），不是 DER 包装 —— Node 默认给 DER，
       所以必须显式要 ieee-p1363。给错了对方验签永远不过，而本地怎么测都像对的。 */
    const signature = signBuffer("sha256", Buffer.from(signingInput, "ascii"), {
      key: this.privateKey,
      dsaEncoding: "ieee-p1363",
    });
    return `${signingInput}.${base64url(signature)}`;
  }
}

/**
 * `htu` 去掉查询串与片段（RFC 9449 §4.2）。
 *
 * 不去掉的后果很安静：同一个端点带不同查询参数就成了不同的 `htu`，对方按规范
 * 比对时全部不匹配 —— 症状是「有时候能过有时候不能」。
 */
export function normalizeHtu(url: string): string {
  try {
    const u = new URL(url);
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}
