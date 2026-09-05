/**
 * In-memory SkillsPort - reference implementation for kernel tests and host
 * unit tests, the way MemoryConnector stands in for a connector.
 *
 * A host that has no registry does not use this: it leaves `ports.skills`
 * unset, and a task that declares skills is refused by name (ADR-018 §2.5).
 * This exists so a test can run a contract that declares real, bundled skill
 * names without pulling the bundled layer first - `forContract` answers for
 * every name the contract declares, with a stub SKILL.md.
 */

import type { SkillDocument, SkillResource, SkillSummary, SkillsPort } from "./ports.js";

export interface MemorySkill {
  name: string;
  description: string;
  /** SKILL.md verbatim; defaults to a minimal front matter + heading. */
  content?: string;
  /** Relative resource paths (references/… assets/…) with their text. */
  resources?: Record<string, string>;
  version?: string;
}

interface Stored {
  name: string;
  description: string;
  content: string;
  resources: Record<string, string>;
  version?: string;
}

export class MemorySkills implements SkillsPort {
  private readonly byName = new Map<string, Stored>();

  constructor(skills: MemorySkill[] = []) {
    for (const s of skills) this.add(s);
  }

  /** One stub entry per name any task in the contract declares. */
  static forContract(contract: { tasks: Array<{ id: string; skills?: string[] }> }): MemorySkills {
    const out = new MemorySkills();
    for (const task of contract.tasks) {
      for (const name of task.skills ?? []) {
        if (!out.byName.has(name)) out.add({ name, description: `stub for ${name} (declared by task ${task.id})` });
      }
    }
    return out;
  }

  add(skill: MemorySkill): void {
    this.byName.set(skill.name, {
      name: skill.name,
      description: skill.description,
      content: skill.content ?? `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n# ${skill.name}\n`,
      resources: skill.resources ?? {},
      ...(skill.version ? { version: skill.version } : {}),
    });
  }

  remove(name: string): void {
    this.byName.delete(name);
  }

  async resolve(name: string): Promise<SkillSummary | undefined> {
    const s = this.byName.get(name);
    return s
      ? { name: s.name, description: s.description, layer: "user", ...(s.version ? { version: s.version } : {}) }
      : undefined;
  }

  async read(name: string): Promise<SkillDocument | undefined> {
    const s = this.byName.get(name);
    if (!s) return undefined;
    return {
      name: s.name,
      description: s.description,
      layer: "user",
      ...(s.version ? { version: s.version } : {}),
      content: s.content,
      resources: Object.keys(s.resources).sort(),
    };
  }

  async readResource(name: string, path: string): Promise<SkillResource> {
    const s = this.byName.get(name);
    if (!s) return { kind: "unavailable", reason: `skill "${name}" is not available` };
    const text = s.resources[path];
    return text === undefined
      ? { kind: "unavailable", reason: `no such resource "${path}" in skill "${name}"` }
      : { kind: "text", text };
  }
}
