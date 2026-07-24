# vxture-ruyin

Ruyin - the Business Workspace Runtime for Vxture AI-native business products.
This repo builds the local (desktop) runtime: an Electron shell plus an
independent Node.js runtime daemon sharing an isomorphic TypeScript kernel
(runtime-core) with the future Cloud Runtime.

This is a DESKTOP-DISTRIBUTION repository, not a deployed web service. It
inherits the org governance base (trunk-based main, five required CI checks,
four-layer secret hygiene, SCA gate, docs numbering) and replaces the
deployment profile with a release model: tag-to-channel artifact publishing
(installer + update feed to the website download host, npm packages to GitHub
Packages, .ruyinpkg product packages to a static registry directory).

## Design documentation

The full design baseline lives under `docs/` (org taxonomy). Start at
`docs/00-meta/00-index.md` for the map and the legacy document-number
(01..08) cross-reference table. Key documents:

| Doc | Path |
|-----|------|
| Product strategy | docs/20-specs/10-product-strategy.md |
| Workspace runtime architecture | docs/30-design/10-workspace-runtime.md |
| Runtime contract + schema | docs/30-design/20-runtime-contract.md, 30-contract-schema.md |
| Context architecture | docs/30-design/40-context-architecture.md |
| Harness (task execution kernel) | docs/30-design/50-harness.md |
| Technical architecture | docs/30-design/60-technical-architecture.md |
| Repo organization and release model | docs/30-design/70-repo-organization.md |
| Product integration guide | docs/40-implementation/10-product-integration-guide.md |

## Layout

```
packages/   published libraries (@vxture scope): contract-schema, runtime-core,
            product-sdk, cli
apps/       installer-only applications: local-host (runtime daemon),
            shell (Electron), ui-workspace (React)
products/   transitional in-repo business products (bid)
docs/       org-taxonomy documentation
scripts/    guardrails and release tooling
```

## Local development

```bash
pnpm install
pnpm build
pnpm test
pnpm lint:contract
pnpm lint:docs-numbering
```

Electron binary downloads are slow/stalled behind the GFW - set the mirror
first (one-time per shell, or persist it in your user env):

```bash
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
```

The better-sqlite3-multiple-ciphers prebuilt binding also downloads from
GitHub releases. If install falls back to node-gyp and fails, fetch the
prebuild through a GitHub proxy (e.g. ghfast.top) and extract it into the
package dir - see docs/60-operations/ notes; CI runners need neither
workaround.

Run the desktop shell (spawns the runtime daemon, opens the dev console;
the same console is reachable from any browser at the printed URL):

```bash
pnpm --filter @vxture/ruyin-shell start
```

Wire the local secret-scan hook once per clone:

```bash
git config core.hooksPath .husky
```

A `NODE_AUTH_TOKEN` with read access to GitHub Packages is needed once
@vxture-scoped dependencies appear (see `.npmrc`).

## Working agreement

See [CLAUDE.md](CLAUDE.md): branch model, tag-to-channel release flow, the five
required CI checks, secret hygiene, the client-zero-secrets rule, and the
engineering hard rules from the design baseline. Current work queue:
`docs/70-workplan/10-workplan.md`. Known debt: `docs/60-operations/10-tech-debt.md`.
