// Build-only archive reuse. The checksum authority remains the lockfile's
// Electron package, never the supplied directory or a caller-supplied receipt.
import { createReadStream, lstatSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

export async function verifyElectronArchive({ directory, version, platform, arch, checksums }) {
  if (typeof directory !== "string" || !directory.trim()) throw Error("RUYIN_ELECTRON_DIST must name an archive directory");
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version ?? "") ||
      !/^[a-z0-9-]+$/.test(platform ?? "") || !/^[a-z0-9-]+$/.test(arch ?? "")) {
    throw Error("Invalid pinned Electron version/platform/architecture");
  }
  const archive = `electron-v${version}-${platform}-${arch}.zip`;
  const expected = checksums && Object.hasOwn(checksums, archive) ? checksums[archive] : undefined;
  if (typeof expected !== "string" || !/^[a-f0-9]{64}$/i.test(expected)) {
    throw Error(`Electron package has no fixed checksum for ${archive}`);
  }
  const root = resolve(directory);
  const rootInfo = lstatSync(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw Error("Electron archive directory must be a regular directory");
  const file = join(root, archive);
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink()) throw Error(`Electron archive must be a regular file: ${archive}`);
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(file)) { hash.update(chunk); bytes += chunk.length; }
  const sha256 = hash.digest("hex");
  if (sha256 !== expected.toLowerCase()) throw Error(`Electron archive checksum mismatch: ${archive}`);
  return { directory: root, archive, sha256, bytes };
}
