# Bid product P10: workflow convergence

Registered 2026-11-20 after the user requested numbered follow-up batches and continued improvement. The standing local RY registration exception applies. Preserve existing edits and project data. P9 production and browser-file handoff gates remain open.

## Numbered delivery batches

| Batch | Work | Acceptance |
| --- | --- | --- |
| P10.1 | Inventory confirmation nodes and consolidate batch material authorization | One effective material-authorization entry for each exact batch request; distinct tools and result reviews remain visible |
| P10.2 | Unify runtime result review with business outline/chapter adoption | One explicit informed business decision, retaining required human verification and source/revision checks; no model self-approval |
| P10.3 | Business task names and clear statuses | Main UI uses product-facing names; internal identifiers and raw checks stay in execution details |
| P10.4 | Retire obsolete manual-draft and whole-proposal entry points | Six-stage workflow is the normal path; old records and active tasks remain readable/recoverable |
| P10.5 | Pause/cancel/retry and action-count consistency | UI matches durable job state across navigation and restarts; a requested cancellation is not reported as an execution failure |
| P10.6 | Combined new/old project acceptance | Authorize, confirm outline, write, revise, export and restart without duplicate decisions, lost drafts or old-project damage |

Product detail: `vx-agent-bidproposal/docs/70-workplan/130-desktop-p10.md`. The user subsequently directed P9 issues to be marked and P10 to proceed. P10.1-P10.6 are now accepted locally in product 1.17.1 and the current observation host. P9 remains open with issue IDs in its acceptance document. Report the numbered list with progress updates. No production release or Windows installer acceptance is implied.

## P10.1 interface registration before implementation

Extend the host-session-only `GET /projects/:projectId/jobs` item with `contextConfirmations: Array<{taskInstanceId: string; checkpointId: string}>`. Each pair identifies an existing, currently pending context_confirm checkpoint whose exact single project-document context matches an active batch step, the persisted document revision/content, the current contract and all pinned source revisions. Empty on missing/stale/terminal/incompatible inputs. Return no source body or credentials. Existing fields and exact-request approval endpoint are unchanged. No product-bridge permission is added.

Workspace UI suppresses only those exact task/checkpoint pairs from the standalone material-confirmation list, using the host batch entry instead. It does not suppress result review, tool confirmation, unrelated tasks, stale/mismatched sources, or confirmations when the jobs read fails. Successful batch authorization keeps its existing requestHash and contract/source checks; this presentation change never decides a checkpoint by itself. Old hosts without the additive field retain all standalone confirmations.

The contract R9 requirement for generated outputs to include human verification remains. P10.2 must consolidate its business meaning rather than deleting human rules to avoid UI friction.

## Confirmation inventory

| Node | Owner and purpose | Disposition |
| --- | --- | --- |
| Fixed batch material authorization | Host exact-request authorization before inference | Keep; one entry per matching batch, consolidate its per-step context prompt in P10.1 |
| Unbatched/stale material request | Host context_confirm | Keep separately; do not infer ownership from labels or task names |
| Tool operation | Host tool_ask | Keep separate from material approval |
| Outline/chapter human verification | Runtime contract + host | Keep required verification; unify with business approval in P10.2 |
| Requirement confirmation, outline lock, rewrite adoption | Product business decisions | Keep source/revision-aware explicit decisions; resolve duplicated semantics in P10.2 |
| State advance | Host state-request decision | Keep distinct; showing/closing a panel grants nothing |
| Technical checks and raw output | Execution record | Retain for support, move out of primary user flow in P10.3 |

## P10.1 local acceptance

Implemented the additive host-only jobs view and shared UI/server type guard. The summary correlates a currently pending context_confirm only after checking active batch state, matching task/step, current contract, pinned source revisions and exact project-document version/content. Lookup indexes task IDs once per request. This never approves a checkpoint, changes the task record or transmits source text. Frontend consolidates only that exact pair; missing old-host metadata, failed jobs reads, mismatched pairs, unrelated tasks, tools and result reviews retain their normal controls. The approval endpoint and product-bridge permissions are unchanged.

142 related host tests, 680 workspace UI tests and 18 API/shared-shape guardrail tests passed. Workspace coverage remains above unchanged thresholds: 99.64% statements, 96.19% branches, 98.93% functions and 100% lines. Host/UI type checks, Vite build, i18n, API/shared-shape checks passed. The guardrail fixture now includes the new shared interface rather than dropping it from verification.

The ordinary browser UI displayed exactly one batch authorization in an isolated synthetic project while its underlying child context checkpoint remained undecided. Closing did not approve it. An actual host restart recovered the same task/checkpoint association, with no model output. The completed P9 project's documents, jobs, task records and file metadata matched the pre-update snapshot after both restarts; MD/DOCX/PDF digests also matched. The synthetic task was explicitly cancelled, the batch settled cancelled (P9-I06 live verification), and the synthetic project was archived. No existing business task was cancelled or approved.

Evidence: local `p10-acceptance/{checked.json,after-restart.json,result.json,main-before.json,main-after.json,single-authorization.jpg,host-regression.log,guardrail-tests.log}` and `p10-ui-coverage.log` under this chat's visualization directory. Product package 1.16.3 remains unchanged; this is a host/API/UI update in the local observation runtime, not a new Windows installer or production release. P9-I01-P9-I05 remain open. P10.2 still needs to consolidate the separate business result decisions without relaxing contract R9.

P10.5 finding retained: after explicit cancellation/archive of the two synthetic UI fixtures, GET /pending still reports their undecided context checkpoints although their task and job states are cancelled. This affects the global bell count, not the exact-batch correlation on the current project. Fix the pending-query terminal/archive filtering in P10.5; do not fabricate approval decisions or delete audit records to clear the count.

## P10.2-P10.6 implementation registration

The user explicitly requested uninterrupted completion of all P10 batches. Keep human verification required by R9. For new outline/chapter requests, the product may stage a read-only candidate while the runtime is waiting solely on human result review and machine checks passed. A product-frame message `ruyin.review/request` carries only a bounded taskInstanceId and requests opening the host review panel. The host accepts it only from the mounted frame/origin and current project, rereads task state and opens an existing verification_review; the message cannot decide any checkpoint. Only the host user's decision uses the existing host decision endpoint. New product requests record `reviewMode=business` locally; only completed/verified matching results can then be adopted/locked automatically, as the fulfillment of that one review decision. Existing requests retain legacy acceptance behavior. Persist application receipts before multi-document writes so a crash cannot replace another revision or require a second human decision.

P10.3 contract/API metadata: add optional bounded task `name` as presentation metadata, expose it on the existing ProjectView.tasks item, and populate names in the bid package build. No authority, output class or human rule changes. Hide internal context/check IDs and raw statuses in collapsed execution details; keep complete inspection available. Product names/data are rendered as text, never HTML.

P10.4 removes the unused manual draft editor/placeholder from the package UI and prevents generic launch controls bypassing the declared business UI. Keep old task definitions and stored Markdown for compatibility rather than making a breaking contract removal.

P10.5 fixes GET /pending to omit archived projects and non-waiting task instances (without rewriting their audit/checkpoint records). Batch cancel actively cancels its owned running task and recovers an uncertain submission by durable requestKey without creating a new task. A pending cancellation cannot be undone by resume; genuine failures remain failures, partial outputs remain unverified, and explicit retry clears the cancellation intent only for a new attempt.

P10.6 verifies new business-review adoption and restart idempotency, exact authorization, cancellation/notification cleanup, compatible old projects and three-format output. Use isolated synthetic data for model acceptance, keep P9-I01-P9-I05 open, retain all repository edits and unchanged quality thresholds. No push, deployment or security-policy change.

## P10.2-P10.6 local delivery and acceptance

All six P10 batches are complete locally. Final product package: `bidproposal-1.17.1.ruyinpkg`, SHA256 `b850d6c7e001b95ebc3d27510aaafc2832630048db733f3dd2aaafd799f2da10`. Preflight, install, compatible project upgrade, activation and actual observation-host restart passed. Version 1.17.0 was an intermediate local candidate; 1.17.1 additionally fixes an idle completed writing queue incorrectly reporting a missing background request when polled. No Windows installer was produced or installed in this batch.

P10.2 stages a read-only candidate only when all machine checks pass and the sole pending checkpoint is human verification. The product asks to open an existing host review; it cannot approve it. The host rereads current-project task state and validates frame source/origin. Closing makes no decision. The host decision is fulfilled by version-checked plan locking or chapter adoption when the product synchronizes, including after return/restart. A completed/verified result is required. Plan adoption uses a durable receipt before multi-document writes; interrupted chapter adoption replays without another decision or duplicate version history. Changed requirements, planning, evidence, current text or an unavailable pinned template prevent replacement and preserve the saved result. Requests without business review mode retain their legacy behavior. The explicit business adoption wording applies to the requested review, while generic/legacy host checkpoints retain their existing meaning.

P10.3 adds optional task `name` (1-80 characters) to contract metadata and ProjectView.tasks. The bid package supplies names. Confirmation, recent-task and execution lists prefer these names, retain legacy fallback and put task/check identifiers under execution details. Generated outline/chapter content is readable independently of raw JSON. P10.4 removes the dead manual-draft editor, incomplete placeholder and duplicate five-step navigation. Product-owned business UI replaces the generic task launcher; old task definitions, records, Markdown and histories remain compatible.

P10.5 adds the additive job state `cancelling` to bridge GET /jobs/:id and control responses while an owned child is settling. Cancel recovers uncertain submission via requestKey without starting missing work, actively requests cancellation, refuses resume while cancellation is pending and retains unverified partial results. Explicit retry after a genuine failure retains history and clears prior intent. GET /pending omits archived projects and non-waiting tasks without changing their checkpoint/audit records. A live cancellation fixture settled its child and job, left the context checkpoint undecided and returned zero pending items.

Validation: 99 product tests, 690 workspace tests, 101 runtime-core tests, 760 local-host tests under the normal development Node 24 runtime, and 18 API/shared-shape guardrail tests passed. Unchanged UI thresholds passed: statements 99.64%, branches 96.23%, functions 98.94%, lines 100%. Runtime-core coverage: 95.36% lines, 86.66% branches, 93.53% functions. Host coverage: 96.71% lines, 88.46% branches, 92.42% functions. No threshold, file inclusion or required check was weakened. All 11 mounted product probes passed; one evidence probe exceeded its polling deadline under concurrent suite load and passed when repeated after the load settled. Type checks, UI build, package build, API/shared-shape/i18n/docs guards and diff checks passed. The build retains its existing large-chunk advisory.

The first full host run using the installed Node 22 executable failed two environment-specific fixtures: one tried writing under its Program Files installation, and one opened the package-default SQLite ABI 137 from ABI 127. The same unchanged suite passed with the configured development Node 24 (ABI 137). The live Node 22 observation host uses its ABI-specific SQLite binding and passed the real model/render/restart acceptance. This does not close P9-I03 current Windows installer acceptance.

P10.6 live acceptance used a fresh project with one synthetic, operator-confirmed requirement and a generated synthetic DOCX template. DeepSeek produced an outline, chapter, isolated rewrite and source-pinned review. IAB verified the single batch authorization, opening/closing host review without adoption, then one explicit host decision per generated output. Leaving the product page did not stop inference; an actual restart retained the same unadopted candidate and task. The confirmed rewrite kept the first chapter as history. The review retained three suggestions and seven missing-material warnings; these are fixture findings, not software test failures or automatically resolved compliance claims. The resulting four-page PDF, DOCX and Markdown passed size/hash verification and remained identical after the final restart. The original P9 six-stage project's business documents, tasks, jobs, file metadata and all three existing output digests also remained identical after upgrade/restarts.

Evidence under this chat's visualization root: `p10-acceptance/{business-review.jpg,final-preview.jpg,workflow-integrity.json,final-integrity.json,final-before-restart.json,final-after-restart.json,package-install.json,product-tests.log,ui-full.log,core-coverage.log,host-coverage-node24.log,guardrails.log}` and `p10-package/build-result.json`. The local observation URL remains port 62501; the synthetic acceptance project is `prj_d9d52cc19fd64d1daeab3e641829e75e`. Existing source edits are retained; no commit, push, deployment or security-policy change was made. P9-I01 chooser, I02 browser save completion, I03 current Windows installer, I04 production accounts/console/model route and I05 cloud/domain-contained acceptance remain open; I06 is locally fixed and reverified.
