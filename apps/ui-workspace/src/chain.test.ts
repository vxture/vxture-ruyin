/**
 * verifyChain (chain.ts): the UI's own independent recomputation of the
 * audit hash chain (WebCrypto SHA-256, matches runtime-core/src/audit.ts).
 * Fixtures below build genuinely valid chains by hashing exactly the way
 * chain.ts does - not hand-picked strings - so a tamper test is actually
 * proving something: the same construction, minus one deliberate change.
 * Uses the same WebCrypto `crypto.subtle` chain.ts itself calls (not
 * node:crypto) - one API, and it is what jsdom's global `crypto` actually
 * provides here.
 *
 * A permanently-crying-wolf integrity indicator is worse than none (it
 * trains the user to ignore it, and the one time it's right goes unseen) -
 * this file exists because the X-3 field rename already broke this exact
 * check once (see check-shared-shapes.mjs's own comment for the incident).
 */

import { expect, test } from "vitest";
import { verifyChain } from "./chain";
import type { AuditEvent, LegacyAuditEvent } from "./api";

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function genesis(projectId: string): Promise<string> {
  return sha256Hex(`genesis:${projectId}`);
}

/** One valid current-shape (X-3) event, linked to whatever hash comes before it. */
async function modernEvent(prevHash: string, i: number, projectId: string): Promise<AuditEvent> {
  const body = {
    eventId: `evt_${i}`,
    occurredAt: `2026-09-01T00:00:0${i}Z`,
    actorId: "user-1",
    actorConsole: null,
    actor: "user",
    objectType: "project",
    objectId: projectId,
    action: "project.created",
    outcome: "success" as const,
    workspace: projectId,
    prevHash,
    payload: { i },
  };
  return { ...body, hash: await sha256Hex(JSON.stringify(body)) };
}

/** One valid pre-X-3 (legacy) event, same linkage, snake_case field names. */
async function legacyEvent(
  prevHash: string,
  i: number,
  projectId: string,
): Promise<LegacyAuditEvent> {
  const body = {
    event_id: `evt_${i}`,
    workspace: projectId,
    kind: "project.created",
    actor: "user",
    timestamp: `2026-08-01T00:00:0${i}Z`,
    prev_hash: prevHash,
    payload: { i },
  };
  return { ...body, hash: await sha256Hex(JSON.stringify(body)) };
}

void test("verifyChain: a genuinely valid chain of modern-shape events verifies", async () => {
  const projectId = "prj_1";
  let prev = await genesis(projectId);
  const events: AuditEvent[] = [];
  for (let i = 0; i < 4; i++) {
    const e = await modernEvent(prev, i, projectId);
    events.push(e);
    prev = e.hash;
  }
  expect(await verifyChain(projectId, events)).toBe(true);
});

void test("verifyChain: an empty chain verifies vacuously", async () => {
  expect(await verifyChain("prj_empty", [])).toBe(true);
});

void test("verifyChain: a tampered payload is caught (the recomputed hash no longer matches)", async () => {
  const projectId = "prj_2";
  const e0 = await modernEvent(await genesis(projectId), 0, projectId);
  const tampered: AuditEvent = { ...e0, payload: { i: 999 } }; // hash 字段没跟着改
  expect(await verifyChain(projectId, [tampered])).toBe(false);
});

void test("verifyChain: a broken prevHash link is caught even if each event's own hash is internally consistent", async () => {
  const projectId = "prj_3";
  const e0 = await modernEvent(await genesis(projectId), 0, projectId);
  const e1 = await modernEvent("not-the-real-previous-hash", 1, projectId); // 自洽但链不上
  expect(await verifyChain(projectId, [e0, e1])).toBe(false);
});

void test("verifyChain: recognizes both field shapes, and a chain that switches shape mid-way still links", async () => {
  const projectId = "prj_4";
  // 前两条是改名之前的老记录，后两条是改名之后的 —— 值是链上真实会出现的样子。
  let prev = await genesis(projectId);
  const e0 = await legacyEvent(prev, 0, projectId);
  prev = e0.hash;
  const e1 = await legacyEvent(prev, 1, projectId);
  prev = e1.hash;
  const e2 = await modernEvent(prev, 2, projectId);
  prev = e2.hash;
  const e3 = await modernEvent(prev, 3, projectId);
  expect(await verifyChain(projectId, [e0, e1, e2, e3])).toBe(true);
});

void test("verifyChain: a purely legacy chain verifies on its own field names", async () => {
  const projectId = "prj_5";
  let prev = await genesis(projectId);
  const events: LegacyAuditEvent[] = [];
  for (let i = 0; i < 3; i++) {
    const e = await legacyEvent(prev, i, projectId);
    events.push(e);
    prev = e.hash;
  }
  expect(await verifyChain(projectId, events)).toBe(true);
});

void test("verifyChain: the wrong genesis (project id) breaks the very first link", async () => {
  const e0 = await modernEvent(await genesis("prj_a"), 0, "prj_a");
  // 跨项目的链不该验得过：genesis 按 projectId 派生，e0 挂在 prj_a 的创世锚上。
  expect(await verifyChain("prj_b", [e0])).toBe(false);
});
