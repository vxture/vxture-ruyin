/**
 * 私有模型服务的接入配置（RY-100 A15 / A16 / A18，RY-001 §07 #41）。
 *
 * @package @vxture/ruyin-local-host
 *
 * ## 为什么叫「私有」而不是「本地」
 *
 * 它<strong>未必在本机</strong>：一个企业把 Ollama 或 vLLM 部署在局域网的一台
 * GPU 机器上，是最常见的形态。叫「本地推理」会让人以为上下文不出这台机器，而
 * 那时它确实出了 —— 只是<strong>不经 Atlas、不出这个组织的网络</strong>。
 *
 * 这个区别不是措辞洁癖：数据边界的承诺要按事实说。回环地址与局域网地址是两种
 * 事实，界面要分别说（{@link isLoopback}）。
 *
 * ## 配置有两级来源，优先级是有理由的
 *
 *   部署侧（环境变量）   私有化部署的运维在部署时配好。**界面不可改** ——
 *                        运维选了哪台推理服务，用户不该绕过去。
 *   本机（配置文件）     没有部署侧配置时，用户自己填。
 *
 * 这与本仓已有的一条模式同源：预置连接器卸不掉、只能停用（ADR-018 §7.1）。
 * 「谁配的谁说了算」比「后写的赢」好懂，也更难出事。
 *
 * ## 开通与配置是两件事
 *
 * **开通**的权威在控制面（RY-100 §04 / A18：直连推理是企业版 / 私有化特性），
 * 运行时不自判；**配置**（地址、模型名）是本机事实。两者分开报，界面才能把
 * 「没开通」与「开通了但没配」说成两句话 —— 前者是商业状态，后者是一句
 * 「去填个地址」。
 *
 * ## 秘密
 *
 * `apiKey` 是**用户自己那台服务的口令**，不是 Vxture 的机密 —— 与用户填给连接器
 * 的数据库口令同类。「客户端零秘密」管的是后者。落盘时随主密钥封存，理由与平台
 * 会话一致：那是用户的东西，不该以明文躺在磁盘上。
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { KeyManager } from "./keys.js";
import type { LocalModelConfig } from "./local-model-gateway.js";

// ============================================================================
// Types
// ============================================================================

/** 配置是谁给的。界面据此决定给不给编辑入口。 */
export type ConfigSource = "deployment" | "local" | "none";

export interface PrivateModelView {
  /** 已配好的接入（没有则缺席）。**永远不含 `apiKey`** —— 它只出守护进程一次，就是写进去那一次。 */
  endpoint?: { baseUrl: string; model: string; hasKey: boolean; loopback: boolean };
  source: ConfigSource;
  /** 部署侧配了就不能在界面改。 */
  editable: boolean;
}

export interface PrivateModelInput {
  baseUrl: string;
  model: string;
  apiKey?: string | undefined;
  timeoutMs?: number | undefined;
}

const FILE = "private-model.bin";

// ============================================================================
// 判定
// ============================================================================

/**
 * 这个地址是不是回环。
 *
 * 决定界面说哪一句：回环 → 上下文**不出本机**；否则 → 不经 Atlas，但<strong>会
 * 离开这台机器</strong>，到你自己指定的那台服务上。两句都对，但只有一句对得上
 * 用户的实际部署 —— 说错的那一句是在替用户做一个他没做过的承诺。
 */
export function isLoopback(baseUrl: string): boolean {
  try {
    const h = new URL(baseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return h === "localhost" || h === "::1" || /^127\./.test(h);
  } catch {
    return false;
  }
}

/**
 * 配置合法吗。
 *
 * 地址与模型名**成对才算配了**：只给地址不给模型名，请求必然被提供方拒掉，而
 * 那种失败要到第一次跑任务时才看得见。入口就要成对。
 */
export function validate(input: Partial<PrivateModelInput>): string | null {
  const baseUrl = (input.baseUrl ?? "").trim();
  const model = (input.model ?? "").trim();
  if (!baseUrl) return "缺少服务地址";
  if (!model) return "缺少模型名";
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return "服务地址不是一个合法的地址";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "服务地址只支持 http 或 https";
  }
  if (input.timeoutMs !== undefined && !(Number.isFinite(input.timeoutMs) && input.timeoutMs > 0)) {
    return "超时时间要是一个正数";
  }
  return null;
}

// ============================================================================
// Store
// ============================================================================

export class PrivateModelStore {
  private readonly path: string;

  constructor(
    private readonly keys: KeyManager,
    dataDir: string,
    /** 部署侧给的那一份（环境变量）。给了就钉死，界面不可改。 */
    private readonly fromDeployment?: LocalModelConfig | undefined,
  ) {
    this.path = join(dataDir, "models", FILE);
  }

  /** 这一刻实际生效的接入；没有配就是 undefined。 */
  effective(): LocalModelConfig | undefined {
    if (this.fromDeployment) return this.fromDeployment;
    return this.readLocal();
  }

  /** 给界面看的投影。**不含口令**。 */
  view(): PrivateModelView {
    const cfg = this.effective();
    const source: ConfigSource = this.fromDeployment ? "deployment" : cfg ? "local" : "none";
    return {
      ...(cfg
        ? {
            endpoint: {
              baseUrl: cfg.baseUrl,
              model: cfg.model,
              hasKey: Boolean(cfg.apiKey),
              loopback: isLoopback(cfg.baseUrl),
            },
          }
        : {}),
      source,
      editable: !this.fromDeployment,
    };
  }

  /**
   * 写一份本机配置。
   *
   * @throws {Error} 部署侧已经配了 —— 这不是「后写的赢」，是运维配了就钉死。
   */
  save(input: PrivateModelInput): void {
    if (this.fromDeployment) {
      throw new Error("deployment-managed");
    }
    const value: LocalModelConfig = {
      baseUrl: input.baseUrl.trim(),
      model: input.model.trim(),
      ...(input.apiKey ? { apiKey: input.apiKey } : {}),
      ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
    };
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, this.keys.seal(Buffer.from(JSON.stringify(value), "utf8")));
  }

  /** 撤掉本机配置。部署侧那份撤不掉 —— 与「预置连接器卸不掉」同一条规矩。 */
  clear(): void {
    if (this.fromDeployment) throw new Error("deployment-managed");
    rmSync(this.path, { force: true });
  }

  private readLocal(): LocalModelConfig | undefined {
    if (!existsSync(this.path)) return undefined;
    try {
      const cfg = JSON.parse(
        this.keys.open(readFileSync(this.path)).toString("utf8"),
      ) as LocalModelConfig;
      /* 文件里可能是旧格式或被改坏的；校验不过就当没配，不让它带着半份配置去跑。 */
      return validate(cfg) === null ? cfg : undefined;
    } catch {
      /* 解不开（换过主密钥、被改过）就当没配。这里不删文件：用户可能刚换机器，
         下一次也许解得开；而一个解不开的文件不影响任何事。 */
      return undefined;
    }
  }
}
