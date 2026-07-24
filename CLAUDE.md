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

## What is being built

An Electron shell + an independent Node.js runtime daemon sharing an isomorphic
TypeScript kernel (runtime-core) with the future Cloud Runtime. Architecture
docs live in docs/30-design/ (see docs/00-meta/00-index.md for the legacy
document-number mapping 01..08 used in cross-references).

## Source layout and the publishing boundary

- `packages/` - published to GitHub Packages (@vxture scope), consumed OUTSIDE
  this repo: contract-schema, runtime-core, product-sdk, cli. The cloud runtime
  consumes these as npm packages, never this repo's source.
- `apps/` - never published as packages; shipped only inside the installer:
  local-host (runtime daemon), shell (Electron), ui-workspace (React).
- `products/` - transitional in-repo products (bid). Moves out once the
  contract + SDK stabilize (TD-006).

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

## Required checks (authoritative set of five)

`quality-gate` / `build` / `test-coverage` / `audit` / `gitleaks`. CI job names
must produce exactly these five contexts - renaming a job breaks branch
protection. The ruleset (docs/50-deployment/rebuild/main-ruleset.json) is
applied AFTER the first green CI run on main (TD-002 tracks this bootstrap).

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
- Contract validation rules R1-R12 are the single authority
  (30-design/30-contract-schema.md); the `lint:contract` guardrail enforces
  them once the CLI lands (TD-004).

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
