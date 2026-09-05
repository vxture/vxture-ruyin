/**
 * Skills in the kernel (ADR-018 §2.4): the two built-in tools a model uses to
 * read a declared skill, and the checks that keep them honest.
 *
 * A skill is an instruction package - `SKILL.md` plus optional `references/`
 * `assets/` `scripts/` (agentskills.io). The registry is the host's: it is a
 * set of directories on a machine, layered bundled < distributed < user <
 * project, and the kernel only sees it through `SkillsPort`. What the kernel
 * does own is the *shape* of the two tools, because a skill read must pass
 * the same Tool Gate as every other call - a tool the gate cannot see is a
 * tool it cannot refuse, and "reading a text file" is still a call the model
 * chose to make.
 *
 * Progressive disclosure, as dsh does it: the turn carries only name +
 * description per declared skill (`TurnRequest.skills`), the model asks for
 * the full text with `use_skill`, and for a reference file with
 * `read_skill_resource`. Neither tool is declared in a contract's `tools[]`:
 * they come with `tasks[].skills`, and exist only for a task that declares
 * some.
 */

import type { Tool } from "@vxture/ruyin-contract-schema";
import type { SkillDocument } from "./ports.js";

export const USE_SKILL = "use_skill";
export const READ_SKILL_RESOURCE = "read_skill_resource";

/**
 * Both are `local_read` at `allow`: they read files that shipped with the
 * product or that the user put in place, never the user's business data. The
 * contract's `permissions.local_read` still applies on top (PERMISSION_KEY in
 * the gate), so a contract that asks before any local read asks here too.
 */
export const SKILL_TOOLS: readonly Tool[] = [
  {
    id: USE_SKILL,
    category: "local_read",
    risk: "low",
    default: "allow",
    input_schema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
  {
    id: READ_SKILL_RESOURCE,
    category: "local_read",
    risk: "low",
    default: "allow",
    input_schema: {
      type: "object",
      properties: { name: { type: "string" }, path: { type: "string" } },
      required: ["name", "path"],
    },
  },
];

export function isSkillTool(id: string): boolean {
  return id === USE_SKILL || id === READ_SKILL_RESOURCE;
}

export function skillTool(id: string): Tool | undefined {
  return SKILL_TOOLS.find((t) => t.id === id);
}

export type ResourcePathCheck = { ok: true; path: string } | { ok: false; reason: string };

/**
 * A resource path is relative, stays inside the skill directory, and names a
 * file under `references/` or `assets/` (ADR-018 §2.4).
 *
 * `scripts/` is refused by name rather than merely absent from the listing:
 * skill scripts do not run locally until an OS-level sandbox exists (TD-005),
 * and handing a model the script text invites it to ask for the run anyway.
 * The host re-checks the same thing when it opens the file; a check that
 * exists in one layer stops existing when someone adds a second caller.
 */
export function checkResourcePath(input: string): ResourcePathCheck {
  const path = input.replaceAll("\\", "/");
  if (!path) return { ok: false, reason: "path is empty" };
  if (path.startsWith("/") || /^[a-zA-Z]:/.test(path)) {
    return { ok: false, reason: `path "${input}" must be relative to the skill directory` };
  }
  const segments = path.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) {
    return { ok: false, reason: `path "${input}" must not leave the skill directory` };
  }
  const top = segments[0];
  if (top === "scripts") {
    return {
      ok: false,
      reason: `"${input}" is under scripts/: skill scripts do not run locally and are not read here (TD-005)`,
    };
  }
  if ((top !== "references" && top !== "assets") || segments.length < 2) {
    return { ok: false, reason: `path "${input}" must be a file under references/ or assets/` };
  }
  return { ok: true, path };
}

/**
 * What `use_skill` hands back: the SKILL.md verbatim, then - as data, not as
 * a sentence - the files the model may ask for next. The author's text is
 * not paraphrased; the runtime sends facts (ADR-011).
 */
export function renderSkillDocument(doc: SkillDocument): string {
  if (doc.resources.length === 0) return doc.content;
  return `${doc.content}\n\n[skill resources: ${doc.name}]\n${doc.resources
    .map((r) => `- ${r}`)
    .join("\n")}`;
}
