/**
 * mdast -> .docx。**确定性转换，不需要模型** —— 这正是 ADR-013 把渲染划归技能
 * （归本仓）、把解析划归模型能力（归 Atlas）的那条分界线。
 *
 * 同构：用 `Packer.toArrayBuffer` 而不是 Node 的 Buffer，这样 Cloud Runtime 能
 * 直接复用同一份渲染器，不必各写一遍。
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  PageBreak,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
  convertInchesToTwip,
} from "docx";
import type { IParagraphOptions, ParagraphChild } from "docx";
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
import {
  describeDiagnostics,
  isLossy,
  isRyDirective,
  type Diagnostic,
  type RuyinDocument,
} from "./document.js";

export interface RenderOptions {
  /** 文档标题，写进 .docx 的元数据。 */
  title?: string;
}

/**
 * 有内容到不了成品时抛出。
 *
 * 渲染宁可失败，也不交一份「少了点东西」的成品：调用方拿到的是带行号的具体
 * 原因，改一版重来的代价是一个回合；而一份悄悄少了图表的标书，代价是这次投标。
 */
export class DocumentLossError extends Error {
  readonly diagnostics: Diagnostic[];
  constructor(diagnostics: Diagnostic[]) {
    super(`文档里有渲染器表达不了的内容：\n${describeDiagnostics(diagnostics)}`);
    this.name = "DocumentLossError";
    this.diagnostics = diagnostics;
  }
}

const ORDERED = "ry-ordered";
const MONO = "Consolas";
/**
 * 正文字体：西文与中文分开指定，否则中文会落到西文字体的兜底字形上。
 * `hAnsi` 不能省 —— Word 用它排高位西文，只给 `ascii` 会让那部分字符换字体。
 */
const BODY_FONT = {
  ascii: "Calibri",
  hAnsi: "Calibri",
  eastAsia: "Microsoft YaHei",
};

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const;

export async function renderDocx(
  doc: RuyinDocument,
  options: RenderOptions = {},
): Promise<Uint8Array> {
  if (isLossy(doc.diagnostics)) throw new DocumentLossError(doc.diagnostics);

  const body: Array<Paragraph | Table> = [];
  for (const node of doc.root.children) body.push(...block(node, 0));

  const file = new Document({
    title: options.title,
    styles: { default: { document: { run: { font: BODY_FONT, size: 22 } } } },
    numbering: {
      config: [
        {
          reference: ORDERED,
          levels: [0, 1, 2, 3, 4].map((level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: indentFor(level) },
          })),
        },
      ],
    },
    // 空文档也要给一个段落：body 完全为空的 .docx 在部分阅读器里打不开。
    sections: [{ children: body.length ? body : [new Paragraph({})] }],
  });
  return new Uint8Array(await Packer.toArrayBuffer(file));
}

function block(node: RootContent, depth: number): Array<Paragraph | Table> {
  switch (node.type) {
    case "heading":
      return [heading(node)];
    case "paragraph":
      return [new Paragraph({ children: inline(node.children) })];
    case "list":
      return list(node, depth);
    case "table":
      return [table(node)];
    case "blockquote":
      return quote(node);
    case "code":
      return code(node);
    case "thematicBreak":
      return [
        new Paragraph({
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 6, color: "AAAAAA" },
          },
        }),
      ];
    case "leafDirective":
      return directive(node);
    default:
      // 到不了这里：parseDocument 已把表达不了的节点报成 lossy，而 lossy 会让
      // 渲染在最上面就抛出。这里返回空数组而不是抛异常，是因为这条分支若真被
      // 走到，说明诊断表和渲染表脱了节 —— 那是缺陷，用例会抓，不是运行时异常。
      return [];
  }
}

function heading(node: Heading): Paragraph {
  return new Paragraph({
    heading: HEADINGS[Math.min(node.depth, 6) - 1],
    children: inline(node.children),
  });
}

function list(node: List, depth: number): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = [];
  const level = Math.min(depth, 4);
  for (const item of node.children as ListItem[]) {
    let first = true;
    for (const child of item.children) {
      if (child.type === "list") {
        out.push(...list(child, depth + 1));
        continue;
      }
      if (child.type === "paragraph" && first) {
        const marker: Partial<IParagraphOptions> = node.ordered
          ? { numbering: { reference: ORDERED, level } }
          : { bullet: { level } };
        out.push(new Paragraph({ ...marker, children: inline(child.children) }));
        first = false;
        continue;
      }
      out.push(...block(child, depth + 1));
    }
  }
  return out;
}

/**
 * 引用块用左边线 + 缩进表达，不用斜体：中文的斜体是把字形硬拉斜，几乎不可读。
 */
function quote(node: Blockquote): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = [];
  for (const child of node.children) {
    for (const rendered of block(child, 0)) {
      out.push(
        child.type === "paragraph"
          ? new Paragraph({
              ...QUOTE_FRAME,
              children: inline(child.children),
            })
          : rendered,
      );
    }
  }
  return out;
}

const QUOTE_FRAME: Partial<IParagraphOptions> = {
  indent: { left: convertInchesToTwip(0.35) },
  border: {
    left: { style: BorderStyle.SINGLE, size: 12, color: "BBBBBB", space: 12 },
  },
};

function code(node: Code): Paragraph[] {
  // 一行一个段落：Word 的段落不保留换行，整块塞进一个段落会连成一长行。
  return node.value.split("\n").map(
    (line) =>
      new Paragraph({
        shading: { fill: "F4F4F4" },
        indent: { left: convertInchesToTwip(0.2) },
        children: [new TextRun({ text: line || " ", font: MONO, size: 20 })],
      }),
  );
}

function table(node: MdTable): Table {
  const rows = node.children.map(
    (row, index) =>
      new TableRow({
        children: row.children.map(
          (cell) =>
            new TableCell({
              children: [new Paragraph({ children: inline(cell.children) })],
            }),
        ),
        tableHeader: index === 0,
      }),
  );
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

function directive(node: {
  name?: string;
  attributes?: Record<string, string | null | undefined> | null | undefined;
}): Array<Paragraph | Table> {
  const name = node.name ?? "";
  if (!isRyDirective(name)) return [];
  if (name === "ry-pagebreak") {
    return [new Paragraph({ children: [new PageBreak()] })];
  }
  const attrs = node.attributes ?? {};
  const title = attrs["title"] ?? "目录";
  // Word 的 TOC 域：页码由 Word 打开文档时自己算。运行时要算页码就得先排版，
  // 而排版是 Word 的事 —— 自己算等于猜。
  return [
    new TableOfContents(title, {
      hyperlink: true,
      headingStyleRange: `1-${clampDepth(attrs["depth"])}`,
    }),
  ];
}

function clampDepth(raw: unknown): number {
  const n = Number.parseInt(String(raw ?? "3"), 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), 6) : 3;
}

function indentFor(level: number): IParagraphOptions {
  return {
    indent: {
      left: convertInchesToTwip(0.25 * (level + 1)),
      hanging: convertInchesToTwip(0.2),
    },
  };
}

function inline(nodes: readonly PhrasingContent[]): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const node of nodes) out.push(...phrase(node, {}));
  return out;
}

interface Format {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
}

function phrase(node: PhrasingContent, format: Format): ParagraphChild[] {
  switch (node.type) {
    case "text":
      return [new TextRun({ text: node.value, ...format })];
    case "strong":
      return node.children.flatMap((c) => phrase(c, { ...format, bold: true }));
    case "emphasis":
      return node.children.flatMap((c) =>
        phrase(c, { ...format, italics: true }),
      );
    case "delete":
      return node.children.flatMap((c) => phrase(c, { ...format, strike: true }));
    case "inlineCode":
      return [new TextRun({ text: node.value, font: MONO, ...format })];
    case "break":
      return [new TextRun({ text: "", break: 1 })];
    case "link":
      return [
        new ExternalHyperlink({
          link: node.url,
          children: [
            new TextRun({ text: nodeText(node), style: "Hyperlink", ...format }),
          ],
        }),
      ];
    default:
      return [new TextRun({ text: nodeText(node), ...format })];
  }
}
