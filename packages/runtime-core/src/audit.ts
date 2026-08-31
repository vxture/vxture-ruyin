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
  ClockPort,
  CryptoPort,
  IdPort,
  ProjectStore,
} from "./ports.js";

export interface AuditInput {
  workspace: string;
  task_instance?: string;
  kind: string;
  actor: AuditEvent["actor"];
  payload: unknown;
}

export function genesisHash(crypto: CryptoPort, projectId: string): string {
  return crypto.sha256(`genesis:${projectId}`);
}

function seal(
  crypto: CryptoPort,
  prevHash: string,
  body: Omit<AuditEvent, "hash" | "prev_hash">,
): AuditEvent {
  const withPrev = { ...body, prev_hash: prevHash };
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
    event_id: id.newId("ev"),
    workspace: input.workspace,
    task_instance: input.task_instance,
    kind: input.kind,
    actor: input.actor,
    timestamp: clock.now(),
    payload: input.payload,
  });
  await store.appendAuditEvent(event);
  return event;
}

/** Walk the chain from genesis; false on any break or content tamper. */
export function verifyAuditChain(
  crypto: CryptoPort,
  projectId: string,
  events: AuditEvent[],
): boolean {
  let prev = genesisHash(crypto, projectId);
  for (const event of events) {
    if (event.prev_hash !== prev) return false;
    const { hash, ...body } = event;
    if (crypto.sha256(JSON.stringify(body)) !== hash) return false;
    prev = hash;
  }
  return true;
}
