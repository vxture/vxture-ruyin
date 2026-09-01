/**
 * 结构化文档表示 —— ADR-013 选的 C，ADR-016 定的形。
 *
 * 内部表示是 **mdast**（Markdown 的标准 AST，unist 家族），不是自造 schema：
 * 渲染器要的是一棵有名字的树，而这棵树已经有人定义好、有一整套工具能读它。
 * 自造一个只有本仓认识的文档 schema，等于把每个下游渲染器都变成本仓的负债。
 *
 * 上线格式是 **Markdown 文本**，不是手搓的 AST JSON。理由不是"方便"：
 * 模型写 Markdown 是母语，写大段 JSON AST 会在嵌套处出错，而且同一篇文档的
 * JSON 表示大约是 Markdown 的三到五倍 token。ADR-013 否决 A 的理由是"字节不该
 * 流经对话"——正文本来就必须流经对话（模型在写它），流经的是**正文**而不是
 * 4 万字节的 OOXML 包装，这是 A 与 C 的真正分界。
 *
 * Markdown 说不了的事（分页、目录域）走 `remark-directive` 指令扩展，这是
 * Markdown 生态里既有的扩展机制，不是本仓发明的语法。
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import { toString as nodeText } from "mdast-util-to-string";
import type { Node, Parent } from "unist";
import type { Root } from "mdast";

/**
 * 诊断的严重度，决定的是**要不要让这次渲染失败**。
 *
 * - `lossy`：内容到不了成品。一份悄悄少了图的标书，长得和一份正确的标书一模
 *   一样——这是本仓反复在抓的那类缺陷，所以它必须让调用失败，而不是附一条
 *   备注了事。
 * - `degraded`：内容在，保真度降了（比如嵌套表被摊平）。报出来，照常渲染。
 */
export type Severity = "lossy" | "degraded";

export interface Diagnostic {
  severity: Severity;
  /** 1 起算的行号；节点没有位置信息时为 null。 */
  line: number | null;
  message: string;
}

export interface RuyinDocument {
  root: Root;
  diagnostics: Diagnostic[];
}

/** 本仓认识的指令。名字前缀 `ry-`，attributes 由 remark-directive 解析。 */
export const RY_DIRECTIVES = {
  /** 分页。Markdown 没有分页的概念，而正式文档必须有。 */
  "ry-pagebreak": { attributes: [] as string[] },
  /** 目录域。渲染成 Word 的 TOC 域，页码由 Word 自己算。 */
  "ry-toc": { attributes: ["depth", "title"] },
} as const;

export type RyDirectiveName = keyof typeof RY_DIRECTIVES;

export function isRyDirective(name: string): name is RyDirectiveName {
  return Object.prototype.hasOwnProperty.call(RY_DIRECTIVES, name);
}

/** 渲染器能表达的 mdast 节点。不在这张表里的一律要报。 */
const SUPPORTED = new Set([
  "root", "heading", "paragraph", "text", "strong", "emphasis", "inlineCode",
  "delete", "break", "link", "list", "listItem", "table", "tableRow",
  "tableCell", "blockquote", "code", "thematicBreak",
]);

/**
 * 一段看起来像指令、却被解析成了普通段落的文本。
 *
 * 这不是假想：`::ry:pagebreak` 用冒号分隔时 remark **不报错**，它把这一行拆成
 * 文本 `::ry` 加一个行内指令 `:pagebreak`，于是 `::ry` 会以字面文本印进标书
 * 正文，而模型要的分页根本没发生。写对与写错之间没有任何反馈——正是这种情况
 * 需要一条诊断把沉默变成响声。
 *
 * 尾部用 `\b` 而不是显式分隔符：被拆开之后段落文本恰好以 `ry` 结尾，写死分隔
 * 符就正好漏掉真实的那个形态。
 */
const LOOKS_LIKE_DIRECTIVE = /^:{2,}\s*ry\b/i;

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkDirective);

/**
 * 解析一篇 Markdown 为可渲染的文档。
 *
 * 解析本身不失败——Markdown 没有语法错误这回事，任何字符串都是合法 Markdown。
 * 会失败的是**渲染**，而判据是这里产出的 `diagnostics`。
 */
export function parseDocument(markdown: string): RuyinDocument {
  const root = processor.parse(markdown) as Root;
  const diagnostics: Diagnostic[] = [];
  walk(root, (node, parent) => inspect(node, parent, diagnostics));
  return { root, diagnostics };
}

/** 有没有会丢内容的诊断。渲染器据此决定拒绝还是照渲。 */
export function isLossy(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === "lossy");
}

/** 把诊断排成给模型看的一段话：带行号、说清怎么改。 */
export function describeDiagnostics(diagnostics: Diagnostic[]): string {
  return diagnostics
    .map((d) => `  ${d.line === null ? "?" : `第 ${d.line} 行`}：${d.message}`)
    .join("\n");
}

/** 返回 false 表示这棵子树不必再看：整段已判错，逐个孩子再报一遍只是噪音。 */
function inspect(node: Node, parent: Parent | null, out: Diagnostic[]): boolean {
  const line = node.position?.start.line ?? null;

  if (node.type === "leafDirective" || node.type === "containerDirective") {
    const name = String((node as { name?: unknown }).name ?? "");
    if (!isRyDirective(name)) {
      // 未知指令必须报。悄悄丢掉一条 `::ry-signature`，成品就少了签章位，
      // 而它长得和一份完整文档没有区别。
      out.push({
        severity: "lossy",
        line,
        message:
          `未知指令 "${name}"；本运行时认识的是 ` +
          `${Object.keys(RY_DIRECTIVES).join("、")}`,
      });
      return false;
    }
    if (node.type === "containerDirective") {
      out.push({
        severity: "lossy",
        line,
        message: `"${name}" 是叶子指令，要写成 ::${name}，不是 :::${name}`,
      });
      return false;
    }
    const attrs = (node as { attributes?: Record<string, unknown> }).attributes;
    const known = RY_DIRECTIVES[name].attributes as readonly string[];
    for (const key of Object.keys(attrs ?? {})) {
      if (!known.includes(key)) {
        // 属性写错不丢内容，指令本体照常渲染 —— 报 degraded。
        out.push({
          severity: "degraded",
          line,
          message:
            `"${name}" 不认识属性 "${key}"，已忽略` +
            (known.length ? `；它接受 ${known.join("、")}` : ""),
        });
      }
    }
    return true;
  }

  if (node.type === "textDirective") {
    out.push({
      severity: "lossy",
      line,
      message: `行内指令暂不支持（写成了 :${String((node as { name?: unknown }).name ?? "")}）`,
    });
    return false;
  }

  // 段落先判：`::ry:pagebreak` 会同时触发这一条和它孩子里的 textDirective，
  // 而真正说清问题的是这一条。停在这里，别让噪音把它淹掉。
  if (node.type === "paragraph" && LOOKS_LIKE_DIRECTIVE.test(nodeText(node))) {
    out.push({
      severity: "lossy",
      line,
      message:
        "这一行看着像指令，但没有被当成指令解析，会以字面文本印进成品；" +
        "指令名用连字符，例如 ::ry-pagebreak",
    });
    return false;
  }

  if (!SUPPORTED.has(node.type)) {
    out.push({
      severity: "lossy",
      line,
      message: `渲染器表达不了 ${node.type}${hint(node.type)}`,
    });
    return false;
  }

  // 表格单元格里嵌表格：Word 能做，但本版摊平。内容还在，结构降级。
  if (node.type === "table" && parent?.type === "tableCell") {
    out.push({
      severity: "degraded",
      line,
      message: "单元格内的表格被摊平为文本",
    });
  }
  return true;
}

function hint(type: string): string {
  switch (type) {
    case "image":
    case "imageReference":
      return "；图片要走上下文通路交给运行时，不能写在正文里";
    case "html":
      return "；正文里的 HTML 不会被渲染，请改用 Markdown 语法";
    case "footnoteReference":
    case "footnoteDefinition":
      return "；脚注暂不支持，请把内容并入正文";
    case "linkReference":
    case "definition":
      return "；引用式链接暂不支持，请写成行内链接 [文字](地址)";
    default:
      return "";
  }
}

function walk(
  node: Node,
  visit: (node: Node, parent: Parent | null) => boolean,
  parent: Parent | null = null,
): void {
  if (!visit(node, parent)) return;
  const children = (node as Partial<Parent>).children;
  if (!Array.isArray(children)) return;
  for (const child of children) walk(child, visit, node as Parent);
}
