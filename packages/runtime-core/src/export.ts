/**
 * 项目导出（TD-020）。
 *
 * ## 导什么
 *
 * **被锁在存储里的那部分**：meta、契约、业务状态、任务实例、审计链。产出文档由
 * `writeArtifact` 写进用户自己授权的目录，本来就在他手里——再复制一份只是让同一
 * 份东西存在两处。§18.5 承诺可导出的，正是这些否则够不到的记录。
 *
 * ## 为什么用 in-toto Statement 而不是自造清单
 *
 * 审计链**本来就是一份 provenance 声明**：哪些能力跑过、什么资料出过域、谁批准了
 * 哪一步。in-toto 的结构正好对上——`subject` 按摘要绑定产物，`predicate` 说这些
 * 产物是怎么来的。**换个信封，别人的工具就能读它**；而一个只有我们的脚本能验的
 * 证明，对收件人的说服力等于零。
 *
 * 外层是 DSSE 信封。**`signatures` 现在是空数组，这是一个合法状态，不是占位**：
 * 客户端零密钥，签不了。所以当前的导出**可验篡改，不可归属**。等签名身份就位，
 * 同一个信封加签即可归属，格式不用重做。
 *
 * ## 一个必须说出口的取舍
 *
 * 审计链里含本机文件路径（传输门记的 `ref`）。**想脱敏就得改事件，而改事件会作废
 * 整条链**——防篡改与可脱敏在这里是直接冲突的。这一版选防篡改，并在信封里**明写
 * 这份导出含本机路径**，让人在转手之前知道。
 */

import { genesisHash } from "./audit.js";
import type { CryptoPort, ProjectStore, StoredAuditEvent } from "./ports.js";

/** in-toto Statement（v1）。字段名照抄规范，不改拼写。 */
export interface InTotoStatement {
  _type: "https://in-toto.io/Statement/v1";
  subject: Array<{ name: string; digest: { sha256: string } }>;
  predicateType: string;
  predicate: RuyinExportPredicate;
}

/**
 * 我们的 predicate。**字段按「能被重新表达成 C2PA 断言」来设计**——C2PA 的词表
 * 明确覆盖「是否借助 AI 生成、如何生成」，而那正是一份模型辅助产出的交付物该随身
 * 带的事实。写成只有我们看得懂的形状，以后就搬不过去。
 */
export interface RuyinExportPredicate {
  project: { id: string; name: string; workspaceId?: string };
  product: { id: string; version: string; contractVersion: string };
  businessState: string;
  /** 审计链：创世锚 + 链头 + 条数。凭这三样即可独立走一遍。 */
  auditChain: { genesis: string; head: string; events: number };
  /** 这份导出是怎么产生的。 */
  producedBy: { runtime: string; exportedAt: string };
  /**
   * 明写在信封里的披露项。**不是免责声明，是让人在转手之前看得见**：
   * 审计链含本机文件路径，而脱敏会作废整条链。
   */
  disclosure: { containsLocalPaths: true; redactionBreaksChain: true };
}

/** DSSE 信封（secure-systems-lab/dsse）。 */
export interface DsseEnvelope {
  payload: string;
  payloadType: "application/vnd.in-toto+json";
  /** 空数组 = 尚未签名。客户端零密钥，签名待平台侧副署能力就位。 */
  signatures: Array<{ keyid: string; sig: string }>;
}

export interface ProjectExport {
  /** 相对路径 → 文件内容。调用方负责落盘。 */
  files: Record<string, string>;
  envelope: DsseEnvelope;
  statement: InTotoStatement;
}

const PREDICATE_TYPE = "https://vxture.com/ruyin/project-export/v1";

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * 组装一份导出。纯函数式：读存储、算摘要、返回内容，**不碰文件系统**——落盘是
 * 宿主的事（内核不许引 Node API）。
 */
export async function buildProjectExport(
  store: ProjectStore,
  crypto: CryptoPort,
  projectId: string,
  opts: { runtimeVersion: string; exportedAt: string },
): Promise<ProjectExport> {
  const meta = await store.getMeta();
  if (!meta) throw new Error(`project "${projectId}" has no meta`);
  const contract = (await store.getContract()) ?? "{}";
  const businessState = (await store.getBusinessState()) ?? "";
  const tasks = await store.listTaskInstances();
  const events: StoredAuditEvent[] = await store.listAuditEvents();

  // 记录原样导出。**审计事件绝不重新序列化成别的形状**：哈希是按存进去时的字段名
  // 算的，换个写法就验不过了。
  const files: Record<string, string> = {
    "project.json": JSON.stringify(meta, null, 2),
    "contract.json": contract,
    "state.json": JSON.stringify({ businessState }, null, 2),
    "tasks.json": `[\n${tasks.join(",\n")}\n]`,
    "audit.json": JSON.stringify(events, null, 2),
  };

  const subject = Object.entries(files)
    .map(([name, content]) => ({
      name,
      digest: { sha256: crypto.sha256(utf8(content)) },
    }))
    // 稳定顺序：同样的输入必须得到逐字节相同的信封，否则没法比对两次导出。
    .sort((a, b) => a.name.localeCompare(b.name));

  const last = events[events.length - 1];
  const statement: InTotoStatement = {
    _type: "https://in-toto.io/Statement/v1",
    subject,
    predicateType: PREDICATE_TYPE,
    predicate: {
      project: {
        id: meta.id,
        name: meta.name,
        ...(meta.workspaceId ? { workspaceId: meta.workspaceId } : {}),
      },
      product: {
        id: meta.productId,
        version: meta.productVersion,
        contractVersion: meta.contractVersion,
      },
      businessState,
      auditChain: {
        genesis: genesisHash(crypto, projectId),
        head: last?.hash ?? genesisHash(crypto, projectId),
        events: events.length,
      },
      producedBy: {
        runtime: opts.runtimeVersion,
        exportedAt: opts.exportedAt,
      },
      disclosure: { containsLocalPaths: true, redactionBreaksChain: true },
    },
  };

  const payloadJson = JSON.stringify(statement, null, 2);
  return {
    files: { ...files, "statement.json": payloadJson },
    statement,
    envelope: {
      payload: crypto.base64(utf8(payloadJson)),
      payloadType: "application/vnd.in-toto+json",
      // 空 = 尚未签名。**不放假签名，也不省掉这个字段**：格式里有这个槽位，
      // 空着才说得清「还没签」，省掉则连「该签」这件事都看不见了。
      signatures: [],
    },
  };
}

