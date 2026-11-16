import { test } from "node:test";
import assert from "node:assert/strict";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { materializePythonAliases } from "./materialize-python-aliases.mjs";

test("materializes uv junctions without changing their canonical Python tree", () => {
  const root = mkdtempSync(join(tmpdir(), "ruyin-python-alias-"));
  try {
    const target = join(root, "cpython-3.13.9");
    mkdirSync(target);
    writeFileSync(join(target, "python.exe"), "python fixture");
    const alias = join(root, "cpython-3.13");
    symlinkSync(target, alias, process.platform === "win32" ? "junction" : "dir");
    materializePythonAliases(root);
    assert.equal(lstatSync(alias).isSymbolicLink(), false);
    assert.equal(readFileSync(join(alias, "python.exe"), "utf8"), "python fixture");
    writeFileSync(join(alias, "python.exe"), "independent copy");
    assert.equal(readFileSync(join(target, "python.exe"), "utf8"), "python fixture");
    materializePythonAliases(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects aliases outside the bundled Python tree", () => {
  const root = mkdtempSync(join(tmpdir(), "ruyin-python-boundary-"));
  try {
    const bundle = join(root, "python");
    const external = join(root, "external");
    mkdirSync(bundle);
    mkdirSync(external);
    symlinkSync(external, join(bundle, "alias"), process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => materializePythonAliases(bundle), /Invalid Python/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
