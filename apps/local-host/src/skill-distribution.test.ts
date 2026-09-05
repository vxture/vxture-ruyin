/**
 * 产品分发层的刷新（ADR-018 §2.3 / ADR-020 §3c）：能力面给什么、本机落什么。
 * fetch 是注入的：这里钉的是 bid 的两个端点说了什么之后本机怎么做，不是能力面
 * 通不通。
 */

import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { refreshDistributedSkills, relativeOf } from "./skill-distribution.js";

function skillMd(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`;
}

interface Surface {
  configured: boolean;
  catalogue: Array<{ name: string; description: string; version?: string }>;
  docs: Record<string, { content: string; resources?: Array<{ uri: string; text?: string }>; contentDigest?: string; version?: string }>;
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
