/**
 * In-memory ConnectorPort - reference implementation for kernel tests and
 * host unit tests. Items are registered per binding root.
 */

import type { Binding, ConnectorPort, ContextItem, ContextItemMeta } from "./ports.js";

export class MemoryConnector implements ConnectorPort {
  private readonly byRoot = new Map<string, ContextItem[]>();

  register(root: string, items: Array<Omit<ContextItem, "source">>): void {
    this.byRoot.set(
      root,
      items.map((i) => ({ ...i, source: "memory" })),
    );
  }

  async discover(binding: Binding): Promise<ContextItemMeta[]> {
    return (this.byRoot.get(binding.root) ?? [])
      .filter((i) => i.type === binding.type)
      .map(({ content: _content, ...meta }) => meta);
  }

  async read(item: ContextItemMeta): Promise<ContextItem> {
    for (const items of this.byRoot.values()) {
      const found = items.find((i) => i.id === item.id);
      if (found) return found;
    }
    throw new Error(`memory connector: item "${item.id}" not found`);
  }
}
