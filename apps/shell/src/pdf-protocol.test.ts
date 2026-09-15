/**
 * pdf.ts itself imports `electron` statically (needed for renderPdf's real
 * BrowserWindow) and Node's ESM loader hard-fails that import outside a real
 * Electron process - "does not provide an export named 'BrowserWindow'", a
 * load-time SyntaxError, not a soft undefined. That's exactly why the
 * request-shape guard and the self-check parser live in pdf-protocol.ts
 * instead: this file can be loaded by plain node:test, pdf.ts cannot.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { PDF_SELF_CHECK_WAIT_MS, isRenderPdfRequest, parsePdfSelfCheck } from "./pdf-protocol.js";

/*
 * RY-001 #22：冒烟里壳等 PDF 标记的上限，必须盖得住排在它前面的那几件事的上限之和。
 * 60 秒的旧值连「种子复制 + 一次 uvx 启动」都盖不住，PR #259 的只读那一轮就是这样红的。
 * 这里把账写成数，谁再把它改小就会在这儿先看到为什么不行。
 */
void test("PDF_SELF_CHECK_WAIT_MS covers every self-check queued before it (RY-001 #22)", () => {
  const mcpStartMs = 60_000; // local-host mcp-client.ts DEFAULT_START_TIMEOUT_MS (#16)
  const seedCopyMeasuredMs = 45_400; // CI runner, read-only smoke round, 2026-09-15
  const toolsSelfCheck = mcpStartMs;
  const uvxSelfCheck = seedCopyMeasuredMs + mcpStartMs;
  assert.ok(
    PDF_SELF_CHECK_WAIT_MS > toolsSelfCheck + uvxSelfCheck,
    `${PDF_SELF_CHECK_WAIT_MS} ms 盖不住 tools ${toolsSelfCheck} + uvx ${uvxSelfCheck} ms`,
  );
});

void test("isRenderPdfRequest: accepts a well-formed request", () => {
  assert.equal(
    isRenderPdfRequest({ kind: "render-pdf", id: "pdf_1", html: "<p>x</p>" }),
    true,
  );
});

void test("isRenderPdfRequest: rejects non-objects, wrong kind, and missing/wrong-typed fields", () => {
  assert.equal(isRenderPdfRequest(null), false);
  assert.equal(isRenderPdfRequest("render-pdf"), false);
  assert.equal(isRenderPdfRequest({ kind: "render-pdf-result", id: "x", html: "x" }), false);
  assert.equal(isRenderPdfRequest({ kind: "render-pdf", html: "x" }), false, "缺 id");
  assert.equal(isRenderPdfRequest({ kind: "render-pdf", id: "x" }), false, "缺 html");
  assert.equal(
    isRenderPdfRequest({ kind: "render-pdf", id: 1, html: "x" }),
    false,
    "id 类型不对也不该放行",
  );
});

void test("parsePdfSelfCheck: no marker yet is 'pending', not a failure", () => {
  assert.deepEqual(parsePdfSelfCheck("[ruyin] listening on http://127.0.0.1:7420"), {
    status: "pending",
  });
  assert.deepEqual(parsePdfSelfCheck(""), { status: "pending" });
});

void test("parsePdfSelfCheck: the ok marker is a pass", () => {
  assert.deepEqual(
    parsePdfSelfCheck("some earlier line\n[ruyin] pdf self-check: ok (1234 bytes)\n"),
    { status: "ok" },
  );
});

void test("parsePdfSelfCheck: anything not starting with 'ok' is a failure, detail included", () => {
  assert.deepEqual(
    parsePdfSelfCheck("[ruyin] pdf self-check: the shell returned something that is not a PDF"),
    { status: "failed", detail: "the shell returned something that is not a PDF" },
  );
});

void test("parsePdfSelfCheck: only the marker line matters, not surrounding noise", () => {
  const output = [
    "[ruyin] local runtime 0.1.0",
    "[ruyin] listening on http://127.0.0.1:17420",
    "[ruyin] pdf self-check: ok (48213 bytes)",
    "[ruyin] session token: abc123",
  ].join("\n");
  assert.deepEqual(parsePdfSelfCheck(output), { status: "ok" });
});
