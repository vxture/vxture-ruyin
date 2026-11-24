/**
 * 产品分发层的刷新（ADR-018 §2.3 / ADR-020 §3c）：能力面给什么、本机落什么。
 * fetch 是注入的：这里钉的是 bid 的两个端点说了什么之后本机怎么做，不是能力面
 * 通不通。
 */

import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pruneVerdict, refreshDistributedSkills, relativeOf, recoverDistributedSkills, verifiedSkillCapability } from "./skill-distribution.js";

function skillMd(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`;
}

interface SuppliedSkill {
  content: string;
  resources?: Array<{ uri: string; mimeType?: string; text?: string }>;
  contentDigest?: string;
  version?: string;
  capabilityId?: string;
  deliveryIntegrity?: "verified" | "unverified";
  deliveryDigest?: string;
  deliveryDigestFormat?: string;
}

interface Surface {
  configured: boolean;
  catalogue: Array<{ name: string; description: string; version?: string; capabilityId?: string }>;
  docs: Record<string, SuppliedSkill>;
  calls: string[];
  fail?: boolean;
}

function fakeFetch(surface: Surface): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    surface.calls.push(url);
    if (surface.fail) throw new Error("ECONNREFUSED");
    const m = /\/products\/([^/]+)\/skills(?:\/([^/?]+))?/.exec(url);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (!m) return json({ code: "NOT_FOUND" }, 404);
    if (!m[2]) {
      return json({ status: { configured: surface.configured, ...(surface.configured ? {} : { reason: "RUNOS_API_URL unset" }) }, skills: surface.catalogue });
    }
    const doc = surface.docs[m[2]];
    return doc ? json(doc) : json({ code: "SKILL_NOT_FOUND" }, 404);
  }) as typeof fetch;
}

function surface(): Surface {
  return {
    configured: true,
    catalogue: [
      { name: "tender-style", description: "House style", version: "1.0.0" },
      { name: "excel-workflow", description: "Sheets", version: "2.1.0" },
    ],
    docs: {
      "tender-style": {
        content: skillMd("tender-style", "House style"),
        resources: [
          { uri: "skill://vxture.tender-style/1.0.0/references/tone.md", text: "# Tone\nFormal." },
          { uri: "skill://vxture.tender-style/1.0.0/scripts/build.py", text: "print(1)" },
          { uri: "skill://vxture.tender-style/1.0.0/references/../SKILL.md", text: "evil" },
        ],
        contentDigest: "sha256:aaa",
        version: "1.0.0",
      },
      "excel-workflow": { content: skillMd("excel-workflow", "Sheets"), contentDigest: "sha256:bbb", version: "2.1.0" },
    },
    calls: [],
  };
}

const cfg = (s: Surface) => ({ baseUrl: "https://bid.test/api/", token: async () => "tok", fetchImpl: fakeFetch(s) });

test("refresh: writes SKILL.md + references, drops scripts and traversal, then reports unchanged on the next pass and removes what the product stopped distributing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ruyin-dist-"));
  const s = surface();
  const first = await refreshDistributedSkills(cfg(s), "bidproposal", dir);
  assert.equal(first.status, "refreshed");
  assert.deepEqual(first.fetched.sort(), ["excel-workflow", "tender-style"]);
  assert.deepEqual(first.failed, []);
  assert.match(readFileSync(join(dir, "tender-style", "SKILL.md"), "utf8"), /^---\nname: tender-style/);
  assert.equal(readFileSync(join(dir, "tender-style", "references", "tone.md"), "utf8"), "# Tone\nFormal.");
  assert.equal(existsSync(join(dir, "tender-style", "scripts")), false);
  assert.equal(existsSync(join(dir, "SKILL.md")), false);
  const receipt = JSON.parse(readFileSync(join(dir, "tender-style", ".ruyin-skill.json"), "utf8")) as { digest: string; version: string };
  assert.equal(receipt.digest, "sha256:aaa");
  assert.equal(receipt.version, "1.0.0");
  // 带了 bearer。
  assert.ok(s.calls.length >= 3);

  // 第二遍：版本没变，一条全文都不再拉。
  s.calls.length = 0;
  const second = await refreshDistributedSkills(cfg(s), "bidproposal", dir);
  assert.deepEqual(second.unchanged.sort(), ["excel-workflow", "tender-style"]);
  assert.deepEqual(second.fetched, []);
  assert.equal(s.calls.length, 1);

  // 产品不再分发 excel-workflow：本地删掉；tender-style 换了版本：重拉。
  s.catalogue = [{ name: "tender-style", description: "House style", version: "1.1.0" }];
  s.docs["tender-style"] = { ...s.docs["tender-style"]!, contentDigest: "sha256:ccc", version: "1.1.0" };
  const third = await refreshDistributedSkills(cfg(s), "bidproposal", dir);
  assert.deepEqual(third.removed, ["excel-workflow"]);
  assert.deepEqual(third.fetched, ["tender-style"]);
  assert.equal(existsSync(join(dir, "excel-workflow")), false);
  rmSync(dir, { recursive: true, force: true });
});

test("refresh: unconfigured and unreachable surfaces leave the local copy alone and say why", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ruyin-dist-"));
  const s = surface();
  await refreshDistributedSkills(cfg(s), "bidproposal", dir);

  s.configured = false;
  const off = await refreshDistributedSkills(cfg(s), "bidproposal", dir);
  assert.equal(off.status, "unconfigured");
  assert.match(off.reason ?? "", /RUNOS_API_URL/);
  assert.equal(existsSync(join(dir, "tender-style", "SKILL.md")), true);

  s.configured = true;
  s.fail = true;
  const down = await refreshDistributedSkills(cfg(s), "bidproposal", dir);
  assert.equal(down.status, "unreachable");
  assert.match(down.reason ?? "", /ECONNREFUSED/);
  assert.equal(existsSync(join(dir, "tender-style", "SKILL.md")), true);
  rmSync(dir, { recursive: true, force: true });
});

test("refresh: a document whose front matter disagrees with the catalogue name, or is not a skill, is reported and not written", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ruyin-dist-"));
  const s = surface();
  s.docs["tender-style"] = { content: skillMd("something-else", "x") };
  s.docs["excel-workflow"] = { content: "# not a skill" };
  const out = await refreshDistributedSkills(cfg(s), "bidproposal", dir);
  assert.deepEqual(out.fetched, []);
  assert.equal(out.failed.length, 2);
  assert.match(out.failed.find((f) => f.name === "tender-style")?.reason ?? "", /does not match/);
  assert.match(out.failed.find((f) => f.name === "excel-workflow")?.reason ?? "", /SKILL.md rejected/);
  assert.equal(existsSync(join(dir, "tender-style")), false);
  rmSync(dir, { recursive: true, force: true });
});

test("relativeOf: Runos skill:// URIs and plain relative paths; anything else is dropped", () => {
  assert.equal(relativeOf("skill://vxture.x/1.0.0/references/a.md"), "references/a.md");
  assert.equal(relativeOf("references/a.md"), "references/a.md");
  assert.equal(relativeOf("https://evil/x.md"), undefined);
});

// --- 删除前的自我保护（pruneVerdict）---------------------------------------
// 删除是**本仓自己的行为**：rmSync 跑在用户机器上、删用户的文件，而决定删什么的
// 目录来自产品的云端能力面 —— 一个本仓不控制、每个产品各自实现的上游。这几条钉
// 住的是「不把删除权无条件交出去」，与任何具体产品无关。

test("prune: 目录空了而本地有 —— 一条不删，并说清为什么", () => {
  const v = pruneVerdict(["a", "b", "c"], new Set());
  assert.deepEqual(v.prune, []);
  assert.deepEqual(v.heldBack?.names, ["a", "b", "c"]);
  assert.match(v.heldBack?.reason ?? "", /目录一条都没有/);
});

test("prune: 一次要删掉本地大多数 —— 一条不删", () => {
  // 本地 6 条，目录里只剩 1 条：要删 5 条。
  const v = pruneVerdict(["a", "b", "c", "d", "e", "f"], new Set(["a"]));
  assert.deepEqual(v.prune, []);
  assert.equal(v.heldBack?.names.length, 5);
  assert.match(v.heldBack?.reason ?? "", /6 条里的 5 条/);
});

test("prune: 正常的增删照常删 —— 保护不是「永不删」", () => {
  const v = pruneVerdict(["a", "b", "c", "d", "e", "f"], new Set(["a", "b", "c", "d", "e"]));
  assert.deepEqual(v.prune, ["f"]);
  assert.equal(v.heldBack, undefined);
});

test("prune: 本地样本太小时不套比例 —— 两条删一条是再正常不过的事", () => {
  const v = pruneVerdict(["a", "b"], new Set(["a"]));
  assert.deepEqual(v.prune, ["b"]);
  assert.equal(v.heldBack, undefined);
});

test("prune: 没有要删的就什么都不说", () => {
  const v = pruneVerdict(["a", "b"], new Set(["a", "b", "c"]));
  assert.deepEqual(v.prune, []);
  assert.equal(v.heldBack, undefined);
});

test("refresh: 能力面返回一份空目录时，本地那份不会被删掉", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ruyin-prune-"));
  const s = surface();
  const first = await refreshDistributedSkills(cfg(s), "bidproposal", dir);
  assert.equal(first.fetched.length, 2);

  // 同一个能力面，下一轮突然一条都不分发了 —— 产品真撤空了，还是它那边出了问题？
  // 分不出来，那就不删。
  s.catalogue = [];
  const second = await refreshDistributedSkills(cfg(s), "bidproposal", dir);
  assert.deepEqual(second.removed, []);
  assert.equal(second.heldBack?.names.length, 2);
  assert.equal(existsSync(join(dir, "tender-style", "SKILL.md")), true);
  assert.equal(existsSync(join(dir, "excel-workflow", "SKILL.md")), true);
  rmSync(dir, { recursive: true, force: true });
});

function verifiedSurface(): Surface {
  const s = surface();
  s.catalogue = [{ name: "tender-style", description: "Synthetic style", capabilityId: "vxture.tender-style", version: "stable" }];
  const doc: SuppliedSkill = { content: skillMd("tender-style", "Verified style"), capabilityId: "vxture.tender-style", version: "1.0.0",
    contentDigest: "registered-contract-digest", deliveryIntegrity: "verified", deliveryDigestFormat: "skill-package-v1",
    resources: [{ uri: "skill://vxture.tender-style/1.0.0/references/tone.md", mimeType: "text/markdown", text: "# Verified tone" },
      { uri: "skill://vxture.tender-style/1.0.0/scripts/build.py", text: "print('never executed')" }] };
  doc.deliveryDigest = deliveryDigest(doc);
  s.docs = { "tender-style": doc };
  return s;
}

function deliveryDigest(doc: SuppliedSkill): string {
  const prefix = `skill://${doc.capabilityId}/${doc.version}/`;
  return createHash("sha256").update(JSON.stringify({ content: doc.content, resources: (doc.resources ?? []).map(r => ({
    mimeType: r.mimeType, path: r.uri.slice(prefix.length), text: r.text,
  })) })).digest("hex");
}

test("verified supply is independently checked and installed as data; stable is never cached as a concrete version", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ruyin-verified-"));
  try {
    const s = verifiedSurface();
    assert.deepEqual((await refreshDistributedSkills(cfg(s), "bidproposal", dir)).fetched, ["tender-style"]);
    const skill = join(dir, "tender-style");
    const receipt = JSON.parse(readFileSync(join(skill, ".ruyin-skill.json"), "utf8")) as { deliveryIntegrity: string; deliveryDigest: string };
    assert.equal(receipt.deliveryIntegrity, "verified"); assert.equal(receipt.deliveryDigest, s.docs["tender-style"]!.deliveryDigest);
    assert.equal(existsSync(join(skill, "scripts")), false);
    assert.equal(verifiedSkillCapability(skill, "tender-style"), undefined, "script-dependent deliveries are not locally runnable");
    s.calls = [];
    assert.deepEqual((await refreshDistributedSkills(cfg(s), "bidproposal", dir)).unchanged, ["tender-style"]);
    assert.equal(s.calls.length, 2, "stable must be checked rather than treated as an immutable pin");
    s.docs["tender-style"]!.resources![0]!.text = "# New package bytes";
    s.docs["tender-style"]!.deliveryDigest = deliveryDigest(s.docs["tender-style"]!);
    assert.deepEqual((await refreshDistributedSkills(cfg(s), "bidproposal", dir)).fetched, ["tender-style"], "contract digest is not the delivery digest");
    assert.equal(readFileSync(join(skill, "references/tone.md"), "utf8"), "# New package bytes");
    s.docs["tender-style"]!.resources!.pop();
    s.docs["tender-style"]!.deliveryDigest = deliveryDigest(s.docs["tender-style"]!);
    await refreshDistributedSkills(cfg(s), "bidproposal", dir);
    assert.equal(verifiedSkillCapability(skill, "tender-style"), "vxture.tender-style");
    assert.equal(verifiedSkillCapability(skill, "another-name"), undefined);
    assert.equal(verifiedSkillCapability(join(dir, "missing"), "tender-style"), undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("tampered or mismatched verified deliveries preserve the installed bytes and receipt", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ruyin-integrity-"));
  try {
    const s = verifiedSurface(); await refreshDistributedSkills(cfg(s), "bidproposal", dir);
    const before = readFileSync(join(dir, "tender-style/.ruyin-skill.json"), "utf8");
    const original = structuredClone(s.docs["tender-style"]!);
    for (const mutation of ["text", "resource", "capability", "uri", "version", "missing-digest", "format", "duplicate", "path", "missing-text"] as const) {
      const doc = structuredClone(original);
      if (mutation === "text") doc.content += "Changed";
      if (mutation === "resource") doc.resources![0]!.text = "Tampered";
      if (mutation === "capability") doc.capabilityId = "other.tender-style";
      if (mutation === "uri") doc.resources![0]!.uri = "skill://other.tender-style/1.0.0/references/tone.md";
      if (mutation === "version") doc.version = "2.0.0";
      if (mutation === "missing-digest") delete doc.deliveryDigest;
      if (mutation === "format") doc.deliveryDigestFormat = "unknown";
      if (mutation === "duplicate") doc.resources!.push(doc.resources![0]!);
      if (mutation === "path") doc.resources![0]!.uri = "skill://vxture.tender-style/1.0.0/references/../tone.md";
      if (mutation === "missing-text") delete doc.resources![0]!.text;
      s.docs["tender-style"] = doc;
      const result = await refreshDistributedSkills(cfg(s), "bidproposal", dir);
      assert.equal(result.failed.length, 1, mutation); assert.deepEqual(result.fetched, [], mutation);
      assert.equal(readFileSync(join(dir, "tender-style/.ruyin-skill.json"), "utf8"), before, mutation);
      assert.equal(readFileSync(join(dir, "tender-style/references/tone.md"), "utf8"), "# Verified tone", mutation);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a failed resource write preserves the old installation; a successful replacement removes old resources", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ruyin-staged-"));
  try {
    const s = surface(); await refreshDistributedSkills(cfg(s), "bidproposal", dir);
    const old = readFileSync(join(dir, "tender-style/SKILL.md"), "utf8");
    s.catalogue[0]!.version = "1.1.0";
    s.docs["tender-style"] = { content: skillMd("tender-style", "Replacement"), version: "1.1.0", resources: [
      { uri: "references/clash.md", text: "First" }, { uri: "references/clash.md/child.md", text: "Not a directory" },
    ] };
    const failed = await refreshDistributedSkills(cfg(s), "bidproposal", dir);
    assert.equal(failed.failed.length, 1); assert.match(failed.failed[0]!.reason, /previous installation retained/);
    assert.equal(readFileSync(join(dir, "tender-style/SKILL.md"), "utf8"), old);
    assert.equal(readFileSync(join(dir, "tender-style/references/tone.md"), "utf8"), "# Tone\nFormal.");
    assert.equal(readdirSync(dir).some(n => n.startsWith(".ruyin-stage-")), false);
    s.docs["tender-style"]!.resources = [{ uri: "references/new.md", text: "Replacement reference" }];
    assert.deepEqual((await refreshDistributedSkills(cfg(s), "bidproposal", dir)).fetched, ["tender-style"]);
    assert.equal(existsSync(join(dir, "tender-style/references/tone.md")), false);
    assert.equal(readFileSync(join(dir, "tender-style/references/new.md"), "utf8"), "Replacement reference");
    assert.equal(readdirSync(dir).some(n => n.startsWith(".ruyin-stage-")), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("incomplete, invalid or duplicate catalogs cannot prune installed supply", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ruyin-catalog-"));
  try {
    const s = surface(); await refreshDistributedSkills(cfg(s), "bidproposal", dir);
    for (const body of [null, {}, { skills: [] , status: { configured: true, complete: false } },
      { skills: [{ name: "../bad" }] }, { skills: [s.catalogue[0], s.catalogue[0]] }]) {
      const result = await refreshDistributedSkills({ ...cfg(s), fetchImpl: async () => Response.json(body) }, "bidproposal", dir);
      assert.equal(result.status, "unreachable"); assert.deepEqual(result.removed, []);
      assert.equal(existsSync(join(dir, "tender-style/SKILL.md")), true);
      assert.equal(existsSync(join(dir, "excel-workflow/SKILL.md")), true);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("overlapping refreshes serialize for one directory without mixing callers or losing the newer result", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ruyin-refresh-order-"));
  const first = verifiedSurface(), second = verifiedSurface();
  second.docs["tender-style"]!.content = skillMd("tender-style", "Second caller result");
  second.docs["tender-style"]!.deliveryDigest = deliveryDigest(second.docs["tender-style"]!);
  const seen: string[] = [];
  let release!: () => void, entered!: () => void;
  const enteredFirst = new Promise<void>(done => { entered = done; });
  const wait = new Promise<void>(done => { release = done; });
  const fetchFor = (s: Surface, identity: string, block: boolean): typeof fetch => async (input, init) => {
    const value = new Headers(init?.headers).get("authorization"); assert.equal(value, `Bearer ${identity}`);
    seen.push(identity);
    if (block && String(input).endsWith("/skills")) { entered(); await wait; }
    return fakeFetch(s)(input, init);
  };
  try {
    const a = refreshDistributedSkills({ ...cfg(first), token: async () => "first", fetchImpl: fetchFor(first, "first", true) }, "bidproposal", dir);
    await enteredFirst;
    const b = refreshDistributedSkills({ ...cfg(second), token: async () => "second", fetchImpl: fetchFor(second, "second", false) }, "bidproposal", join(dir, "."));
    await new Promise<void>(done => setImmediate(done));
    assert.deepEqual(seen, ["first"]);
    release();
    assert.deepEqual((await a).fetched, ["tender-style"]);
    assert.deepEqual((await b).fetched, ["tender-style"]);
    assert.deepEqual(seen, ["first", "first", "second", "second"]);
    assert.match(readFileSync(join(dir, "tender-style/SKILL.md"), "utf8"), /Second caller result/);
  } finally { release(); rmSync(dir, { recursive: true, force: true }); }
});

test("interrupted publication restores the valid previous installation before any network request", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ruyin-recover-"));
  try {
    const s = verifiedSurface(); await refreshDistributedSkills(cfg(s), "bidproposal", dir);
    const installed = join(dir, "tender-style"), backup = join(dir, ".ruyin-previous-tender-style");
    renameSync(installed, backup);
    const stage = join(dir, ".ruyin-stage-aborted"); mkdirSync(stage); writeFileSync(join(stage, "SKILL.md"), "Partial new content");
    let asked = false;
    const result = await refreshDistributedSkills({ baseUrl: "https://synthetic.test", fetchImpl: async () => {
      asked = true; assert.equal(existsSync(join(installed, "SKILL.md")), true); throw Error("offline");
    } }, "bidproposal", dir);
    assert.equal(asked, true); assert.equal(result.status, "unreachable");
    assert.equal(existsSync(backup), false);
    assert.match(readFileSync(join(installed, "SKILL.md"), "utf8"), /Verified style/);
    assert.equal(existsSync(stage), true, "anonymous staging data is not a completed installation");
    assert.deepEqual(recoverDistributedSkills(dir), { restored: [], pending: [] });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("recovery discards a completed old backup only when the installed version is valid", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ruyin-recover-old-"));
  try {
    const s = verifiedSurface(); await refreshDistributedSkills(cfg(s), "bidproposal", dir);
    const installed = join(dir, "tender-style"), backup = join(dir, ".ruyin-previous-tender-style");
    mkdirSync(backup);writeFileSync(join(backup, "SKILL.md"), skillMd("tender-style", "Old complete version"));
    writeFileSync(join(backup, ".ruyin-skill.json"), JSON.stringify({ name: "tender-style" }));
    assert.deepEqual(recoverDistributedSkills(dir), { restored: [], pending: [] });
    assert.equal(existsSync(backup), false);assert.match(readFileSync(join(installed, "SKILL.md"), "utf8"), /Verified style/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("invalid, conflicting or linked recovery targets are retained and block destructive refresh", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ruyin-recover-refusal-"));
  const outside = mkdtempSync(join(tmpdir(), "ruyin-recover-outside-"));
  try {
    const backup = join(dir, ".ruyin-previous-tender-style");mkdirSync(backup);
    writeFileSync(join(backup, "SKILL.md"), skillMd("tender-style", "Old complete version"));
    writeFileSync(join(backup, ".ruyin-skill.json"), JSON.stringify({ name: "mismatch" }));
    assert.deepEqual(recoverDistributedSkills(dir).pending, ["tender-style"]);
    writeFileSync(join(backup, ".ruyin-skill.json"), JSON.stringify({ name: "tender-style" }));
    mkdirSync(join(dir, "tender-style"));writeFileSync(join(dir, "tender-style/SKILL.md"), "Partial invalid installation");
    assert.deepEqual(recoverDistributedSkills(dir).pending, ["tender-style"]);
    let reads = 0;
    const result = await refreshDistributedSkills({ baseUrl: "https://synthetic.test", fetchImpl: async () => { reads++; return Response.json({ skills: [] }); } }, "bidproposal", dir);
    assert.equal(result.status, "unreachable");assert.equal(reads, 0);assert.equal(existsSync(backup), true);
    const linkedRoot = join(dir, "linked");symlinkSync(outside, linkedRoot, "junction");
    assert.deepEqual(recoverDistributedSkills(linkedRoot).pending, ["directory"]);
    const linkedBackup = join(dir, ".ruyin-previous-linked");symlinkSync(outside, linkedBackup, "junction");
    assert.ok(recoverDistributedSkills(dir).pending.includes("linked"));assert.deepEqual(readdirSync(outside), []);
    assert.deepEqual(recoverDistributedSkills(join(dir, "missing")), { restored: [], pending: [] });
  } finally { rmSync(dir, { recursive: true, force: true });rmSync(outside, { recursive: true, force: true }); }
});
