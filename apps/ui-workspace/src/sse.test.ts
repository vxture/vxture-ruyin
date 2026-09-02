/**
 * extractSseEvents (sse.ts): buffering, blank-line framing, dropping a
 * malformed frame without losing the stream. Same logic as
 * apps/shell/src/daemon-events.ts's extractDaemonEvents (see this file's
 * own header comment - three copies of one event vocabulary exist by
 * design), so these cases are ported from that file's already-validated
 * test suite rather than reinvented.
 */

import { expect, test } from "vitest";
import { extractSseEvents } from "./sse";
import type { RuntimeEvent } from "./api";

void test("extractSseEvents: a single complete frame in one chunk", () => {
  const { events, buffer } = extractSseEvents("", 'data: {"kind":"task"}\n\n');
  expect(events).toEqual([{ kind: "task" }]);
  expect(buffer).toBe("");
});

void test("extractSseEvents: the real server format (space after the colon)", () => {
  // server.ts writes `data: ${JSON.stringify(event)}\n\n` - the space is real.
  const { events } = extractSseEvents("", 'data: {"kind":"pending"}\n\n');
  expect(events).toEqual([{ kind: "pending" }]);
});

void test("extractSseEvents: a real RuntimeEvent (business fields, not just kind) round-trips through the generic", () => {
  const { events } = extractSseEvents<RuntimeEvent>(
    "",
    'data: {"kind":"task","projectId":"prj_1","taskInstance":"ti_1"}\n\n',
  );
  expect(events).toEqual([{ kind: "task", projectId: "prj_1", taskInstance: "ti_1" }]);
});

void test("extractSseEvents: a frame split across two chunks is held, not lost", () => {
  const first = extractSseEvents("", 'data: {"kind":"tas');
  expect(first.events).toEqual([]);
  expect(first.buffer).toBe('data: {"kind":"tas');

  const second = extractSseEvents(first.buffer, 'k"}\n\n');
  expect(second.events).toEqual([{ kind: "task" }]);
  expect(second.buffer).toBe("");
});

void test("extractSseEvents: the blank-line delimiter itself split across chunks", () => {
  const first = extractSseEvents("", 'data: {"kind":"task"}\n');
  expect(first.events).toEqual([]);
  const second = extractSseEvents(first.buffer, "\n");
  expect(second.events).toEqual([{ kind: "task" }]);
});

void test("extractSseEvents: heartbeat and the initial comment yield no events", () => {
  const beat = extractSseEvents("", ": beat\n\n");
  expect(beat.events).toEqual([]);
  expect(beat.buffer).toBe("");

  const ok = extractSseEvents("", ": ok\n\n");
  expect(ok.events).toEqual([]);
});

void test("extractSseEvents: multiple frames in one chunk, in order", () => {
  const { events, buffer } = extractSseEvents(
    "",
    'data: {"kind":"task"}\n\ndata: {"kind":"pending"}\n\n',
  );
  expect(events).toEqual([{ kind: "task" }, { kind: "pending" }]);
  expect(buffer).toBe("");
});

void test("extractSseEvents: a malformed data: line is dropped, not thrown, and does not take the next frame with it", () => {
  const { events } = extractSseEvents(
    "",
    'data: {not valid json\n\ndata: {"kind":"task"}\n\n',
  );
  expect(events).toEqual([{ kind: "task" }]);
});

void test("extractSseEvents: a frame with no data: line (a bare comment) contributes nothing", () => {
  const { events } = extractSseEvents("", ": some comment line\n\n");
  expect(events).toEqual([]);
});

void test("extractSseEvents: a frame with multiple data: lines parses each independently", () => {
  const { events } = extractSseEvents(
    "",
    'data: {"kind":"task"}\ndata: {"kind":"pending"}\n\n',
  );
  expect(events).toEqual([{ kind: "task" }, { kind: "pending" }]);
});
