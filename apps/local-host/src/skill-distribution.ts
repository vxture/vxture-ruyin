/**
 * 产品分发层的刷新（ADR-018 §2.3 / ADR-020 §3c）：产品的云端能力面把 Runos 分发
 * 给它的技能转交过来，落进 <dataDir>/skills/distributed/<产品>/<技能>/。
 *
 * 通路与回合、契约拉取同一条（ADR-009 / ADR-012）：`RUYIN_CAPABILITY_BASE` +
 * 用户的平台 token。**Ruyin 不直连 Runos**（ADR-001 / 009）—— 这里只认识产品
 * 能力面的两个端点：
 *
 *   GET /products/:id/skills          目录：{ status: {configured, reason?}, skills: [{name, description, capabilityId, version}] }
 *   GET /products/:id/skills/:name    一条：{ content, resources: [{uri, mimeType?, text?}], contentDigest, version }
 *
 * 按 `contentDigest` 缓存：本地那份的摘要没变就不重写；能力面不可达时本地那份
 * 照用（离线可用）。产品不再分发的，本地删掉 —— 分发层是产品的清单在本机的
 * 投影，不是用户的收藏（用户要留的放用户层）。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { checkResourcePath } from "@vxture/ruyin-core";
import { SKILL_NAME_RE, parseSkillMd } from "./skill-registry.js";

export interface DistributionConfig {
  baseUrl: string;
  token?: (() => Promise<string | undefined>) | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface DistributionOutcome {
  product: string;
  /**
   * unconfigured = 能力面说它自己没接 Runos；unreachable = 能力面拉不到（本地照用）；
   * refreshed = 目录对过了（可能一条都没变）。
   */
  status: "unconfigured" | "unreachable" | "refreshed";
  reason?: string;
  fetched: string[];
  unchanged: string[];
  removed: string[];
  failed: Array<{ name: string; reason: string }>;
}

/** 落在每个技能目录里的回执：下次刷新靠它判断变没变。 */
interface Receipt {
  name: string;
  digest?: string;
  version?: string;
  capabilityId?: string;
  fetchedAt: string;
}

const RECEIPT = ".ruyin-skill.json";

interface CatalogueItem {
  name: string;
  description?: string;
  capabilityId?: string;
  version?: string;
}

interface FetchedSkill {
  content: string;
  resources: Array<{ uri: string; mimeType?: string; text?: string }>;
  contentDigest?: string;
  version?: string;
  capabilityId?: string;
}

export async function refreshDistributedSkills(
  cfg: DistributionConfig,
  productId: string,
  targetDir: string,
): Promise<DistributionOutcome> {
  const outcome: DistributionOutcome = {
    product: productId,
    status: "refreshed",
    fetched: [],
    unchanged: [],
    removed: [],
    failed: [],
  };
  const base = `${cfg.baseUrl.replace(/\/+$/, "")}/products/${encodeURIComponent(productId)}/skills`;

  const catalogue = await getJson(cfg, base);
  if (!catalogue.ok) {
    return { ...outcome, status: "unreachable", reason: catalogue.reason };
  }
  const body = catalogue.body as {
    status?: { configured?: boolean; reason?: string };
    skills?: CatalogueItem[];
  };
  if (body.status && body.status.configured === false) {
    return {
      ...outcome,
      status: "unconfigured",
      ...(body.status.reason ? { reason: body.status.reason } : {}),
    };
  }
  const items = (body.skills ?? []).filter(
    (s): s is CatalogueItem => !!s && typeof s.name === "string" && SKILL_NAME_RE.test(s.name),
  );

  mkdirSync(targetDir, { recursive: true });
  const wanted = new Set(items.map((s) => s.name));

  for (const item of items) {
    const dir = join(targetDir, item.name);
    const receipt = readReceipt(dir);
    // 目录里只有版本没有摘要：版本相同且本地有回执就先信本地；变了再去取全文。
    if (receipt && item.version && receipt.version === item.version && existsSync(join(dir, "SKILL.md"))) {
      outcome.unchanged.push(item.name);
      continue;
    }
    const one = await getJson(cfg, `${base}/${encodeURIComponent(item.name)}`);
    if (!one.ok) {
      outcome.failed.push({ name: item.name, reason: one.reason });
      continue;
    }
    const fetched = one.body as FetchedSkill;
    if (typeof fetched.content !== "string") {
      outcome.failed.push({ name: item.name, reason: "surface returned no content" });
      continue;
    }
    if (receipt?.digest && fetched.contentDigest && receipt.digest === fetched.contentDigest && existsSync(join(dir, "SKILL.md"))) {
      outcome.unchanged.push(item.name);
      continue;
    }
    const written = writeSkill(dir, item.name, fetched);
    if (!written.ok) {
      outcome.failed.push({ name: item.name, reason: written.reason });
      continue;
    }
    outcome.fetched.push(item.name);
  }

  // 产品不再分发的，本地删掉。
  for (const name of existingSkills(targetDir)) {
    if (!wanted.has(name)) {
      rmSync(join(targetDir, name), { recursive: true, force: true });
      outcome.removed.push(name);
    }
  }
  return outcome;
}

function writeSkill(dir: string, name: string, fetched: FetchedSkill): { ok: true } | { ok: false; reason: string } {
  const parsed = parseSkillMd(fetched.content);
  if (!parsed.ok) return { ok: false, reason: `SKILL.md rejected: ${parsed.reason}` };
  if (parsed.meta.name !== name) {
    return { ok: false, reason: `front matter name "${parsed.meta.name}" does not match catalogue name "${name}"` };
  }
  // 整目录重写：旧资源不残留在新版本旁边。
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), parsed.content);
  const root = resolve(dir);
  for (const r of fetched.resources ?? []) {
    if (typeof r?.uri !== "string" || typeof r.text !== "string") continue;
    const rel = relativeOf(r.uri);
    if (!rel) continue;
    const check = checkResourcePath(rel);
    if (!check.ok) continue; // scripts/ 与越界的不落盘（TD-005）
    const file = resolve(root, check.path);
    if (!file.startsWith(root + sep)) continue;
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, r.text);
  }
  const receipt: Receipt = {
    name,
    fetchedAt: new Date().toISOString(),
    ...(fetched.contentDigest ? { digest: fetched.contentDigest } : {}),
    ...(fetched.version ? { version: fetched.version } : {}),
    ...(fetched.capabilityId ? { capabilityId: fetched.capabilityId } : {}),
  };
  writeFileSync(join(dir, RECEIPT), JSON.stringify(receipt, null, 2));
  return { ok: true };
}

/**
 * `skill://<capability>/<version>/references/x.md` → `references/x.md`。
 * Runos 的资源 URI 形状（210-consumption-contract）；认不出的不落盘。
 */
export function relativeOf(uri: string): string | undefined {
  const m = /^skill:\/\/[^/]+\/[^/]+\/(.+)$/.exec(uri);
  if (m?.[1]) return m[1];
  // 能力面也可能直接给相对路径。
  if (!uri.includes("://")) return uri;
  return undefined;
}

function readReceipt(dir: string): Receipt | undefined {
  try {
    return JSON.parse(readFileSync(join(dir, RECEIPT), "utf8")) as Receipt;
  } catch {
    return undefined;
  }
}

function existingSkills(targetDir: string): string[] {
  try {
    return readdirSync(targetDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && SKILL_NAME_RE.test(d.name))
      .map((d) => d.name);
  } catch {
    return [];
  }
}

async function getJson(
  cfg: DistributionConfig,
  url: string,
): Promise<{ ok: true; body: unknown } | { ok: false; reason: string }> {
  const doFetch = cfg.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 30_000);
  try {
    const token = await cfg.token?.();
    const res = await doFetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, reason: `HTTP ${res.status} ${text.slice(0, 160)}` };
    }
    return { ok: true, body: await res.json() };
  } catch (cause) {
    return { ok: false, reason: cause instanceof Error ? cause.message : String(cause) };
  } finally {
    clearTimeout(timer);
  }
}
