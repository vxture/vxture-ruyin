/**
 * 索引重建的上限（TD-046）。
 *
 * `reindexBinding` 把每一条的**完整内容**读进内存再一次性写库。绑一个装着几万份
 * 文件、或者几个 GB 文本的目录（一个真实的共享盘就长这样），会让守护进程把它们
 * 同时攒在内存里 —— 而这发生在用户点「绑定目录」之后的几秒内，他不会把卡顿和那
 * 次点击联系起来。
 *
 * 这里问三件事：条数上限管不管用、字节上限管不管用、以及**跳过了多少说不说得
 * 出来**。第三件是判据点名的那一半：只回一个「索引了 5000 条」时，「一万份里索
 * 引了五千份」和「这里就只有五千份」是同一个数字，而前者意味着用户之后搜不到的
 * 东西其实在那儿。
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Binding, ConnectorPort, ContextItemMeta } from "@vxture/ruyin-core";
import { KeyManager } from "./keys.js";
import { SqliteStoragePort } from "./storage.js";
import { reindexBinding } from "./fts.js";
import { DEFAULT_RESOURCE_LIMITS } from "./resource-limits.js";

const BINDING: Binding = {
  type: "enterprise_capability",
  source: "local",
  connector: "local-fs",
  root: "C:/work",
};

/** n 条候选，每条 `bytes` 字节。读到哪几条会被记下来 —— 上限的关键是**没读**。 */
function fakeConnector(n: number, bytes: number): ConnectorPort & { read_: string[] } {
  const read_: string[] = [];
  const metas: ContextItemMeta[] = Array.from({ length: n }, (_, i) => ({
    id: `itm_${i}`,
    name: `doc-${i}.md`,
    type: BINDING.type,
    source: "local",
    connector: "local-fs",
    ref: `C:/work/doc-${i}.md`,
    bytes,
    modifiedAt: "2026-09-01T00:00:00Z",
  }));
  return {
    read_,
    discover: async () => metas,
    read: async (meta: ContextItemMeta) => {
      read_.push(meta.id);
      return { ...meta, content: { kind: "text" as const, text: "储能案例" } };
    },
  } as unknown as ConnectorPort & { read_: string[] };
}

async function fixture(): Promise<{
  storage: SqliteStoragePort;
  projectId: string;
  cleanup: () => void;
}> {
  const dataDir = mkdtempSync(join(tmpdir(), "ruyin-reindex-"));
  const storage = new SqliteStoragePort(dataDir, await KeyManager.open(dataDir));
  const projectId = "prj_limits";
  await storage.createProjectStore(projectId);
  return {
    storage,
    projectId,
    cleanup: () => {
      // 先关库再删目录：Windows 上一个开着的 SQLite 文件会让 rmSync 直接 EPERM。
      storage.closeAll();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

test("索引：条数上限拦住多余的，并报出跳过了几条", async () => {
  const { storage, projectId, cleanup } = await fixture();
  const connector = fakeConnector(20, 10);
  const out = await reindexBinding(storage, projectId, BINDING, connector, {
    maxIndexItems: 5,
    maxIndexBytes: DEFAULT_RESOURCE_LIMITS.maxIndexBytes,
  });
  assert.equal(out.indexed, 5);
  assert.equal(out.skipped, 15, "跳过多少要说得出 —— 否则用户以为这里就只有 5 条");
  assert.equal(out.stoppedBy, "items");
  // 关键在**没读**：读完再判断的话，那 15 条已经在内存里了。
  assert.equal(connector.read_.length, 5);
  cleanup();
});

test("索引：字节上限拦住多余的 —— 一万份便签和十份镜像是两种超法，只管条数会漏掉后者", async () => {
  const { storage, projectId, cleanup } = await fixture();
  const connector = fakeConnector(10, 1000);
  const out = await reindexBinding(storage, projectId, BINDING, connector, {
    maxIndexItems: DEFAULT_RESOURCE_LIMITS.maxIndexItems,
    maxIndexBytes: 3500,
  });
  assert.equal(out.indexed, 3, "第 4 条会让总量超过 3500，所以它读都不该被读");
  assert.equal(out.bytes, 3000);
  assert.equal(out.stoppedBy, "bytes");
  assert.equal(connector.read_.length, 3);
  cleanup();
});

test("索引：没超上限时 skipped 是 0、stoppedBy 不出现 —— 常态下这一层什么都没变", async () => {
  const { storage, projectId, cleanup } = await fixture();
  const connector = fakeConnector(4, 10);
  const out = await reindexBinding(storage, projectId, BINDING, connector);
  assert.equal(out.indexed, 4);
  assert.equal(out.skipped, 0);
  assert.equal(out.stoppedBy, undefined);
  cleanup();
});

test("索引：一条就超上限时，**读都不读它** —— 而那一条往往正是最大的那份", async () => {
  const { storage, projectId, cleanup } = await fixture();
  const connector = fakeConnector(3, 1_000_000);
  const out = await reindexBinding(storage, projectId, BINDING, connector, {
    maxIndexItems: DEFAULT_RESOURCE_LIMITS.maxIndexItems,
    maxIndexBytes: 100,
  });
  assert.equal(out.indexed, 0);
  assert.equal(out.skipped, 3);
  assert.deepEqual(connector.read_, [], "一条都不该被读进内存");
  cleanup();
});
