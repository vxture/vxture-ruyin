/**
 * 本机检索（TD-022）：`search_knowledge` 与它底下的 FTS 索引。
 *
 * 这个文件里最要紧的是**中文查得到**。默认的 unicode61 分词器把一整串连续
 * 汉字当成一个 token，于是「储能」「案例」这类查询一律 0 命中 —— 索引对中文
 * 资料一直是死的，而唯一的症状是排序悄悄退化成按时间，看起来和「就是没有更
 * 相关的」一模一样。一个检索工具建在这样的索引上，会每次都如实地回「没找到」，
 * 然后让模型交出一份查无实据的方案。
 */

import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ContextItemMeta } from "@vxture/ruyin-core";
import Database from "better-sqlite3-multiple-ciphers";
import { KeyManager } from "./keys.js";
import { SqliteStoragePort } from "./storage.js";
import { searchContext } from "./fts.js";
import { LocalToolExecutor } from "./tool-executor.js";

const CAPABILITY =
  "本公司在储能项目上有丰富经验，已交付多个电化学储能电站案例。";
const QUALIFICATION = "具备电力工程施工总承包一级资质，近三年无重大事故。";
const UNRELATED = "食堂承包服务方案，含储能柜采购一项。";

function meta(id: string, name: string): ContextItemMeta {
  return {
    id,
    name,
    type: "enterprise_capability",
    source: "local",
    connector: "local-fs",
    ref: `C:/work/${name}`,
    bytes: 128,
    modifiedAt: "2026-09-01T00:00:00Z",
  };
}

async function seeded(): Promise<{
  dataDir: string;
  storage: SqliteStoragePort;
  projectId: string;
  scope: ContextItemMeta[];
}> {
  const dataDir = mkdtempSync(join(tmpdir(), "ruyin-search-"));
  const storage = new SqliteStoragePort(dataDir, await KeyManager.open(dataDir));
  const projectId = "prj_search";
  await storage.createProjectStore(projectId);
  const store = storage.openHostStore(projectId);
  assert.ok(store);
  store.replaceIndexForType("enterprise_capability", [
    { id: "i1", name: "企业能力.md", content: CAPABILITY },
    { id: "i2", name: "资质.md", content: QUALIFICATION },
    { id: "i3", name: "无关.md", content: UNRELATED },
  ]);
  return {
    dataDir,
    storage,
    projectId,
    // i3 故意不在范围内 —— 它含「储能」，用来验范围过滤真的在过滤。
    scope: [meta("i1", "企业能力.md"), meta("i2", "资质.md")],
  };
}

void test("检索：中文查得到 —— 这正是换分词器要换来的东西", async () => {
  const { dataDir, storage, projectId, scope } = await seeded();
  try {
    for (const query of ["储能项目", "电化学储能", "电力工程"]) {
      const { hits } = searchContext(storage, projectId, query, scope, 5);
      assert.ok(
        hits.length > 0,
        `"${query}" 查不到 —— unicode61 时代四条查询全是 0 命中，就是这个样子`,
      );
      assert.ok(hits[0]?.excerpt.includes(query), "摘录没落在命中处");
    }
  } finally {
    storage.closeAll();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

void test("检索：两字词也要查得到（trigram 有 3 字下限，靠子串扫描兜底）", async () => {
  const { dataDir, storage, projectId, scope } = await seeded();
  try {
    // 「储能」「资质」在中文里恰恰是最常查的那类，而它们正好低于 trigram 下限。
    for (const [query, expect] of [["储能", "i1"], ["资质", "i2"]] as const) {
      const { hits } = searchContext(storage, projectId, query, scope, 5);
      assert.equal(hits[0]?.id, expect, `"${query}" 没兜住`);
    }
  } finally {
    storage.closeAll();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

void test("检索：范围外的不回，但把有多少条落在范围外说出来", async () => {
  const { dataDir, storage, projectId, scope } = await seeded();
  try {
    const { hits, outOfScope } = searchContext(
      storage,
      projectId,
      "储能",
      scope,
      5,
    );
    assert.deepEqual(
      hits.map((h) => h.id),
      ["i1"],
      "i3 也含「储能」，但它不在本任务的上下文集里",
    );
    // 悄悄丢掉会让模型以为资料就这么薄，然后写出一份更弱的方案。
    assert.equal(outOfScope, 1);
  } finally {
    storage.closeAll();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

void test("检索：空范围和查不到，说的不能是同一句话", async () => {
  const { dataDir, storage, projectId, scope } = await seeded();
  const exec = new LocalToolExecutor((p, q, s, l) =>
    searchContext(storage, p, q, s, l),
  );
  const call = (query: string, contextSet: ContextItemMeta[]) => ({
    tool: "search_knowledge",
    arguments: { query },
    workspace: projectId,
    taskId: "ti_1",
    provider: "runtime" as const,
    connectors: [],
    grants: [],
    contextSet,
  });
  try {
    const empty = await exec.execute(call("储能", []));
    // 范围是空的，是选取阶段的问题，不是资料的问题 —— 报成同一句话，查的人会
    // 往错的方向找。
    assert.match(empty.content, /no context items/);

    const missing = await exec.execute(call("量子计算", scope));
    assert.match(missing.content, /no match/);
    assert.match(missing.content, /2 context item/);

    const found = await exec.execute(call("电化学储能", scope));
    assert.match(found.content, /\[i1\] 企业能力\.md/);
  } finally {
    storage.closeAll();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

/**
 * 没接检索能力时，`search_knowledge` 必须**不在支持列表里**。
 *
 * 差别不是措辞：不支持 → 任务在启动时被明确拒绝，说清缺什么；支持但查不到
 * → 任务照跑，每次检索都如实回「没找到」，最后交出一份查无实据的方案。
 */
void test("检索：没接上时不假装支持", () => {
  assert.equal(new LocalToolExecutor().supports("search_knowledge"), false);
  assert.equal(
    new LocalToolExecutor(() => ({ hits: [], outOfScope: 0 })).supports(
      "search_knowledge",
    ),
    true,
  );
  // 其它工具不受影响。
  assert.equal(new LocalToolExecutor().supports("export_result"), true);
});

/**
 * 老库的迁移：`CREATE VIRTUAL TABLE IF NOT EXISTS` 碰上已存在的表什么也不做，
 * 所以升级后的老库会一直留着那个对中文零命中的索引 —— 而它不报错，只是永远
 * 查不到东西。这条用例造一个真正的旧表，再开一次，看它有没有被换过来。
 */
void test("迁移：老库的 unicode61 索引换成 trigram，行不丢，中文查得到", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "ruyin-mig-"));
  const keys = await KeyManager.open(dataDir);
  const projectId = "prj_old";
  try {
    // 先按正常路径建库，再把索引表退回旧形状 —— 这样除了分词器，其它都和真实
    // 老库一致（含加密、WAL）。
    const first = new SqliteStoragePort(dataDir, keys);
    await first.createProjectStore(projectId);
    first.closeAll();

    const dir = join(dataDir, "projects", projectId);
    const raw = new Database(join(dir, "project.db"));
    raw.pragma(`cipher='sqlcipher'`);
    raw.pragma(`key="x'${keys.workspaceKeyHex(dir)}'"`);
    raw.exec("DROP TABLE fts_index");
    raw.exec(
      `CREATE VIRTUAL TABLE fts_index USING fts5(
         item_id UNINDEXED, type UNINDEXED, name, content
       )`,
    );
    raw.prepare(
      "INSERT INTO fts_index (item_id, type, name, content) VALUES (?, ?, ?, ?)",
    ).run("i1", "enterprise_capability", "企业能力.md", CAPABILITY);
    // 旧索引在这里就是死的 —— 先把这一点钉住，否则下面的断言证明不了什么。
    assert.deepEqual(
      raw
        .prepare("SELECT item_id FROM fts_index WHERE fts_index MATCH ?")
        .all('"储能项目"'),
      [],
      "旧分词器居然查得到 —— 那这次迁移就没有理由",
    );
    raw.close();

    const reopened = new SqliteStoragePort(dataDir, keys);
    const store = reopened.openHostStore(projectId);
    assert.ok(store);
    try {
      // 行搬过来了：迁移不回读源文件，索引里本来就存着正文。
      const hits = searchContext(
        reopened,
        projectId,
        "储能项目",
        [meta("i1", "企业能力.md")],
        5,
      );
      assert.equal(hits.hits.length, 1, "迁移之后仍然查不到");
      assert.ok(hits.hits[0]?.excerpt.includes("储能项目"));
    } finally {
      reopened.closeAll();
    }
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
