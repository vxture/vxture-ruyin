# P20-P22 - Recovery, diagnostics and packaged acceptance

Registered 2026-11-22 under the standing local RY registration exception before
implementation. Owner authorized continuous P20-P22 delivery. No platform edits,
release publishing, security-policy changes or installed-runtime replacement.

| Batch | Delivery | Acceptance |
| --- | --- | --- |
| P20 | General settings Backup and restore; verified encrypted copies, original keys and new-directory restore | Startup executes queued maintenance before opening stores; failed/interrupted work retains original data; same Windows user/machine only |
| P21 | General settings Diagnostics; explicit local checks and report download | Structured statuses with actionable local remedies; export has no account, credential, file content, project name/path or raw logs |
| P22 | Build/check current final artifacts and exercise packaged runtime | Fresh agent-free startup, independent signed agent install, persistence, tray lifecycle and recovery; report exact OS/distribution blockers without bypass |

P20 reuses the verified offline backup algorithm, promoted to the shipped host
instead of retaining a development-only duplicate. Backups include encrypted
stores, original wrapped keys, agent packages and settings; Chromium cache is
excluded. Backup manifests carry SHA256/size lists and database integrity checks.
Restore verifies the backup, copies to a new target and verifies again before
atomically switching the existing location pointer. No existing target or
current directory is overwritten, merged or deleted. External folder contents
are outside the backup. DPAPI scope remains unchanged; no portable key export.

Queue/cancel/status use the existing authenticated loopback boundary:
GET `/maintenance`, POST `/maintenance` with action backup/restore, source for
restore and new target, DELETE `/maintenance` cancels only an unstarted request.
Queue refuses executing/queued model jobs, reading/render/download work,
initialization or pending migration. Queue persists intent in the location file;
UI states that a restart is required, using existing `/ui/restart`. The shell
shows a maintenance startup window with an appropriate wait bound. Standalone
browser hosts can queue but cannot pretend a shell restart occurred.
Queued requests clear to running before execution; interrupted running records
become explicit failure on the next startup, never silently rerun. Failure leaves
the original pointer authoritative. Success/failure is shown after reconnect.

P21 GET `/diagnostics` supplies a bounded schema of local runtime readiness,
storage protection, agent validation, connector/tool/component readiness and UI
asset availability. Checks do not send business data or silently launch/download
third-party tools. The UI exports this exact sanitized JSON locally; no automatic
upload, support messaging or raw-log collection. Existing log-folder entry stays.

P22 uses a dedicated artifact/output/data/profile directory. Never downgrade the
current installed runtime or disable Smart App Control/Code Integrity. Reuse
official cached dependencies and unchanged release checks. Only observed passing
executions count; a passing bundled Node daemon is not an Electron/Store-signed
installation. Keep P22 partial if an OS gate prevents the remaining acceptance.

Next batch after acceptance: P23 distribution blocker resolution and release
readiness, scoped to any concrete issues found in P22. No automatic release.

## Acceptance on 2026-11-22

| Batch | State | Observed result |
| --- | --- | --- |
| P20 | Complete | Actual production daemon and a real development Electron restart both execute backup and new-directory restore; original newer data stays intact, restored project IDs/document revisions/agent versions remain intact, and the immutable backup verifies again |
| P21 | Complete | Authenticated diagnostics, explicit browser report download and Chinese/English UI checked; strict output allowlist excludes account IDs, credentials, source names/paths and raw logs; registered/disabled/not-acquired capabilities do not inflate available counts |
| P22 | Partial, distribution blocked | Current unpacked artifact produced, packaged daemon tested with its bundled Node, signed agent lifecycle and recovery passed; development Electron using shipped resources passed UI/Node/Python/PDF smoke; packaged EXE and final NSIS completion remain blocked by Windows policy |

Regression: 799 UI tests passed with 100% lines, 99.48% statements, 96.25%
branches and 99.12% functions. Host: 865 passed, zero failures or skips,
96.92% lines / 89.74% branches / 92.90% functions. Shell: all tests passed,
100% lines / 97.14% branches / 100% functions across 64 tests. Shared-package
tests: 187 passed (contract 48, document 21, runtime core 102, CLI 16).
Guardrail/release/helper tests: 203 passed. All workspace type checks and
shared-shape, API-envelope, i18n, CSS-token,
update-policy, app-version, brand-asset and document-number checks passed.
Coverage thresholds were retained.

Real development shell acceptance covers ten outcomes: hide/restore retains the
renderer, background task and autosave finish, busy exit defaults to continue,
second launch restores the existing window, close preference applies immediately,
cancelled restart does not relaunch, accepted restart recovers durable work,
backup and restore execute through the real shell restart, maintenance startup
window appears, and explicit idle exit stops the runtime. Synthetic model service
and dialog answers are used; these are not real-account/platform acceptance.

The broader development-shell smoke loads current shipped resources and reports
three UI assets, Playwright MCP with 24 tools, Python Excel MCP with 25 tools,
no non-loopback listener and a real 7,290-byte Chromium PDF. This is useful
component evidence, but is not a substitute for the required packaged-EXE smoke.

P22 blockers: Code Integrity event 3077, policy `VerifiedAndReputableDesktop`,
GUID `{0283ac0f-fff1-49ae-ada1-8a933130cad6}`, status `0xc0e90002`:

- Unpacked `Ruyin.exe --smoke` is blocked before execution.
- NSIS reaches the generated setup executable used by
  `computeScriptAndSignUninstaller`, then its execution is blocked. The NSIS
  build therefore fails before a completed installer is available. Any remaining
  intermediate setup file is not an installable delivery.

No Windows protection was changed, and no artifact was published or installed
over the user's runtime. P22's full packaged acceptance is explicitly open.

Local evidence root (outside Git):
`C:/Users/stonesomker/.codex/visualizations/2026/11/16/01a1e264-9ed7-7913-8ce8-301098a98865`.
Key records: `p22-package/pack.log`, `pack-final.log`,
`distribution-blocks.json`, `packaged-agent-result.json`, `recovery-result.json`,
`broad-source-result.json`, `p22-desktop/desktop-result.json`,
`p20-ui-tests.log`, `p22-host-final.log`, `p22-shell-tests.log` and
`p22-guard-tests.log`. The isolated review tab uses synthetic data and the built
UI from the unpacked resources; the real-account runtime remains separate.

## Next numbered batch

- P23.1: resolve the recorded distribution trust/signing path without weakening
  client protection; check the existing Microsoft review/Store route before any
  new file submission.
- P23.2: rerun the unchanged NSIS and packaged-smoke gates in an approved build
  environment, then verify installation, first launch and tray exit.
- P23.3: validate backup/restore and diagnostics in the successfully installed
  build, record exact artifact hashes, and decide release readiness. Publishing
  remains a separate explicit action.

## P23 continuation registered 2026-11-22

Owner authorized continuing P23. First refresh existing Microsoft file-review and
Partner Center certification status, and reconcile exact hashes/versions against
the P22 artifacts. Reuse the established Store-signed distribution path; an old
approved hash never implies a newly built file is approved. Read-only platform
and CI inspection is in scope. Prepare current Store artifacts and local
provenance/acceptance records where the current host permits it. No new file
upload, Store publication, current installation replacement or Windows trust
policy changes are implied. A required external-state or current-source build
handoff must be described concretely, after local preparation is complete.

P23 version preparation, registered before editing: Partner Center's certified
package is `0.2.0.0`, and the current builder deliberately reserves Store's last
version component as zero. Prepare the next host candidate as `0.2.1-beta.1`
(Store `0.2.1.0`) in shell/package.json, local-host/package.json and main.ts's
VERSION together. Incrementing only `-beta.N` would still produce `0.2.0.0` and
would not be a Store update. This is a local candidate version, not a release,
upload or alteration of the already certified submission. Complete any running
build before applying the three related edits, then rebuild and recheck the
candidate with the original gates intact.

P23 AppX correction registered before editing: the unchanged short-path retry
also fails with MakeAppx `0x8007007b`; the longest source path is only 211
characters, so path length is not the root cause. A diagnostic-only binary
isolation reproduces failure with one file:
`docx/templates/default-docx-template/word/_rels/document.xml.rels`. This is
python-docx's unpacked template scaffold; its OPC relationship files collide with
AppX's own OPC relationship interpretation. The library's actual default uses
`docx/templates/default.docx`, as verified in upstream api.py. Exclude only that
unpacked scaffold from the shipped document-reader payload, retaining the real
default.docx, all runtime code/native dependencies and licences. Extend the
existing post-package reader verification with real in-memory DOCX creation and
reading, and test the payload with the scaffold absent. `/nv` was used only to
isolate diagnostic subsets; final MakeAppx and smoke gates remain unchanged.

P23 Store target correction registered before editing: the fixed AppX completes,
then electron-builder starts NSIS because the Store config inherits and merges
the base win.target list. Make `--store` pass the supported explicit CLI target
`--win appx`, while ordinary packaging retains its configured NSIS target. This
keeps the two distribution formats separate as the Store build documentation
already specifies. Retain document-reader verification, ordinary/read-only
packaged EXE smoke and all other build assertions; selecting the correct format
does not mark any blocked smoke as passed.

## P23 observed outcome (2026-11-22)

P23.1 refreshed Partner Center: still Ready to publish, explicitly certified,
manual publication hold retained. Package management reports the old
`Ruyin-Store-0.2.0-beta.1-x64.appx`, Store `0.2.0.0`, 366.7 MB. No signed
package download link was exposed by the inspected package-management view.
There is no local Store package registration. Existing pydantic_core review
is Completed / main file Not malware, with explicit SAC remediation; .text
still says Pending. Old Ruyin.exe review remains In progress / Not malware,
with explicit remediation of its submitted hash. These are not approvals of
the new candidate. No new file was submitted or published during inspection.

P23.2 fixes are complete in source: the Store payload omits only the unused
python-docx scaffold, the actual default.docx remains, and `--store` explicitly
selects AppX. The same XML bytes package successfully as an ordinary data path
but fail under an OPC `_rels` path; this confirms the relationship-namespace
collision. Diagnostic subset runs used `/nv` only for fault isolation. The
final normal pipeline used neither `/nv` nor skipped dependencies/smoke gates.
It generated only AppX and then reached the unchanged packaged EXE smoke.

Final local submission candidate:

- Host `0.2.1-beta.1`; Store `0.2.1.0` > certified `0.2.0.0`.
- File: `C:/Users/stonesomker/.ruyin/build/p23-store-final/Ruyin-Store-0.2.1-beta.1-x64.appx`.
- Size: 421,406,369 bytes.
- SHA256: `42ad77d12f94939c0987c2679aa86cd5a8d2687db33903acffe62a989f7a569b`.
- Identity/publisher/architecture match Store configuration; 20 key archive
  entries match current compiled files, including maintenance/backup/diagnostics,
  all built UI files and the actual default DOCX template. No bundled business
  agents or unused template scaffold; no AppxSignature.p7x. This is an unsigned
  Store submission input, not an installable certified release.

Validation: 204 script/guardrail tests and 26 relevant host tests passed, zero
skips. Version/API/shared-shape/i18n/update/docs/diff checks passed; normal build
and the actual packaged reader's Markdown plus DOCX checks passed. The candidate
daemon via bundled Node passed signed-agent install/update/rollback/disable,
encrypted persistence, backup/new-directory restore and sanitized diagnostics.
Development Electron loading candidate resources passed Node MCP (24 tools),
offline Python MCP (25 tools), listener audit, UI and a 7,290-byte PDF. These
are component-level evidence, not Store-installed or packaged-EXE certification.
UI/host full-suite coverage remains P22's baseline, not a new full-suite run.

Final pipeline still fails at execution of unpacked Ruyin.exe, before it can
start. Code Integrity event 3077 at 2026-11-22 04:41:58 +08:00 identifies
`VerifiedAndReputableDesktop`, status `0xc0e90002`, and SHA256
`6ef25d604fc3f094adf0bc3711747be2490ec697b52271935988848060ebf9a9`.
No security protection was changed. Ordinary/read-only packaged EXE and actual
Store install/upgrade checks remain open. Previous CI at commit 06eed0c built
both distribution formats successfully but failed the older UI branch-coverage
gate; it is not CI for the current dirty worktree and was not rerun as proof of
this candidate. No source was pushed and no installed runtime was replaced.

Evidence: `p23-distribution/microsoft-status.json`, `certification-status.jpg`,
`appx-isolation.json`, `opc-comparison.json`, `store-final.log`,
`store-candidate-result.json`, `final-code-integrity-block.json`,
`guard-tests.log`, `host-targeted.log`, `packaged-agent-result.json`,
`recovery-result.json`, `broad-source-result.json` and `review-notes.md`.
Failed long/short path logs and diagnostic-only subset packages are retained;
they are not delivery files.

Remaining numbered work:

- P23.2: specific-file authorization, replacement and resubmission are now
  completed as recorded below; manual publication hold is retained.
  Complete current-source CI and the required
  packaged EXE smoke in an approved build environment before release readiness.
- P23.3: obtain the Microsoft-signed candidate through the approved distribution
  path, then verify actual installation/activation, upgrade, encrypted data,
  background lifecycle, backup/restore and diagnostics. No unsigned sideload or
  replacement of the user's existing runtime is implied.
- P24: after those gates pass, prepare stable-host release notes and the
  independent agent-package delivery procedure. Public release still requires
  a separate explicit decision.

P23 submission authorization (2026-11-22): owner explicitly authorized uploading
the exact new AppX with SHA256
`42ad77d12f94939c0987c2679aa86cd5a8d2687db33903acffe62a989f7a569b`,
replacing the old pending release and resubmitting certification, while retaining
manual publishing hold. The file hash was rechecked before browser upload.
This does not authorize Publish now or represent completion of the still-open
packaged/installed validation gates.

### P23 new-package resubmission completed (2026-11-22)

Rechecked the exact authorized AppX SHA256, returned the old ready-to-publish
submission to draft and uploaded `Ruyin-Store-0.2.1-beta.1-x64.appx` (421,406,369
bytes). Partner Center identified Store `0.2.1.0`, x64 / Windows.Desktop and
automatically marked the superseded `0.2.0.0` package for removal when saving.
The original upload tab remained on Analyzing package after the server had
finished. A second read of the same packages page exposed the enabled Save
button; saving succeeded, returned to overview and showed only the new package
as Validated / Packages Complete. No repeated upload was needed.

Publishing hold was explicitly checked in Submission Options: Don't publish
this submission until I select Publish now remained selected. The existing
runFullTrust rationale was retained. All overview sections were Complete.
Submit for certification was accepted. Final observed state is In certification,
with Submission Complete, Pre-processing In progress, Certification Not started
and Publishing Not started. The page explicitly states publication starts only
after Publish now. The portal's submission-summary date still reads 11/21/2026;
the local observation is 2026-11-22 Asia/Shanghai. This is submission acceptance,
not a new certification approval or an installation result.

Store ID remains `9PC52HV8RJ4N`, submission ID `1152921505702421794`. Exact-file
authorization and manual-publish scope were followed; no new screenshot upload,
public release, device-trust change or installed-runtime replacement occurred.
The stale upload tab was closed after the saved server result was verified.
The accepted certification page remains open for the user.

Evidence: `p23-distribution/store-submission-result.json`,
`submission-progress.json` and `store-resubmitted-current.jpg`. Remaining work is
current-source CI/packaged execution plus P23.3 Microsoft-signed installation
and upgrade acceptance; P24 release preparation follows those gates. No standing
monitor or automatic publication has been configured.
