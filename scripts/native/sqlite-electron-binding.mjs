#!/usr/bin/env node
/**
 * sqlite-electron-binding.mjs - ensure the Electron-ABI native binding of
 * better-sqlite3-multiple-ciphers is present (TD-010).
 *
 * The Runtime daemon runs inside Electron's bundled Node (the shell forks it
 * as a utilityProcess), whose ABI differs from the host Node's - but the
 * package's install step only fetches a prebuilt for the host Node. This
 * script fetches the matching *electron* prebuilt with the package's own
 * prebuild-install and drops it at
 *
 *   <pkg>/build/electron-v<abi>-<platform>-<arch>/better_sqlite3.node
 *
 * NEXT TO (not over) the host-Node binding, so `node --test` and plain
 * `node dist/main.js` keep working; apps/local-host/src/storage.ts picks the
 * electron file at runtime when process.versions.electron is set.
 *
 * Usage: node scripts/native/sqlite-electron-binding.mjs
 *   [--module-dir <dir>]    package.json dir to resolve the package from
 *                           (default apps/local-host; pack.mjs passes the
 *                           deployed tree apps/shell/out/daemon)
 *   [--electron <version>]  target Electron (default: the `electron` package
 *                           installed under apps/shell)
 *   [--force]               re-fetch even if the binding is already present
 *
 * Network: GitHub release assets, via prebuild-install (honours HTTPS_PROXY /
 * npm_config_https_proxy and its cache ~/.npm/_prebuilds). Mirror override:
 * npm_config_better_sqlite3_multiple_ciphers_binary_host_mirror=<base url>.
 * Idempotent and cheap when the file is present - wired into the shell's
 * start/smoke scripts.
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = "better-sqlite3-multiple-ciphers";
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

function arg(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const moduleDir = resolve(
  arg("--module-dir") ?? join(repoRoot, "apps", "local-host"),
);
const force = process.argv.includes("--force");

function electronVersion() {
  const explicit = arg("--electron");
  if (explicit) return explicit;
  const shellRequire = createRequire(
    join(repoRoot, "apps", "shell", "package.json"),
  );
  return shellRequire("electron/package.json").version;
}

// Resolve the package from the module dir, then its tooling from the package
// itself (prebuild-install and node-abi are its own dependencies, so this
// works in the pnpm store and in a `pnpm deploy --legacy` tree alike).
const pkgDir = dirname(
  createRequire(join(moduleDir, "package.json")).resolve(`${PKG}/package.json`),
);
const pkgRequire = createRequire(join(pkgDir, "package.json"));
const pkgVersion = pkgRequire("./package.json").version;
const prebuildBin = pkgRequire.resolve("prebuild-install/bin.js");
const { getAbi } = createRequire(prebuildBin)("node-abi");

const version = electronVersion();
const abi = getAbi(version, "electron");
const { platform, arch } = process;
const label = `electron-v${abi}-${platform}-${arch}`;
const dest = join(pkgDir, "build", label, "better_sqlite3.node");

if (existsSync(dest) && !force) {
  console.log(`[sqlite-electron] present: ${label} (electron ${version}) -> ${dest}`);
  process.exit(0);
}

// prebuild-install reads package.json from cwd, then chdirs into --path
// (and insists on a package.json there too) and extracts into it. Point cwd
// at the real package and --path at a scratch dir holding a copy of its
// package.json, so the host-Node binding in build/Release is left untouched.
const scratch = join(pkgDir, "build", `.${label}.tmp`);
rmSync(scratch, { recursive: true, force: true });
mkdirSync(scratch, { recursive: true });
copyFileSync(join(pkgDir, "package.json"), join(scratch, "package.json"));
console.log(
  `[sqlite-electron] fetching ${PKG}@${pkgVersion} prebuilt for electron ${version} (${label})`,
);
const res = spawnSync(
  process.execPath,
  [
    prebuildBin,
    "--runtime", "electron",
    "--target", version,
    "--arch", arch,
    "--platform", platform,
    "--path", scratch,
    "--verbose",
  ],
  { cwd: pkgDir, stdio: "inherit" },
);
const produced = join(scratch, "build", "Release", "better_sqlite3.node");
if (res.status !== 0 || !existsSync(produced)) {
  rmSync(scratch, { recursive: true, force: true });
  console.error(
    `[sqlite-electron] FAILED to fetch the ${label} prebuilt of ${PKG}@${pkgVersion} ` +
      `(prebuild-install exit ${res.status ?? "signal"}). Check network / proxy, or set ` +
      `npm_config_better_sqlite3_multiple_ciphers_binary_host_mirror to a mirror of the ` +
      `GitHub release assets.`,
  );
  process.exit(1);
}
mkdirSync(dirname(dest), { recursive: true });
renameSync(produced, dest);
rmSync(scratch, { recursive: true, force: true });
console.log(`[sqlite-electron] ready: ${dest}`);
