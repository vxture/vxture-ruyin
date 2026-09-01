/**
 * mdast -> HTML。PDF 这条路的中间态（ADR-017）：壳里的 Chromium 排版它，
 * `printToPDF` 出成品。
 *
 * 和 docx 渲染器一样是确定性转换、同构、不碰宿主 API。两个渲染器共用同一棵
 * 树、同一套诊断，所以「表达不了就失败」那条规矩两边一致。
 *
 * **每一处文本都转义。** 输入的 Markdown 是模型写的，正文里的原始 HTML 在
 * ADR-016 里已判为 lossy（拒渲），但这里仍然逐节点构造、绝不拼接原文 ——
 * 拼接是把「模型写的字」变成「浏览器执行的东西」的那一步。
 */

import type {
  Blockquote,
  Code,
  Heading,
  List,
  ListItem,
  Paragraph as MdParagraph,
  PhrasingContent,
  RootContent,
  Table as MdTable,
} from "mdast";
import { toString as nodeText } from "mdast-util-to-string";
import { isRyDirective, type Diagnostic, type RuyinDocument } from "./document.js";

export interface HtmlOptions {
  title?: string;
  /** 页边距，CSS 长度。缺省 20mm —— 正式文档的常见值。 */
  margin?: string;
}

export interface HtmlOutput {
  html: string;
  /**
   * 这次转换特有的降级，`parseDocument` 那一轮看不出来的。
   *
   * 诊断是按文档产生的，而有些损失只在**特定目标格式**上发生：同一棵树渲染
   * 成 docx 没有损失，渲染成 PDF 就有。所以它们在这里补，而不是回头去污染
   * 文档级的诊断表。
   */
  notes: Diagnostic[];
}

const CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", Calibri, sans-serif;
  font-size: 11pt;
  line-height: 1.7;
  color: #111;
}
h1, h2, h3, h4, h5, h6 { line-height: 1.35; margin: 1.4em 0 0.6em; page-break-after: avoid; }
h1 { font-size: 20pt; }
h2 { font-size: 16pt; }
h3 { font-size: 13pt; }
h4, h5, h6 { font-size: 11.5pt; }
p { margin: 0 0 0.7em; orphans: 2; widows: 2; }
ul, ol { margin: 0 0 0.7em; padding-left: 1.9em; }
li { margin: 0.15em 0; }
blockquote {
  margin: 0.6em 0; padding: 0.1em 0 0.1em 0.9em;
  border-left: 3px solid #bbb; color: #333;
}
pre {
  background: #f4f4f4; padding: 0.6em 0.8em; margin: 0.6em 0;
  font-family: Consolas, "Courier New", monospace; font-size: 9.5pt;
  white-space: pre-wrap; word-break: break-word;
}
code { font-family: Consolas, "Courier New", monospace; font-size: 0.94em; }
table { border-collapse: collapse; width: 100%; margin: 0.7em 0; page-break-inside: avoid; }
th, td { border: 1px solid #999; padding: 0.35em 0.55em; text-align: left; vertical-align: top; }
th { background: #f0f0f0; font-weight: 600; }
hr { border: 0; border-top: 1px solid #aaa; margin: 1.2em 0; }
a { color: #0b53a8; text-decoration: none; }
.ry-pagebreak { break-after: page; page-break-after: always; }
.ry-toc { margin: 0 0 1.4em; }
.ry-toc-title { font-size: 15pt; font-weight: 600; margin: 0 0 0.5em; }
.ry-toc ol { list-style: none; padding-left: 0; margin: 0; }
.ry-toc li { margin: 0.2em 0; }
.ry-toc li[data-depth="2"] { padding-left: 1.4em; }
.ry-toc li[data-depth="3"] { padding-left: 2.8em; }
.ry-toc li[data-depth="4"], .ry-toc li[data-depth="5"], .ry-toc li[data-depth="6"] { padding-left: 4.2em; }
`;

export function renderHtml(
  doc: RuyinDocument,
  options: HtmlOptions = {},
): HtmlOutput {
  const notes: Diagnostic[] = [];
  const slugs = new SlugBook();
  // 目录要在正文之前渲染，但它列的是正文里的标题 —— 先把标题走一遍编好锚点，
  // 正文再用同一本账，两边的 id 才对得上。
  const headings = collectHeadings(doc, slugs);
  const body = doc.root.children
    .map((node) => block(node, slugs, headings, notes))
    .join("\n");

  const html = [
    "<!doctype html>",
    '<html lang="zh-CN"><head><meta charset="utf-8">',
    // 送进来的 HTML 由模型写的 Markdown 转成。逐节点构造 + 转义已经挡住了
    // 脚本，这条 CSP 是第二道：任何外发请求、任何脚本，一律不成立。
    '<meta http-equiv="Content-Security-Policy" ' +
      "content=\"default-src 'none'; style-src 'unsafe-inline'; font-src local; img-src data:\">",
    `<title>${escapeText(options.title ?? "")}</title>`,
    `<style>@page { size: A4; margin: ${cssLength(options.margin) ?? "20mm"}; }${CSS}</style>`,
    "</head><body>",
    body,
    "</body></html>",
  ].join("\n");
  return { html, notes };
}

interface HeadingRef {
  depth: number;
  text: string;
  id: string;
}

function collectHeadings(doc: RuyinDocument, slugs: SlugBook): HeadingRef[] {
  const out: HeadingRef[] = [];
  for (const node of doc.root.children) {
    if (node.type !== "heading") continue;
    const text = nodeText(node);
    out.push({ depth: node.depth, text, id: slugs.forHeading(text) });
  }
  return out;
}

function block(
  node: RootContent,
  slugs: SlugBook,
  headings: HeadingRef[],
  notes: Diagnostic[],
): string {
  switch (node.type) {
    case "heading":
      return heading(node, slugs);
    case "paragraph":
      return `<p>${inline((node as MdParagraph).children)}</p>`;
    case "list":
      return list(node as List, slugs, headings, notes);
    case "table":
      return table(node as MdTable);
    case "blockquote":
      return `<blockquote>${(node as Blockquote).children
        .map((c) => block(c as RootContent, slugs, headings, notes))
        .join("")}</blockquote>`;
    case "code":
      return `<pre><code>${escapeText((node as Code).value)}</code></pre>`;
    case "thematicBreak":
      return "<hr>";
    case "leafDirective":
      return directive(node, headings, notes);
    default:
      // 到不了这里：表达不了的节点已在 parseDocument 报成 lossy，而 lossy 会
      // 让渲染在最上面就拒绝。
      return "";
  }
}

function heading(node: Heading, slugs: SlugBook): string {
  const level = Math.min(node.depth, 6);
  const id = slugs.take(nodeText(node));
  return `<h${level} id="${escapeAttr(id)}">${inline(node.children)}</h${level}>`;
}

function list(
  node: List,
  slugs: SlugBook,
  headings: HeadingRef[],
  notes: Diagnostic[],
): string {
  const tag = node.ordered ? "ol" : "ul";
  const items = (node.children as ListItem[])
    .map(
      (item) =>
        `<li>${item.children
          .map((child) => {
            // 列表项里的单个段落不再包 <p>：包了会在条目里多出一行空白。
            if (child.type === "paragraph" && item.children.length === 1) {
              return inline(child.children);
            }
            return block(child as RootContent, slugs, headings, notes);
          })
          .join("")}</li>`,
    )
    .join("");
  return `<${tag}>${items}</${tag}>`;
}

function table(node: MdTable): string {
  const rows = node.children.map((row, index) => {
    const tag = index === 0 ? "th" : "td";
    const cells = row.children
      .map((cell) => `<${tag}>${inline(cell.children)}</${tag}>`)
      .join("");
    return `<tr>${cells}</tr>`;
  });
  const [head, ...rest] = rows;
  return `<table><thead>${head ?? ""}</thead><tbody>${rest.join("")}</tbody></table>`;
}

function directive(
  node: { name?: string; attributes?: Record<string, string | null | undefined> | null },
  headings: HeadingRef[],
  notes: Diagnostic[],
): string {
  const name = node.name ?? "";
  if (!isRyDirective(name)) return "";
  if (name === "ry-pagebreak") return '<div class="ry-pagebreak"></div>';

  const attrs = node.attributes ?? {};
  const depth = clampDepth(attrs["depth"]);
  const title = attrs["title"] ?? "目录";
  const listed = headings.filter((h) => h.depth <= depth);
  // Word 的 TOC 域让 Word 自己算页码。PDF 是定版的，页码要在渲染时就知道，
  // 而知道页码得先排版 —— 那需要渲染两遍。本版不做，所以这里的目录**有链接、
  // 没页码**，并且把这件事报出去：不说，读的人会以为目录本来就长这样。
  notes.push({
    severity: "degraded",
    line: null,
    message: "PDF 的目录没有页码（只有内部链接）；需要页码请导出 .docx",
  });
  const items = listed
    .map(
      (h) =>
        `<li data-depth="${h.depth}"><a href="#${escapeAttr(h.id)}">${escapeText(h.text)}</a></li>`,
    )
    .join("");
  return (
    `<nav class="ry-toc"><div class="ry-toc-title">${escapeText(title)}</div>` +
    `<ol>${items}</ol></nav>`
  );
}

function clampDepth(raw: unknown): number {
  const n = Number.parseInt(String(raw ?? "3"), 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), 6) : 3;
}

function inline(nodes: readonly PhrasingContent[]): string {
  return nodes.map(phrase).join("");
}

function phrase(node: PhrasingContent): string {
  switch (node.type) {
    case "text":
      return escapeText(node.value);
    case "strong":
      return `<strong>${inline(node.children)}</strong>`;
    case "emphasis":
      return `<em>${inline(node.children)}</em>`;
    case "delete":
      return `<del>${inline(node.children)}</del>`;
    case "inlineCode":
      return `<code>${escapeText(node.value)}</code>`;
    case "break":
      return "<br>";
    case "link":
      // 只放行 http/https/mailto。`javascript:` 这类伪协议在 PDF 里同样是可点
      // 的链接，而链接文字是模型写的 —— 白名单，不是黑名单。
      return safeHref(node.url)
        ? `<a href="${escapeAttr(node.url)}">${inline(node.children)}</a>`
        : escapeText(nodeText(node));
    default:
      return escapeText(nodeText(node));
  }
}

function safeHref(url: string): boolean {
  return /^(https?:|mailto:|#)/i.test(url.trim());
}

/** CSS 长度白名单：这个值会进 `@page`，不能是任意字符串。 */
function cssLength(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return /^\d+(\.\d+)?(mm|cm|in|pt|px)$/.test(value.trim())
    ? value.trim()
    : undefined;
}

function escapeText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttr(value: string): string {
  return escapeText(value).replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

/**
 * 标题锚点。两次遍历（先编目录、后渲正文）必须得到同一串 id，所以按顺序发放
 * 而不是每次现算 —— 同名标题现算会得到同一个 id，目录里的链接就会全指向第一个。
 */
class SlugBook {
  private readonly used = new Map<string, number>();
  private readonly issued: string[] = [];
  private cursor = 0;

  forHeading(text: string): string {
    const base =
      text
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-+|-+$/g, "") || "h";
    const seen = this.used.get(base) ?? 0;
    this.used.set(base, seen + 1);
    const id = seen === 0 ? base : `${base}-${seen}`;
    this.issued.push(id);
    return id;
  }

  /** 正文渲染时按同样的顺序取回。 */
  take(_text: string): string {
    return this.issued[this.cursor++] ?? "h";
  }
}
