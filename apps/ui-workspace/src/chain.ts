/**
 * Client-side audit-chain verification (WebCrypto SHA-256). Mirrors
 * runtime-core/src/audit.ts: genesis anchored to the workspace id; each
 * event's hash covers its body including prev_hash. JSON.parse ->
 * JSON.stringify preserves key order, so the recomputation matches the
 * seal-time serialization. Gives the user an independent integrity check
 * right in the UI.
 */

import { isLegacyAuditEvent, type StoredAuditEvent } from "./api";

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyChain(
  projectId: string,
  events: StoredAuditEvent[],
): Promise<boolean> {
  let prev = await sha256Hex(`genesis:${projectId}`);
  for (const event of events) {
    // X-3 之前是 prev_hash，之后是 prevHash。**两种都要认**：链里可以同时躺着
    // 两种形状的记录，只认一种等于对另一种谎报断裂。
    const linked = isLegacyAuditEvent(event) ? event.prev_hash : event.prevHash;
    if (linked !== prev) return false;
    const { hash, ...body } = event;
    if ((await sha256Hex(JSON.stringify(body))) !== hash) return false;
    prev = hash;
  }
  return true;
}
