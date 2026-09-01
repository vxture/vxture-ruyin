import assert from "node:assert/strict";
import test from "node:test";
import { inflateRawSync } from "node:zlib";

import {
  DocumentLossError,
  isLossy,
  parseDocument,
  renderDocx,
} from "./index.js";

/**
 * 把 .docx 解开读 XML。
 *
 * 断言「产出了一些字节」等于什么都没断言 —— 一份打不开的 .docx 同样是一堆
 * 字节。所以这里真的走一遍 ZIP 中央目录、解压 `word/document.xml`，对里面的
 * OOXML 下断言。中央目录而不是本地头：本地头在带数据描述符时长度字段是 0。
 */
function unzip(bytes: Uint8Array, name: string): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  assert.notEqual(eocd, -1, "没有找到 ZIP 中央目录 —— 这不是一个 zip");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(p, true), 0x02014b50);
    const method = view.getUint16(p + 10, true);
    const compressed = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const entry = Buffer.from(
      bytes.subarray(p + 46, p + 46 + nameLen),
    ).toString("utf8");
    if (entry === name) {
      const dataAt =
        local +
        30 +
        view.getUint16(local + 26, true) +
        view.getUint16(local + 28, true);
      const raw = bytes.subarray(dataAt, dataAt + compressed);
      const out = method === 0 ? Buffer.from(raw) : inflateRawSync(raw);
      return out.toString("utf8");
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`.docx 里没有 ${name}`);
}

void test("解析：表达不了的内容报成 lossy，带行号", () => {
  const doc = parseDocument("# 标题\n\n正文\n\n![图](chart.png)\n");
  assert.equal(isLossy(doc.diagnostics), true);
  const d = doc.diagnostics.find((x) => x.message.includes("image"));
  assert.ok(d, "图片没有被报出来 —— 那它就会从成品里悄悄消失");
  assert.equal(d.line, 5);
  assert.match(d.message, /上下文通路/);
});

/**
 * 这条是本文件里最重要的一条。
 *
 * `::ry:pagebreak` 用冒号分隔时，remark **不报错**：它安静地变成一个普通段落，
 * 于是这行字会以字面文本印进标书正文，而模型要的分页根本没发生。写对与写错
 * 之间没有任何反馈 —— 除非有人把这份沉默变成响声。
 */
void test("解析：看着像指令却没被当成指令的行，必须报出来", () => {
  const doc = parseDocument("第一页\n\n::ry:pagebreak\n\n第二页\n");
  const d = doc.diagnostics.find((x) => x.line === 3);
  assert.ok(d, "冒号写法被静默当成正文 —— 这正是要抓的那种沉默");
  assert.equal(d.severity, "lossy");
  assert.match(d.message, /连字符/);
});

void test("解析：未知指令是丢内容，未知属性只是降级", () => {
  const unknown = parseDocument("::ry-signature\n");
  assert.equal(isLossy(unknown.diagnostics), true);

  const attr = parseDocument("::ry-toc{depth=2 style=fancy}\n");
  assert.equal(isLossy(attr.diagnostics), false, "属性写错不该挡住整篇渲染");
  assert.equal(attr.diagnostics.length, 1);
  assert.equal(attr.diagnostics[0]?.severity, "degraded");
});

void test("渲染：有内容到不了成品就失败，并说清哪一行", async () => {
  const doc = parseDocument("# 标题\n\n![图](chart.png)\n");
  await assert.rejects(
    () => renderDocx(doc),
    (error: unknown) => {
      assert.ok(error instanceof DocumentLossError);
      assert.match(error.message, /第 3 行/);
      return true;
    },
    "宁可失败也不交一份悄悄少了图的标书",
  );
});

void test("渲染：只有降级诊断时照常出成品", async () => {
  const doc = parseDocument("# 标题\n\n::ry-toc{style=fancy}\n");
  const bytes = await renderDocx(doc);
  assert.ok(bytes.byteLength > 0);
});

void test("渲染：产出的是真能打开的 .docx，而且每种构件都进了 XML", async () => {
  const markdown = [
    "::ry-toc{depth=2 title=目录}",
    "",
    "# 技术方案",
    "",
    "本方案**满足**全部~~部分~~需求，见 [附件](https://example.com/a)。",
    "",
    "## 需求覆盖",
    "",
    "1. 第一条",
    "2. 第二条",
    "   - 子项",
    "",
    "| 需求 | 覆盖 |",
    "| --- | --- |",
    "| R1 | 是 |",
    "",
    "> 甲方要求原文",
    "",
    "```json",
    '{ "a": 1 }',
    "```",
    "",
    "---",
    "",
    "::ry-pagebreak",
    "",
    "## 附录",
  ].join("\n");

  const doc = parseDocument(markdown);
  assert.deepEqual(doc.diagnostics, [], "这篇里不该有任何诊断");

  const bytes = await renderDocx(doc, { title: "技术方案" });
  assert.equal(bytes[0], 0x50, "不是以 PK 开头 —— 不是 zip");
  const xml = unzip(bytes, "word/document.xml");

  // 逐个构件对 OOXML 下断言：渲染表若和诊断表脱节，某一条会在这里断掉。
  const expectations: Array<[string, string | RegExp]> = [
    ["目录域", /<w:instrText[^>]*>TOC .*?\\o/],
    ["一级标题", /w:val="Heading1"/],
    ["二级标题", /w:val="Heading2"/],
    ["正文", "技术方案"],
    ["加粗", /<w:b\b/],
    ["删除线", /<w:strike\b/],
    ["超链接", /<w:hyperlink/],
    ["有序列表编号", /<w:numPr>/],
    ["表格", /<w:tbl>/],
    ["表头行", /<w:tblHeader/],
    ["引用块左边线", /<w:pBdr>/],
    ["代码块底纹", /w:fill="F4F4F4"/],
    ["分页", /<w:br w:type="page"/],
  ];
  for (const [what, pattern] of expectations) {
    const hit =
      typeof pattern === "string" ? xml.includes(pattern) : pattern.test(xml);
    assert.ok(hit, `${what} 没有出现在 word/document.xml 里`);
  }

  // 链接文字必须在，否则读者拿到的是一个没有锚文本的链接。
  assert.ok(unzip(bytes, "word/_rels/document.xml.rels").includes("example.com"));

  // 中文字体落在 styles.xml 的 docDefaults 上。少了 eastAsia，一篇中文标书
  // 会用西文字体的兜底字形排版 —— 打得开，但没法交。
  const styles = unzip(bytes, "word/styles.xml");
  assert.match(styles, /w:eastAsia="Microsoft YaHei"/);
  assert.match(styles, /w:hAnsi="Calibri"/);
});

void test("渲染：空文档也要能打开", async () => {
  const bytes = await renderDocx(parseDocument(""));
  assert.match(unzip(bytes, "word/document.xml"), /<w:body>/);
});
