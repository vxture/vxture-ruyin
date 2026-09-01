/**
 * shellPdfRenderer (pdf.ts): the daemon-side half of the PDF render channel
 * to the shell (ADR-017). Had zero coverage - and the file's own comment
 * names the exact failure mode an untested reply-decoding path invites:
 * "收不了就明说 —— 悄悄产出一份长度为 0 的「PDF」" (fail to decode silently
 * and you hand the user a zero-byte "PDF" instead of an error). These tests
 * drive the id-correlated request/reply protocol, both cloned-bytes shapes,
 * the two reply-wrapping conventions, and the render timeout, without a real
 * utilityProcess: a fake parentPort stands in.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { shellPdfRenderer } from "./pdf.js";

interface FakePort {
  port: {
    postMessage(message: unknown): void;
    on(event: "message", listener: (event: unknown) => void): void;
    start(): void;
  };
  sent: unknown[];
  /** Simulates the real contract: the listener receives `{ data: payload }`. */
  send(data: unknown): void;
  /** Simulates the fallback contract: the listener receives the payload bare. */
  sendRaw(data: unknown): void;
}

function fakePort(): FakePort {
  let handler: ((event: unknown) => void) | undefined;
  const sent: unknown[] = [];
  return {
    port: {
      postMessage: (message) => sent.push(message),
      on: (_event, listener) => {
        handler = listener;
      },
      start: () => {},
    },
    sent,
    send: (data) => handler!({ data }),
    sendRaw: (data) => handler!(data),
  };
}

/** Installs a fake parentPort for the duration of `fn`, then removes it. */
async function withPort<T>(fn: (fp: FakePort) => Promise<T> | T): Promise<T> {
  const proc = process as unknown as { parentPort?: unknown };
  const fp = fakePort();
  proc.parentPort = fp.port;
  try {
    return await fn(fp);
  } finally {
    delete proc.parentPort;
  }
}

void test("shellPdfRenderer: no parentPort attached (bare daemon) returns undefined", () => {
  const proc = process as unknown as { parentPort?: unknown };
  assert.equal(proc.parentPort, undefined);
  assert.equal(shellPdfRenderer(), undefined);
});

void test("shellPdfRenderer: happy path posts render-pdf and resolves with the shell's bytes", async () => {
  await withPort(async ({ port, sent, send }) => {
    const render = shellPdfRenderer()!;
    const bytesPromise = render("<html>如影</html>");
    assert.equal(sent.length, 1);
    const msg = sent[0] as { kind: string; id: string; html: string };
    assert.equal(msg.kind, "render-pdf");
    assert.equal(msg.html, "<html>如影</html>");
    void port; // used only via `sent`/`send` above

    send({ kind: "render-pdf-result", id: msg.id, ok: true, bytes: new Uint8Array([1, 2, 3]) });
    assert.deepEqual([...(await bytesPromise)], [1, 2, 3]);
  });
});

void test("shellPdfRenderer: accepts the { data: [...] } clone shape some Electron versions send", async () => {
  await withPort(async ({ sent, send }) => {
    const render = shellPdfRenderer()!;
    const bytesPromise = render("<html/>");
    const id = (sent[0] as { id: string }).id;
    send({ kind: "render-pdf-result", id, ok: true, bytes: { data: [4, 5, 6] } });
    assert.deepEqual([...(await bytesPromise)], [4, 5, 6]);
  });
});

void test("shellPdfRenderer: accepts a bare array-like bytes shape", async () => {
  await withPort(async ({ sent, send }) => {
    const render = shellPdfRenderer()!;
    const bytesPromise = render("<html/>");
    const id = (sent[0] as { id: string }).id;
    send({ kind: "render-pdf-result", id, ok: true, bytes: { length: 2, 0: 7, 1: 8 } });
    assert.deepEqual([...(await bytesPromise)], [7, 8]);
  });
});

void test("shellPdfRenderer: an unrecognized bytes shape rejects instead of returning empty bytes", async () => {
  await withPort(async ({ sent, send }) => {
    const render = shellPdfRenderer()!;
    const bytesPromise = render("<html/>");
    const id = (sent[0] as { id: string }).id;
    send({ kind: "render-pdf-result", id, ok: true, bytes: { totally: "unexpected" } });
    await assert.rejects(bytesPromise, /this host cannot read/);
  });
});

void test("shellPdfRenderer: a shell-side failure rejects with the shell's error", async () => {
  await withPort(async ({ sent, send }) => {
    const render = shellPdfRenderer()!;
    const bytesPromise = render("<html/>");
    const id = (sent[0] as { id: string }).id;
    send({ kind: "render-pdf-result", id, ok: false, error: "chromium crashed" });
    await assert.rejects(bytesPromise, /chromium crashed/);
  });
});

void test("shellPdfRenderer: a shell-side failure without a message still rejects", async () => {
  await withPort(async ({ sent, send }) => {
    const render = shellPdfRenderer()!;
    const bytesPromise = render("<html/>");
    const id = (sent[0] as { id: string }).id;
    send({ kind: "render-pdf-result", id, ok: false });
    await assert.rejects(bytesPromise, /could not render this document/);
  });
});

void test("shellPdfRenderer: also accepts a reply that is not wrapped in { data }", async () => {
  await withPort(async ({ sent, sendRaw }) => {
    const render = shellPdfRenderer()!;
    const bytesPromise = render("<html/>");
    const id = (sent[0] as { id: string }).id;
    sendRaw({ kind: "render-pdf-result", id, ok: true, bytes: new Uint8Array([9]) });
    assert.deepEqual([...(await bytesPromise)], [9]);
  });
});

void test("shellPdfRenderer: unrelated or malformed messages are ignored, not mistaken for a reply", async () => {
  await withPort(async ({ sent, send }) => {
    const render = shellPdfRenderer()!;
    const bytesPromise = render("<html/>");
    const id = (sent[0] as { id: string }).id;

    send(null);
    send("a string, not an object");
    send({ kind: "something-else", id });
    send({ kind: "render-pdf-result" }); // missing id
    send({ kind: "render-pdf-result", id: "not-the-right-id", ok: true, bytes: new Uint8Array() });

    send({ kind: "render-pdf-result", id, ok: true, bytes: new Uint8Array([9, 9]) });
    assert.deepEqual([...(await bytesPromise)], [9, 9]);
  });
});

void test("shellPdfRenderer: concurrent calls are correlated by id, not conflated", async () => {
  await withPort(async ({ sent, send }) => {
    const render = shellPdfRenderer()!;
    const p1 = render("<a/>");
    const p2 = render("<b/>");
    assert.equal(sent.length, 2);
    const id1 = (sent[0] as { id: string }).id;
    const id2 = (sent[1] as { id: string }).id;
    assert.notEqual(id1, id2);

    // 反着回：先回第二个，第一个仍未定，证明不是按到达顺序瞎配的。
    send({ kind: "render-pdf-result", id: id2, ok: true, bytes: new Uint8Array([2]) });
    assert.deepEqual([...(await p2)], [2]);
    send({ kind: "render-pdf-result", id: id1, ok: true, bytes: new Uint8Array([1]) });
    assert.deepEqual([...(await p1)], [1]);
  });
});

void test("shellPdfRenderer: rejects if the shell never answers within the render timeout", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  await withPort(async ({ sent }) => {
    const render = shellPdfRenderer()!;
    const bytesPromise = render("<html/>");
    assert.equal(sent.length, 1);
    t.mock.timers.tick(90_000);
    await assert.rejects(bytesPromise, /did not answer within \d+ms/);
  });
});
