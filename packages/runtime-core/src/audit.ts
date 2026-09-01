/**
 * Hash-chained audit events. Design authority:
 * docs/30-design/50-harness.md section 9.
 *
 * Chain: each event's hash = sha256(JSON of the event body including
 * prev_hash); the genesis prev_hash is anchored to the workspace id. The
 * event body is stringified once at seal time; verification re-stringifies
 * the parsed body, which preserves key order (JSON.parse -> stringify is
 * order-stable), so the chain survives storage round-trips.
 */

import type {
  AuditEvent,
  AuditOutcome,
  ClockPort,
  CryptoPort,
  IdPort,
  LegacyAuditEvent,
  ProjectStore,
  StoredAuditEvent,
} from "./ports.js";

export interface AuditInput {
  workspace: string;
  task_instance?: string;
  /** X-3 的 action —— 既有的 kind 就是它，语义相符，无需第二个字段。 */
  kind: string;
  actor: AuditEvent["actor"];
  /**
   * 具体是谁。人做的传会话 sub；运行时自己做的传下面的常量。
   * **不给缺省**：默认一个身份，就是替某个人签了名。
   */
  actorId: string;
  /**
   * 结果。**必填，不给缺省**（X-3：必须区分成功与被拒）——默认 success 会让
   * 每一条没人想过的记录都自称成功，而那正是审计要防的事。
   */
  outcome: AuditOutcome;
  payload: unknown;
}

/** 运行时自己发起的写。人做的用会话里的 sub。 */
export const RUNTIME_ACTOR = "ruyin:runtime";

/**
 * 结果**不是必然**的那些事件 —— 调用点必须说明，否则抛错。
 *
 * 其余事件是「这件事发生了」的记录，发出它的那一行就在事情刚做完之处，
 * 结果只能是成功。而这几个可能是成功也可能是被拒：把它们默认成 success，
 * 审计就会把每一次拒绝都记成通过 —— 那正是审计存在要防的事。
 *
 * **列表本身就是护栏**：以后新增一个结果不定的事件却忘了说明，会当场抛错，
 * 而不是安静地留下一条自称成功的记录。
 */
export const OUTCOME_MUST_BE_STATED = new Set([
  "checkpoint.decided",
  "tool.decision",
  "tool.executed",
  "verification.result",
  "task.failed",
  "capability.retry",
]);

/**
 * objectType 由 action 的前缀派生，不单独声明。
 *
 * 派生而非声明是有意的：两者**不可能漂移**。声明一遍，下一个加事件的人就得
 * 记得填第二个字段，而忘了填的那次不会有任何东西提醒他。
 */
function objectTypeOf(action: string): string {
  const dot = action.indexOf(".");
  return dot > 0 ? action.slice(0, dot) : action;
}

export function genesisHash(crypto: CryptoPort, projectId: string): string {
  return crypto.sha256(`genesis:${projectId}`);
}

function seal(
  crypto: CryptoPort,
  prevHash: string,
  body: Omit<AuditEvent, "hash" | "prevHash">,
): AuditEvent {
  const withPrev = { ...body, prevHash };
  const hash = crypto.sha256(JSON.stringify(withPrev));
  return { ...withPrev, hash };
}

export async function emitAudit(
  store: ProjectStore,
  crypto: CryptoPort,
  clock: ClockPort,
  id: IdPort,
  input: AuditInput,
): Promise<AuditEvent> {
  const prev =
    (await store.lastAuditHash()) ?? genesisHash(crypto, input.workspace);
  const event = seal(crypto, prev, {
    eventId: id.newId("ev"),
    occurredAt: clock.now(),
    actorId: input.actorId,
    // Ruyin 是桌面运行时，不属于任何控制台。通则：MUST NOT 硬编一个。
    actorConsole: null,
    actor: input.actor,
    objectType: objectTypeOf(input.kind),
    // 最具体的那个 id：任务相关事件指任务实例，其余指项目容器。
    objectId: input.task_instance ?? input.workspace,
    action: input.kind,
    outcome: input.outcome,
    workspace: input.workspace,
    ...(input.task_instance ? { taskId: input.task_instance } : {}),
    payload: input.payload,
  });
  await store.appendAuditEvent(event);
  return event;
}

/** X-3 之前写下的记录（按字段名判，不按内容猜）。 */
export function isLegacyAuditEvent(
  event: StoredAuditEvent,
): event is LegacyAuditEvent {
  return "event_id" in event;
}

/**
 * 从创世走一遍链；任何断裂或内容改动都返回 false。
 *
 * **按存储里的原样校验**：哈希是按存进去时的字段名算的，所以新旧两种形状各按
 * 自己的样子重新序列化即可 —— 链靠 prev 哈希串相连，与命名无关。
 * **绝不能为了统一词表回写既有记录**：那会作废每一条链。
 */
export function verifyAuditChain(
  crypto: CryptoPort,
  projectId: string,
  events: StoredAuditEvent[],
): boolean {
  let prev = genesisHash(crypto, projectId);
  for (const event of events) {
    const linked = isLegacyAuditEvent(event) ? event.prev_hash : event.prevHash;
    if (linked !== prev) return false;
    const { hash, ...body } = event;
    if (crypto.sha256(JSON.stringify(body)) !== hash) return false;
    prev = hash;
  }
  return true;
}

/**
 * 把存储里的任一形状投影成 X-3 词表，好让消费方只面对一套字段名。
 *
 * 旧记录的 `outcome` 是 `unknown` —— **无从回填，也绝不猜**：把一条不知道结果
 * 的记录标成 success，正是审计存在的意义所要防的那种事。
 */
export function toAuditView(event: StoredAuditEvent): AuditEvent {
  if (!isLegacyAuditEvent(event)) return event;
  return {
    eventId: event.event_id,
    occurredAt: event.timestamp,
    // 旧记录只有角色，没有身份。用角色名填身份会凭空造出一个「谁」。
    actorId: `legacy:${event.actor}`,
    actorConsole: null,
    actor: event.actor,
    objectType: objectTypeOf(event.kind),
    objectId: event.task_instance ?? event.workspace,
    action: event.kind,
    outcome: "unknown",
    workspace: event.workspace,
    ...(event.task_instance ? { taskId: event.task_instance } : {}),
    prevHash: event.prev_hash,
    hash: event.hash,
    payload: event.payload,
  };
}
