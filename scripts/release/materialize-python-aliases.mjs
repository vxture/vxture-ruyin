import { cpSync, lstatSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

// uv creates major/minor directory aliases. MakeAppx requires real files and
// directories; retain the aliases as independent trees before offline validation.
export function materializePythonAliases(root) {
  const base = realpathSync(root);
  for (const name of readdirSync(base)) {
    const alias = join(base, name);
    if (!lstatSync(alias).isSymbolicLink()) continue;
    const target = realpathSync(alias);
    const inside = relative(base, target);
    if (!inside || inside.startsWith("..") || isAbsolute(inside) || !lstatSync(target).isDirectory()) {
      throw new Error(`Invalid Python directory alias: ${name}`);
    }
    const temporary = mkdtempSync(join(base, ".materialize-"));
    try {
      cpSync(target, join(temporary, "tree"), { recursive: true, dereference: true });
      rmSync(alias); // Unlink only: never recursively remove the junction target.
      renameSync(join(temporary, "tree"), alias);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }
}
