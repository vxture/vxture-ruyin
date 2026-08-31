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

import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { isPathGranted } from "@vxture/ruyin-core";
import type {
  ToolExecutionRequest,
  ToolExecutionResult,
  ToolExecutorPort,
} from "@vxture/ruyin-core";

/** Cap on what one read can pull into a model turn. */
const MAX_READ_BYTES = 256 * 1024;

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

  private readFile(request: ToolExecutionRequest): ToolExecutionResult {
    const path = String(request.arguments["path"] ?? "");
    const denied = guardPath(path, request, "read");
    if (denied) return denied;
    try {
      const stat = statSync(path);
      if (!stat.isFile()) {
        return { content: `"${path}" is not a file`, isError: true };
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

  private writeDocument(request: ToolExecutionRequest): ToolExecutionResult {
    const path = String(request.arguments["path"] ?? "");
    const content = String(request.arguments["content"] ?? "");
    const denied = guardPath(path, request, "readwrite");
    if (denied) return denied;
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content, "utf8");
      return { content: `wrote ${Buffer.byteLength(content, "utf8")} bytes to ${path}` };
    } catch (cause) {
      return { content: describe(cause), isError: true };
    }
  }
}

/**
 * Re-check the path against the grants, and check the grant is strong enough
 * for what is about to happen: a read grant does not authorize a write.
 */
function guardPath(
  path: string,
  request: ToolExecutionRequest,
  need: "read" | "readwrite",
): ToolExecutionResult | undefined {
  if (!path) return { content: "no path was given", isError: true };
  if (!isPathGranted(path, request.grants)) {
    return {
      content: `"${path}" is outside every granted folder`,
      isError: true,
    };
  }
  if (need === "readwrite") {
    const writable = request.grants.some(
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

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
