import { expect, test } from "vitest";
import { extractSseEvents } from "./sse";
import type { RuntimeEvent } from "./api";

void test("extractSseEvents: a single complete frame in one chunk", () => {
  const { events, buffer } = extractSseEvents<RuntimeEvent>(
    "",
    'data: {"kind":"pending"}\n\n',
  );
  expect(events).toEqual([{ kind: "pending" }]);
  expect(buffer).toBe("");
});

void test("extractSseEvents: a task event carries its business fields through", () => {
  const { events } = extractSseEvents<RuntimeEvent>(
    "",
    'data: {"kind":"task","projectId":"prj_1","taskInstance":"ti_1"}\n\n',
  );
  expect(events).toEqual([{ kind: "task", projectId: "prj_1", taskInstance: "ti_1" }]);
});

void test("extractSseEvents: a frame split across two chunks is held, not lost", () => {
  const first = extractSseEvents<RuntimeEvent>("", 'data: {"kind":"pen');
  expect(first.events).toEqual([]);
  const second = extractSseEvents<RuntimeEvent>(first.buffer, 'ding"}\n\n');
  expect(second.events).toEqual([{ kind: "pending" }]);
});

void test("extractSseEvents: the blank-line delimiter itself split across chunks", () => {
  const first = extractSseEvents<RuntimeEvent>("", 'data: {"kind":"pending"}\n');
  expect(first.events).toEqual([]);
  const second = extractSseEvents<RuntimeEvent>(first.buffer, "\n");
  expect(second.events).toEqual([{ kind: "pending" }]);
});

void test("extractSseEvents: heartbeats yield no events", () => {
  const { events, buffer } = extractSseEvents<RuntimeEvent>("", ": beat\n\n");
  expect(events).toEqual([]);
  expect(buffer).toBe("");
});

void test("extractSseEvents: multiple frames in one chunk, in order", () => {
  const { events } = extractSseEvents<RuntimeEvent>(
    "",
    'data: {"kind":"pending"}\n\ndata: {"kind":"update-intent"}\n\n',
  );
  expect(events).toEqual([{ kind: "pending" }, { kind: "update-intent" }]);
});

void test("extractSseEvents: a malformed data: line is dropped, the frame after it is not", () => {
  const { events } = extractSseEvents<RuntimeEvent>(
    "",
    'data: {not valid json\n\ndata: {"kind":"pending"}\n\n',
  );
  expect(events).toEqual([{ kind: "pending" }]);
});
