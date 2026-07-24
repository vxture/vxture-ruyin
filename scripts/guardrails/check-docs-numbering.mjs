#!/usr/bin/env node
/**
 * check-docs-numbering.mjs - docs/ numbering hard guardrail.
 *
 * Enforces the docs taxonomy meta-rule (070-docs-taxonomy.md): numbered = formal
 * (permanent), unnumbered = temporary (locate and delete). Walks every .md under
 * docs/; any file that is not an index, not whitelisted, and matches none of the
 * legal numbered shapes is a violation.
 *
 * Template note: this is the platform check-docs-numbering.mjs TIGHTENED. The
 * domain-document pattern is restricted to the strict underscore family
 * `{kind}_{domain}_{NNN}_{slug}` with kind in {data,design,ops} and a
 * hyphen-free domain word. The platform version accepted a loose
 * `{prefix}(_{domain})?_{NNN}` with hyphens (arda's `arda-{sub}-NNN` legacy
 * variant); new product repos do NOT get that exemption.
 *
 * Modes: default lists violations as a worklist (exit 0); `--strict` fails hard
 * (exit 1) for CI. New product repos run --strict from day one.
 */

import { readdirSync, statSync } from "node:fs";
import { join, relative, basename } from "node:path";

const DOCS_ROOT = "docs";
const STRICT = process.argv.includes("--strict");

// Root-level non-docs whitelist (config/entry files that live under docs/ but
// are not taxonomy content). Kept minimal.
const WHITELIST = new Set(["README.md"]);

// Legal "numbered" shapes (any one qualifies):
//   00-index.md / NN(N)-slug.md   -- in-directory sequence (10-step gaps; 00 is
//                                    the index; 2-3 digits, sort-safe)
//   {kind}_{domain}_{NNN}_{slug}  -- domain/schema document, STRICT underscore
//                                    family: kind in {data,design,ops}, domain
//                                    is a hyphen-free canonical word, NNN is the
//                                    three-digit band, slug may use hyphens
//   ADR-NNN* / TD-NNN*            -- append-only type registers
const NUMBERED = [
  /^\d{2,3}-.+\.md$/u,
  /^(data|design|ops)_[a-z][a-z0-9]*_\d{3}_[a-z0-9-]+\.md$/u,
  /^(ADR|TD)-\d{3}.*\.md$/u,
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (name.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

function isNumbered(file) {
  const name = basename(file);
  if (WHITELIST.has(name)) return true;
  return NUMBERED.some((re) => re.test(name));
}

let files;
try {
  files = walk(DOCS_ROOT);
} catch {
  console.log(`[docs-numbering] no ${DOCS_ROOT}/ - skip`);
  process.exit(0);
}

const violations = files
  .filter((f) => !isNumbered(f))
  .map((f) => relative(".", f).replaceAll("\\", "/"))
  .sort();

if (violations.length === 0) {
  console.log(`[docs-numbering] OK - ${files.length} docs, all numbered.`);
  process.exit(0);
}

console.log(
  `[docs-numbering] ${violations.length} unnumbered .md (= temporary/to-delete or to-number; see docs/10-standards/00-index.md):`,
);
for (const v of violations) console.log(`  ${v}`);

if (STRICT) {
  console.error(
    `\n[docs-numbering] STRICT: an unnumbered file is a violation - number it (NN- / {kind}_{domain}_{NNN}_ / ADR- / TD-) or delete it.`,
  );
  process.exit(1);
}
console.log(`\n[docs-numbering] report mode (non-blocking). CI runs --strict.`);
process.exit(0);
