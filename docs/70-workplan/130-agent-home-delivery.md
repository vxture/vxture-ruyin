# P14 - Agent installation and online entry

Registered 2026-11-21 before implementation. Owner explicitly supersedes the
old built-in-product distribution decision: the stable RUYIN host has no
built-in business agents; local products arrive through validated .ruyinpkg
installation. Repository fixtures remain for explicit development/tests only.
Use the standing local RY register exception; RY-original reconciliation remains
open. Do not edit the platform repo or provision rights in this batch.

| Batch | Scope | Acceptance |
| --- | --- | --- |
| P14.1 | Remove default/packaged business fixtures and built-in wording | Fresh production host has no agent; managed installations/user data remain |
| P14.2 | Per-product install/online actions; clarify top install menu | Card installation and manual import share existing package checks; registry entries determine local supply |
| P14.3 | Platform-owned online addresses and metadata refresh | Use existing homeUrl, never guessed subdomains; refresh on login/home focus/manual check; no cross-account stale data |
| P14.4 | Stable brand/back slot; readable project-list failure | Logo/back use identical bounds; missing project directory is not falsely presented as no projects |
| P14.5 | Integration and visual acceptance | Real read-only metadata plus isolated package tests; preserve installed hosts and business data |
| P14.6 | Account/tenant menu ownership and concise labels | Usage panel has no outgoing links; tenant administration is avatar menu item 2; header shows short organization name, panel shows full name and type |
| P14.7 | Compact type and tier badges | English ORG/IND; exactly five tier labels FREE/STRT/PRO/BIZ/ENT; legacy team/business map to BIZ; full labels remain in tooltips; commercial values do not change |

Verified current Console subscription endpoint already selects product home_url
and returns homeUrl. Real current-workspace CoSpace metadata contains
https://cospace.ruyin.work. Other product URLs must retain their platform values;
do not overwrite all products with a shared domain. The section-level online
entry goes to https://ruyin.work per owner. No guessed product URL fallback.

Card Install means install that exact product from the existing registry;
show it only when a registry package exists. The top menu is for importing a
local .ruyinpkg or browsing the registry. Both paths retain current digest,
signature, compatibility, payload, rollback and project upgrade validation.
No unsigned-production bypass, shell/binary download shortcut or secret is added.

Multiple subscription rows of one product render one product card, preferring
an active/trial row over expired historical rows without inventing entitlement
or combining commercial limits. Retain the distinction between unavailable
metadata and an empty list. Missing or unsafe homeUrl is unavailable, never
silently guessed from productCode or changed to a different product's URL.

The running P11 acceptance process has a missing projects directory. Preserve
its failure status and existing account/session. Do not recreate or delete that
directory, seed example work into it, or report its missing projects as zero.
Replace raw filesystem path text in the UI with the existing localized failure
message while retaining the failure for diagnostics.

Owner steering 2026-11-21: runtime updates and agent updates are separate.
Runtime updates remain under Runtime/settings; home actions only manage agent
packages. Use concise English action labels. Organization switching belongs
in the avatar panel as a distinct current-organization selector; it must use
native reauthorization and atomically replace the desktop session, never claim
that a browser-only tenant switch changed desktop scope. Track this separately
as P15; the user has not reopened platform editing authorization.

RY-102 local change record: GET /auth/session keeps its existing shape with
one optional org.shortName field; org.name becomes the canonical full tenant
name when a matching /api/me/organization profile is available. Short name
comes from displayName, falling back to tenant-context name. Ignore profiles
whose tenantId does not match the authenticated tenant; do not expose profile
contact data. No new endpoint or platform file change is included.

Regression run exposed an existing MCP child-exit race: EPIPE on stdin was
unhandled and could terminate the host. Include a narrow transport-error
handler that fails the connector's pending requests through existing teardown;
keep this separate from update/tenant behavior and verify child-exit coverage.

## Acceptance record - 2026-11-21

- UI full regression: 723 passed; 100% lines, 99.62% statements, 96.21%
  branches, 98.98% functions, with unchanged repository gates.
- Host full regression: 805 passed; 96.75% lines, 89.19% branches,
  92.63% functions. Includes a real empty production daemon, independent
  package installation, fresh subscription metadata, canonical name projection,
  cross-tenant profile rejection and a real closed MCP stdin regression.
- Final five-tier alias correction: 92 related UI tests passed; UI type check
  and production build passed. All five canonical codes are covered, with
  team/business aliases retaining their platform values and displaying BIZ.
- Shell build and i18n/shared-shape/CSS-token/brand/API/docs guards passed.
- Actual P11 browser: short organization name in header; ORG and BIZ/PRO/FREE
  badges visible; quota panel contains no links; avatar menu has tenant
  administration immediately after account center. Empty loading metadata
  never claims there are no subscribed agents.
- Measured home-logo and settings-back bounds both x=24, y=10.6667,
  width=18, height=18 at the same browser size. Shared slot applies to all views.
- Evidence saved outside the repository in p14-agent-home under the existing
  task evidence directory, including compact-badges-en.jpg and test logs.

This is source/build and local-browser acceptance. No new installer, Store
submission or installed-host replacement was performed. The protected P11
daemon still runs its previous backend; canonical full-name enrichment and
fresh-cache behavior require a daemon restart/new build to take effect there.
Its missing projects directory remains a P11 environment defect, visibly
reported; no directory, project or account was fabricated to hide it.

## Next numbered batches

1. P15 - Organization switching: a separate current-organization selector in
   the avatar panel; load real authorized options, use scoped native login,
   replace the desktop session only after success, then reload workspace,
   subscriptions and project scope. Keep current work on failure/cancellation.
   Existing platform routes support tenant hints; do not change platform files.
2. P16 - Release acceptance: restore the P11 test environment from verified
   data, validate the finished host plus independently signed agent packages,
   then perform packaged smoke and installation/update acceptance before any
   release claim. Do not recreate a missing business directory as an empty one.

## P15 interface review - 2026-11-21

Read-only platform source review confirms scoped native login already accepts
`tenantId` and `workspaceId` on `/auth/login?surface=native&handle=...`.
The platform validates UUID hints and records them in the pending authorization.
`GET /api/me/workspaces` supplies authorized tenant/default-workspace pairs,
including tenantName, tenantType, isCurrent and isDefault. RUYIN must use these
pairs, not construct a tenant ID from a displayed name or alter a browser cookie.
Platform files remain outside the authorized edit scope.

The desktop client currently refuses beginLogin while already signed in and
commits a claimed session immediately. The next implementation batch must add
a separate switch flow preserving the old session until the candidate identity
matches the same user and requested tenant/workspace and has been safely stored.
Failure, cancellation, timeout or a mismatched candidate must leave the previous
session, project scope and saved work intact. Cache clearing and UI scope reload
happen only after a successful replacement. Stale in-flight reads must not enter
the new scope; existing sessionVersion fencing provides the foundation.

| Sub-batch | Delivery |
| --- | --- |
| P15.1 | Project authorized tenant/default-workspace options through the local host; no new platform endpoint |
| P15.2 | Scoped native authorization with atomic persisted session replacement and cancellation |
| P15.3 | Compact organization selector in the avatar panel; pending/error states and refreshed workspace scope |
| P15.4 | Membership, same-user, scope-match, cancellation, stale-request and browser regression acceptance |

This review is preparation, not an implemented switch or a real-account acceptance.

## P15 implementation registration - 2026-11-21

Implement in RUYIN only: PlatformSession, local auth routes, shared UI API
types, avatar organization control, SessionGate/workbench scope reset and tests.
Local RY-102 additive record: GET /auth/organizations returns only authorized
tenant/default-workspace pairs; POST /auth/organization-switch accepts tenantId
and workspaceId and returns an opaque requestId plus authorizeUrl. GET
/auth/organization-switch?requestId=... returns pending/completed/failed/cancelled/
expired status, target and a bounded error code; DELETE with requestId cancels.
All require the existing loopback bearer credential. No platform session ID,
claim secret, tokens or account document enters these responses.

Candidate claims are verified with fresh platform identity/context reads for
the same account and exact tenant/workspace before atomic sealed-file rename,
then in-memory replacement. Cancellation/logout fence late results. Retire
old bridge/library tickets and refresh entitlements after successful switch;
do not stop background jobs or alter documents on begin/cancel/failure.
The UI remounts scoped workbench data on a new identity scope and returns to
Home only after successful switching. Tests use synthetic accounts/services;
real multi-organization verification remains a separately reported limitation
until a suitable authorized account environment is available.

Owner UI correction - 2026-11-21: integrate the current organization name and
IND/ORG badge into the avatar panel identity heading. Render a fixed
"组织切换" action in the same section as account center, tenant administration,
usage and settings, with an internal disclosure indicator. Remove the separate
organization block and its divider; the action is a local system control, not
an external link. Keep the validated scoped authorization behavior unchanged.

Owner scope correction - 2026-11-21: the selector has two business levels,
organization then workspace. Organization headings do not execute a switch;
only a concrete workspace row does. Read-only platform review found
`/api/me/workspaces` exposes only each tenant's default workspace, and its
isCurrent flag identifies a tenant rather than the active workspace. Add the
existing `/api/iam/workspaces/mine` read for the active tenant and compare exact
tenant/workspace IDs from `/api/tenant-context`. Candidate verification uses
the same active workspace membership read, allowing non-default workspaces
without treating the whole organization as selected. Group options by tenant
in the avatar menu and mark the exact active workspace in the list.

RY-102 local clarification: `/auth/organizations` retains the same flat pair
shape; it now projects every switchable workspace in the current tenant and
the existing default-workspace entries for other tenants. The current Console
API cannot enumerate another tenant's full workspace membership before
entering it. Record that integration limit explicitly; do not invent extra
workspaces or change platform files under the RUYIN-only authorization.

Owner visual clarification - 2026-11-21: two levels means two adjacent popover
panels, not an inline expansion. The avatar menu is the first panel; its fixed
organization-switch row opens a separate second panel to the right, grouped
by organization and selectable at workspace level. Use the shared Radix/DS
popover positioning and focus behavior, with viewport collision handling.

The same-tenant browser acceptance exposed an older identity projection that
overrode the active workspace with the tenant's default list entry. Correct
projectIdentity to prefer a real UUID from the verified tenant context, taking
its matching workspace name. Retain placeholder filtering and the legacy
default-list fallback only when the context has no real workspace UUID. Pin
this with identity and persisted scope-switch tests. Replace the trigger's
caret/sort icon with a bidirectional switch icon per owner.

Owner personal-scope simplification - 2026-11-21: when tenantType is personal,
omit the redundant organization-name meta row and place the personal-tenant
badge alongside the user's name in the avatar heading. Organization tenants
retain their full organization name and type. Never infer personal scope from
a missing type or equal display names. Final placement correction: both personal
and organization tenant-type badges sit alongside the person's name. The
organization-name meta row is text only; personal scope has no such row.

No additional confirmation dialog is part of organization/workspace switching.
Selecting a workspace begins scoped native authorization immediately. Browser
authentication remains the existing security boundary; the manual confirmation
page on port 62509 is only the synthetic acceptance server, never product UI.
Use "switching" progress copy instead of implying a second confirmation step.

## P15 source and synthetic acceptance - 2026-11-21

- Host full regression: 831 passed, 96.79% lines, 89.40% branches and 92.66%
  functions. UI full regression: 762 passed, 100% lines, 99.55% statements,
  96.35% branches and 99.03% functions, with unchanged thresholds. The final
  progress-copy adjustment additionally passed the 36 selector/avatar tests.
- UI types and production build passed. i18n, shared shapes, API envelopes,
  CSS tokens, documentation numbering and whitespace checks passed.
- Real local daemon with sealed synthetic sessions and local Console fixture:
  cancellation, ignored late approval, personal-to-organization switching,
  same-organization non-default workspace switching and returning to the
  original workspace were exercised through the browser. Current-workspace
  identity and project lists follow the selected workspace, not its tenant's
  default. This does not count as real-account or live-platform acceptance.
- The two adjacent popovers use the shared DS. The fixed organization-switch
  action uses a horizontal bidirectional arrow; the child panel groups tenant
  headings and workspace actions. Tenant badges are alongside the person's
  name. Personal scope omits the duplicate tenant-name row.
- Before/after offline verified snapshots of the isolated acceptance runtime
  contain two encrypted project databases. Their complete logical kv digests
  match; both saved product documents remain revision 1. Evidence is outside
  the repository under the task's p17-capability-library/p15-* files. The
  independently preserved damaged P11/62501 environments were not changed.

Remaining numbered work:

1. P15.5 - Real-account acceptance and cross-organization full workspace
   discovery. Current Console exposes complete workspace membership only for
   the active tenant; other tenants still expose their default workspace.
   Platform changes remain deferred by the owner, so this limitation is open.
2. P16 - Packaged runtime and independently installed agent acceptance,
   followed by installation/update checks. No installer replacement or release
   was performed during this source and synthetic UI batch.

Owner menu wording correction - 2026-11-21: change the avatar action label
from "租户管理" to "组织管理" (English: "Organization management"). Retain its
existing Console destination and position; this is presentation wording only.

## P15.5 and P16 follow-through registration - 2026-11-21

Use an independent durable data directory and current compiled daemon for
real Accounts/Console acceptance. Authenticate through the existing native
browser flow, exercise authorized scope selection and fresh business reads,
then verify restart recovery. Do not copy credentials from another profile,
alter existing P11 directories, edit platform sources or publish a release.
Retain only counts, status and identity digests in acceptance results.

In parallel preparation for P16, inspect the known cold-start defect where
enabled connector preparation delays loopback readiness beyond the shell's
health deadline. Register any narrow source correction and its exact readiness
semantics here before editing code. Normal packaged and read-only smoke gates
remain required; no native trust, package-signature or protection bypass.

Owner card layout correction - 2026-11-21: subscription tier/state stay at
the top right of My agents cards. Move local installation state to the footer
left immediately before the version; both describe the same installed payload.
Keep actual entitlement, registry availability and action behavior unchanged.

Product metadata correction registered before implementation: live subscription
rows already include iconVersion/iconUrl, which RUYIN ignored. Hosted icon
bytes use the existing public Console `/api/applications/:code/icon?v=...`
contract; use those first, safe external iconUrl second, default icon on
missing/failed images. Subscription rows omit descriptions; enrich only that
display field from the existing public website `/api/products/catalog` read,
without sending an RP session or account identifier to the public endpoint.
Use the configured website base, short in-memory cache, bounded fetch and
best-effort fallback; a catalog outage must not erase subscriptions or grant
entitlements. No platform edits. Local RY-102 additive record:
`/platform/subscribed-products` may include optional description alongside the
existing optional iconUrl/iconVersion fields. Actions and identity are unchanged.

Live icon read correction: Console currently returns 401 for unauthenticated
icon requests despite source comments describing public delivery. Add an exact
bearer-guarded local GET `/platform/product-icon?code=...&version=...` binary
route. The daemon forwards only to its configured Console's fixed icon path,
validates identifiers, accepts bounded raster MIME types and never exposes
the platform session to the UI. UI loads blobs with its local API bearer,
revokes object URLs and falls back to safe external metadata/default on error.
No proxy URL parameter or arbitrary destination is accepted.

Owner refinements: top-right card badges share one horizontal line. Header
organization trigger grows to the full short-name length, stays single-line
and does not clip. Keep framework controls and business scope unchanged.

Owner desktop/online card parity: display the platform product nickname below
its name when available, and show commercial tier with the live releaseStage
at top right. Project subscription active state does not imply stable release;
unknown stages retain the existing subscription indicator, never invent stable.
Retain expired/disabled/not-entitled warnings and current desktop actions. Public
metadata enrichment adds optional productNick/releaseStage, with no commerce
semantics changed. Description occupies the card body rather than icon-column
indentation, and a bounded three-line overview preserves card scanability.

Owner commerce-entry correction: desktop Renew/Subscribe actions must open
the platform's product pricing/plan-selection page, not the Console order or
subscription checkout flow. Product code selects the pricing context; no plan,
cycle or order is assumed by RUYIN. Keep the platform-owned commercial action
eligibility and avoid any purchase/checkout during acceptance.

Owner header hit-area correction: make the brand trigger and the equivalent
settings/product back control share a 32px interaction box, while retaining
the existing icon/text sizes and visual anchor. Apply to all header modes so
switching pages never shifts the logo/back glyph. Verify actual element bounds
in the local browser; no runtime or API change is needed for this adjustment.

Owner About dialog usability: add a bottom Close action and focus that button
on opening. Retain Radix Escape handling and trigger-focus restoration; Enter
activates the focused Close action. Keep the information layout centered and
the footer below it. Browser focus is used without OS cursor manipulation.

Owner recommendation follow-up: replace Home's hardcoded recommendations with
a narrow public display list from the configured website product catalog.
Local RY-102 additive route: GET `/platform/product-catalog` returns `{items}`,
using the existing local bearer guard and the shared 60-second display cache.
Choose up to three agent products in platform order, without asserting an
unavailable popularity ranking. Reuse real logo, name/nickname, description,
releaseStage and version. A missing version uses an explicit current-image
lookup on the same fixed authenticated Console route; 404 uses the fallback.
Failed catalog reads show unavailable instead of the old static snapshot.
No platform edits or commerce changes.

Owner switching clarification: normal organization/workspace changes should
reuse the authenticated desktop session without another sign-in or browser.
The inspected Console exposes native login/claim and browser redirect switch
flows, not a desktop session context mutation. Track P15.6 for that platform
capability and full cross-organization workspace discovery; do not simulate
switching with local IDs or remove membership checks. Platform editing is
still deferred under the owner's RUYIN-only authorization.

## P15.5 real-account and Home follow-up acceptance - 2026-11-21

The isolated durable runtime on port 62517 completed real Accounts/Console
acceptance using the normal native browser flow. The same account switched
organization -> personal -> original organization; fresh subscription,
entitlement and quota reads followed scope. Organization reads contained seven
subscription records for five products and six entitlement records. Personal
scope correctly returned no subscriptions or entitlements. Restart retained
the sealed identity and scope. The owner subsequently selected personal scope;
the final metadata restart preserved that selection. Existing installations,
damaged historical profiles and platform sources were not changed.

Home now uses current public catalog metadata for its recommendation cards,
with no production static snapshot. Browser acceptance in personal scope
confirmed real hosted images for VXTPL (128px), TenderForge (256px) and Yucer
(200px), plus current descriptions, nicknames and release stages. Missing or
failed images retain the default icon; unavailable catalog data is distinct
from an empty catalog. The public read transmits no account/session data.

The same acceptance pass verified pricing-before-order navigation, the shared
32px brand/back hit area and unchanged icon coordinates across header modes,
and the About footer Close action with initial focus, Enter and Escape.

Final source validation: 841 host tests and 765 UI tests passed. UI coverage
remains above the unchanged gates: 99.56% statements, 100% lines, 96.44%
branches and 98.94% functions. Host coverage: 96.79% lines, 89.59% branches,
92.74% functions. Host/UI builds, UI type check, i18n, API/shared shapes, CSS
tokens, document numbering and whitespace checks passed. Evidence is kept
outside the repository under the task's p15-real-acceptance directory.

Remaining numbered batches:

1. P15.6 - Desktop scope switch without a browser/sign-in round trip, and
   complete cross-organization workspace discovery. Requires a supported
   platform session-context API; platform edits remain deferred by the owner.
2. P16 - Connector cold-start readiness correction, then packaged runtime,
   independent agent install/update and installer acceptance. This follow-up
   updated the local development host only; no release or installer update.

Owner empty-state correction - 2026-11-21: the generic no-agent action opens
the configured website `/appcenter`, with the action named Application center.
No product is selected in an empty account. Product-specific subscribe/renew
cards continue to open pricing for that product.

## P16 implementation registration - 2026-11-21

1. P16.1 - Listen before optional connector warm-up. Add optional
   `startupState: initializing | ready | failed` to GET `/system`; `/health`
   continues to mean the loopback server is alive. During initialization,
   task submissions/decisions, background-job writes, connector/component
   mutations and data-directory moves return retryable 503
   `RUNTIME_INITIALIZING` (or `RUNTIME_START_FAILED` on an unexpected registry
   load failure), without recording a task or changing configuration. Reads,
   sign-in and cancellation remain available. Recover interrupted tasks only
   after connector loading finishes; individual connector failures remain
   visible in their existing health records. The Home runtime card refreshes
   only while initializing and displays the actual startup state.
2. P16.2 - Exercise slow connector initialization with a real child daemon:
   loopback/UI reads remain responsive, no premature task admission, and
   readiness changes after completion. Keep smoke checks after warm-up.
   Move remaining cache permission traversal/deletion to asynchronous I/O so
   a large Python cache cannot block the freshly opened loopback server.
3. P16.3 - Build and smoke the current packaged runtime in an isolated output
   and data directory, preserving the installed runtime. Exercise independently
   signed agent package install/update, rejection, persistence and reopening.
   Do not bypass OS protection, trust validation or replace a user installation.
4. P16.4 - Record actual results and any packaging/OS blockers. No publishing
   or platform-source changes are authorized by this batch.

P15.6 read-only recheck: Console tenant-context remains GET-only; desktop
native auth has no context mutation. Browserless switching remains dependent
on platform work, which the owner previously deferred.

Packaging isolation: add optional `RUYIN_PACK_OUTPUT_DIR` to the existing pack
script. Builder output, smoke executable/resource paths and read-only smoke
all use the same resolved directory. Default release paths stay unchanged.
This run uses a new task-owned directory and explicit isolated runtime data.

## P17.1 recommendation correction registration - 2026-11-21

The owner requires acquisition recommendations to exclude agents already
shown in My agents and backfill other candidates. Console already exposes
GET `/api/subscription/recommended-products`, excluding every product ever
subscribed in the tenant (including other workspaces and bundled coverage),
preview/sunset releases and products without a customer-visible public plan.
Use this authenticated tenant-scoped source, enrich public display metadata,
filter to agents and remove any remaining locally installed/subscribed codes
before taking three entries. Re-evaluate on account/workspace refresh and
ignore late replies from another scope. Reads failing must not become an
empty successful recommendation list.

Local RY-102 addition: GET `/platform/recommended-products` -> `{items}` with
the same public product display shape and existing local bearer guard. Console
capability denials remain 403; upstream failures remain retryable 502. Existing
GET `/platform/product-catalog` remains an unscoped public display projection.

The existing platform source orders by `prod.sort`, not usage/subscriber
popularity, and limits six candidates across product types. No available
endpoint supplies a heat rank. Label this section Recommended agents, preserve
platform order and do not invent a popularity score. True popularity ranking
and a full agent-specific candidate feed remain platform follow-up work; no
platform files are modified. If fewer than three eligible new agents exist,
show the actual count or a compact no-new-agents state with App center.

Owner section-icon refinement: replace My agents' package/cube outline with
the existing design-system application-grid icon, preserving section geometry.
Settings icon corrections: Databases uses `database`, Models uses `sparkles`
and Skills uses `cpu` (the owner's requested swap). Keep sidebar geometry.

## P16 and P17.1 acceptance results - 2026-11-21

P16.1/P16.2 passed: a real daemon with an 18-second MCP initialization opens
its loopback server before the shell's 15-second deadline. Health, system,
project and authentication reads remain available. Execution/configuration
mutations receive retryable readiness errors before persistence, and tasks
and background jobs recover only after connector preparation. Initialization
and failure are localized in Home; initialization refresh stops when settled.
Python cache copying/permission traversal/removal yield through async I/O.

P16.3 partially passed: the full current unpacked package was generated in
an isolated task directory. Existing vendored skill/tool resources were used
with `RUYIN_SKIP_SKILL_PULL=1`; this is not a fresh dependency-acquisition gate.
The offline document reader's 11 dependencies were verified. Starting the
new unsigned Electron EXE was denied before execution: CodeIntegrity event
3077 identified policy 0283ac0f-fff1-49ae-ada1-8a933130cad6. The executable
SHA256 is 643469b89a5105f816e6e1868f2872c704523705e80b7c67bd56e740820f21a8.
Therefore Electron smoke, read-only Electron smoke and final installer launch
acceptance remain OPEN; the installed application was not replaced.

A separate acceptance run used the actual packaged daemon/dependency tree
with its bundled official Node runtime and synthetic account/tenant fixtures.
Production package signature requirements stayed enabled; only disposable
fixture public trust keys were provided in the isolated data directory.
Unsigned, invalid publisher signature and tampered payload packages were
rejected. Preflight made no installation, dual-signed packages installed with
embedded UI, and 1.0.0 -> 1.0.1 activation retained the project Markdown.
After daemon restart, both agent versions, the active version, installation
identity, workspace attribution and revision-1 encrypted document remained.
The runtime binary stayed unchanged. This proves package/runtime separation,
not Electron/Store certification or live product commercial acceptance.

P17.1 passed with the real organization session: recommendation reads return
HTTP 200 with zero eligible new products for this tenant. My agents remains
populated; no subscribed agent repeats below. The compact no-new-agent state
links to App center. Fixture tests verify exclusion BEFORE taking three,
replacement order, installed-agent exclusion, scope changes, stale replies,
role denial and unavailable-versus-empty behavior. Browser acceptance also
verified the grid, database cylinder, Models sparkle and Skills chip icons.

Validation: 846 host tests and 771 UI tests passed with unchanged coverage
gates. UI: 99.56% statements, 100% lines, 96.36% branches, 99.05% functions.
Host: 96.82% lines, 89.68% branches, 92.78% functions. 31 release-script tests
passed. Host/UI builds, UI/shell type checks and API, shared-shape, i18n,
update-policy, CSS-token, docs-numbering and whitespace guards passed.

Remaining numbered work:

1. P15.6 - Supported platform API for desktop context switching without a
   browser and complete cross-organization workspace discovery. Platform
   source edits remain explicitly deferred by the owner.
2. P16.5 - Execute Electron/read-only smoke and installer acceptance for the
   exact current source in an environment that permits unsigned build tests,
   then the existing Microsoft signing/distribution path. Local CodeIntegrity
   protection was preserved; no current-source installation is claimed.
3. P17.2 - Platform-ranked agent acquisition feed: real popularity ranking,
   agent-only candidate pagination and explicit eligibility. The existing
   Console endpoint is a six-product operational ordering, so RUYIN currently
   labels the section Recommended agents and never fabricates heat values.

Evidence, package and isolated data are outside the repository under the task's
`p16-release-acceptance` directory. The user-facing current-source runtime
remains port 62517, retaining the scope selected by the owner.

## P17.3 agent delivery modes registration - 2026-11-21

Owner correction: subscription and desktop delivery are independent. A remote
subscription does not imply that a local package exists. Use an installed
validated package as positive local availability evidence, otherwise a matching
published `/registry` item; do not infer delivery mode from product names,
online URLs or release version. No current platform display field explicitly
declares desktop support. Missing registry entries mean no currently listed
package, and failed registry reads mean unknown, not desktop unsupported.

Cards with a valid online URL retain Online regardless of local supply. Online
is primary until a package is installed; a published package adds an outline
Install action, or primary Install for desktop-only supply. Installed agents
show primary Open and secondary Online when present. Omit Online when no safe
URL is supplied. A non-installed card with neither known entry shows a muted
no-entry explanation, not a disabled Online button. Expired subscription and
existing entitlement/disabled controls remain unchanged.

Installation state becomes a low-emphasis icon/text pair in the footer before
the associated version, without a colored pill. Only published/installed local
supply gets installation wording. Registry list/check behavior uses existing
routes and package trust checks. Top Install still imports/browses packages;
card Install uses the exact matching product/version. UI-only change; no local
API shape or platform source edits.

P17.3 acceptance: all 774 UI tests passed; coverage remains above unchanged
gates (99.56% statements, 100% lines, 96.34% branches, 99.05% functions).
UI type check/build, i18n, shared shapes, API shape, CSS tokens, docs numbering
and whitespace checks passed. Tests cover dual delivery before/after install,
desktop-only delivery, package-vs-platform version, online URL validation,
unlisted/unreachable package catalogs, unsigned package policy, installation
retry and update sequencing. Existing commercial/entitlement gates remain.

Real organization acceptance on 62517: all five online cards retain enabled
Online actions and no invented installation status. Footer content does not
overflow at the observed 1038px viewport. The public registry read currently
returns NoSuchKey (404); this is unknown desktop availability, not evidence
that these products never support local execution. No packages were installed
or customer data changed for this UI batch. Screenshot evidence lives outside
the repository in `p17-delivery-modes/live-agent-entries.jpg`.

Additional numbered follow-up: P17.4 - authoritative platform delivery metadata
for online URL and desktop package availability/identity, distinguishing
unsupported, planned, published and temporarily unavailable. Desktop package
identity must be explicit when it differs from product code; never guess a
mapping from names (for example TenderForge vs a historical bidproposal
fixture). This is a platform contract proposal only, not a platform code edit.
Previously open P15.6, P16.5 and P17.2 remain open.

Owner sequencing decision - 2026-11-22: defer P17.4 and include it in the
future independent RUYIN backend batch. Do not implement platform terminal
metadata exposure as a separate immediate task. Platform already owns the
authoritative `product.product_surfaces` values (`web`, `desktop`, `app`,
`miniprogram`), which Opera/Admin expose; customer-facing catalog/subscription
reads currently omit them. Correct the earlier wording: the metadata exists,
but RUYIN does not yet receive it. The future backend design should cover its
read path, explicit package identity/availability and desktop consumption
together, retaining Accounts identity and Console business ownership. Current
UI/package-evidence behavior remains in place until that batch.
