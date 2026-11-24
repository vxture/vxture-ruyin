# P13 - Configurable desktop device authorization

Registered 2026-11-21 before implementation. Owner decision supersedes the
earlier single-desktop-session proposal: normal multi-computer use takes
priority. No implementation of single-session takeover was made.

Use the previously authorized local work-register path while RY-001 / RY-102
original reconciliation remains open. This file records the implementation
batch and proposed additive interface; it is not a replacement authority.

## Accepted behavior

- One current user per local runtime; up to three authorized desktop devices
  per account by default. The platform owns the configurable limit, not RUYIN.
- Count installation identities, not browser tabs, login attempts, products,
  tenants or an enterprise's total membership. Each member has their own limit.
- A login below the limit preserves existing desktop and browser sessions and
  their background work. No login-triggered task pause or automatic eviction.
- At the limit, authenticate normally but withhold desktop activation. Show
  device name, platform and recent activity. The user may explicitly release
  an existing device and continue. The admission/replacement is atomic.
- Device release preserves all local files/results. It revokes that device's
  subsequent platform authorization; it does not remotely delete data or
  migrate local tasks. Task calls already in flight may settle safely.
- Temporary outages do not erase valid sessions. Config changes must not
  silently evict existing authorized devices; apply limits to new admission.

## Batches

| Batch | Scope | Acceptance |
| --- | --- | --- |
| P13.1 | Existing identity/session audit; platform contract and policy | Account-scoped identity; no web-session count; default/config semantics explicit |
| P13.2 | RUYIN claim integration and race safety | Stable instance identity; pending limit state; explicit selection; stale claims/401/cache cannot change another session |
| P13.3 | Login and account device UI | Chinese/English; understandable errors; loading/retry/cancel; no automatic release |
| P13.4 | Platform admission, list/release and authorization checks | Atomic concurrent fourth-device refusal; same-device idempotency; user isolation; outage and expiry tests |
| P13.5 | Cross-process integration and regression | Three active clients; fourth blocked; explicit replacement; unaffected sessions/browser/background execution |

## Proposed additive contract for review

Existing transitional Console native approval/claim remains; no new token
audience, S2S grant, client secret, Accounts logout or inference relay.

- POST /auth/native/claim: existing deviceSecret plus optional device metadata
  (id = existing InstanceIdentity.jkt, name, platform). Optional releaseDeviceId
  only after a user selects an entry shown by the same pending login.
- A recognized 409 DESKTOP_DEVICE_LIMIT response returns the server limit and
  a sanitized list of the authenticated account's device entries, with no
  rpsid, token, deviceSecret or identity claims. Keep the pending approval for
  retry/replacement, bounded by its existing five-minute lifetime.
- Successful claims retain the existing rpsid/expiresInSec response. Platform
  admission must precede exposing a new usable desktop session.
- Signed-in GET /api/desktop/devices and DELETE /api/desktop/devices/:id:
  server derives the account from verified identity. Return only id, name,
  platform, lastActiveAt and current marker. Never accept caller account IDs.
- Local GET /auth/devices mirrors only the sanitized view; local POST
  /auth/devices/release accepts deviceId. In pending login it explicitly
  replaces that device; while signed in it releases a selected remote device.
- Local GET /auth/session may add desktopLogin: {state: "device_limit", limit,
  devices}. This is a pending UI state, not a signed-in session. No default
  three-device local enforcement when the platform endpoint is unavailable.

Platform implementation scope needs the platform repository's G6 confirmation
before edits. Authentication source, registration and installed application
remain unchanged until separately verified. A client-only result must not be
reported as deployed cross-device enforcement.

## Current scope confirmed by owner

The owner explicitly chose RUYIN-only implementation on 2026-11-21. Do not
edit the platform repo in this batch. P13.4 and production enforcement are
deferred; the interface above is a proposal tested with synthetic responses,
not an approved or deployed platform contract. P13.5 currently covers client
transport/UI and regression, not actual admission across production devices.

Pending states are memory-only. Existing deviceSecret and credentials remain
inside the daemon; the UI sees only whitelisted device fields. The stable
existing instance public-key thumbprint, hostname and OS are sent in claim's
JSON body. The browser authorization URL continues to contain only the handle,
surface and optional account-selection prompt. No hardware serial or private
key is collected. Reinstalling/resetting the data root can change installation
identity; this is installation recognition, not hardware attestation.

Local compatibility behavior: upstream device-list 404/501 becomes
{supported:false}. Other failures remain errors; there is no fabricated device
list, local default limit, automatic eviction or browser logout. The current
production platform therefore keeps its existing login behavior. There is no
new task suspension, polling timer or kernel execution policy in this batch.

Server policy defaults, admission atomicity/idempotency, device/account
binding, durable list expiry, anti-spoofing and revocation enforcement still
belong to the future platform implementation. No client implementation can
make an untrusted self-declared device ID enforce an account limit by itself.

## Client outcome and validation

- P13.1: client policy and proposed contract registered; platform agreement and
  default configuration remain pending.
- P13.2: stable installation metadata in claim; additive pending admission
  state; explicit remote selection and same-pending replacement; whitelisted
  device views and timeout/outage handling implemented. Late claim after logout,
  superseded login, old-session 401 confirmation and old-account JSON-body
  completion cannot overwrite, sign out or contaminate a newer local session.
- P13.3: Chinese/English login device picker and account device panel
  implemented. No preselected victim; current device uses ordinary Sign out.
  Replacement warning, cancellation/restart, retry and unsupported platform
  states are visible. Existing signed-in UI survives transient status outages.
- P13.4: deferred by owner; no platform edits, remote deployment or enforced
  three-device default in this batch.
- P13.5: client regression accepted; actual multi-device platform admission and
  revocation acceptance remain pending P13.4.

Host full suite: 799/799, no skips, 96.72% lines / 89.12% branches / 92.72%
functions. UI full suite: 704/704, 100% lines / 96.02% branches / 98.97%
functions. Original coverage thresholds retained. Host/UI types, UI production
build, API/shared-shape/i18n/docs guards passed. CSS token guard still fails on
the pre-existing --shadow-md reference in the project-actions trigger style; the new
device styles introduce no undefined token. This is not an all-gates-green
release. Vite retains its existing large-entry-chunk warning.

Visual check used the real built UI and compiled local API with three
synthetic desktop records, in an isolated loopback fixture. English and Chinese
device limit views and explicit selection were checked at 1280x720. No real
device was released. Evidence: p13-desktop-devices/host-full.log, ui-full.log,
device-limit-zh.jpg and result.json under this chat's evidence directory.
The temporary fixture was stopped. The installed app and user's running hosts,
projects, credentials, model settings and Windows policy were not modified.
No installer or agent package was produced, and no commit/push was performed.

## P13.3 refinement registered 2026-11-21

Owner rejected the sparse stacked login layout and requested system-defined
computer names plus a separate confirmation before release. Rework only the
RUYIN device/login UI, its English/Chinese copy, styles and related tests.
Use a compact brand header, a focused authorization panel, aligned device
rows with operating-system icons and activity columns, and one primary action.
Keep secondary actions together and the page usable in small desktop windows.
Both pending-login and account-settings releases must open a confirmation
dialog naming the exact selected computer; only its confirmation calls the
release API. Dismissal, Escape and selection alone perform no mutation.

Actual metadata already uses node:os hostname(), and this PC's result matches
Win32_ComputerSystem.Name. Preserve that source and display returned name
verbatim, including case, spaces and Unicode. Do not generate business/location
nicknames or infer device names from the OS. Previous visual evidence used
invented fixture names; new visual evidence will use this computer's actual
system name and clearly remain isolated test data. No platform edit, naming
override, real device release or installer update is in scope.

Refinement gate correction: the same stylesheet's existing floating project
action uses undefined --shadow-md. Replace just that reference with the DS
semantic --shadow-overlay, which resolves to the intended medium shadow. No
layout or behavior change to that control; keep the CSS token guard enabled.

### Refinement outcome

The device-limit page now has a compact brand bar and one centered desktop
panel, aligned computer/activity columns, system icons, usage count and a
single primary action in the footer. Long names wrap without substitution.
Smaller windows preserve row selection and the footer; the 833x871 check
measured document scrollWidth equal to window width, with no horizontal overflow.

Both login replacement and account device release open the DS AlertDialog.
It displays the exact selected system name, OS and recent activity plus the
authorization/task impact. Keep device receives initial focus. Cancellation
and Escape do not call the release API; during an in-flight confirmed request,
duplicate submission and dialog dismissal are blocked. Only the final Confirm
button calls onRelease with that selected device ID.

Name provenance was checked twice: node:os hostname() matches Windows
Win32_ComputerSystem.Name, and a real isolated daemon sent that same name plus
its existing instance thumbprint to a synthetic native-claim server. The new
main-wiring regression passed. Host production implementation did not change;
the previous 799-test full host run remains its baseline. UI full regression:
705/705, 100% lines / 96.01% branches / 98.97% functions, thresholds unchanged.
Host/UI compilation, UI production build, CSS tokens, i18n, shared shapes,
docs numbering and diff checks passed. The earlier CSS-token failure is fixed
by the semantic shadow token above. The existing Vite chunk warning remains.

Evidence is p13-desktop-refinement/ui-full.log, devices-zh.jpg, confirm-zh.jpg
and result.json. The visual fixture used one actual OS computer name and a
synthetic device ID, with limit 1 solely to exercise the configurable limit;
the accepted default remains 3 and platform implementation is still deferred.
The browser confirmation was cancelled; no real or synthetic device was
released during visual inspection. Its fixture was stopped and viewport reset.
No platform code, installed application, actual account/session, customer data
or task execution policy was modified.

## Full-capacity visual correction registered 2026-11-21

Owner requested the default full 3-of-3 scenario instead of the single-device
test and found the main panel too wide. Use three occupied slots in the visual
fixture, with the actual local OS name plus two clearly identified TEST-*
synthetic names. Narrow the login device panel from 784px to approximately
640px by changing only its outer content max-width; preserve the device columns,
confirmation, dynamic server limit and normal login layout. Rebuild and inspect
the complete list and confirmation. No device registration/release, platform
edit or configured production limit change is authorized by this visual task.

Full-capacity correction outcome: the built login panel now measures 640px
(previously 784px), and the isolated preview shows 3 / 3 authorized devices.
The current 1038x871 viewport has scrollWidth 1038, so there is no horizontal
overflow. Actual OS name is unchanged; TEST-PC-02 and TEST-PC-03 are explicitly
synthetic names, not invented aliases assigned to real customer computers.
The confirmation still names the selected computer and was cancelled during
inspection. CSS token/docs guards and the production UI rebuild passed. This
was a single CSS width change; no new business tests were needed and the
705-test UI baseline remains the preceding full regression.

Evidence: p13-desktop-refinement/devices-3of3-compact-zh.jpg and
confirm-3of3-compact-zh.jpg. The isolated loopback preview on port 59219 and
its marked browser tab are retained for the owner's visual review. No actual
device was registered or released; the default policy remains a platform-side
pending implementation. P13.3 visual refinement is complete; P13.4 remains
deferred by owner.

## Compact device list revision registered 2026-11-21

Owner requests the main panel approximately equal to the confirmation dialog,
with recent activity in each computer's secondary line instead of its own
column. Target 512px desktop panel, retaining the full 3-of-3 fixture, original
OS names, row padding and explicit second confirmation. Move refresh into the
header and remove the table-like column labels and obsolete responsive rules.
Remove Restart sign-in from the valid device-limit step and both locale keys;
ordinary sign-in remains available after cancellation, expiry or failure.
Change only device/login presentation, copy and related UI tests. No platform,
device-count enforcement, authentication protocol or installed-app changes.

Owner follow-up: remove the redundant task/authorization-impact paragraph
from the confirmation dialog. Keep the title, brief confirmation description,
exact computer identity and explicit Keep/Confirm actions. Remove its now-unused
locale keys and CSS rule; do not change release behavior or the list's note.

Compact-list outcome: both the main panel and confirmation measure 512px in
the 1038px desktop viewport, with no horizontal overflow. Each original OS
computer name stays on the first line; OS and recent activity share the second
line. Refresh moved into the header; only Cancel sign-in and Release remain
in the login footer. Restart sign-in and its unused locale keys are removed.
The compact list passed the full 706-case UI coverage gate (100% lines,
96.01% branches, 98.97% functions). The subsequent paragraph-only deletion
passed the focused device/login tests, types, UI build and i18n/CSS/docs
guards; the earlier full run is retained as its baseline.

The confirmation now contains the title, short description, computer identity
and Keep/Confirm buttons, with no redundant task-impact paragraph. Its two-step
behavior remains. Evidence: ui-single-column-full.log,
devices-3of3-single-column-zh.jpg and confirm-3of3-minimal-zh.jpg in
p13-desktop-refinement. Port 59219 remains a synthetic, three-device preview
for visual review; no actual device was released or platform/installer changed.

Copy refinement registered 2026-11-21: owner requests no repeated device count
in the explanatory sentence. Keep quantity only in the header's count badge;
shorten Chinese/English login hint to the action needed to continue. No behavior
or layout changes. Update the existing English assertion to read server limit
from the badge instead of the removed repeated sentence.

Final owner wording: "已达设备授权上限，释放一台设备后继续使用。"
English matches the same meaning without repeating a numeric limit. Device
tests 7/7, i18n guard and UI production build passed; the retained preview
was refreshed and the final sentence visually verified. Evidence:
p13-desktop-refinement/devices-final-copy-zh.jpg. No behavior change.
