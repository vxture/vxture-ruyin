/**
 * 技能登记册（ADR-018 §2.3）：四层目录、近者优先、启用状态、资源读取边界。
 *
 * 全部在临时目录里搭四层，不碰仓内 resources/skills（开发机上多半没拉过）。
 */

import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SkillRegistry, listResources, parseSkillMd } from "./skill-registry.js";

function skillMd(name: string, description: string, extra = ""): string {
  return `---\nname: ${name}\ndescription: ${description}\n${extra}---\n# ${name}\n\nDo the thing.\n`;
}

function putSkill(root: string, name: string, description: string, extra = "", files: Record<string, string> = {}): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), skillMd(name, description, extra));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  return dir;
}

interface Rig {
  dataDir: string;
  bundled: string;
  logs: string[];
  registry: SkillRegistry;
}

function rig(withBundledIndex = true): Rig {
  const base = mkdtempSync(join(tmpdir(), "ruyin-skills-"));
  const dataDir = join(base, "data");
  const bundled = join(base, "bundled");
  mkdirSync(dataDir, { recursive: true });
  // 预置层：两个来源，其中一个是「装而不启用」档；两个来源各带一条同名技能。
  putSkill(join(bundled, "src-a"), "docx-basics", "Word layout basics", "metadata:\n  version: 1.2.0\n", {
    "references/guide.md": "# Guide\nUse styles.",
    "assets/template.docx": "PKbinary",
    "scripts/run.py": "print('no')",
  });
  putSkill(join(bundled, "src-a"), "playwright-skill", "Browser automation (a)");
  putSkill(join(bundled, "src-b"), "playwright-skill", "Browser automation (b)");
  putSkill(join(bundled, "src-b"), "research-deep", "Deep research", "allowed-tools: read_file search_knowledge\n");
  // 一份坏的：没有 description。
  mkdirSync(join(bundled, "src-b", "broken"), { recursive: true });
  writeFileSync(join(bundled, "src-b", "broken", "SKILL.md"), "---\nname: broken\n---\n# nothing");
  if (withBundledIndex) {
    writeFileSync(
      join(bundled, "index.json"),
      JSON.stringify({
        sources: [
          { id: "src-a", license: "MIT", tier: "default" },
          { id: "src-b", license: "Apache-2.0", tier: "installed-disabled" },
        ],
        skills: [
          { source: "src-a", name: "docx-basics", dir: "src-a/docx-basics" },
          { source: "src-a", name: "playwright-skill", dir: "src-a/playwright-skill" },
          { source: "src-b", name: "playwright-skill", dir: "src-b/playwright-skill" },
          { source: "src-b", name: "research-deep", dir: "src-b/research-deep" },
          { source: "src-b", name: "broken", dir: "src-b/broken" },
        ],
        servers: [{ id: "x.y", tier: "default", license: "MIT" }],
      }),
    );
  }
  const logs: string[] = [];
  const registry = new SkillRegistry({ bundledDir: bundled, dataDir, log: (l) => logs.push(l), ttlMs: 0 });
  return { dataDir, bundled, logs, registry };
}

test("parseSkillMd: the Agent Skills front matter, and what is refused", () => {
  const ok = parseSkillMd(skillMd("docx-basics", "Word basics", "license: MIT\nallowed-tools: read_file write_document\nmetadata:\n  version: 2\n"));
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.meta.name, "docx-basics");
    assert.equal(ok.meta.license, "MIT");
    assert.deepEqual(ok.meta.allowedTools, ["read_file", "write_document"]);
    assert.equal(ok.meta.version, "2");
    assert.match(ok.content, /^---\nname: docx-basics/);
  }
  assert.match((parseSkillMd("# no front matter") as { reason: string }).reason, /must start with/);
  assert.match((parseSkillMd("---\nname: Bad_Name\ndescription: x\n---\n") as { reason: string }).reason, /kebab-case/);
  assert.match((parseSkillMd("---\nname: fine\n---\n") as { reason: string }).reason, /description is required/);
  assert.match((parseSkillMd("---\nname: [\n---\n") as { reason: string }).reason, /not YAML/);
  // BOM 与 CRLF 都算数：Windows 上保存过的文件。
  assert.ok(parseSkillMd("﻿---\r\nname: crlf-ok\r\ndescription: yes\r\n---\r\n").ok);
});

test("layers: nearest wins by name, same-layer duplicates keep the first, installed-disabled is off by default, a bad file is skipped with a log line", async () => {
  const { dataDir, registry, logs } = rig();
  // 用户层盖住预置层的同名；项目层再盖住用户层。
  putSkill(join(dataDir, "skills", "user"), "docx-basics", "My own docx notes");
  putSkill(join(dataDir, "skills", "distributed", "vxture.bid"), "tender-style", "Tender house style");
  const projectId = "prj_1";
  putSkill(join(dataDir, "projects", projectId, "skills"), "docx-basics", "Project-specific docx rules");

  assert.equal((await registry.resolve("docx-basics", ""))?.layer, "user");
  assert.equal((await registry.resolve("docx-basics", projectId))?.layer, "project");
  assert.equal((await registry.resolve("tender-style", ""))?.layer, "distributed");
  // 同层重名：先扫到的（src-a）生效；src-b 那条整个来源是「装而不启用」，本来就不启用。
  assert.equal((await registry.resolve("playwright-skill", ""))?.description, "Browser automation (a)");
  assert.equal(await registry.resolve("research-deep", ""), undefined);
  assert.equal(await registry.resolve("broken", ""), undefined);
  assert.ok(logs.some((l) => l.includes("broken") && l.includes("description is required")));

  const listing = registry.list(projectId);
  const docx = listing.items.filter((s) => s.name === "docx-basics");
  assert.deepEqual(
    docx.map((s) => [s.layer, s.enabled, s.shadowedBy]),
    [
      ["bundled", true, "project"],
      ["user", true, "project"],
      ["project", true, undefined],
    ],
  );
  const bundledDocx = docx.find((s) => s.layer === "bundled");
  assert.equal(bundledDocx?.version, "1.2.0");
  assert.equal(bundledDocx?.license, "MIT");
  assert.equal(bundledDocx?.tier, "default");
  assert.equal(bundledDocx?.hasScripts, true);
  const research = listing.items.find((s) => s.name === "research-deep");
  assert.equal(research?.enabled, false);
  assert.equal(research?.tier, "installed-disabled");
  assert.deepEqual(research?.allowedTools, ["read_file", "search_knowledge"]);
  assert.deepEqual(
    listing.layers.map((l) => [l.layer, l.present, l.count]),
    [
      ["bundled", true, 4],
      ["distributed", true, 1],
      ["user", true, 1],
      ["project", true, 1],
    ],
  );
  assert.deepEqual(registry.counts(), { bundled: 4, distributed: 1, user: 1, project: 0 });
});

test("setEnabled: the choice is keyed by layer/source/name, survives a new instance, and un-shadows the next layer down", async () => {
  const { dataDir, registry } = rig();
  putSkill(join(dataDir, "skills", "user"), "docx-basics", "My own docx notes");
  assert.equal((await registry.resolve("docx-basics", ""))?.layer, "user");

  const off = registry.setEnabled({ layer: "user", source: "user", name: "docx-basics" }, false);
  assert.equal(off.enabled, false);
  // 用户层那条停了，预置层那条重新生效。
  assert.equal((await registry.resolve("docx-basics", ""))?.layer, "bundled");
  assert.equal(registry.list().items.find((s) => s.layer === "bundled" && s.name === "docx-basics")?.shadowedBy, undefined);

  // 装而不启用的那条可以显式打开。
  const on = registry.setEnabled({ layer: "bundled", source: "src-b", name: "research-deep" }, true);
  assert.equal(on.enabled, true);
  assert.equal((await registry.resolve("research-deep", ""))?.description, "Deep research");

  // 新实例读同一份 state.json。
  const again = new SkillRegistry({ bundledDir: registry.bundledDir, dataDir, ttlMs: 0 });
  assert.equal((await again.resolve("docx-basics", ""))?.layer, "bundled");
  assert.equal((await again.resolve("research-deep", ""))?.layer, "bundled");

  assert.throws(() => registry.setEnabled({ layer: "user", source: "user", name: "no-such" }, true), /is not installed/);
});

test("read + readResource: SKILL.md verbatim with the resource list; references/assets only, text only, capped", async () => {
  const { registry, bundled } = rig();
  const doc = await registry.read("docx-basics", "");
  assert.ok(doc);
  assert.match(doc.content, /^---\nname: docx-basics/);
  // references 在前、assets 在后（说明先于素材），各自内部按名排序。
  assert.deepEqual(doc.resources, ["references/guide.md", "assets/template.docx"]);
  assert.equal(doc.version, "1.2.0");

  const text = await registry.readResource("docx-basics", "references/guide.md", "");
  assert.deepEqual(text, { kind: "text", text: "# Guide\nUse styles." });
  assert.equal((await registry.readResource("docx-basics", "assets/template.docx", "")).kind, "unavailable");
  assert.match((await registry.readResource("docx-basics", "scripts/run.py", "") as { reason: string }).reason, /TD-005/);
  assert.match((await registry.readResource("docx-basics", "references/../SKILL.md", "") as { reason: string }).reason, /leave/);
  assert.match((await registry.readResource("docx-basics", "references/missing.md", "") as { reason: string }).reason, /no such resource/);
  assert.match((await registry.readResource("nope", "references/x.md", "") as { reason: string }).reason, /not available/);

  // 超过上限的截断，并说自己截了。
  writeFileSync(join(bundled, "src-a", "docx-basics", "references", "big.md"), "x".repeat(300 * 1024));
  const big = await registry.readResource("docx-basics", "references/big.md", "");
  assert.equal(big.kind, "text");
  if (big.kind === "text") {
    assert.equal(big.truncated, true);
    assert.equal(big.text.length, 256 * 1024);
  }
  assert.equal(listResources(join(bundled, "src-a", "docx-basics")).length, 3);
});

test("no bundled layer: counts are zero and the listing says the layer is absent, not empty", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "ruyin-skills-nb-"));
  const registry = new SkillRegistry({ bundledDir: join(dataDir, "nowhere"), dataDir, ttlMs: 0 });
  assert.equal(registry.bundledDir, undefined);
  assert.equal(registry.bundledIndex(), undefined);
  const listing = registry.list();
  assert.deepEqual(listing.items, []);
  assert.equal(listing.layers.find((l) => l.layer === "bundled")?.present, false);
  rmSync(dataDir, { recursive: true, force: true });
});

test("bundled layer without an index is scanned two levels deep (source/skill)", async () => {
  const { registry } = rig(false);
  assert.equal(registry.bundledIndex(), undefined);
  assert.equal((await registry.resolve("docx-basics", ""))?.layer, "bundled");
  const view = registry.list().items.find((s) => s.name === "docx-basics");
  assert.equal(view?.source, "src-a");
  // 没有索引就没有档位信息：一律按默认启用，research-deep 也在。
  assert.equal((await registry.resolve("research-deep", ""))?.layer, "bundled");
});
