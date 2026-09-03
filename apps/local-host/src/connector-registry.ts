/**
 * Host-side connector registry (ADR-005 seam ④ and ⑤, host half).
 *
 * The kernel only ever calls `get(id)` on the lookup it was handed. This
 * class owns that lookup: it loads the installed connectors from a manifest
 * in the data dir at startup, starts each one, and puts it in the same Map
 * the kernel reads - so installing a connector does not restart the daemon.
 *
 * Trust posture, from the ADR's four rules. "Source-restricted" and "signed"
 * (rules 1 and 3) are what the .ruyinpkg pipeline will provide once the
 * Registry root exists (TD-012); until then this registry does what the
 * package installer does: **production refuses to install**, and only an
 * explicit development switch allows it. An installed connector is an
 * arbitrary process run with the user's rights - that is precisely the thing
 * rule 1 says must not come from anywhere. "Explicit install" (rule 2) is the
 * POST; "project-scoped authorization" (rule 4) is ConnectorGrant, in the
 * kernel.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ConnectorHealth, ConnectorPort, ContextSource } from "@vxture/ruyin-core";
import { McpConnector, type ConnectorToolOutcome } from "./connector-mcp.js";
import type { ConnectorToolSource } from "./tool-executor.js";

export const CONNECTORS_FILE = "connectors.json";

/** Ids follow the contract's id grammar plus dashes; never local-fs. */
const CONNECTOR_ID = /^[a-z][a-z0-9_-]{0,63}$/;

export interface InstalledConnector {
  id: string;
  transport: "stdio";
  command: string;
  args: string[];
  env?: Record<string, string>;
  /** Which contract source kind this connector serves (lan / private). */
  source: Extract<ContextSource, "lan" | "private">;
  installedAt: string;
}

export interface ConnectorView extends InstalledConnector {
  health: ConnectorHealth;
  /** Tools the running server exposes (tools/list at start); empty when not running. */
  tools: string[];
}

export class ConnectorInstallRefusedError extends Error {}

interface Manifest {
  items: InstalledConnector[];
}

export class ConnectorRegistry implements ConnectorToolSource {
  private readonly manifestPath: string;
  private readonly live = new Map<string, McpConnector>();
  private specs: InstalledConnector[] = [];

  constructor(
    dataDir: string,
    private readonly lookup: Map<string, ConnectorPort>,
    private readonly options: {
      /** Development only. Production leaves this false and refuses installs. */
      allowUnsigned: boolean;
      log?: (line: string) => void;
      timeoutMs?: number;
    },
  ) {
    this.manifestPath = join(dataDir, CONNECTORS_FILE);
  }

  /** Load the manifest and start every connector in it. Failures are reported, not fatal. */
  async load(): Promise<void> {
    this.specs = this.readManifest().items;
    for (const spec of this.specs) {
      try {
        await this.bringUp(spec);
      } catch (cause) {
        // Still registered so the user sees it (with a failing health), and so
        // a binding through it fails with "unavailable" rather than "unknown".
        this.options.log?.(
          `[ruyin] connector "${spec.id}" failed to start: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
    }
  }

  async list(): Promise<ConnectorView[]> {
    const out: ConnectorView[] = [];
    for (const spec of this.specs) {
      out.push({
        ...spec,
        health: await this.healthOf(spec.id),
        tools: this.live.get(spec.id)?.tools() ?? [],
      });
    }
    return out;
  }

  // -- ConnectorToolSource (ADR-005 batch D) ------------------------------

  /** Does any running connector expose this tool - the machine-level question startTask asks. */
  exposes(tool: string): boolean {
    for (const connector of this.live.values()) {
      if (connector.tools().includes(tool)) return true;
    }
    return false;
  }

  /** Which of the *granted* connectors expose this tool - the project-level question execution asks. */
  providersOf(tool: string, granted: readonly string[]): string[] {
    return granted.filter((id) => this.live.get(id)?.tools().includes(tool) ?? false);
  }

  async callTool(
    connector: string,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<ConnectorToolOutcome> {
    const live = this.live.get(connector);
    if (!live) return { content: `connector "${connector}" is not running`, isError: true };
    return live.callTool(tool, args);
  }

  async healthOf(id: string): Promise<ConnectorHealth> {
    const connector = this.live.get(id);
    if (!connector) {
      return { ok: false, detail: "not running", checkedAt: new Date().toISOString() };
    }
    return connector.health();
  }

  /**
   * Install and start a connector. Refused in production until the signing
   * trust anchor exists - see the file header.
   */
  async install(input: {
    id: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
    source: string;
  }): Promise<ConnectorView> {
    if (!this.options.allowUnsigned) {
      throw new ConnectorInstallRefusedError(
        "connector installation is refused until connectors arrive signed (TD-012); " +
          "set RUYIN_ALLOW_UNSIGNED_CONNECTORS=1 for development only",
      );
    }
    if (!CONNECTOR_ID.test(input.id) || input.id === "local-fs") {
      throw new Error(`invalid connector id "${input.id}"`);
    }
    if (this.lookup.has(input.id)) {
      throw new Error(`connector "${input.id}" is already installed`);
    }
    if (!input.command || typeof input.command !== "string") {
      throw new Error("connector command is required");
    }
    if (input.source !== "lan" && input.source !== "private") {
      throw new Error(`connector source must be lan or private, got "${input.source}"`);
    }
    const spec: InstalledConnector = {
      id: input.id,
      transport: "stdio",
      command: input.command,
      args: Array.isArray(input.args) ? input.args.map(String) : [],
      ...(input.env ? { env: input.env } : {}),
      source: input.source,
      installedAt: new Date().toISOString(),
    };
    // Start before persisting: a connector that cannot even initialize is
    // not installed, it is a typo the user should see now.
    await this.bringUp(spec);
    this.specs.push(spec);
    this.writeManifest();
    return { ...spec, health: await this.healthOf(spec.id), tools: this.live.get(spec.id)?.tools() ?? [] };
  }

  async remove(id: string): Promise<void> {
    const idx = this.specs.findIndex((s) => s.id === id);
    if (idx < 0) throw new Error(`connector "${id}" is not installed`);
    const connector = this.live.get(id);
    if (connector) await connector.stop();
    this.live.delete(id);
    this.lookup.delete(id);
    this.specs.splice(idx, 1);
    this.writeManifest();
  }

  /** Stop every running connector (daemon shutdown). */
  async stopAll(): Promise<void> {
    for (const connector of this.live.values()) await connector.stop();
    this.live.clear();
  }

  private async bringUp(spec: InstalledConnector): Promise<void> {
    const { id, command, args, env } = spec;
    const connector = new McpConnector(
      { id, command, args, ...(env ? { env } : {}) },
      this.options.timeoutMs !== undefined ? { timeoutMs: this.options.timeoutMs } : {},
    );
    // Registered before start so a failed start still leaves a name the UI
    // and the kernel can report on ("unavailable", not "unknown connector").
    this.live.set(id, connector);
    this.lookup.set(id, connector);
    await connector.start();
  }

  private readManifest(): Manifest {
    if (!existsSync(this.manifestPath)) return { items: [] };
    try {
      const parsed = JSON.parse(readFileSync(this.manifestPath, "utf8")) as Partial<Manifest>;
      return { items: Array.isArray(parsed.items) ? parsed.items : [] };
    } catch (cause) {
      this.options.log?.(
        `[ruyin] ${CONNECTORS_FILE} unreadable, starting with no connectors: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
      return { items: [] };
    }
  }

  private writeManifest(): void {
    mkdirSync(dirname(this.manifestPath), { recursive: true });
    writeFileSync(this.manifestPath, JSON.stringify({ items: this.specs }, null, 2), "utf8");
  }
}
