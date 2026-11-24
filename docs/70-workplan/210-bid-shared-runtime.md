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
