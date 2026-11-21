# P17 - Skills and tool-provider organization

Registered 2026-11-21 before implementation, under the standing local RY
registration exception. Preserve P15 organization switching and P16 release
acceptance as pending independent batches. No platform changes or real
capability activation/download are authorized by this UI redesign.

Read-only P11 observation: 232 local skills, 31 local tool entries, 879 cloud
metadata entries (877 skills, 2 connectors). 105 bundled skill rows have an
exact cloud ID under the existing owner/name rule. These counts describe this
snapshot, never product constants. Versions are absent from cloud metadata;
do not invent version equivalence or upgrades.

| Batch | Scope | Acceptance |
| --- | --- | --- |
| P17.1 | Identity and union model | Exact capability IDs merge; local user/project entries remain independent; no name-only cloud matches |
| P17.2 | One local/cloud skill library | Search plus source, location and local-state filters in one compact row; filtered count at left defaults to all; local-only entries remain discoverable |
| P17.3 | Category ownership and existing controls | Skill enable/disable stays in Skills; MCP acquisition/start/stop is under Connectors; built-in tools stay in runtime details; databases keep their dedicated surface |
| P17.4 | Regression and visual acceptance | Count/filter conservation, multi-page catalog completion, stale-request isolation, failure versus empty, actions and real browser evidence |

Keep runtime dependency checks separate and collapsed by default. The skill
library replaces the duplicate local/cloud skill inventories, with local
management details under each row. Connectors own their supplied tools and
cloud connector metadata. Models and Databases retain their separate entries.
Use a bounded, complete read of the existing local catalog API before reporting
union counts. Filter locally; typing never triggers a Runos network request.
If the cloud read fails, retain local rows, show the cloud failure and avoid a
false full-directory count. Existing snapshot provenance remains visible.

RY-102 local additive record: SkillView in GET /skills and POST /skills/refresh
may include capabilityId. Bundled identity uses the existing owner/name mapping;
distributed identity comes only from the existing verified receipt. User and
project skills get no inferred cloud ID. This is display identity, not permission.
Unverified legacy distributions stay distinct local entries. No route is added.

Preserve the semantic categories. Skills are
instructions/materials, tools execute operations, connectors supply tools, and
databases keep their dedicated configuration surface. Do not mix all four in a
default inventory. P17 delivers a merged local/cloud skill
library, MCP tool acquisition/management in the existing connector cards,
built-in tools under collapsed runtime details, and cloud connector metadata
under Connectors. Models and Databases remain separate left-nav categories.
The observed merged skill count is 1004 (=877+232-105). Tool-provider cards
merge by their exact provider ID and include registered providers that have
not been activated. Directory presence does not grant installation/execution.

## Acceptance - 2026-11-21

- UI full suite: 739 passed; 100% lines, 99.63% statements, 96.43% branches,
  99% functions. Original thresholds remain unchanged. Includes complete
  catalog pagination, duplicate/change refusal, local overrides, exact-identity
  union, local-only entries, filter intersections, stale-response isolation,
  retained error states, incremental rendering and existing control actions.
- Host full suite: 807 passed; 96.72% lines, 89.18% branches, 92.65% functions.
  Additional real HTTP list/refresh identity wiring plus the two identity
  projection cases passed 3/3 after adding the new route regression.
- UI/host builds, UI types, API/shared-shape/i18n/CSS/docs guards and diff checks
  passed. No package installation, real provider activation, model call,
  permission change, platform edit or installed application replacement occurred.
- Browser source-build acceptance: skill total 1004, local-and-cloud 105,
  local-only 127. Connector page contains 25 unique tool providers, including
  21 not yet in the active/staged connector list, and two separate cloud
  connector metadata entries. Expansion reveals existing local actions.
- At 1038px desktop width, count/search/three filters share one row. The count
  is left aligned and defaults to all 1004 skills, then tracks 127/105 when
  those location filters are selected. Controls stay compact at wider widths.
- Evidence: p17-capability-library under the existing task evidence directory;
  screenshots skills-filter-row-1038-en.jpg and connector-owned-tools-en.jpg.

The running P11 daemon still uses its previous backend, so the bundled-skill
compatibility identity rule is exercised there; the additive distributed receipt
projection is tested against the newly built host. P11's missing project
directory remains visibly reported and unchanged.

## Remaining numbered work

### P17.5 - Filter semantics and expandable skill cards

Registered 2026-11-21 before implementation, following owner approval.
Replace overlapping location/status filters with Installation / Installation
source / Availability. Source and availability apply to installed copies;
selecting Not installed resets and disables those two filters. Choosing a
specific source or availability selects Installed. Global settings omit the
project-only layer. Availability distinguishes Ready, Disabled and Needs
attention (scripts/overridden); task permission remains independent.

Keep the single compact filter row and filtered count at left. Skill cards
keep title, short description, horizontally arranged labels and local action
in the upper area. Expansion puts per-copy summary/actions before full
description and secondary metadata, with explicit section spacing. Cloud
metadata cannot push local controls below it. Do not duplicate the single-copy
action in both summary and details; multi-copy actions remain separately
identified at the top of expanded content. Cloud-only entries have no local
toggle. Preserve identities, all existing host routes and source data.

Owner clarification: replace the ambiguous combined Local & cloud label with
independent computer/cloud icons. Computer means installed on this machine;
cloud means listed in the cloud catalog, never cloud execution availability.
Both icons may appear on one deduplicated skill. Keep accessible hover labels.
Filled colored cloud is reserved for verified cloud callability; hollow muted
cloud means callability is unconfirmed. Current API supplies listing metadata
and local runnable hints only, so cloud icons remain hollow and explain that
execution status is not provided. Do not infer cloud callability from local hints.

Owner follow-up: use the concise default label Installation (zh: 安装状态).
Needs attention must expose reasons and next steps in expanded details, before
the long description. Script restrictions are a current runtime limit, not a
broken enable switch; instructions/references remain readable. Offer a local
filter action to find ready alternatives. For overridden copies, name the
winning layer and offer same-name search; never automatically disable copies.

#### P17.5 implementation verification - 2026-11-21

- Final UI suite: 745 passed across 31 files, with unchanged coverage thresholds:
  100% lines, 99.64% statements, 96.48% branches, 99.01% functions. The final
  run used two workers after an unrestricted parallel run hit test timeouts;
  its failure log is retained alongside the passing run. No thresholds were lowered.
- New guidance interactions passed with no enable/disable call: find ready
  alternatives resets query/source and selects Installed + Ready; same-name
  search resets source/availability and preserves per-copy management.
- Types, UI build, i18n and CSS guards pass. Earlier API/shared-shape/docs guards
  also pass; no host or platform changes belong to this follow-up.
- Browser checks before the final wording/guidance additions confirmed one-line
  filters at 1038px/1651px, no page horizontal overflow, 24px gaps between expanded
  description/metadata/cloud sections, independent local/cloud icons and counts
  of 1004 total, 232 installed and 772 not installed. Not installed reset and
  disabled source/availability, with no local actions on those rows.
- Final browser recheck is pending: browser automation lost its service connection
  and continued timing out after a fresh session. Saved p17.5 screenshots cover
  the earlier layout only, not the final Installation wording and guidance box.
  Do not treat them as visual acceptance of those final additions. Source build
  and automated regressions are complete; no installer was built or replaced.
- The existing P11 missing-project-directory error remains visible and unchanged.

Remaining visual check: P17.5 final guidance, compact Installation label and
cloud hover text after the browser connection recovers.

### P17.6 - Resume development runtime after interrupted app session

Registered 2026-11-21 before edits. The existing 62501 harness data and 19
project directories remain present. Restoring package mode currently fails
with ALREADY_INSTALLED; the default fixture mode also fails while replacing an
existing UI cache. Make package-mode restart validate the supplied package,
compare its exact materialized bytes with the installed version, and reuse
matching files without installing/overwriting. Refuse mismatches. Exercise a
fresh install, restart with preserved projects, and changed installed bytes
in isolated smoke tests. Do not recreate P11's missing project directory,
alter platform files/security policy, start model tasks or replace the installed app.

Recovery finding: the old temporary data root is missing its original master
key and 16 of 19 project keys. Its current project also has no key.enc. Startup
generated a new master and one project key before failing; only those two new
files were isolated in the task's recovery-generated-keys evidence folder after
stopping the recovery process. No original database/key was replaced or reset.
Add a pre-start check in the development harness to refuse existing encrypted
containers with missing master/per-container keys before opening KeyManager.
Read-only search across 486 candidate key files found no key that can decrypt
the old target container; available copies belong to other test roots. Finish
UI verification in a new explicitly isolated data directory. This is not
recovery of the old project content.

#### P17.6 verification and recovery inventory - 2026-11-21

- Harness smoke tests pass 3/3 with installed Node 22. They exercise fresh
  package installation, restart retaining the same project IDs and package
  modification time, refusal of changed installed bytes, and refusal of missing
  project/master keys without creating replacements. Types, docs, i18n, CSS and
  diff checks pass. Existing final UI baseline remains 745 passing tests.
- Key search: 486 candidate paths; 464 readable original-runtime candidates
  did not decrypt the known old project's wrapped key; 21 files could not be
  decoded (mostly deliberately invalid move-test fixtures); one newly generated
  quarantined key was excluded. No matching original key or full backup found.
  The currently selected project's database lacks a plaintext SQLite header.
  The reason original keys disappeared is not established by this investigation.
- Preserve-only copy: C:/Users/stonesomker/.ruyin/recovery/2026-11-21-NPmz6Y-preserved
  contains 68 original project/runtime/library files (73,042,503 bytes), including
  DB/WAL/SHM and surviving wrapped keys. Every copied SHA256 matches its source.
  Also copied nine historical acceptance snapshots (3,337,559 bytes) with matching
  hashes: source parsing, analysis result, review plan and inquiry candidates.
  These can support partial manual reconstruction, not full project recovery.
- New UI review host: 62503 with persistent isolated data under
  C:/Users/stonesomker/.ruyin/development/p17-ui-review. It uses three clearly
  synthetic harness projects and package 1.17.1; it does not impersonate recovery
  of port 62501 or the real P11 session. No model credentials/calls are enabled.
- P17.5 final English guidance is now visually verified: summary/actions above
  the guidance, readable restrictions, Find ready skills action, separated
  description/metadata. Screenshot p17.5-final-guidance-en.jpg. This host has
  only local skills and explicitly reports cloud catalog unavailable; real-cloud
  count/icon coverage remains the previous real-host check plus automated tests.

Next: P17.7 - restore old development project data if original keys or a complete
backup become available; preserve the verified copy meanwhile. P15 organization
switching and P16 installer/update acceptance remain independent queued work.

### P17.7 - Missing-key protection and verified offline backup

Registered 2026-11-21 before implementation. Original-key recovery remains
unavailable; do not claim that preserved files or analysis snapshots restore it.
Extend missing-key refusal from the development launcher into KeyManager itself:
never create a replacement master when encrypted containers/sealed runtime data
exist, and never generate a new project key for a nonempty existing database.
Fresh project creation remains supported. No new host route or response shape.

Add a manual, development-only offline backup/verify helper. The runtime must
be stopped first. Copy encrypted files and keys together to a new, disjoint
directory; reject links, existing targets, incomplete key sets and changed
source files. Hash every file and publish a manifest only after verification.
Verification opens copied databases read-only with existing keys and runs
integrity checks on the same Windows user account (DPAPI is not portable).
Test actual backup/reopen, a corrupted copy, missing keys, retained WAL data,
path boundaries and refusal to overwrite. No scheduled job, backup settings UI,
plaintext key export, platform change or installed-app replacement in this batch.

Implementation reuses the existing OS-managed runtime ownership lock for the
offline copy and the development harness. Includes sealed session/instance/model
state when deciding whether a missing master can be newly initialized. Backup
verification uses a disposable copy for SQL integrity checks so the immutable
backup's WAL/SHM bytes cannot be changed by the SQLite reader.

#### P17.7 acceptance - 2026-11-21

- Production KeyManager refuses replacement master/project keys when protected
  data already exists. Storage obtains the original key before opening SQLite,
  avoiding a leaked database handle on missing-key failure. Fresh databases
  initialize normally. The legacy rename fixture now includes original keys
  and asserts they travel unchanged with DB/WAL; the new protections are retained.
- Final host regression: 811/811 passed, 96.72% lines, 89.21% branches and
  92.68% functions, with unchanged thresholds. Targeted key/storage/harness/backup
  tests: 25/25. Host compilation, API/shared-shape/docs guards and diff checks pass.
- Real isolated backup: 60 files, 7,400,664 bytes and three encrypted databases
  at C:/Users/stonesomker/.ruyin/backups/2026-11-21-p17.7-ui-review. Standalone
  verify succeeds. A separately started restored copy retained all project IDs;
  table digests of kv/task_instances/audit_events/journal/files match the backup.
  The immutable backup verified again after the restore probe stopped.
- An actual backup attempt against the active review host was refused by the
  existing ownership lock, without creating its destination. The review host
  restarted against final source build at 62503; data lives outside Temp.
- Developer-only commands and restoration limits are documented in
  docs/60-operations/20-runtime-backup.md. Tests cover WAL-only committed rows,
  corruption, missing/wrong keys, active ownership, changing source, directory
  links, nested paths and existing targets. Failed copies stay marked partial.
- This closes new-data protection and verified backup/reopen acceptance only.
  The earlier 62501 project's missing original keys remain unrecovered. The
  Windows installed runtime, platform and real account session are unchanged.
- P15 interface preparation is recorded in 130-agent-home-delivery.md. Existing
  platform scope hints and authorized workspace pairs are confirmed by read-only
  source review; organization-switch code and real-account acceptance remain next.

1. P15 - Real organization switching with scoped native reauthorization and
   atomic desktop session replacement; platform files remain outside scope.
2. P16 - Recover the P11 acceptance environment from verified data, then package,
   install and update acceptance. Source/browser acceptance is not an installer
   release claim.
