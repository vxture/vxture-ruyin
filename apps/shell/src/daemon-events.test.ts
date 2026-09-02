import { strict as assert } from "node:assert";
import test from "node:test";
import { extractDaemonEvents } from "./daemon-events.js";

void test("extractDaemonEvents: a single complete frame in one chunk", () => {
  const { events, buffer } = extractDaemonEvents("", 'data: {"kind":"task"}\n\n');
  assert.deepEqual(events, [{ kind: "task" }]);
  assert.equal(buffer, "");
});

void test("extractDaemonEvents: the real server format (space after the colon)", () => {
  // server.ts writes `data: ${JSON.stringify(event)}\n\n` - the space is real.
  const { events } = extractDaemonEvents("", 'data: {"kind":"pending"}\n\n');
  assert.deepEqual(events, [{ kind: "pending" }]);
});

void test("extractDaemonEvents: a frame split across two chunks is held, not lost", () => {
  const first = extractDaemonEvents("", 'data: {"kind":"tas');
  assert.deepEqual(first.events, [], "不完整的帧还没到，不该产出事件");
  assert.equal(first.buffer, 'data: {"kind":"tas');

  const second = extractDaemonEvents(first.buffer, 'k"}\n\n');
  assert.deepEqual(second.events, [{ kind: "task" }]);
  assert.equal(second.buffer, "");
});

void test("extractDaemonEvents: the blank-line delimiter itself split across chunks", () => {
  const first = extractDaemonEvents("", 'data: {"kind":"task"}\n');
  assert.deepEqual(first.events, [], "只到了一个换行，帧还没收完");
  const second = extractDaemonEvents(first.buffer, "\n");
  assert.deepEqual(second.events, [{ kind: "task" }]);
});

void test("extractDaemonEvents: heartbeat and the initial ': ok' comment yield no events", () => {
  const beat = extractDaemonEvents("", ": beat\n\n");
  assert.deepEqual(beat.events, []);
  assert.equal(beat.buffer, "");

  const ok = extractDaemonEvents("", ": ok\n\n");
  assert.deepEqual(ok.events, []);
});

void test("extractDaemonEvents: multiple frames in one chunk, in order", () => {
  const { events, buffer } = extractDaemonEvents(
    "",
    'data: {"kind":"task"}\n\ndata: {"kind":"pending"}\n\ndata: {"kind":"update-intent"}\n\n',
  );
  assert.deepEqual(events, [{ kind: "task" }, { kind: "pending" }, { kind: "update-intent" }]);
  assert.equal(buffer, "");
});

void test("extractDaemonEvents: a malformed data: line is dropped, not thrown, and does not take the next frame with it", () => {
  const { events } = extractDaemonEvents(
    "",
    'data: {not valid json\n\ndata: {"kind":"task"}\n\n',
  );
  assert.deepEqual(events, [{ kind: "task" }], "坏帧应该被丢掉，后面那条好帧必须还在");
});

void test("extractDaemonEvents: a frame with no data: line (a bare comment) contributes nothing", () => {
  const { events } = extractDaemonEvents("", ": some comment line\n\n");
  assert.deepEqual(events, []);
});
