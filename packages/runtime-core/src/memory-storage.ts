/**
 * In-memory StoragePort - the reference implementation of the storage ports.
 * Used by the kernel's own tests and useful for any host's unit tests; it is
 * exported deliberately as executable documentation of the port contract.
 */

import type {
  AuditEvent,
  JournalEntry,
  StoragePort,
  ProjectMeta,
  ProjectStore,
} from "./ports.js";

class MemoryProjectStore implements ProjectStore {
  private meta: ProjectMeta | undefined;
  private contract: string | undefined;
  private businessState: string | undefined;
  private readonly tasks = new Map<string, string>();
  private readonly audit: AuditEvent[] = [];
  private readonly journal: JournalEntry[] = [];

  async putMeta(meta: ProjectMeta): Promise<void> {
    this.meta = meta;
  }
  async getMeta(): Promise<ProjectMeta | undefined> {
    return this.meta;
  }

  async putContract(contractJson: string): Promise<void> {
    this.contract = contractJson;
  }
  async getContract(): Promise<string | undefined> {
    return this.contract;
  }

  private grants: string | undefined;
  private bindings: string | undefined;
  async putGrants(grantsJson: string): Promise<void> {
    this.grants = grantsJson;
  }
  async getGrants(): Promise<string | undefined> {
    return this.grants;
  }
  async putBindings(bindingsJson: string): Promise<void> {
    this.bindings = bindingsJson;
  }
  async getBindings(): Promise<string | undefined> {
    return this.bindings;
  }

  async setBusinessState(state: string): Promise<void> {
    this.businessState = state;
  }
  async getBusinessState(): Promise<string | undefined> {
    return this.businessState;
  }

  async putTaskInstance(id: string, dataJson: string): Promise<void> {
    this.tasks.set(id, dataJson);
  }
  async getTaskInstance(id: string): Promise<string | undefined> {
    return this.tasks.get(id);
  }
  async listTaskInstances(): Promise<string[]> {
    return [...this.tasks.values()];
  }

  async appendAuditEvent(event: AuditEvent): Promise<void> {
    this.audit.push(event);
  }
  async listAuditEvents(): Promise<AuditEvent[]> {
    return [...this.audit];
  }
  async lastAuditHash(): Promise<string | undefined> {
    return this.audit.length > 0
      ? this.audit[this.audit.length - 1]!.hash
      : undefined;
  }

  async appendJournal(entry: JournalEntry): Promise<void> {
    this.journal.push(entry);
  }
  async listJournal(taskInstance: string): Promise<JournalEntry[]> {
    return this.journal.filter((e) => e.taskInstance === taskInstance);
  }
}

export class MemoryStoragePort implements StoragePort {
  private readonly stores = new Map<string, MemoryProjectStore>();

  async createProjectStore(projectId: string): Promise<ProjectStore> {
    if (this.stores.has(projectId)) {
      throw new Error(`workspace store "${projectId}" already exists`);
    }
    const store = new MemoryProjectStore();
    this.stores.set(projectId, store);
    return store;
  }

  async openProjectStore(
    projectId: string,
  ): Promise<ProjectStore | undefined> {
    return this.stores.get(projectId);
  }

  async listProjectIds(): Promise<string[]> {
    return [...this.stores.keys()];
  }
}
