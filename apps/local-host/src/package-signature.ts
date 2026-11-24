import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";
import { CHECKSUMS_ENTRY, SIGNATURE_ENTRY, type PackageContents } from "./pkg.js";

/** Host-provisioned trust only. A key shipped inside a package is never trusted. */
export interface PackageTrust {
  registryKey: KeyObject;
  publisherKeys: ReadonlyMap<string, KeyObject>;
}

export function parsePackageTrust(input: string): PackageTrust {
  const value = JSON.parse(input);
  if (!value || value.version !== 1 || typeof value.publisherKeys !== "object" ||
      value.publisherKeys === null || Array.isArray(value.publisherKeys)) {
    throw new Error("Invalid package trust configuration");
  }
  function key(pem: unknown): KeyObject {
    if (typeof pem !== "string" || !pem.startsWith("-----BEGIN PUBLIC KEY-----")) {
      throw new Error("Package trust requires SPKI public keys");
    }
    const result = createPublicKey(pem);
    if (result.asymmetricKeyType !== "ed25519") throw new Error("Package trust requires Ed25519 keys");
    return result;
  }
  return {
    registryKey: key(value.registryKey),
    publisherKeys: new Map(Object.entries(value.publisherKeys).map(([id, pem]) => [id, key(pem)])),
  };
}

export function countersignaturePayload(publisher: string, checksums: Buffer, signature: string): Buffer {
  return Buffer.from(JSON.stringify([
    "ruyinpkg-registry-ed25519-v1",
    publisher,
    createHash("sha256").update(checksums).digest("hex"),
    signature,
  ]));
}

function decodeSignature(value: unknown): Buffer | undefined {
  if (typeof value !== "string" || value.length !== 88) return;
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 64 && bytes.toString("base64") === value) return bytes;
}

export function verifiedPublisher(contents: PackageContents, trust?: PackageTrust): string | undefined {
  const raw = contents.get(SIGNATURE_ENTRY);
  const checksums = contents.get(CHECKSUMS_ENTRY);
  if (!trust || !raw || !checksums || raw.length > 2048) return;
  if (trust.registryKey.type !== "public" || trust.registryKey.asymmetricKeyType !== "ed25519") return;
  try {
    const envelope = JSON.parse(raw.toString("utf8"));
    if (!envelope || envelope.version !== 1 || typeof envelope.publisher !== "string") return;
    const publisher = trust.publisherKeys.get(envelope.publisher);
    if (!publisher || publisher.type !== "public" || publisher.asymmetricKeyType !== "ed25519") return;
    const author = decodeSignature(envelope.publisherSignature);
    const registry = decodeSignature(envelope.registrySignature);
    if (!author || !registry) return;
    if (!verify(null, countersignaturePayload(envelope.publisher, checksums, envelope.publisherSignature), trust.registryKey, registry)) return;
    if (verify(null, checksums, publisher, author)) return envelope.publisher;
  } catch {
    // Malformed envelopes and crypto errors fail closed.
  }
}
