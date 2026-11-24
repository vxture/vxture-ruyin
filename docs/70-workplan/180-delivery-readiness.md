# P23.2 and P24 - Source acceptance and delivery readiness

Registered 2026-11-22 before implementation under the owner's standing local RY
registration exception. Owner approved proceeding with current-source CI
acceptance and delivery preparation while Microsoft certification is pending.

| Work | Deliverable | Boundary |
| --- | --- | --- |
| P23.2 | Inventory current changes, validate an isolated source snapshot, required checks and exact build correspondence | Preserve the working tree, staging and existing user runtimes; CI is for the current snapshot, not an older commit |
| P24.1 | Check the first agent-package candidate, production signing/registry prerequisites, installation/update/rollback instructions | No bundled business agents, invented publisher trust, platform edits or release tags |
| P24.2 | User quick-start, runtime release notes, backup/restore and diagnosis guidance, remaining acceptance checklist | Document observed behavior; distinguish development fixtures from real production providers |
| P25 | Rebuild current bid package, run product tests and mounted six-stage/recovery probes | Synthetic-only validation; fix probe synchronization without weakening assertions or claiming live provider acceptance |
| P26 | Read-only platform capability/identity inventory and prioritized integration questions | Repo-local findings, not a replacement interface standard or platform implementation |

The submitted host candidate is fixed: `0.2.1-beta.1`, Store `0.2.1.0`, AppX
SHA256 `42ad77d12f94939c0987c2679aa86cd5a8d2687db33903acffe62a989f7a569b`.
Do not rebuild/replace/upload it or publish while doing this work. Documentation
and source-check corrections do not retrospectively certify or change that
archive. Any required runtime change is a separate next-candidate finding.

P24.1 implementation refinement, registered before code: the ordinary package
CLI emits unsigned files, while production host installation requires publisher
and Registry Ed25519 signatures under host-provisioned public trust. Add a small
build-only signing command that consumes caller-provided private key files and
the matching public trust, validates the complete package before and after
signing, refuses key/publisher mismatch and existing output, and emits only
public package metadata. It does not generate production keys, change runtime
trust, publish a registry or touch the submitted host. Exercise valid signing,
tampering, mismatched keys/publisher, native payload rejection and immutable
input/output with temporary synthetic keys. Document the still-unconfigured
production key/trust distribution separately rather than inventing it.

The platform checkout remains read-only. No customer material is sent to model
providers. Store installation/upgrade acceptance remains P23.3 after a trusted
Microsoft-signed candidate is obtainable. No security policy change or private
certificate installation is permitted by this preparation task.

Start by identifying the exact changed/untracked source files and existing
required checks. Exclude build outputs, local evidence, credentials and temporary
fixtures from any reviewable source handoff. Preserve existing edits and staging.
Only compare equivalent source/package payloads; a different rebuilt EXE hash is
not the submitted file's identity. Record test failures and limitations honestly.

P25 probe repair registered before code: the mounted writing probe advances the
synthetic task after a microtask-only flush, while the UI action still awaits
WebCrypto and document persistence. Failures occur at different adoption stages.
Wait for the existing refresh control to become idle before directly driving
the synthetic result. Keep all draft/history/evidence assertions unchanged.

Clean-run CI also exposed the Markdown mapper test's dependency on compiled
document code. Like backup and signing integration, it must run after build
with missing artifacts treated as failure; static checks explicitly defer it.

## Local acceptance and handoff (2026-11-22)

- Captured 514 source files (6,000,776 bytes) in an attached managed worktree.
  Original files and index were preserved; all 514 original hashes still match.
  Subsequent build-tool, CI and documentation edits live in the delivery worktree.
- Frozen-lockfile install, recursive build/type-check and all workspace suites
  passed: UI 799, host 865, shell 64 and shared packages 187. Local coverage
  gates retain their existing thresholds (UI branches 96.25%, host 89.72%).
- All 205 script tests passed with prepared build/runtime inputs. A source-only
  archive without dependencies/build outputs passed 193 and explicitly deferred
  12 environment-dependent tests. Backup, Markdown and signing integration are
  mandatory after build and all six cases passed with zero skips.
- Secret scans passed on the snapshot and staged source. Local OSV execution was
  blocked by this Windows environment; the same lockfile's remote audit passed.
- Rebuilt the actual independent bidproposal 1.17.1 package, with the immutable
  hash recorded in the package-delivery guide. Its 99 product tests passed.
  Twelve mounted UI probes cover reading, matrix autosave, optional bidder
  questions, plans/recovery, enterprise material/evidence, writing/rewrite,
  review and output tickets. Writing passed twice after probe synchronization.
- Actual package preflight rejected unsigned production installation. Temporary
  synthetic author/Registry keys then exercised the build signer and actual
  mandatory-signature installer. All 44 extracted UI files matched the package,
  the isolated product origin served exact entry bytes, and repeat installation
  was refused. Temporary keys and test installation were removed; original
  unsigned bytes stayed unchanged. No production keys or authority were invented.
- Added the user guide, 0.2.1 delivery checklist and signing procedure. P26's
  read-only findings and prioritized integration gates are in
  [platform readiness](190-platform-readiness.md).

Reviewable handoff is existing [PR #311](https://github.com/vxture/vxture-ruyin/pull/311).
The code checkpoint `9e377907a8d30325b8936d236af2dc3252bffba3` passed remote
build, compiled integration, contract/static/quality gates, coverage, audit,
gitleaks and CodeQL. Both Windows package and Store jobs subsequently passed:
normal packaged launch, read-only payload launch, offline Excel tools, real DOCX
reader and Store identity 0.2.1.0. The complete
[CI run](https://github.com/vxture/vxture-ruyin/actions/runs/44953566873) is green.
This is GitHub runner package acceptance, not Microsoft-signed installation on
the user's computer. Final documentation-only changes are checked on the PR's
current SHA separately. No merge, release tag or public publication was performed.

## Reproduce the business regression

With the independent product checkout available and the RUYIN workspace built:

```powershell
node --test <bidproposal-repo>/portals/desktop/src/*.test.mjs
Get-ChildItem scripts/dev/bid-*-ui-probe.mjs | ForEach-Object {
  node $_.FullName <bidproposal-repo>/portals/desktop
  if ($LASTEXITCODE -ne 0) { throw "Business UI probe failed" }
}
```

These are JSDOM/component/API fixtures, not a substitute for browser chooser,
actual file download or real provider/environment acceptance. They transmit no
customer materials and do not call a real model.

## Remaining numbered batches

1. **P23.3**: Microsoft-signed actual installation, upgrade, DPAPI migration and
   background/recovery acceptance. Certification is now Ready to publish, with
   manual hold retained; certification does not complete these tests.
2. **P26.1–P26.6 implementation**: formal signing/trust delivery, approved native
   identity and product invocation, exact scope switching, supported-client
   catalog, atomic device policy, and real Atlas/Runos/deployment verification.
   These require the platform and production environment work, not more synthetic
   bid content. Platform files remain unchanged in this batch.
