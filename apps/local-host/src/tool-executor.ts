/**
 * Local tool execution - the preset half of the skill layer (ADR-006).
 *
 * The Tool Gate has already decided the call may happen and that its arguments
 * are legal for this workspace; by the time execution starts, paths have been
 * checked against the grants. This file still re-checks them, because a
 * defence that only exists at one layer stops existing the moment someone adds
 * a second caller.
 *
 * Only tools implemented here are ever offered to a provider: promising a tool
 * and failing on use costs a turn and teaches the provider nothing.
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, extname, join } from "node:path";
import { isPathGranted } from "@vxture/ruyin-core";
import type {
  FolderGrant,
  ToolExecutionRequest,
  ToolExecutionResult,
  ToolExecutorPort,
} from "@vxture/ruyin-core";

/** Cap on what one read can pull into a model turn. */
const MAX_READ_BYTES = 256 * 1024;

/**
 * Cap on one artifact. Generous - a real deliverable with images is large -
 * but present: an unbounded write driven by a model is a way to fill a disk.
 */
const MAX_WRITE_BYTES = 100 * 1024 * 1024;

/**
 * Extensions this host reads back as text (mirrors the connector's table).
 * A binary file is not decoded as UTF-8 and handed over as if it were the
 * document: that produces mojibake shaped exactly like content.
 */
const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown", ".yaml", ".yml", ".json", ".csv", ".xml", ".html",
]);

const IMPLEMENTED = new Set(["read_file", "write_document"]);

export class LocalToolExecutor implements ToolExecutorPort {
  supports(tool: string): boolean {
    return IMPLEMENTED.has(tool);
  }

  async execute(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    switch (request.tool) {
      case "read_file":
        return this.readFile(request);
      case "write_document":
        return this.writeDocument(request);
      default:
        return {
          content: `tool "${request.tool}" is not implemented by this host`,
          isError: true,
        };
    }
  }

  /**
   * Write bytes into a granted folder. **The one write path in this host** -
   * `write_document` encodes its text and comes through here too, so the
   * guard, the cap and the atomicity are not something a second writer can
   * forget to repeat.
   *
   * Public because the byte producers are the skill layer, not the contract
   * tool surface: a rendering skill turns structured content into a `.docx`
   * and hands the bytes here (ADR-013 option C). Deliberately NOT reachable
   * as a tool argument - see the note on `write_document`.
   */
  writeArtifact(
    path: string,
    bytes: Uint8Array,
    grants: FolderGrant[],
  ): ToolExecutionResult {
    const denied = guard(path, grants, "readwrite");
    if (denied) return denied;
    if (bytes.byteLength > MAX_WRITE_BYTES) {
      return {
        content: `refusing to write ${bytes.byteLength} bytes; the limit is ${MAX_WRITE_BYTES}`,
        isError: true,
      };
    }
    // Write beside the target, then rename. A crash partway through a direct
    // write leaves a truncated file at the real name - and a half-written
    // .docx is not a shorter document, it is one that will not open, sitting
    // exactly where the user expects their deliverable.
    const staging = join(
      dirname(path),
      `.${randomBytes(8).toString("hex")}${extname(path)}.partial`,
    );
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(staging, bytes);
      renameSync(staging, path);
      return { content: `wrote ${bytes.byteLength} bytes to ${path}` };
    } catch (cause) {
      rmSync(staging, { force: true });
      return { content: describe(cause), isError: true };
    }
  }

  private readFile(request: ToolExecutionRequest): ToolExecutionResult {
    const path = String(request.arguments["path"] ?? "");
    const denied = guardPath(path, request, "read");
    if (denied) return denied;
    try {
      const stat = statSync(path);
      if (!stat.isFile()) {
        return { content: `"${path}" is not a file`, isError: true };
      }
      // A non-text file is reported as such, never decoded and handed back as
      // though it were the document. Nor are its bytes returned: a tool result
      // goes into the conversation, and bytes in the conversation is the cost
      // problem ADR-013 rejected. Reading such a file is a job for the context
      // pipeline, which carries bytes without routing them through a turn.
      if (!TEXT_EXTENSIONS.has(extname(path).toLowerCase())) {
        return {
          content: `"${path}" is not a text file; read it as context instead of through this tool`,
          isError: true,
        };
      }
      const buffer = readFileSync(path);
      const truncated = buffer.byteLength > MAX_READ_BYTES;
      const text = buffer.subarray(0, MAX_READ_BYTES).toString("utf8");
      return {
        content: truncated
          ? `${text}\n\n[truncated at ${MAX_READ_BYTES} bytes of ${buffer.byteLength}]`
          : text,
      };
    } catch (cause) {
      return { content: describe(cause), isError: true };
    }
  }

  /**
   * Text output. There is deliberately no base64 parameter here, and adding
   * one would be a mistake rather than a convenience: tool arguments come from
   * the provider's `tool_call`, so bytes passed that way travel through the
   * conversation - a 2MB document becomes 2.7MB of base64 in the context, and
   * both cost and the context limit go with it. That is ADR-013 option A, and
   * it was rejected for exactly this. Bytes reach disk through
   * `writeArtifact`, called by a skill, never through a turn.
   */
  private writeDocument(request: ToolExecutionRequest): ToolExecutionResult {
    const path = String(request.arguments["path"] ?? "");
    const content = String(request.arguments["content"] ?? "");
    return this.writeArtifact(
      path,
      Buffer.from(content, "utf8"),
      request.grants,
    );
  }
}

/**
 * Re-check the path against the grants, and check the grant is strong enough
 * for what is about to happen: a read grant does not authorize a write.
 *
 * Takes grants rather than a request because the writers are not all tool
 * calls - a skill writing a rendered artifact has to clear the same bar as a
 * model asking for a write, and a guard that only fits one caller's shape is
 * a guard the next caller routes around.
 */
function guard(
  path: string,
  grants: FolderGrant[],
  need: "read" | "readwrite",
): ToolExecutionResult | undefined {
  if (!path) return { content: "no path was given", isError: true };
  if (!isPathGranted(path, grants)) {
    return {
      content: `"${path}" is outside every granted folder`,
      isError: true,
    };
  }
  if (need === "readwrite") {
    const writable = grants.some(
      (g) => g.mode === "readwrite" && isPathGranted(path, [g]),
    );
    if (!writable) {
      return {
        content: `"${path}" is granted read-only`,
        isError: true,
      };
    }
  }
  return undefined;
}

function guardPath(
  path: string,
  request: ToolExecutionRequest,
  need: "read" | "readwrite",
): ToolExecutionResult | undefined {
  return guard(path, request.grants, need);
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
