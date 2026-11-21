/**
 * Workspace encryption key management (TD-009; design:
 * RY-301 s.08, formerly 30-design/60 section 7.3).
 *
 *   per-workspace data key (random 32B)
 *       -> wrapped with AES-256-GCM under the master key (<wsDir>/key.enc)
 *   master key (random 32B)
 *       -> Windows: DPAPI-protected file (user scope) - production platform
 *       -> elsewhere: plaintext file, dev-grade, warned loudly
 *
 * The files/ area holds no content yet; it joins this key hierarchy when
 * file storage lands.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

interface DpapiApi {
  protectData(
    data: Uint8Array,
    entropy: Uint8Array | null,
    scope: "CurrentUser" | "LocalMachine",
  ): Uint8Array;
  unprotectData(
    data: Uint8Array,
    entropy: Uint8Array | null,
    scope: "CurrentUser" | "LocalMachine",
  ): Uint8Array;
}

async function loadDpapi(): Promise<DpapiApi | undefined> {
  if (process.platform !== "win32") return undefined;
  try {
    const mod = (await import("@primno/dpapi")) as unknown as {
      Dpapi?: DpapiApi;
      default?: { Dpapi?: DpapiApi };
    };
    return mod.Dpapi ?? mod.default?.Dpapi;
  } catch {
    return undefined;
  }
}

const DPAPI_FILE = "master.key.dpapi";
const PLAIN_FILE = "master.key";

function hasStoredData(dataDir: string): boolean {
  for (const kind of ["projects", "libraries", "workspaces"]) {
    const root = join(dataDir, kind);
    if (existsSync(root) && readdirSync(root, { withFileTypes: true }).some(entry => {
      if (!entry.isDirectory()) return false;
      const dir = join(root, entry.name);
      return existsSync(join(dir, "key.enc")) || ["project.db", "workspace.db"].some(name =>
        existsSync(join(dir, name)) && statSync(join(dir, name)).size > 0);
    })) return true;
  }
  return ["platform/instance-key.bin", "platform/session.bin", "runtime/platform-session.enc", "models/private-model.bin"]
    .some(name => existsSync(join(dataDir, name)));
}

export class KeyManager {
  private constructor(
    private readonly masterKey: Buffer,
    readonly protection: "dpapi" | "plaintext",
  ) {}

  static async open(dataDir: string): Promise<KeyManager> {
    const dir = join(dataDir, "runtime");
    const dpapi = await loadDpapi();
    const dpapiPath = join(dir, DPAPI_FILE);
    const plainPath = join(dir, PLAIN_FILE);

    // Load whichever form exists (a data dir moves between machines only in
    // dev; mixed forms are not migrated automatically).
    if (existsSync(dpapiPath)) {
      if (!dpapi) {
        throw new Error(
          "master key is DPAPI-protected but DPAPI is unavailable on this platform",
        );
      }
      const master = Buffer.from(
        dpapi.unprotectData(readFileSync(dpapiPath), null, "CurrentUser"),
      );
      return new KeyManager(master, "dpapi");
    }
    if (existsSync(plainPath)) {
      return new KeyManager(
        Buffer.from(readFileSync(plainPath, "utf8").trim(), "hex"),
        "plaintext",
      );
    }

    if (hasStoredData(dataDir)) {
      throw new Error("Original master key is missing for existing RUYIN data; restore the original key from backup. No replacement key was created.");
    }
    mkdirSync(dir, { recursive: true });
    const master = randomBytes(32);
    if (dpapi) {
      writeFileSync(
        dpapiPath,
        Buffer.from(dpapi.protectData(master, null, "CurrentUser")),
      );
      return new KeyManager(master, "dpapi");
    }
    writeFileSync(plainPath, master.toString("hex"), { mode: 0o600 });
    console.warn(
      "[ruyin] WARN: master key stored as plaintext file (no OS key protection on this platform) - dev-grade only",
    );
    return new KeyManager(master, "plaintext");
  }

  /** Seal an arbitrary blob under the master key (iv | tag | ciphertext). */
  seal(data: Buffer): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.masterKey, iv);
    const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  }

  /** Open a blob produced by seal(); throws on tampering or wrong key. */
  open(blob: Buffer): Buffer {
    const iv = blob.subarray(0, 12);
    const tag = blob.subarray(12, 28);
    const ciphertext = blob.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", this.masterKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  /** Load or create the per-workspace data key; returns 64-char hex. */
  workspaceKeyHex(wsDir: string): string {
    const path = join(wsDir, "key.enc");
    if (existsSync(path)) {
      return this.open(readFileSync(path)).toString("hex");
    }
    if (["project.db", "workspace.db"].some(name => existsSync(join(wsDir, name)) && statSync(join(wsDir, name)).size > 0)) {
      throw new Error("Original project key.enc is missing for an existing database; restore its original key from backup. No replacement key was created.");
    }
    const key = randomBytes(32);
    writeFileSync(path, this.seal(key));
    return key.toString("hex");
  }
}
