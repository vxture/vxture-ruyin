#!/usr/bin/env node
/**
 * Installer pack orchestration (workplan W4; design 30-design/70 section 7.2):
 *
 *   pnpm -r build
 *     -> pnpm deploy --legacy the daemon (self-contained node_modules incl.
 *        native modules and workspace packages) into apps/shell/out/daemon
 *     -> electron-builder (nsis, or --dir for an unpacked smoke build)
 *
 * Usage: node scripts/release/pack.mjs [--dir]
 *   --dir  build the unpacked win-unpacked/ tree only (fast; used by the
 *          packaged smoke check) instead of the NSIS installer.
 *
 * GFW note: local runs may need ELECTRON_MIRROR and
 * ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
 */

import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const shellDir = join(repoRoot, "apps", "shell");
const daemonOut = join(shellDir, "out", "daemon");
const dirOnly = process.argv.includes("--dir");

function run(cmd, args, cwd) {
  console.log(`[pack] ${cmd} ${args.join(" ")}`);
  const res = spawnSync(cmd, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32", // .cmd shims on Windows
  });
  if (res.status !== 0) {
    console.error(`[pack] FAILED: ${cmd} ${args.join(" ")}`);
    process.exit(res.status ?? 1);
  }
}

// Ensure a full dev install first (a previous run's deploy step may have
// left the workspace production-pruned).
run("pnpm", ["install", "--prefer-offline"], repoRoot);
run("pnpm", ["--recursive", "build"], repoRoot);

rmSync(daemonOut, { recursive: true, force: true });
run(
  "pnpm",
  [
    "--filter",
    "@vxture/ruyin-local-host",
    "deploy",
    "--prod",
    "--legacy",
    daemonOut,
  ],
  repoRoot,
);

// `pnpm deploy --prod` production-installs the WHOLE workspace as a side
// effect, stripping devDependencies (including electron-builder). Restore
// them before packaging.
run("pnpm", ["install", "--prefer-offline"], repoRoot);

run(
  "pnpm",
  ["exec", "electron-builder", "--win", ...(dirOnly ? ["--dir"] : [])],
  shellDir,
);

console.log(`[pack] done -> ${join(shellDir, "release")}`);
