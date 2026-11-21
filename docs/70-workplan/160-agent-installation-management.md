# P19 - Agent installation management

Registered 2026-11-22 before implementation under the standing local RY
registration exception. RUYIN host releases remain separate from independent
agent packages. Platform changes, subscription/surface APIs, installed runtime
replacement and account switching remain outside this batch.

| Batch | Delivery | Acceptance |
| --- | --- | --- |
| P19.1 | Installation management from the home Install menu | One compact dialog, installed agents only, distinct loading/failure/empty states |
| P19.2 | Current and retained versions; check, update and switch default version | Exact package validation before activation; failed download never switches; explicit confirmation for rollback |
| P19.3 | Enable/disable and unfinished-task protection | Disable is confirmed; host refuses disabling an agent with unfinished tasks; project data and retained versions stay available |
| P19.4 | Source, package, persistence and browser acceptance | Signed synthetic package update and rollback; restart retains default version/state/results; isolated fixtures only |

Use existing package import, registry download and validated pin-version routes.
The dialog manages machine installation, independent of account subscription;
it must neither imply entitlement nor add runtime-update/download shortcuts.
Open, online use and subscriptions stay on the home product cards. Keep concise
localized labels, fixed action placement, expandable versions and clear inline
errors. No new settings-navigation category or competing host framework.

Switching back changes the default for new projects; it does not downgrade
existing project snapshots. Normal compatible upgrades retain their existing
readiness and unfinished-task gates. Never delete project data or older packages
in this MVP. Physical uninstall/version cleanup is a later explicit operation,
after P20 backup/restore, rather than relabelling disable as uninstall.

Local RY-102 change: POST `/products/:id/deactivate` may return 409 with
`PRODUCT_BUSY` when any project of that product has unfinished tasks, runnable
batches, document readings or renders. Counts/checks are machine-wide; do not
expose other workspaces' project names or IDs. No other request/response shape
changes. Preserve existing 404 behavior for unknown products.
Registry downloads must also match the requested product ID, version and
publisher after preflight, before writing any package to disk. A mismatch
returns `REGISTRY_PACKAGE_MISMATCH` (422), without installation or activation.

The UI waits for server acknowledgements; on mutation success it refreshes both
the manager list and home, and on failure keeps the previous installed state.
Repeated clicks cannot start concurrent changes. Dialog dismissal never cancels
an already accepted install. Errors remain reviewable on reopening.
Persist default-version and enabled-state changes by atomic file rename; a
failed save must restore the previous in-memory state as well as retain disk
state. Add a storage-failure regression rather than relying on UI optimism.

Follow-on list: P20 backup/restore; P21 diagnostics; P22 packaged acceptance.

## Acceptance - 2026-11-22

P19.1-P19.3 source implementation and P19.4 isolated acceptance are complete.
No installed application was replaced, no platform files were modified and no
real-account agent package was installed or disabled.

- Host regression: 856 passing tests, 96.88% lines, 89.92% branches and 92.86%
  functions. Includes exact registry identity checks before disk writes,
  cross-workspace unfinished-task protection, reading/render/batch protection,
  readiness rejection, and failed-state-save rollback with reopened storage.
- Workspace regression: 789 passing tests across 33 files, 100% lines, 99.55%
  statements, 96.26% branches and 99.08% functions. Existing gates unchanged.
  Eleven manager scenarios plus the home-menu integration cover cancellation,
  package failure/mismatch, server busy rejection, stale reads, refresh failure,
  unmount during accepted work, retained-version operations without registry,
  unsigned package blocking, and local state distinct from subscriptions.
- Production UI build, both type checks, localization/API/shared-shape/CSS-token
  and document-numbering guards passed. No new dependency was introduced.
- A separate current daemon with encrypted storage, synthetic Console and dual
  signed packages passed install/registry update/pin/rollback/disable/restart/
  reenable acceptance. Existing project version/result remains unchanged after
  rollback; new project uses the selected default. Disabled state and both
  retained versions survive restart. No customer data or model service used.
- Actual browser in the isolated fixture installed 1.0.2 from the signed local
  registry, disabled with confirmation, reenabled, and selected 1.0.0 after the
  explicit no-downgrade warning. The UI showed all three retained versions.
  Screenshot `p19-installation/installations-versions.jpg` is synthetic evidence,
  not a claim about installed agents on the real account.
- Real-account development tab 62517 now exposes Install -> Installations and
  correctly shows zero locally installed packages. Online subscription cards
  remain separate. Registry unavailability is reported rather than an empty
  catalog or an up-to-date claim.

Automatic approval review rejected the final combined idle-check/restart command
for the real-account development host 62517 with only “blocked by policy” and
no detailed reason. That process was left running. The new host protection and
atomic-save logic were accepted on the isolated current daemon and will apply
on that development host's next normal start; its frontend is already refreshed.
This is not packaged-installer/release acceptance (P22).

Evidence is outside the repository under this task's `p19-installation/`:
`host-tests.log`, `ui-tests.log`, `ui-build.log`, `agent-package-result.json`,
fixture process logs and the installation-manager screenshot.

## P19.5 - Dedicated management page

Owner approved a host-sidebar Agents entry alongside Home, retaining the home
Install menu as a shortcut. Replace the management dialog with the single
`#agents` page in existing RUYIN chrome. Home Install -> Installations navigates
there. Import/package-registry controls are shared with the page, keeping the
current home import/registry shortcuts. Confirmation dialogs remain for version
switches and disabling only. No host or platform API changes in this batch.

Provide concise page title/actions, search and All/Updates/Disabled filters with
counts. Registry failure must not claim agents are up to date. Retained versions
remain expandable; page uses the main viewport scroll, not a modal-sized inner
container. Refresh/reentry queries actual host state. Leaving after an accepted
install does not cancel it. Two entry points lead to one implementation and
installation truth; no second independent management workflow.

### P19.5 acceptance - 2026-11-22

- Added the Home-peer Agents navigation entry and direct `#agents` route. Both
  preserve the host brand/sidebar and existing workspace/account scope. Home
  Install -> Installations now navigates to this route; the former management
  modal was removed. Import and registry controls are extracted into a shared
  module used by home and the page, retaining the original shortcuts.
- Search and All/Updates/Disabled filters update from actual installed rows.
  The update count is unknown when the registry is unavailable, while locally
  retained versions remain usable. Expanded versions scroll with the page.
- UI regression: 792 tests pass across 33 files; 100% lines, 99.55% statements,
  96.35% branches and 99.09% functions. Unchanged coverage gates. Type check,
  production build, localization/shared-shape/CSS-token/docs guards pass.
  Covers both entry points, direct navigation/reentry, page package import and
  registry install, filtering/counts, state changes and pending-work behavior.
- Actual real-account browser 62517: Home Install -> Installations navigates to
  `#agents`, selects Agents in the host sidebar and correctly shows no local
  packages. The original account and workspace remain selected. Only UI assets
  were rebuilt; no real-account package or installed executable was changed.
- Actual isolated signed-package fixture: direct page, search empty state,
  update 1.0.0 -> 1.0.2, confirmed disable, reenable, and expanded three-version
  list all passed. Screenshot `agent-management-page.jpg` contains only the
  synthetic fixture. The fixture tab/process was closed after acceptance.
- Evidence: `p195-targeted.log`, `p195-ui-full.log`, `p195-ui-build.log` and
  `agent-management-page.jpg` under this task's `p19-installation/` directory.
  P20/P21/P22 remain next; this UI batch introduces no new daemon API.
