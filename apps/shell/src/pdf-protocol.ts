/**
 * The daemon<->shell PDF request/reply shapes and the smoke self-check
 * marker parser (ADR-017). Split out of pdf.ts on purpose: pdf.ts statically
 * imports `electron`, and Node's ESM loader hard-fails on that import
 * outside a real Electron process ("does not provide an export named
 * 'BrowserWindow'") - not a soft undefined, a load-time SyntaxError. Nothing
 * here touches Electron, so this half can be driven directly by node:test.
 */

export interface RenderPdfRequest {
  kind: "render-pdf";
  id: string;
  html: string;
}

export interface RenderPdfReply {
  kind: "render-pdf-result";
  id: string;
  ok: boolean;
  /** 成功时的 PDF 字节；失败时缺省。 */
  bytes?: Uint8Array;
  error?: string;
}

export function isRenderPdfRequest(value: unknown): value is RenderPdfRequest {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v["kind"] === "render-pdf" &&
    typeof v["id"] === "string" &&
    typeof v["html"] === "string"
  );
}

export type PdfSelfCheckResult =
  | { status: "pending" }
  | { status: "ok" }
  | { status: "failed"; detail: string };

/**
 * The daemon's smoke self-check (ADR-017) prints its verdict to stdout
 * rather than answering a request - main.ts accumulates that output and
 * polls this against it. Waiting for the marker instead of a fixed delay
 * matters: "wait two seconds then declare success" passes on a slow machine
 * and also passes when the render link is dead.
 */
export function parsePdfSelfCheck(daemonOutput: string): PdfSelfCheckResult {
  const hit = /\[ruyin\] pdf self-check: (.+)/.exec(daemonOutput);
  if (!hit) return { status: "pending" };
  const detail = hit[1] ?? "";
  return detail.startsWith("ok") ? { status: "ok" } : { status: "failed", detail };
}
