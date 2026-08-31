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
