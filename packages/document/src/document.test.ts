import assert from "node:assert/strict";
import test from "node:test";
import { inflateRawSync } from "node:zlib";

import {
  DocumentLossError,
  isLossy,
  parseDocument,
  renderDocx,
  renderHtml,
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

void test("解析：三冒号写成了容器指令，报出来该写两冒号", () => {
  const doc = parseDocument(":::ry-toc\n:::\n");
  assert.equal(isLossy(doc.diagnostics), true);
  assert.match(doc.diagnostics[0]?.message ?? "", /要写成 ::ry-toc，不是 :::ry-toc/);
});

void test("解析：行内指令（正文中间的单冒号）暂不支持，报出来不是悄悄丢字", () => {
  const doc = parseDocument("正文中间 :ry-toc 这里还有字\n");
  assert.equal(isLossy(doc.diagnostics), true);
  assert.match(doc.diagnostics[0]?.message ?? "", /行内指令暂不支持/);
});

void test("解析：正文里的原始 HTML、脚注、引用式链接都表达不了，各自报清楚原因", () => {
  const html = parseDocument("正文\n\n<div>x</div>\n");
  assert.match(html.diagnostics[0]?.message ?? "", /HTML 不会被渲染/);

  const footnote = parseDocument("正文[^1]\n\n[^1]: 脚注内容\n");
  assert.equal(footnote.diagnostics.length, 2, "引用处和定义处都要各报一条");
  assert.match(footnote.diagnostics[0]?.message ?? "", /脚注暂不支持/);
  assert.match(footnote.diagnostics[1]?.message ?? "", /脚注暂不支持/);

  const ref = parseDocument("见 [文字][ref]。\n\n[ref]: https://example.com\n");
  assert.equal(ref.diagnostics.length, 2);
  assert.match(ref.diagnostics[0]?.message ?? "", /引用式链接暂不支持/);
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

  // 超链接的地址落在 rels 里，且必须标成外部链接 —— 少了 TargetMode，Word 会
  // 把它当成包内相对路径，点开是一个找不到的文件。整份 rels 里「出现过这个
  // 域名」不算数：断言要钉到这一条关系上。
  assert.match(
    unzip(bytes, "word/_rels/document.xml.rels"),
    /Target="https:\/\/example\.com\/a" TargetMode="External"/,
  );

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

/**
 * HTML 渲染（ADR-017 的中间态）。这份 HTML 会被送进一个 BrowserWindow，所以
 * 最要紧的一条是：**模型写的字进不去执行位置**。
 */
void test("HTML：模型写的字全部转义，不给它变成标记的机会", () => {
  const doc = parseDocument(
    "# <script>alert(1)</script>\n\n" +
      "正文里也有 <img onerror=x> 和 `<b>代码</b>`。\n",
  );
  // 正文里的原始 HTML 在解析层就被判 lossy，所以这些尖括号只会以文本存在。
  const { html } = renderHtml(doc);
  assert.ok(!html.includes("<script>"), "转义漏了 —— 这是最不该漏的一处");
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img onerror=x&gt;/);
});

void test("HTML：只放行 http/https/mailto/锚点的链接", () => {
  const { html } = renderHtml(
    parseDocument(
      "[正常](https://example.com/a) 与 [伪协议](javascript:alert(1))\n",
    ),
  );
  assert.match(html, /<a href="https:\/\/example\.com\/a">正常<\/a>/);
  // 伪协议降级为纯文本：在 PDF 里它同样是可点的，而链接文字是模型写的。
  assert.ok(!/javascript:/i.test(html), "伪协议进了 href");
  assert.match(html, /伪协议/);
});

void test("HTML：分页与目录，目录没有页码这件事要说出来", () => {
  const doc = parseDocument(
    "::ry-toc{depth=2}\n\n# 一\n\n::ry-pagebreak\n\n## 二\n\n### 三\n",
  );
  const { html, notes } = renderHtml(doc);
  assert.match(html, /class="ry-pagebreak"/);
  // depth=2：三级标题不进目录。
  assert.match(html, /<a href="#一">一<\/a>/);
  assert.match(html, /<a href="#二">二<\/a>/);
  assert.ok(!html.includes(">三</a>"), "depth 没起作用");
  // 目录项指向的锚点必须真的存在于正文标题上。
  assert.match(html, /<h1 id="一">/);
  assert.match(html, /<h2 id="二">/);

  const note = notes.find((n) => n.message.includes("页码"));
  assert.ok(note, "PDF 目录没页码是降级，不说出来读的人会以为本来就长这样");
  assert.equal(note.severity, "degraded");
});

void test("HTML：同名标题的锚点不互相抢", () => {
  const { html } = renderHtml(parseDocument("::ry-toc\n\n# 概述\n\n# 概述\n"));
  assert.match(html, /<h1 id="概述">/);
  assert.match(html, /<h1 id="概述-1">/);
  assert.match(html, /href="#概述"/);
  assert.match(html, /href="#概述-1"/);
});

/**
 * 上面「每种构件都进了 XML」那条钉的是 docx，从没在 HTML 侧走过 list()/
 * table() ——两个渲染器各自实现，各自的分支各自可能错。这条同一棵树、两条
 * 渲染路径都走：嵌套列表、多子项条目（段落不该被省略 <p>）、引用块里套非
 * 段落子节点、多行代码块（含空行）、斜体/行内码/换行——docx 那条大用例里都
 * 没出现过。
 */
const KITCHEN_SINK_2 = [
  "# 标题",
  "",
  "*斜体* `行内码` 断行示例第一行  ",
  "断行示例第二行",
  "",
  "1. 一级条目",
  "   - 二级子项 A",
  "   - 二级子项 B",
  "2. 一级条目二",
  "",
  "| 需求 | 覆盖 |",
  "| --- | --- |",
  "| R1 | 是 |",
  "",
  "> 引用里有一个列表：",
  ">",
  "> - 引用列表项",
  "",
  "```",
  "line1",
  "",
  "line3",
  "```",
].join("\n");

void test("HTML：列表(嵌套/多子项)、表格、引用套列表、多行代码块、斜体/行内码/换行", () => {
  const doc = parseDocument(KITCHEN_SINK_2);
  assert.deepEqual(doc.diagnostics, [], "这篇里不该有任何诊断");
  const { html } = renderHtml(doc);

  assert.match(html, /<em>斜体<\/em>/);
  assert.match(html, /<code>行内码<\/code>/);
  assert.match(html, /第一行<br>断行示例第二行/, "硬换行没有变成 <br>");

  // 多子项条目：段落不该被 list() 的单段落优化省掉 <p>。
  assert.match(html, /<li><p>一级条目<\/p><ul>/, "多子项条目的段落被误省了 <p>");
  assert.match(html, /<ul><li>二级子项 A<\/li><li>二级子项 B<\/li><\/ul>/);
  // 单子项条目：不该多出一层 <p>。
  assert.match(html, /<li>一级条目二<\/li>/);

  assert.match(html, /<table><thead><tr><th>需求<\/th><th>覆盖<\/th><\/tr><\/thead>/);
  assert.match(html, /<tbody><tr><td>R1<\/td><td>是<\/td><\/tr><\/tbody>/);

  assert.match(html, /<blockquote><p>引用里有一个列表：<\/p><ul><li>引用列表项<\/li><\/ul><\/blockquote>/);

  // 代码块里的空行原样保留，不是被 split 悄悄吃掉。
  assert.match(html, /<pre><code>line1\n\nline3<\/code><\/pre>/);
});

void test(".docx：同一棵树里 HTML 用例覆盖、docx 那条大用例没走到的分支", async () => {
  const doc = parseDocument(KITCHEN_SINK_2);
  const bytes = await renderDocx(doc, { title: "kitchen sink 2" });
  const xml = unzip(bytes, "word/document.xml");

  assert.match(xml, /<w:i\/>/, "斜体没有进 XML");
  assert.match(xml, /w:ascii="Consolas"/, "行内码没有用等宽字体");
  assert.match(xml, /<w:br\/>/, "硬换行没有进 XML（w:br 不带 type，区别于分页的 w:br type=page）");

  // 引用块里的非段落子节点（这里是列表）：quote() 的三元分支走的是「原样
  // 透传」那一半，不是 QUOTE_FRAME 的左边线段落。混进段落框会在 Word 里
  // 把列表项也画上引用的左边线，读起来像是甲方原文的一部分。
  const listItemParagraph =
    /<w:p>(?:(?!<\/w:p>)[\s\S])*?引用列表项(?:(?!<w:p>)[\s\S])*?<\/w:p>/.exec(xml)?.[0] ?? "";
  assert.match(listItemParagraph, /<w:numPr>/, "引用里的列表项没有列表编号");
  assert.ok(
    !listItemParagraph.includes("<w:pBdr"),
    "引用块里的列表项被套进了引用的左边线段落，不是原样透传",
  );

  // 多行代码块：空行必须还是一个独立段落（用一个不可见空格撑开），不能被
  // split("\n") 悄悄吞掉，否则一份贴出来的代码会在 Word 里少一行。
  const codeParagraphs = [...xml.matchAll(/w:fill="F4F4F4"/g)];
  assert.ok(codeParagraphs.length >= 3, "多行代码块的空行段落被吞了");
});

void test("HTML：@page 的 margin 有白名单，不是任意字符串直接拼进 <style>", () => {
  const doc = parseDocument("正文\n");
  const injected = renderHtml(doc, {
    margin: "20mm; } body { display:none } /* ",
  }).html;
  // 不匹配白名单一律退回默认值，而不是把这串字符原样送进 CSS。
  assert.match(injected, /@page \{ size: A4; margin: 20mm; \}/);
  assert.ok(!injected.includes("display:none"));

  const custom = renderHtml(doc, { margin: "15mm" }).html;
  assert.match(custom, /@page \{ size: A4; margin: 15mm; \}/);
});

void test("HTML：标题选项也转义，不止正文", () => {
  const html = renderHtml(parseDocument("正文\n"), {
    title: '</title><script>alert(1)</script>',
  }).html;
  assert.ok(!html.includes("<script>"));
  assert.match(html, /<title>&lt;\/title&gt;&lt;script&gt;/);
});

void test("HTML：目录深度以下没有任何标题时，给一个空目录而不是报错或漏报降级说明", () => {
  const { html, notes } = renderHtml(
    parseDocument("::ry-toc{depth=1}\n\n## 只有二级标题\n"),
  );
  assert.match(html, /<ol><\/ol>/, "深度筛完为空时应该是空列表，不是漏渲染整个 nav");
  assert.ok(notes.some((n) => n.message.includes("页码")), "空目录也该说清没有页码这回事");
});

void test("HTML：::ry-toc 的 depth 缺省是 3，越界的会被夹到 1..6", () => {
  const withDefault = renderHtml(
    parseDocument("::ry-toc\n\n# 一\n\n#### 四级\n"),
  ).html;
  assert.match(withDefault, /href="#一"/);
  // 标题本身总会渲染在正文里，能不能进目录只看这个链接存不存在。
  assert.ok(!withDefault.includes('<a href="#四级'), "缺省深度不是 3");

  const clamped = renderHtml(
    parseDocument("::ry-toc{depth=99}\n\n###### 六级\n"),
  ).html;
  assert.match(clamped, /<a href="#六级/, "depth 超界没有被夹到 6");
});
