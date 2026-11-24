# B6.4 - Shared runtime dependencies for Bid Web migration

Registered 2026-11-25 before implementation under the owner's standing local
RY task-registration exception recorded in the delivery-readiness worktree.
The owner directed continued batch execution from the complete existing desktop
application, preserving the original workflow sidebar and business kernel.

## First stage: reconcile existing public-package implementation

Base: reviewed remote main `3d3df8169b25957c56f322a5e8438ada42b1d40e`.
Source: the fixed delivery baseline
`8fb4cfcabb2cacc1e3842de54491d7bb9286cca6`, already covered by open PR #311.
Do not merge the unrelated installer, Store or application changes from that
larger PR to obtain these package dependencies.

Replay only the following twelve existing files, preserving their actual
behavior and tests. Reconcile the existing engineering references for the
optional contract fields and task snapshot/recovery behavior.

- `packages/contract-schema/src/compare.ts`
- `packages/contract-schema/src/contract.test.ts`
- `packages/contract-schema/src/rules.ts`
- `packages/contract-schema/src/schema.ts`
- `packages/contract-schema/src/types.ts`
- `packages/document/src/document.test.ts`
- `packages/document/src/document.ts`
- `packages/document/src/docx.ts`
- `packages/runtime-core/src/core.test.ts`
- `packages/runtime-core/src/harness.ts`
- `packages/runtime-core/src/ports.ts`
- `packages/runtime-core/src/project.ts`

Engineering references: `docs/30-design/30-contract-schema.md` and
`docs/30-design/50-harness.md`. Register this stage in the existing workplan
index. The existing shared-shape guard also requires the optional
`documentRevision` field in `apps/ui-workspace/src/api.ts` to match the kernel's
context metadata; align that type without adding UI behavior or routes.
No local-host HTTP endpoint, product identity route, platform contract
or operating-system adapter is added by this stage.

Acceptance: package build/type/tests and coverage; the real current Bid 0.2
contract accepted by the reconciled schema; locked project-document snapshots
reach inference only after consent; changed/missing/oversized inputs fail before
inference; task recovery does not duplicate accepted work; existing app
type/build compatibility; required PR and main checks. Use a clean independent
worktree and preserve both dirty development checkouts.

The four public packages remain in the existing lockstep release process.
Source reconciliation does not publish npm packages or change the Store file.
A compatible package release requires the reviewed exact source and its
existing `packages-v*` pipeline; no direct local publication or installer tag.

## Following stage: share the original presentation

The desktop sidebar, project home/library/settings and task confirmation areas
are part of the complete application. They currently live in the private
installer UI. Define a narrow public presentation package with injected
environment actions and labels, extracted from those existing components.
Original desktop and Bid Web must consume the same implementation. Keep
desktop-native chrome and global RUYIN settings host-owned.

Register its concrete component, test, stylesheet, export and publishing-file
scope here before editing. Do not copy the whole private application or daemon
into Bid, add a replacement editor, use a horizontal workflow, or invent
runtime results while backend adapters remain incomplete.

No platform source, worker01 configuration, production runtime, credentials,
database, product execution grant or cross-environment synchronization change.

## First-stage local acceptance

The existing twelve package changes are reconciled in an independent worktree.
Additional targeted cases verify project-document schema/source restrictions,
incompatible rebinding, request-key project/task scope and UTF-8 input ceilings.
The UI context metadata type retains the optional document revision so the
existing shared-shape guard stays effective.

Local recursive build/type-check and all 1,592 workspace tests passed: 190
shared-package, 634 UI, 715 host and 53 shell tests. Existing coverage gates
remain unchanged. The actual Bid 1.17.2 packaged 0.2 contract passes the
reconciled schema; the existing fixture and public-package version/order,
shared-shape, API and documentation guardrails pass. Public package release
and current required PR/main checks remain separate acceptance steps.

Packed all four candidate npm archives and installed them in a separate
consumer. Using only their public exports, the actual Bid 1.17.2 contract
created its `plan_outline` task, required context consent before a synthetic
gateway turn, retained revision 7 and recovered the same task ID after opening
a new harness. The document archive preserved clock text and emitted a real
DOCX ZIP. This is archive-consumption evidence, not a registry publication or
production-provider acceptance.

The broader script suite on this Windows host ran 180 cases: 177 passed, two
existing CSS-token fixture tests failed at filesystem symlink creation with
`EPERM`, and one case was skipped. Do not weaken those assertions or alter OS
policy to hide the host limitation; the unchanged suite must pass in Linux CI.

## Required audit repair

The first PR CI exposed existing main-lockfile advisories in Electron,
systeminformation, Vite/Vitest, brace-expansion, fast-uri, glob, ip-address,
minimatch, source-map-js and Undici. The original delivery baseline already
contains their verified dependency updates. Replay only the security dependency
fields in the three app manifests (retain application versions), existing
bounded overrides in `pnpm-workspace.yaml`, and the corresponding lockfile.
Regenerate `apps/ui-workspace/src/third-party-list.ts` with the existing script.
Do not add audit exceptions, change required checks or copy installer/Store code.
Rebuild and rerun the affected workspace suites and exact CI audit before merge.

Linux CI then exposed a pre-existing HTTP connector test race: the fake server
scheduled listener shutdown, but an existing keep-alive connection could still
serve the asserted read. In `apps/local-host/src/connector-mcp-http.test.ts`,
explicitly await the fake server's existing close method (which also closes
connections), then assert the same unavailable result and clean up in finally.
No connector implementation, refusal assertion or coverage threshold changes.

## Public build API follow-up

Bid's current build still locates `packProduct` and `writeZip` through a RUYIN
checkout path. Before publishing the first compatible 0.2.0 package, add the
explicit `@vxture/ruyin-cli` library entry in `packages/cli/src/index.ts` and
`packages/cli/package.json`, exporting these existing build functions without
changing their implementation or binary entry. Verify a packed-archive consumer
can build the real Bid product through this public entry. Bid can then pin the
published package and remove the cross-repository build argument. No product
SDK, local-host API or runtime presentation package is introduced here.

## B6.4.2 shared presentation implementation scope

Extract the original project presentation into `packages/workbench-ui` as
`@vxture/ruyin-workbench-ui`. Move the existing workflow sidebar, product home,
library picker, project/settings/task confirmation panel, pending inbox,
product-surface/bridge metadata, audit-chain display, typed UI client/SSE and
locale/provider/catalog modules, their tests and current application CSS.
Keep re-export/import wrappers at their old app paths so the original desktop
uses the same source. This is relocation, not a redesign or a second UI.

The module retains the same native client defaults. Add only an injectable
request transport for product-owned Web routing and an optional product canvas
slot in the original project panel. Browser file selection will use an explicit
environment adapter; do not expose server filesystem input as a Web feature.

Update `apps/ui-workspace/package.json`, package/public exports, TS/Vitest
configuration, the necessary lockfile, existing package publish order, version
manifests and architecture/entry docs. All five public packages release in the
existing lockstep process as 0.2.1. Update i18n, shared-shape and CSS-token guards
to check the relocated source as well as native app composition; do not drop
their assertions. Retain existing coverage thresholds in both test locations.

Acceptance: original desktop build and full tests; original project/sidebar/
review behavior against the moved components; independent installed-package Web
composition and visual desktop/narrow-screen comparison. No global RUYIN
settings, Electron shell or daemon is included in the public presentation entry.
No platform change, production release or synchronization behavior.

### Local presentation acceptance

The original modules and styles now live in the public package; desktop paths
are implementation-free re-exports. The injected transport, product canvas and
browser upload/context slots preserve the same task and review controls. The
shared suite passed 335 cases with 100% line coverage; the combined native/shared
suite passed 806 cases (99.48% statements, 96.27% branches, 99.12% functions,
100% lines). Coverage runs from the repository root so moved implementation is
measured together with its original native callers, without lowering gates.
Recursive build/type-check and 35 focused version/order/shape guard tests pass.
Installed-registry Web composition and production runtime acceptance follow
after the reviewed package release; these local results do not imply deployment.

## B6.5 reusable Node runtime adapters

Continue the authorized full desktop-to-Web migration by extracting the original
storage/file store, background jobs, task runner/queue, event bus, document
reading/rendering, product library, download tickets and Word layout modules into
`packages/node-runtime` (`@vxture/ruyin-node-runtime`). Keep native re-export
wrappers and the existing native integration tests. Move/copy the focused module
tests into the public package as appropriate, and add a structural storage-key
provider boundary so server hosts never import the native DPAPI/development
master-key manager. The fixed original Python reader and hash-locked requirements
are copied byte-for-byte into the package by its build, retaining their existing
canonical source in resources/document-reader.

Update the local-host dependency, package manifests/lockstep version (0.2.2),
existing publish order and shape guard source pointers. Add the package export,
build/type/test configuration and documented import. No new local-host HTTP
routes, provider credentials, private app imports, product logic, automatic
synchronization or platform changes. Web identity, workspace namespace, resource
limits, persistent volume and Linux layout are product-owned adapters verified
separately before deployment. Runtime storage remains encrypted and durable;
server key provisioning cannot fall back to a generated plaintext master key.

### Node extraction local acceptance

The public Node module and its native re-export wrappers pass recursive build and
type checking, 61 targeted tests and all 874 original native integration tests.
The latter measures both original app and extracted implementation together at
the unchanged 90/78/88 coverage floor (96.79/89.50/92.81 achieved). Structural
key injection is tested against real encrypted SQLite and encrypted file bytes:
reopening retains revisions/content, wrong and invalid keys fail. No native key
manager or development plaintext fallback is exported. Eleven shape-guard cases
also pass, including drift in the moved event implementation. Server production
identity, namespace/limits, Linux reader/layout and release remain product work.
