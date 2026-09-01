/**
 * 工具执行器的落盘与读取行为（M2，ADR-013）。
 *
 * 两条主线：
 *   1. **字节路径是唯一的写入路径** —— 文本写入也走它，所以护栏 / 上限 / 原子性
 *      不会因为新增第二个写入方而漏掉
 *   2. **读不出文本的文件不硬解** —— 与连接器同一条规矩（M3）：乱码的形状和正文
 *      一模一样，读的人分辨不出来
 */

import { strict as assert } from "node:assert";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { inflateRawSync } from "node:zlib";
import { join } from "node:path";
import test from "node:test";
import type { FolderGrant, ToolExecutionRequest } from "@vxture/ruyin-core";
import { LocalToolExecutor } from "./tool-executor.js";

const exec = new LocalToolExecutor();

function grantedDir(mode: "read" | "readwrite" = "readwrite"): {
  dir: string;
  grants: FolderGrant[];
} {
  const dir = mkdtempSync(join(tmpdir(), "ruyin-out-"));
  return {
    dir,
    grants: [
      { id: "g1", path: dir, mode, createdAt: "2026-08-31T00:00:00Z" },
    ],
  };
}

function call(
  tool: string,
  args: Record<string, unknown>,
  grants: FolderGrant[],
): ToolExecutionRequest {
  return { tool, arguments: args, workspace: "prj_1", taskId: "ti_1", grants };
}

void test("落盘：字节原样写入，不经 UTF-8 往返", async () => {
  const { dir, grants } = grantedDir();
  const out = join(dir, "deliverable.docx");
  // 0xff/0xfe 不是合法 UTF-8：若中间被当字符串处理过，必然损坏。
  const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0xfe, 0x7f]);

  const r = exec.writeArtifact(out, bytes, grants);
  assert.equal(r.isError, undefined);
  assert.deepEqual(new Uint8Array(readFileSync(out)), bytes);
});

void test("落盘：write_document 走同一条字节路径，文本行为不变", async () => {
  const { dir, grants } = grantedDir();
  const out = join(dir, "notes.md");

  const r = await exec.execute(
    call("write_document", { path: out, content: "# 方案\n三条" }, grants),
  );
  assert.equal(r.isError, undefined);
  assert.equal(readFileSync(out, "utf8"), "# 方案\n三条");
});

void test("落盘：写成功后不留暂存文件（原子改名，不是就地写）", async () => {
  const { dir, grants } = grantedDir();
  exec.writeArtifact(join(dir, "a.docx"), new Uint8Array([1, 2, 3]), grants);

  // 半个 .docx 不是短一点的文档，是打不开的文档，而它就摆在用户等成果的位置。
  const stray = readdirSync(dir).filter((f) => f.includes("partial"));
  assert.deepEqual(stray, []);
});

void test("落盘：写失败不留残骸", async () => {
  const { dir, grants } = grantedDir();
  // 目标是一个已存在且非空的目录 —— 改名到它必然失败。
  const target = join(dir, "occupied");
  mkdirSync(target);
  writeFileSync(join(target, "inside"), "x");

  const r = exec.writeArtifact(target, new Uint8Array([1]), grants);
  assert.equal(r.isError, true);
  assert.deepEqual(
    readdirSync(dir).filter((f) => f.includes("partial")),
    [],
  );
});

void test("落盘：授权目录之外一律拒绝，技能与模型同一条底线", async () => {
  const { grants } = grantedDir();
  const elsewhere = join(mkdtempSync(join(tmpdir(), "ruyin-other-")), "x.docx");

  const r = exec.writeArtifact(elsewhere, new Uint8Array([1]), grants);
  assert.equal(r.isError, true);
  assert.match(r.content, /outside every granted folder/);
  assert.equal(existsSync(elsewhere), false);
});

void test("落盘：只读授权不能写 —— 读的许可不是写的许可", async () => {
  const { dir, grants } = grantedDir("read");
  const out = join(dir, "x.docx");

  const r = exec.writeArtifact(out, new Uint8Array([1]), grants);
  assert.equal(r.isError, true);
  assert.match(r.content, /granted read-only/);
  assert.equal(existsSync(out), false);
});

void test("落盘：超过上限拒绝，且不落任何东西", async () => {
  const { dir, grants } = grantedDir();
  const out = join(dir, "huge.docx");

  const r = exec.writeArtifact(out, new Uint8Array(100 * 1024 * 1024 + 1), grants);
  assert.equal(r.isError, true);
  assert.match(r.content, /refusing to write/);
  assert.equal(existsSync(out), false);
});

void test("读取：非文本文件如实报错，不把乱码当正文交出去", async () => {
  const { dir, grants } = grantedDir();
  const pdf = join(dir, "t.pdf");
  writeFileSync(pdf, new Uint8Array([0x25, 0x50, 0x44, 0x46, 0xff, 0xfe]));

  const r = await exec.execute(call("read_file", { path: pdf }, grants));
  assert.equal(r.isError, true);
  assert.match(r.content, /not a text file/);
  // 关键：没有任何一段被 UTF-8 硬解出来的内容混进结果。
  assert.ok(!r.content.includes("�"));
});

void test("读取：文本文件照常读出", async () => {
  const { dir, grants } = grantedDir();
  const md = join(dir, "n.md");
  writeFileSync(md, "招标要点");

  const r = await exec.execute(call("read_file", { path: md }, grants));
  assert.equal(r.isError, undefined);
  assert.equal(r.content, "招标要点");
});

/** 解开 .docx 取 word/document.xml —— 只断言「有字节」等于什么都没断言。 */
function docPart(bytes: Buffer): string {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  assert.notEqual(eocd, -1, "没有中央目录 —— 这不是一个 zip");
  let p = v.getUint32(eocd + 16, true);
  for (let i = v.getUint16(eocd + 10, true); i > 0; i--) {
    const method = v.getUint16(p + 10, true);
    const comp = v.getUint32(p + 20, true);
    const nl = v.getUint16(p + 28, true);
    const el = v.getUint16(p + 30, true);
    const cl = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = bytes.subarray(p + 46, p + 46 + nl).toString("utf8");
    if (name === "word/document.xml") {
      const at =
        local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
      const raw = bytes.subarray(at, at + comp);
      return (method === 0 ? raw : inflateRawSync(raw)).toString("utf8");
    }
    p += 46 + nl + el + cl;
  }
  throw new Error(".docx 里没有 word/document.xml");
}

/**
 * 导出（TD-019 / ADR-016）。
 *
 * 契约一直声明着 export_result，宿主一直没实现它，于是 toolOffers 把它安静地
 * 摘掉，export_deliverable 任务没有任何办法达成目标。这一组用例钉住的是它现在
 * 真的能达成，以及它在什么情况下必须拒绝。
 */

void test("导出：按路径汇总多份 Markdown，产出真能打开的 .docx", async () => {
  const { dir, grants } = grantedDir();
  writeFileSync(join(dir, "a.md"), "# 技术方案\n\n第一部分\n", "utf8");
  writeFileSync(join(dir, "b.md"), "::ry-pagebreak\n\n## 附录\n\n第二部分\n", "utf8");
  const out = join(dir, "投标成果.docx");

  const r = await exec.execute(
    call(
      "export_result",
      { path: out, format: "docx", sources: [join(dir, "a.md"), join(dir, "b.md")] },
      grants,
    ),
  );
  assert.equal(r.isError, undefined, r.content);

  const bytes = readFileSync(out);
  assert.equal(bytes[0], 0x50, "不是 zip —— 那就不是 .docx");
  assert.ok(bytes.byteLength > 1000);
  // 两份都进去了，而且是按给定顺序 —— 顺序由模型定，运行时不许自作主张。
  const xml = docPart(bytes);
  assert.ok(xml.indexOf("第一部分") < xml.indexOf("第二部分"));
  assert.match(xml, /<w:br w:type="page"/);
});

void test("导出：正文里有渲染不了的东西，宁可失败也不交半份成品", async () => {
  const { dir, grants } = grantedDir();
  writeFileSync(join(dir, "a.md"), "# 方案\n\n![架构图](arch.png)\n", "utf8");
  const out = join(dir, "x.docx");

  const r = await exec.execute(
    call("export_result", { path: out, format: "docx", sources: [join(dir, "a.md")] }, grants),
  );
  assert.equal(r.isError, true);
  assert.match(r.content, /第 3 行/);
  assert.equal(existsSync(out), false, "拒绝了却还是落了盘 —— 那这次拒绝没有意义");
});

void test("导出：未授权目录里的来源读不到", async () => {
  const { dir, grants } = grantedDir();
  const outside = mkdtempSync(join(tmpdir(), "ruyin-nope-"));
  writeFileSync(join(outside, "secret.md"), "# 别人的资料\n", "utf8");

  const r = await exec.execute(
    call(
      "export_result",
      { path: join(dir, "x.docx"), format: "docx", sources: [join(outside, "secret.md")] },
      grants,
    ),
  );
  assert.equal(r.isError, true);
  assert.match(r.content, /outside every granted folder/);
});

void test("导出：渲染不出来的格式当场说清，而不是给一个名字对内容不对的文件", async () => {
  const { dir, grants } = grantedDir();
  writeFileSync(join(dir, "a.md"), "# 方案\n", "utf8");
  const out = join(dir, "x.pdf");

  const r = await exec.execute(
    call("export_result", { path: out, format: "pdf", sources: [join(dir, "a.md")] }, grants),
  );
  assert.equal(r.isError, true);
  assert.match(r.content, /does not render "pdf"/);
  assert.equal(existsSync(out), false);
});

void test("导出：来源不是 Markdown 就直说，不硬当文本解", async () => {
  const { dir, grants } = grantedDir();
  writeFileSync(join(dir, "old.docx"), Buffer.from([0x50, 0x4b, 0x03, 0x04]));

  const r = await exec.execute(
    call(
      "export_result",
      { path: join(dir, "x.docx"), format: "docx", sources: [join(dir, "old.docx")] },
      grants,
    ),
  );
  assert.equal(r.isError, true);
  assert.match(r.content, /not a Markdown source/);
});

void test("导出：只降级不丢内容时照常出成品，但把降级说出来", async () => {
  const { dir, grants } = grantedDir();
  writeFileSync(join(dir, "a.md"), "::ry-toc{style=fancy}\n\n# 方案\n", "utf8");
  const out = join(dir, "x.docx");

  const r = await exec.execute(
    call("export_result", { path: out, format: "docx", sources: [join(dir, "a.md")] }, grants),
  );
  assert.equal(r.isError, undefined, r.content);
  assert.ok(existsSync(out));
  assert.match(r.content, /reservations/);
  assert.match(r.content, /style/);
});

void test("导出：export_result 现在真的在工具面上", () => {
  assert.equal(exec.supports("export_result"), true);
});
