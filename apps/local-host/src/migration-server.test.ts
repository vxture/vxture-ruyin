import assert from "node:assert/strict";
import { test } from "node:test";
import { startMigrationServer, stopMigrationServer } from "./migration-server.js";

const status = () => ({
  phase: "copy" as const,
  copiedBytes: 40,
  totalBytes: 100,
  from: "C:/old",
  to: "D:/new",
});

void test("搬家期间的小服务：/health 说自己在搬，/migration 报进度", async () => {
  const server = await startMigrationServer(17931, "t0k", status);
  try {
    const health = await (await fetch("http://127.0.0.1:17931/health")).json();
    // 壳先看这一条判断「有没有人在」，所以它不校验令牌 —— 与正式服务同口径。
    assert.deepEqual(health, { ok: true, state: "migrating" });

    const prog = await (
      await fetch("http://127.0.0.1:17931/migration", {
        headers: { authorization: "Bearer t0k" },
      })
    ).json();
    assert.deepEqual(prog, status());
  } finally {
    await stopMigrationServer(server);
  }
});

void test("搬家期间的小服务：进度要令牌；别的路一律 503，不假装能答", async () => {
  const server = await startMigrationServer(17932, "t0k", status);
  try {
    const noToken = await fetch("http://127.0.0.1:17932/migration");
    assert.equal(noToken.status, 401);

    // 这一刻库还没开、密钥还没解 —— 任何别的回答都会是假的。
    for (const path of ["/system", "/projects", "/"]) {
      const r = await fetch(`http://127.0.0.1:17932${path}`);
      assert.equal(r.status, 503, path);
      assert.equal(((await r.json()) as { code: string }).code, "MIGRATING");
    }
  } finally {
    await stopMigrationServer(server);
  }
});

void test("搬家期间的小服务：关掉之后端口要真的空出来 —— 正式服务紧接着要用它", async () => {
  const first = await startMigrationServer(17933, "t0k", status);
  await stopMigrationServer(first);
  // 关不干净的话这一步会 EADDRINUSE。
  const second = await startMigrationServer(17933, "t0k", status);
  await stopMigrationServer(second);
});

void test("搬家**进行中**就能被问到进度 —— 这条是那个进度条能不能成立的全部前提", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { performMove } = await import("./data-location.js");

  const root = mkdtempSync(join(tmpdir(), "ruyin-mid-move-"));
  const src = join(root, "data");
  mkdirSync(join(src, "runtime"), { recursive: true });
  writeFileSync(join(src, "runtime", "master.key.dpapi"), "KEY");
  mkdirSync(join(src, "projects", "prj_1"), { recursive: true });
  // 十几个文件就够：判据是「搬到一半时问得到」，不是「搬得久」。
  for (let i = 0; i < 12; i++) {
    writeFileSync(join(src, "projects", "prj_1", `chunk${i}.bin`), Buffer.alloc(64 * 1024, i));
  }

  let progress = {
    phase: "copy" as "copy" | "verify",
    copiedBytes: 0,
    totalBytes: 0,
    from: src,
    to: join(root, "moved"),
  };
  const server = await startMigrationServer(17934, "tk", () => progress);
  const midFlight: unknown[] = [];
  try {
    const out = await performMove(src, join(root, "moved"), "copy", async (p) => {
      progress = { ...progress, ...p };
      // **搬到一半时**去问一次。同步复制的年代这里永远超时 —— 事件循环被整段
      // 占住，服务在那儿也轮不到（2026-09-05 实测：3 GB 搬移期间端点一次都没
      // 答上话）。这就是为什么复制与核对都改成了异步。
      if (midFlight.length < 2) {
        const r = await fetch("http://127.0.0.1:17934/migration", {
          headers: { authorization: "Bearer tk" },
        });
        midFlight.push(await r.json());
      }
    });
    assert.equal(out.status, "moved", out.reason);
  } finally {
    await stopMigrationServer(server);
  }

  assert.equal(midFlight.length, 2, "搬家进行中该能问到两次");
  for (const answer of midFlight) {
    const a = answer as { phase: string; copiedBytes: number; totalBytes: number };
    assert.ok(["copy", "verify"].includes(a.phase), a.phase);
    assert.ok(a.copiedBytes > 0, "问到的是真在动的数字，不是零");
    assert.ok(a.copiedBytes <= a.totalBytes);
  }
});
