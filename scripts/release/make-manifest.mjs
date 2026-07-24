#!/usr/bin/env node
/**
 * Generate the website download manifest + SHA256SUMS for a channel
 * (contract: 30-design/70-repo-organization.md section 7.3 - the website
 * renders downloads from manifest.json alone).
 *
 * Usage: node scripts/release/make-manifest.mjs <channel> <version> [baseUrl]
 *   channel  stable | beta
 *   baseUrl  defaults to the dl host layout; overridable until L2 settles.
 *
 * Reads installers from apps/shell/release/, writes manifest.json and
 * SHA256SUMS next to them.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const [channel, version, baseUrlArg] = process.argv.slice(2);
if (!channel || !version || !["stable", "beta"].includes(channel)) {
  console.error(
    "usage: make-manifest.mjs <stable|beta> <version> [baseUrl]",
  );
  process.exit(2);
}
const baseUrl = (baseUrlArg ?? `https://dl.vxture.com/ruyin/${channel}`).replace(
  /\/+$/,
  "",
);

const releaseDir = join(
  fileURLToPath(new URL("../..", import.meta.url)),
  "apps",
  "shell",
  "release",
);

const installers = readdirSync(releaseDir).filter((f) => f.endsWith(".exe"));
if (installers.length === 0) {
  console.error(`no .exe found in ${releaseDir}`);
  process.exit(1);
}

const sums = [];
const platforms = {};
for (const file of installers) {
  const full = join(releaseDir, file);
  const sha256 = createHash("sha256").update(readFileSync(full)).digest("hex");
  sums.push(`${sha256}  ${file}`);
  platforms["win32-x64"] = {
    url: `${baseUrl}/${file}`,
    sha256,
    size: statSync(full).size,
  };
}

const manifest = {
  product: "ruyin",
  channel,
  version,
  platforms,
  releasedAt: new Date().toISOString(),
};

writeFileSync(join(releaseDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(join(releaseDir, "SHA256SUMS"), sums.join("\n") + "\n");
console.log(`[manifest] ${channel} ${version}`);
console.log(JSON.stringify(manifest, null, 2));
