import { strict as assert } from "node:assert";
import test from "node:test";
import { diffPending, type PendingRow } from "./pending-notify.js";

function rows(...ids: string[]): PendingRow[] {
  return ids.map((checkpointId) => ({ checkpointId }));
}

void test("diffPending: the first poll seeds silently - a startup backlog is not news", () => {
  const result = diffPending(undefined, rows("a", "b"));
  assert.deepEqual(result.toNotify, []);
  assert.deepEqual([...result.announced].sort(), ["a", "b"]);
});

void test("diffPending: an empty first poll seeds an empty set, not undefined", () => {
  const result = diffPending(undefined, []);
  assert.deepEqual(result.toNotify, []);
  assert.deepEqual([...result.announced], []);
});

void test("diffPending: nothing new -> nothing to notify, the set is unchanged", () => {
  const first = diffPending(undefined, rows("a", "b"));
  const second = diffPending(first.announced, rows("a", "b"));
  assert.deepEqual(second.toNotify, []);
  assert.deepEqual([...second.announced].sort(), ["a", "b"]);
});

void test("diffPending: a genuinely new row is the one that gets notified", () => {
  const first = diffPending(undefined, rows("a"));
  const second = diffPending(first.announced, rows("a", "b"));
  assert.deepEqual(second.toNotify, rows("b"));
  assert.deepEqual([...second.announced].sort(), ["a", "b"]);
});

void test("diffPending: a row that is no longer pending is forgotten, not left to grow the set forever", () => {
  const first = diffPending(undefined, rows("a", "b"));
  const second = diffPending(first.announced, rows("a"));
  assert.deepEqual(second.toNotify, []);
  assert.deepEqual([...second.announced], ["a"]);
});

void test("diffPending: one gone and one new in the same poll - only the new one notifies", () => {
  const first = diffPending(undefined, rows("a", "b"));
  const second = diffPending(first.announced, rows("a", "c"));
  assert.deepEqual(second.toNotify, rows("c"));
  assert.deepEqual([...second.announced].sort(), ["a", "c"]);
});

void test("diffPending: an id that reappears after being forgotten notifies again", () => {
  const first = diffPending(undefined, rows("a"));
  const gone = diffPending(first.announced, []); // "a" 不再等待，被忘掉
  assert.deepEqual([...gone.announced], []);
  const back = diffPending(gone.announced, rows("a")); // 同一个 id 又来了
  assert.deepEqual(back.toNotify, rows("a"), "重新出现的检查点应该再通知一次");
});
