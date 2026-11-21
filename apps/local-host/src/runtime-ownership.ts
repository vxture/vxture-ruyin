/**
 * OS-managed ownership of runtime paths, acquired before storage access.
 * @package @vxture/ruyin-local-host
 */
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

/** Resolve existing ancestors too, so junction aliases share ownership. */
function canonicalPath(path: string): string {
  let current = resolve(path);
  const tail: string[] = [];
  for (;;) {
    try {
      const canonical = join(realpathSync.native(current), ...tail);
      return process.platform === "win32" ? canonical.toLowerCase() : canonical;
    } catch (error) {
      if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      tail.unshift(basename(current));
      current = parent;
    }
  }
}

/** A listening pipe/socket is released by the OS even after a forced exit. */
export async function acquireRuntimeOwnership(paths: string[]): Promise<() => Promise<void>> {
  const servers: Server[] = [];
  const release = async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))));
  };
  try {
    for (const path of [...new Set(paths.map(canonicalPath))].sort()) {
      const hash = createHash("sha256").update(path).digest("hex");
      const address = process.platform === "win32"
        ? `\\\\.\\pipe\\ruyin-owner-${hash}`
        : process.platform === "linux"
          ? `\0ruyin-owner-${hash}`
          : join(tmpdir(), `ruyin-owner-${hash}.sock`);
      const server = createServer((socket) => socket.destroy());
      await new Promise<void>((ok, fail) => {
        server.once("error", fail);
        server.listen(address, () => {
          server.removeListener("error", fail);
          ok();
        });
      }).catch((cause: unknown) => {
        throw new Error(`RUYIN runtime ownership unavailable for ${path}; close the other runtime before starting or migrating.`, { cause });
      });
      servers.push(server);
      server.unref();
    }
    return release;
  } catch (error) {
    await release();
    throw error;
  }
}
