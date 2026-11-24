# Microsoft Store beta

## Current observed status (2026-11-22)

Submission 1 is now **Ready to publish** for the new
`Ruyin-Store-0.2.1-beta.1-x64.appx`, Store version `0.2.1.0`. The owner explicitly
authorized replacement and resubmission. The exact file SHA256
`42ad77d12f94939c0987c2679aa86cd5a8d2687db33903acffe62a989f7a569b`
was checked before upload. Partner Center validated the new package and saved
the replacement of the old `0.2.0.0` package, then accepted Submit for
certification. All submission sections were Complete. The manual publishing
hold was verified both in Submission Options and after resubmission: publication
starts only after Publish now. No publication or installed-app replacement
occurred. A fresh overview read during P24 on 2026-11-22 explicitly says
"Your product has passed the certification process" and publication begins
only after Publish now. The subordinate submission-summary label still reads
In certification; it is stale relative to the explicit certification result.
This approval does not establish Microsoft-signed installation acceptance.
Initial submission evidence: `p23-distribution/store-resubmitted-current.jpg`
and `store-submission-result.json` under the local acceptance evidence root.

The later 2026-11-22 local launch recheck now passes for the exact candidate EXE
SHA256 `6ef25d604fc3f094adf0bc3711747be2490ec697b52271935988848060ebf9a9`,
including normal and enforced-read-only launch with fresh isolated data. Smart
App Control remains On. The EXE equals `app/Ruyin.exe` inside the fixed AppX;
no installed app was replaced. This supersedes the earlier current-machine
execution-block result, but does not establish Store installation/activation
or upgrade acceptance. See [candidate checklist](100-beta-021.md).

### Previous certification and package history

Before the authorized replacement, Submission 1 was **Ready to publish**. After reloading Partner Center on
2026-11-21, its explicit certification result says the product passed and will
start publishing only after Publish now is selected. The older submission
summary still says In certification; retain it as a stale secondary label,
not the current certification decision. Publishing remains on manual hold.
The owner authorized four functional screenshot uploads and resubmission on
2026-11-20. The earlier report
`334c0c08-e19c-4f07-833f-73776504a317` (review completed 2026-11-18) lists policy
10.1.1.3 Inaccurate Representation: English (United States) screenshots show
only the login screen. This was the failure corrected by the resubmission,
and the refreshed certification result now confirms the correction passed.
The approved package remains unchanged; this does not certify current source.

P23 refreshed the above status and the existing file reviews on 2026-11-22.
The current certified package still reports `0.2.0.0` / 366.7 MB. Its package
management view exposes package details, but no signed-package download link
was observed; no Store package is registered on this computer. The next local
candidate is `0.2.1-beta.1` / Store `0.2.1.0`, so it advances the certified
version. It was subsequently uploaded and resubmitted as recorded above;
certification, publishing and actual installation remain pending.

The next candidate removes python-docx's unused unpacked template scaffold from
the reader payload. Its `_rels` files caused reproducible MakeAppx
`0x8007007b` failures, including a one-file diagnostic reproduction. The actual
`default.docx` template archive, runtime/native files and licences are retained;
real offline DOCX creation and reading now run in the post-package reader check.
The Store build also explicitly selects `--win appx`: inheriting the base config
otherwise adds an unintended NSIS build. Its ordinary and read-only packaged
EXE gates remain in place. Details and current acceptance are recorded in
`70-workplan/170-recovery-diagnostics-acceptance.md`.

Four PNG functional screenshots are ready: workbench, task source consent,
runtime/skill availability and connectors, with isolated synthetic data. The
exact uploaded AppX SHA256 was reverified; all 19 checked UI, contract and
selected runtime files match the screenshot runtime. All four uploads and
captions were saved and verified after reopening the English listing (five
screenshots including the existing login image). Resubmission was accepted.
The Chinese listing and package were unchanged. Evidence is in P11's
store-screenshots-saved.jpg and store-resubmitted.jpg.

The separate Ruyin.exe security submission
`71850a85-e9c0-4098-bea8-0d0386d87e95` has a Not malware determination and an
analyst statement that Smart App Control blocking was remediated, although its
generic badge still says In progress. The installed 0.2.0-beta.1 then passed
isolated shell/UI/SQLite/PDF/loopback/Node MCP/offline Excel MCP startup, and
the native app window opened. This does not verify the current-source package
or a Store installation. A new upstream pydantic_core dependency blocking the
current-source pack was submitted with explicit owner authorization as
`f0d2c8df-c4aa-4038-b795-47854b4768fb` (now Completed, main file Not malware,
with an explicit analyst statement that Smart App Control blocking was
remediated; one extracted .text section still displays Pending). The unchanged
offline Excel MCP startup check now succeeds on this machine. Current-source
NSIS generation and both normal/read-only packaged smoke now pass, including
SQLite, UI/PDF, Node and offline Excel MCP plus the locked document reader.
The first current-source NSIS was actually installed after the earlier
launcher timeout. Installed startup found a Program Files whitespace bug in
UV_CONSTRAINT; source is corrected to use a file URI. The corrected NSIS
has a new SHA256 (f3e8ac6b...) and is specifically SAC-blocked, so that source
correction is not installed. The first installation is now functional through
its existing application-level constraint override and cache preparation;
normal native UI and full installed smoke passed. Automatic cold-start readiness
(15-second shell wait versus 47-second cache preparation), trusted permanent-fix
distribution and Store installation remain open. No OS protection changed.
See P11 workplan
`docs/70-workplan/100-bid-p11-delivery.md` for boundaries and evidence.

## P2 work registration (2026-11-17)

The owner authorized registering P2 here while RY-001 is inaccessible
(Claude reports regional unavailability); backfill RY-001 when access returns.
Scope: acquire runtime ownership before location resolution, migration and
database/key access. Cover location pointers and source/destination directories,
reject concurrent ownership and verify release after process termination.
This does not change Local API shapes. Store-installed migration and coexistence
with older binaries still require installation validation: older binaries do
not participate in the new ownership protocol.

Implemented: OS-owned named pipes on Windows (abstract sockets on Linux)
serialize location resolution and hold all candidate data paths before migration
or key/database access. Existing path ancestors are canonicalized to cover
junction aliases. Acquisition failure releases partial ownership. Migration now
aborts if its progress port cannot be bound, preserving the pending request.
On other Unix hosts, filesystem sockets fail closed after an unclean exit;
automatic crash recovery is currently verified only on Windows/Linux.
Validation: local-host compilation and 37 migration/ownership tests passed on
Windows, including competing owners, partial rollback and forced child exit.
Real daemon subprocess tests reject conflicts on the pointer, source and target
before creating keys or moving files. A temporary Windows DPAPI-protected key
still decrypts sealed state after directory migration under the same OS user.
This does not prove DPAPI behavior inside a Store-installed package identity.
An occupied legacy runtime port was also tested against a real daemon child:
the child fails before migration/key creation and leaves the pointer and source
bytes unchanged. Older runtimes on different ports remain outside this protocol;
close all older installations before Store migration validation.
No existing user data was migrated or opened by these tests.

### P3 local regression (2026-11-17)

Boundary confirmed by the owner: Accounts authenticates users; Console owns
subscriptions, entitlements, tenants and workspace business data. The native
Console session mediates that business context; it does not make Console the
identity provider.

Interactive testing found a stale developer harness: it supplied only the old
platform stub, so the current session route always reported signed out. The
harness now supplies the Console session fixture and Accounts/public Console
URL metadata. Its required boot smoke passed without skips, including signed-in
identity, logout and login recovery. No Local API contract changed.
Browser validation passed project navigation, material consent, result review
and completion of a mock task, encrypted file intake (48 bytes), tightening
read_file to Never, and persistence of the imported file and permission after
page reload. Evidence: TEMP/ruyin-p3-materials.jpg. These interactions use only
isolated temporary fixtures and a mock model, not real account credentials.

Full package test commands passed for local-host (713 tests), workspace UI
(626), runtime-core (95), shell (53) and document. Coverage thresholds passed;
local-host line/branch/function coverage was 96.64/88.57/92.67 percent.
Workspace UI type-check and production build passed. Vite reported its existing
large-chunk warning (main bundle about 1.13 MB before compression).
The ownership entrypoint tests now follow main-wiring.test's existing convention
of disabling inherited subprocess coverage; child exit and data-preservation
assertions remain active, and coverage thresholds were not changed.
This validates local workbench/task/tool/file/recovery behavior using the test
fixtures. It does not establish Store-installed behavior, live external model
availability or a real user's complete interactive workflow.

### P4 installation and upgrade acceptance (2026-11-17)

Partner Center submission 1 is still in certification; publishing has not
started and the manual publishing hold is in effect. No RUYIN Store package
was registered for the current Windows user at the start of P4.

2026-11-18: The installation of NSIS beta `0.2.0-beta.1` succeeded after
Microsoft remediated Smart App Control blocking of the installer (submission
`a8552412-6c31-4964-8812-d14cc6c1564f`). The installed unsigned `Ruyin.exe`
was separately blocked before startup (Code Integrity event 3077). It was
submitted for review as `71850a85-e9c0-4098-bea8-0d0386d87e95`; the last
verified status was Submitted / Pending. A later check could not load the
review page. Partner Center still showed In certification and manual publishing
hold. No Store package was registered locally. Local ownership/migration
regression (33 tests) and developer harness smoke (2 tests) passed again;
installed startup remains unverified. Leave the Windows security policy intact.

P4 pre-install checks: full workspace build, update policy, app/package version
consistency, documentation numbering and 15 pack-smoke tests passed. A local
`pack.mjs --dir` run fetched bundled skills and installed/probed three Node MCP
servers (37 tools). It stalled downloading the pinned uv 0.12.10 official GitHub
release; a separate bounded connection check to the same URL also timed out.
The run was stopped before Electron packaging and executable smoke. No packaged
startup or installation pass is claimed. Log: TEMP/ruyin-p4-pack.log; Store
status evidence: TEMP/ruyin-p4-certification.jpg. The attempt used an isolated
temporary location pointer and data root, without replacing the installed app.

Record the exact tested package identity, version and build before comparing
results. Submission 1 uses CI artifact `ruyin-store-753`; it predates the
local P2 runtime ownership changes. Use a later Store build containing those
changes to sign off the migration guard.

1. Install through the approved Store distribution path alongside the existing
   NSIS installation. Record package registration and launch from Start.
2. Check daemon health, loopback UI, PDF export, and bundled Node/Python tools.
   Test Accounts login and recovery, then verify Console supplies subscriptions,
   entitlements, tenant and workspace. Check session restart and logout.
3. With both applications closed, preserve a recoverable copy of the legacy
   pointer and data before testing migration. Verify the effective directory,
   DPAPI access, existing project data and settings, then test sequential starts
   of both installations. Keep the old installation through acceptance.
4. When a second signed build is available, update through Store and confirm
   the package version advances with data, configuration, and startup intact.

P2 acceptance remains incomplete until the Store-signed installation can be
obtained. Verify the installed app's effective location pointer and data root,
same-user DPAPI decryption, existing workspace/configuration/session recovery,
and sequential NSIS/Store activation with no concurrent daemon. Do not infer
Store AppData virtualization behavior from an unpacked or Node-only test.

The Store product is in certification, not a published or certified release.
Partner Center: https://partner.microsoft.com/en-US/dashboard/products/9PC52HV8RJ4N/overview

Submission 1 (ID `1152921505702421794`) was submitted on 2026-11-17
(Asia/Shanghai). Partner Center reports `In certification`, with submission
complete and pre-processing in progress. The stated processing time is usually
a few hours, potentially up to three business days. Publication remains on hold
until `Publish now` is selected.
The `ruyin-store-753` package has been uploaded and Partner Center reports
`Validated` / Packages `Complete`. Publication has not started.
Pricing/availability, properties and submission options are complete. The draft
uses a zero Store acquisition price, direct-link-only discoverability, and a
manual publishing hold. Chinese and English descriptions have been saved;
both listings now include an actual packaged login screenshot and are Complete.
Age ratings are Complete: consent to share the publisher name and
developer email with IARC was explicitly granted. The owner confirmed that
pornographic, gory and discriminatory content is prohibited and restrictions
are enforced by the model services. The revised questionnaire generates
Microsoft 12+ / ESRB Teen (regional ratings vary). The owner explicitly confirmed
legal adulthood and authorized accepting IARC Terms of Use at the save step;
the terms were accepted and the rating saved.
The runFullTrust justification is saved; Microsoft approval is still pending.

## Identity

| Field | Value |
| --- | --- |
| Store ID | 9PC52HV8RJ4N |
| Package identity | VxtureStudio.RUYIN |
| Publisher | CN=9B432893-508A-4CA0-927B-271209E9FE0F |
| Publisher display name | Vxture Studio |
| Package family | VxtureStudio.RUYIN_hwrbg2tvfk1sa |

These are public package identifiers, not credentials.

## Build

Run `node scripts/release/pack.mjs --store` on Windows. This reuses the
daemon deployment, bundled runtimes and read-only payload smoke checks.
For a repeat build with a cached Electron distribution, set the build-only
`RUYIN_ELECTRON_DIST` to a directory containing the exact version/platform
archive named by the installed `electron` package. Pack streams its SHA256
against that package's `checksums.json` before using the builder's supported
`electronDist` option. Wrong versions, missing files and digest mismatches
fail; an explicit invalid directory never falls back to a download. The
builder CLI runs directly through Node with literal arguments. No dependency
version, production configuration, native executable or smoke gate is changed.
The Store configuration generates AppX, a format accepted on the Store's
MSIX/AppX submission path. The CI `store-package` job checks the identity
inside the generated archive and retains it as an artifact.

The seed step materializes uv's Python directory aliases before its offline
verification. MakeAppx rejects directory junctions in its file mapping; retaining
each alias as a real directory preserves uv's lookup paths.

Validated build: commit `19a9db7`, CI run `43955125124`, artifact
`ruyin-store-753`. Store AppX construction, archive identity checks and payload
smoke passed, as did the separate NSIS packaged smoke. This is build validation,
not a Store-installed test or certification result.

The following documentation/diagnostic update `746c0e4` also passed all CI jobs
in run `43956532976`. The uploaded AppX SHA256 is
`b5e6bc8ad4f250ee39272a149b46ab2b545cff0fc53a73c45f566794f3f32c97`.
The existing local NSIS installation has not been replaced or uninstalled.

Screenshot capture build `f884202` passed every CI job in run `43962317073`.
Artifact `ruyin-store-screenshots-758` contains `store-login.png`, captured from
the packaged UI on a clean runner. Capture is opt-in via
`RUYIN_SMOKE_SCREENSHOT` during `--smoke`, refuses an authenticated workspace,
and does not alter the normal application startup path.

This unsigned submission package is not an installer users can trust or
install directly. Microsoft signs the certified package for Store distribution.
No certificate is added to a user's device by this workflow.

## Remaining validation before submission

- Install the Store-signed beta and test activation, loopback UI, daemon,
  bundled Node/Python tools, PDF export and Accounts login/recovery/logout.
- Verify the packaged filesystem and AppData behavior preserves the existing
  location pointer, encrypted data and DPAPI access.
- Test migration from NSIS without concurrent daemons or conflicting shortcuts.
  A Store package has a different installation identity; it is not an
  automatic in-place NSIS upgrade. Do not uninstall or move existing data
  until migration has been verified.
- Review Store-managed updates, capabilities, listings, privacy disclosure
  and certification requirements. Existing NSIS update behavior is unchanged.

The current CI payload smoke runs the unpacked executable. It does not prove
that Store-installed activation or data migration works.
