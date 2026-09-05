# vxture-ruyin Repository Standards

Authoritative working agreement for this repo. Ruyin is the Business Workspace
Runtime for Vxture AI-native business products - a DESKTOP-DISTRIBUTION repo,
not a deployed web service. The platform template (vxture-template) explicitly
does not apply to ruyin (product_240 section 0.3); this repo inherits the org
governance base (140-repo-governance-standard.md) and replaces the deployment
profile: tag-to-environment becomes tag-to-channel, deploying a service becomes
publishing artifacts. Full design: docs/30-design/70-repo-organization.md.

**Package manager: pnpm** (whole-stack, org-wide). Authority for governance
lives in the platform repo (`D:\MyWebSite\vxture\vxture-platform`):
`140-repo-governance-standard.md` (base), `070-docs-taxonomy.md` (docs
numbering). Gaps are fixed in the platform standard first, then mirrored here.

## Naming

Brand = product = RUYIN, uppercase, with the tag "Intelligent Workbench"
(owner, 2026-09-03). That is what the product shows about itself: the
wordmark in the title bar, the document title, the login and about pages.
Do not reintroduce a parallel Chinese name next to the wordmark.

Three things deliberately stay capitalized "Ruyin", not uppercase (owner):
the installer, Start-menu and executable name (productName / artifactName,
"Ruyin-Setup-x.y.z.exe"); apps/shell's app.setName("Ruyin"), which keys the
userData path on installed machines and is a path, not a name; and prose in
docs, which may keep writing "Ruyin" (with its Chinese name) as ordinary
text.
Lowercase "ruyin" is for identifiers only (@vxture scope, RUYIN_* env vars,
paths, the daemon's log prefix).

## What is being built

An Electron shell + an independent Node.js runtime daemon sharing an isomorphic
TypeScript kernel (runtime-core) with the future Cloud Runtime. Architecture
docs live in docs/30-design/ (see docs/00-meta/00-index.md for the legacy
document-number mapping 01..08 used in cross-references).

## Source layout and the publishing boundary

- `packages/` - published to GitHub Packages (@vxture scope), consumed OUTSIDE
  this repo: contract-schema, runtime-core, document, cli. The cloud runtime
  consumes these as npm packages, never this repo's source. (product-sdk is
  planned, not present - workplan W3; do not list it as if it existed.)
- `apps/` - never published as packages; shipped only inside the installer:
  local-host (runtime daemon), shell (Electron), ui-workspace (React).
- `products/` - the test fixture (bidproposal), kept in-repo on purpose (TD-006,
  standing): no product code lives here and none will; it ships inside the
  installer so the home page is not empty, which is why it must look like
  what it is (TD-033).

## Branch model and release channels

Single long-lived branch: `main` (trunk-based). Feature branch -> PR -> squash
merge -> branch deleted. Merging to main never publishes anything.

Releases are tag-triggered (channel, not environment):

- `beta-YYYYMMDD.N` tag -> beta channel (no approval gate)
- `vX.Y.Z` tag -> stable channel, gated by a required reviewer on the
  `production` GitHub Environment

Artifacts flow three ways (docs/30-design/70-repo-organization.md section 6):
npm packages -> GitHub Packages; installer + update feed -> website platform
download (dl host, manifest.json contract); .ruyinpkg product packages ->
static registry directory (real Registry service later).

## Required checks (five org-wide, plus one for distribution repos)

`quality-gate` / `build` / `test-coverage` / `audit` / `gitleaks` are the
org-wide floor - no repo may drop one. CI job names must produce these contexts
exactly: renaming a job breaks branch protection.

Ruyin adds a sixth, `packaged-smoke`: it builds the installer and actually
launches the packaged app. The other five can all be green while the shipped
artifact does not start - a dependency missing from the deployed tree, a native
module built for the wrong ABI, or one that silently degrades when it fails to
resolve. Only running the packaged thing sees that. Governance basis: ruyin's
own call as a desktop-distribution repo the platform template explicitly
excludes (product_240 section 0.3) - not contingent on any org-wide standard.
A parallel proposal to generalize this for all distribution repos is open at
vxture-platform#131 (see docs/60-operations/10-tech-debt.md TD-025); ruyin
does not wait on it to land.

The ruleset (docs/50-deployment/rebuild/main-ruleset.json) documents intent;
GitHub only enforces what has been applied to it (TD-002 covers the bootstrap).

## Secret hygiene (four layers) and the client-zero-secrets rule

Credentials never enter the repo - push protection + gitleaks CI + local
.husky/pre-commit (wire once per clone: `git config core.hooksPath .husky`) +
public posture, all-rights-reserved (no LICENSE file, no license field).

Desktop-specific hard rule: the shipped client contains ZERO secrets. All
client-side configuration is public by design. Signing keys live only in CI;
user tokens live only in the user's OS credential store.

## Engineering hard rules (from the design baseline)

- No `execute_script`-class tool may enter the contract schema before an
  OS-level execution sandbox exists (TD-005; 30-design/60 section 13).
- AI usage is metered at the Vxture AI Gateway server-side, never self-reported
  by the client (30-design/70 section 2.1).
- runtime-core stays host-agnostic: no Node/Electron APIs in the kernel, hosts
  implement the ports (30-design/60 section 6).
- The contract validation rules (R-series, sparse numbering - the authority
  is the table in 30-design/30-contract-schema.md section 15, never a range
  written here) are the single authority; the `lint:contract` guardrail
  enforces them (TD-004 closed).

## Docs taxonomy

`docs/` follows the org taxonomy: decades 00-meta / 10-standards / 20-specs /
30-design / 40-implementation / 50-deployment / 60-operations / 70-workplan /
80-liaison / 90-memory; map in docs/00-meta/00-index.md. Numbered = formal,
unnumbered = temporary (delete or number it), enforced by
`pnpm lint:docs-numbering`. ADRs: docs/30-design/decisions/ (append-only).
Tech debt register: docs/60-operations/10-tech-debt.md (TD-NNN). Workplan:
docs/70-workplan/10-workplan.md.

## Repository hygiene

- Keep the working tree clean; never commit runtime artifacts, installers,
  or .ruyinpkg files (git-ignored on purpose).
- After a merge, prune stale remotes: `git fetch --prune`.
- Keep root meta files (.gitignore, .editorconfig, .gitattributes, .npmrc,
  .gitleaks.toml, CLAUDE.md, README.md) ASCII-only.
