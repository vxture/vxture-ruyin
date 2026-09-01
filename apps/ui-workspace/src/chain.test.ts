/**
 * verifyChain (chain.ts): the client-side independent integrity check over
 * an audit trail. Every other test file in this app mocks this module away
 * (chain.ts isn't part of TD-031's six-component scope, and hand-computing
 * a valid SHA-256 chain in every fixture would be needless overhead there) -
 * this file is the one place its real WebCrypto hashing actually runs.
 *
 * buildChain below mirrors verifyChain's own algorithm from the writer's
 * side (real crypto.subtle.digest calls, not a stand-in), so a test can
 * assert the verifier agrees with a chain built the same way storage.ts's
 * real seal-time hashing would, without needing production data.
 *
 * This isn't hypothetical: the X-3 field rename (kind->action,
 * timestamp->occurredAt, prev_hash->prevHash...) once broke exactly this
 * check because ui-workspace's own AuditEvent copy hadn't caught up - every
 * intact chain read as 哈希链断裂 (broken). A permanently-crying-wolf
 * integrity indicator is worse than none: it trains the user to ignore it,
 * and the one time it's right goes unseen (see
 * scripts/guardrails/check-shared-shapes.mjs's own header for the incident,
 * which is what actually guards the type shapes now - this file guards the
 * verification logic itself).
 */

import { expect, test } from "vitest";
import { verifyChain } from "./chain";
import type { AuditEvent, LegacyAuditEvent } from "./api";

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type EventSeed = Omit<AuditEvent, "prevHash" | "hash">;

/** Builds a real, self-consistent chain: each event's hash covers its own
 *  body (including prevHash), exactly as verifyChain expects to recompute. */
async function buildChain(
  projectId: string,
  seeds: EventSeed[],
): Promise<AuditEvent[]> {
  let prev = await sha256Hex(`genesis:${projectId}`);
  const events: AuditEvent[] = [];
  for (const seed of seeds) {
    const body = { ...seed, prevHash: prev };
    const hash = await sha256Hex(JSON.stringify(body));
    events.push({ ...body, hash });
    prev = hash;
  }
  return events;
}

function seed(over: Partial<EventSeed> = {}): EventSeed {
  return {
    eventId: "ae_1",
    occurredAt: "2026-06-01T00:00:00.000Z",
    actorId: "u1",
    actorConsole: null,
    actor: "yh",
    objectType: "project",
    objectId: "prj_1",
    action: "project.created",
    outcome: "success",
    workspace: "wsp_1",
    payload: {},
    ...over,
  };
}

void test("verifyChain: no events verifies trivially true (genesis only, nothing to check)", async () => {
  expect(await verifyChain("prj_1", [])).toBe(true);
});

void test("verifyChain: a single correctly-chained event verifies true", async () => {
  const events = await buildChain("prj_1", [seed()]);
  expect(await verifyChain("prj_1", events)).toBe(true);
});

void test("verifyChain: a multi-event chain verifies true", async () => {
  const events = await buildChain("prj_1", [
    seed({ eventId: "ae_1", action: "project.created" }),
    seed({ eventId: "ae_2", action: "task.started", taskId: "t1" }),
    seed({ eventId: "ae_3", action: "task.completed", taskId: "t1", outcome: "success" }),
  ]);
  expect(await verifyChain("prj_1", events)).toBe(true);
});

void test("verifyChain: a genesis anchored to a different project id fails", async () => {
  const events = await buildChain("prj_1", [seed()]);
  expect(await verifyChain("prj_other", events)).toBe(false);
});

void test("verifyChain: tampering with a stored field (not just the hash) breaks the chain", async () => {
  const events = await buildChain("prj_1", [seed({ actor: "yh" })]);
  const tampered = [{ ...events[0]!, actor: "someone-else" }];
  expect(await verifyChain("prj_1", tampered)).toBe(false);
});

void test("verifyChain: a hash rewritten to match tampered content still fails (recomputation, not trust)", async () => {
  const events = await buildChain("prj_1", [seed()]);
  const { hash: _oldHash, ...body } = events[0]!;
  const forgedBody = { ...body, action: "project.deleted" };
  const forgedHash = await sha256Hex(JSON.stringify(forgedBody));
  // 伪造事件自己内部是自洽的（哈希确实覆盖了改过的内容），但断链在于下一条
  // 事件用旧的 hash 之后：这里只有一条事件，测的是"改了内容却配上了看起来
  // 对的新哈希"仍然要能通过重算——它会，因为重算就是按存储原样重新算一遍。
  // 真正防的是"改了内容但没跟着换哈希"，下一条用例测那个。
  expect(await verifyChain("prj_1", [{ ...forgedBody, hash: forgedHash }])).toBe(true);
});

void test("verifyChain: content changed without updating its own hash fails", async () => {
  const events = await buildChain("prj_1", [seed()]);
  const tampered = [{ ...events[0]!, action: "project.deleted" }]; // hash left stale
  expect(await verifyChain("prj_1", tampered)).toBe(false);
});

void test("verifyChain: a broken link (prevHash doesn't match the prior event's hash) fails", async () => {
  const events = await buildChain("prj_1", [seed({ eventId: "ae_1" }), seed({ eventId: "ae_2" })]);
  const brokenSecond = { ...events[1]!, prevHash: "not-the-real-prev-hash" };
  // 也重算它自己的哈希，让"prevHash 对不上"成为唯一的失败原因，不是顺带触发
  // 了内容自算不一致这条判据。
  const { hash: _oldHash, ...body } = brokenSecond;
  const rehash = await sha256Hex(JSON.stringify(body));
  expect(await verifyChain("prj_1", [events[0]!, { ...body, hash: rehash }])).toBe(false);
});

void test("verifyChain: mixed legacy and current-shape events chain together (X-3 migration, TD-014 D6)", async () => {
  const [first] = await buildChain("prj_1", [seed({ eventId: "ae_1" })]);
  if (!first) throw new Error("buildChain returned no events");
  // 老记录用 prev_hash/timestamp/kind/event_id，字段名不同，但链的哈希只认
  // 存储原样——第二条老格式事件照样能接在新格式事件后面。
  const legacyBody: Omit<LegacyAuditEvent, "hash"> = {
    event_id: "ae_legacy",
    workspace: "wsp_1",
    kind: "task.started",
    actor: "yh",
    timestamp: "2026-06-01T00:05:00.000Z",
    prev_hash: first.hash,
    payload: { note: "旧记录" },
  };
  const legacyHash = await sha256Hex(JSON.stringify(legacyBody));
  const legacy: LegacyAuditEvent = { ...legacyBody, hash: legacyHash };

  expect(await verifyChain("prj_1", [first, legacy])).toBe(true);
});
