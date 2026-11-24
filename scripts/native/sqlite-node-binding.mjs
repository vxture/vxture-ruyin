#!/usr/bin/env node
// Run with the same Node executable that will launch the development host.
// Keep ABI-specific bindings alongside the package default and Electron build.
import { createRequire } from 'node:module';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../..', import.meta.url));
const hostRequire = createRequire(join(root, 'apps/local-host/package.json'));
const pkgDir = dirname(hostRequire.resolve('better-sqlite3-multiple-ciphers/package.json'));
const pkgRequire = createRequire(join(pkgDir, 'package.json'));
const label = `node-v${process.versions.modules}-${process.platform}-${process.arch}`;
const destination = join(pkgDir, 'build', label, 'better_sqlite3.node');

if (!existsSync(destination)) {
  mkdirSync(join(pkgDir, 'build'), { recursive: true });
  const scratch = mkdtempSync(join(pkgDir, 'build', '.node-prebuild-'));
  try {
    copyFileSync(join(pkgDir, 'package.json'), join(scratch, 'package.json'));
    const result = spawnSync(process.execPath, [pkgRequire.resolve('prebuild-install/bin.js'),
      '--runtime', 'node', '--target', process.versions.node,
      '--arch', process.arch, '--platform', process.platform, '--path', scratch],
      { cwd: pkgDir, stdio: 'inherit' });
    const produced = join(scratch, 'build/Release/better_sqlite3.node');
    if (result.status !== 0 || !existsSync(produced)) {
      throw new Error(`Official SQLite prebuild download failed for ${label}`);
    }
    mkdirSync(dirname(destination), { recursive: true });
    renameSync(produced, destination);
  } finally {
    if (dirname(scratch) !== join(pkgDir, 'build')) throw new Error('Unexpected scratch directory');
    rmSync(scratch, { recursive: true, force: true });
  }
}

// Verify an encrypted round trip with disposable data in THIS runtime.
const Database = hostRequire('better-sqlite3-multiple-ciphers');
const probeDir = mkdtempSync(join(tmpdir(), 'ruyin-sqlite-probe-'));
const probeFile = join(probeDir, 'probe.db');
const key = randomBytes(32).toString('hex');
let db;
try {
  db = new Database(probeFile, { nativeBinding: destination });
  db.pragma("cipher = 'sqlcipher'");
  db.pragma(`key="x'${key}'"`);
  db.exec('CREATE TABLE probe(value TEXT); INSERT INTO probe VALUES (\'binding-ready\')');
  const version = db.prepare('select sqlite_version() as version').get().version;
  db.close();
  if (readFileSync(probeFile).subarray(0, 16).toString() === 'SQLite format 3\0') throw new Error('Database was not encrypted');
  db = new Database(probeFile, { nativeBinding: destination });
  db.pragma("cipher = 'sqlcipher'");
  db.pragma(`key="x'${key}'"`);
  if (db.prepare('SELECT value FROM probe').get().value !== 'binding-ready') throw new Error('Encrypted database round trip failed');
  console.log(`[sqlite-node] ready: ${label}; SQLite ${version}`);
} finally {
  if (db?.open) db.close();
  if (dirname(probeDir) !== tmpdir()) throw new Error('Unexpected probe directory');
  rmSync(probeDir, { recursive: true, force: true });
}
