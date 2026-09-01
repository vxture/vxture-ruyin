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
import { basename, dirname, extname, join } from "node:path";
import { isPathGranted } from "@vxture/ruyin-core";
import {
  describeDiagnostics,
  isLossy,
  parseDocument,
  renderDocx,
  renderHtml,
} from "@vxture/ruyin-document";
import type { Diagnostic } from "@vxture/ruyin-document";
import type { SearchOutcome } from "./fts.js";
import type {
  ContextItemMeta,
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

/** What `export_result` can take in. A `.docx` is not Markdown; say so. */
const SOURCE_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);

/**
 * 无条件渲染得出来的格式。`pdf` 不在里面，因为它要壳里的 Chromium
 * （ADR-017）——守护进程脱离壳单独跑时就没有，那时如实说没有，而不是给一份
 * 空文件或悄悄换成 docx。
 */
const RENDERERS = new Set(["docx"]);

/** Cap on what one export reads in, before rendering multiplies it. */
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

const IMPLEMENTED = new Set([
  "read_file",
  "write_document",
  "export_result",
  "search_knowledge",
]);

/** 在给定范围内检索的能力。宿主注入，因为它要碰存储，而执行器本身不该碰。 */
export type ContextSearch = (
  projectId: string,
  query: string,
  scope: ContextItemMeta[],
  limit: number,
) => SearchOutcome;

/** 一次检索最多回多少条。回太多等于把整份资料塞进对话。 */
const MAX_SEARCH_RESULTS = 20;

export class LocalToolExecutor implements ToolExecutorPort {
  /**
   * `search` 缺省时 `search_knowledge` **不在支持列表里**，而不是支持了却查不
   * 到东西。两者的差别是：前者让任务在启动时就被明确拒绝（说清缺什么），后者
   * 让任务跑起来、每次检索都返回「没找到」，然后交出一份查无实据的方案。
   */
  constructor(
    private readonly search?: ContextSearch,
    /** 壳提供的 PDF 排版（ADR-017）；脱离壳运行时缺省。 */
    private readonly renderPdfBytes?: (html: string) => Promise<Uint8Array>,
  ) {}

  /** 打包冒烟的自检要走这条真实通道，所以它是可读的。 */
  get pdfRenderer(): ((html: string) => Promise<Uint8Array>) | undefined {
    return this.renderPdfBytes;
  }

  supports(tool: string): boolean {
    if (tool === "search_knowledge") return this.search !== undefined;
    return IMPLEMENTED.has(tool);
  }

  /** 这台机器此刻真渲染得出来的格式。 */
  private formats(): string[] {
    return this.renderPdfBytes ? [...RENDERERS, "pdf"] : [...RENDERERS];
  }

  async execute(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    switch (request.tool) {
      case "read_file":
        return this.readFile(request);
      case "write_document":
        return this.writeDocument(request);
      case "export_result":
        return this.exportResult(request);
      case "search_knowledge":
        return this.searchKnowledge(request);
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

  /**
   * 在本任务的上下文集内检索（TD-022）。
   *
   * 范围就是上下文集，不是整个项目索引 —— 那是这次任务选出来、必要时经用户
   * 确认过的那一批资料；让检索伸到它之外，那道确认就成了摆设。
   *
   * 回的是**摘录加 id**，不是整篇：整篇的位置在上下文通路，从这里回传等于
   * 让资料按全价流经对话。
   */
  private searchKnowledge(
    request: ToolExecutionRequest,
  ): ToolExecutionResult {
    if (!this.search) {
      return { content: "search is not wired on this host", isError: true };
    }
    const query = String(request.arguments["query"] ?? "").trim();
    if (!query) return { content: "no query was given", isError: true };
    const asked = Number(request.arguments["limit"] ?? 8);
    const limit = Math.min(
      Number.isFinite(asked) && asked > 0 ? Math.floor(asked) : 8,
      MAX_SEARCH_RESULTS,
    );

    const { hits, outOfScope } = this.search(
      request.workspace,
      query,
      request.contextSet,
      limit,
    );
    if (hits.length === 0) {
      // 空结果要能区分「范围内没有」和「范围本身是空的」——后者是选取阶段的
      // 问题，不是资料的问题，而两者报成同一句话，查的人会往错的方向找。
      const why = request.contextSet.length
        ? `no match for "${query}" in this task's ${request.contextSet.length} context item(s)`
        : "this task has no context items to search";
      return {
        content: outOfScope
          ? `${why}; ${outOfScope} match(es) exist outside this task's context set`
          : why,
      };
    }
    const lines = hits.map((h) => `- [${h.id}] ${h.name}: ${h.excerpt}`);
    if (outOfScope) {
      lines.push(
        `(${outOfScope} further match(es) are outside this task's context set)`,
      );
    }
    return { content: lines.join("\n") };
  }

  /**
   * Assemble the Markdown documents this task already wrote into one rendered
   * deliverable (ADR-013 option C, ADR-016).
   *
   * The parts are named **by path**, not pasted into the call. They were
   * written by `write_document` in an earlier turn, so they are already on
   * disk inside a granted folder; re-emitting them here would send the whole
   * document through the conversation a second time, at full token price, to
   * produce bytes that never needed to be there. The model decides *which*
   * parts and in *what order* - that is the part only it knows.
   */
  private async exportResult(
    request: ToolExecutionRequest,
  ): Promise<ToolExecutionResult> {
    const path = String(request.arguments["path"] ?? "");
    const format = String(request.arguments["format"] ?? "");
    const formats = this.formats();
    if (!formats.includes(format)) {
      return {
        content:
          `this host does not render "${format}"; it renders ${formats.join(", ")}` +
          // 脱离壳跑的守护进程没有 Chromium。说清是「这套装配没有」，不是
          // 「这个格式做不了」——两句话指向的排查方向完全不同。
          (format === "pdf"
            ? " (pdf needs the Ruyin shell; this daemon is running on its own)"
            : ""),
        isError: true,
      };
    }
    const raw = request.arguments["sources"];
    const sources = (Array.isArray(raw) ? raw : [raw]).map((s) => String(s));
    if (!sources.length || sources.some((s) => !s)) {
      return { content: "no source documents were given", isError: true };
    }

    const parts: string[] = [];
    let total = 0;
    for (const source of sources) {
      const denied = guard(source, request.grants, "read");
      if (denied) return denied;
      if (!SOURCE_EXTENSIONS.has(extname(source).toLowerCase())) {
        return {
          content:
            `"${source}" is not a Markdown source; export assembles ` +
            `${[...SOURCE_EXTENSIONS].join(", ")}`,
          isError: true,
        };
      }
      try {
        const bytes = readFileSync(source);
        total += bytes.byteLength;
        if (total > MAX_SOURCE_BYTES) {
          return {
            content: `sources exceed ${MAX_SOURCE_BYTES} bytes`,
            isError: true,
          };
        }
        parts.push(bytes.toString("utf8"));
      } catch (cause) {
        return { content: describe(cause), isError: true };
      }
    }

    const document = parseDocument(parts.join("\n\n"));
    // A lossy document is refused rather than written. The model gets the
    // line numbers and can fix its Markdown for one more turn; a deliverable
    // that is quietly missing a figure looks exactly like a correct one, and
    // nobody finds out until it is the thing that was submitted.
    if (isLossy(document.diagnostics)) {
      return {
        content:
          "cannot render; fix these and call again:\n" +
          describeDiagnostics(document.diagnostics),
        isError: true,
      };
    }
    const title = basename(path, `.${format}`);
    let bytes: Uint8Array;
    // 某个目标格式特有的降级 —— 同一棵树渲染成 docx 没损失、渲染成 pdf 有的
    // 那些（比如 PDF 的目录没有页码）。和文档级诊断合在一起报。
    const notes: Diagnostic[] = [];
    try {
      if (format === "pdf") {
        const page = renderHtml(document, { title });
        notes.push(...page.notes);
        bytes = await this.renderPdfBytes!(page.html);
        // 壳返回了，但返回的不是 PDF。写下去用户会得到一个打不开的文件，而
        // 文件名、大小、修改时间都很正常 —— 在这里断掉。
        if (!startsWithPdfHeader(bytes)) {
          return {
            content: "the shell returned something that is not a PDF",
            isError: true,
          };
        }
      } else {
        bytes = await renderDocx(document, { title });
      }
    } catch (cause) {
      return { content: describe(cause), isError: true };
    }
    const written = this.writeArtifact(path, bytes, request.grants);
    const reservations = [...document.diagnostics, ...notes];
    if (written.isError || !reservations.length) return written;
    // Degraded, not lossy: the content is all there at lower fidelity. Say so
    // anyway - the caller should know what it is handing over.
    return {
      content:
        `${written.content}\nrendered with reservations:\n` +
        describeDiagnostics(reservations),
    };
  }
}

/** `%PDF-`。一份长度对、头不对的文件，是一份打不开的交付物。 */
function startsWithPdfHeader(bytes: Uint8Array): boolean {
  const magic = [0x25, 0x50, 0x44, 0x46, 0x2d];
  return magic.every((b, i) => bytes[i] === b);
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
