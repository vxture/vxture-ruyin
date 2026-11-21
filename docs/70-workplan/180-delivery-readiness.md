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
