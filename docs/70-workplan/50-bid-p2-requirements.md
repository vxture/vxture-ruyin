# Bid P2: tender interpretation and requirement confirmation

Continue the owner-approved six-batch MVP. Product code remains in vx-agent-bidproposal; package 1.2.0 uses existing task/context/result and Markdown document bridges. No new host business API. Requirements are split into commercial and technical, require quote/location for confirmation, and editing clears confirmation. Re-analysis appends deduplicated candidates without replacing existing rows. Runtime retains sensitive-context approval and result review. Coverage checking remains a later batch.

Development acceptance uses synthetic tender text and the previously authorized DeepSeek key file, read only by the isolated host process. RUYIN_HARNESS_MODEL_KEY_FILE explicitly opts into the probe; no credential enters the package. No private-domain claim is made for this public-model test route. Missing/invalid configuration fails rather than falling back to a public route.

## Acceptance result: passed (text-input desktop MVP)

- Installed bidproposal 1.2.2 with pinned UI through the production install handler (201).
- Synthetic Markdown tender went through the existing runtime task path and official DeepSeek flash. Context and result checkpoints were exercised in the shared shell. Six AI requirements (3 commercial, 3 technical) retained exact source quotes; verified against the synthetic source.
- Browser verified individual confirmation, one manual addition with quote/location, all-confirmation, edit invalidation (7 to 6), reconfirm/save and reopen at matrix revision 2. Seven confirmed rows persisted. P1 chapter drafts remained intact at revision 4.
- Requirements Markdown document ID: bid_requirements; scope and revision conflict behavior reuse the existing project document bridge. No new host business API.
- Product tests: 6 passed; syntax check, docs numbering, diff whitespace check passed. Host harness smoke: 2 passed. Desktop and narrow viewport inspected.
- Final package SHA256: be47a426ed8527c472e144fe5bdac808f99d49578bdba58f65ed9563f5581099.
- Review URL: http://127.0.0.1:62501/?token=uiharness#ws/prj_c47d1b5c62ca441b85104b7bafb4dd27/product
- Evidence: p2-result.json and p2-desktop-requirements.jpg under the task visualization directory.

## P7.0 real-source reading baseline (2026-11-19)

Registered under the owner's standing permission to keep local workplan records while the RY artifact is unavailable. Product workplan: vx-agent-bidproposal `docs/70-workplan/100-desktop-p7.md`.

The owner supplied an 89-page historical tender PDF. Development-only probes compared pdfplumber/pypdf and existing PDF.js, retained 34 table candidates including single-row tables, recorded 64 equipment serials and 11 continuation candidates, and flagged images and one contaminated quantity cell. Twenty-four quote/location cases plus five negative controls passed. Synthetic DOCX and UTF-8 Markdown structural reading were also checked. No model interpretation or external upload occurred; quote matches do not establish business completeness.

No host route, contract, installed package or project binding changed. These probes use development dependencies, not a shipped reader. Production local parsing must use the existing tool distribution boundary and an explicit adapter decision before implementation; it does not belong in LocalFsConnector or runtime-core. P7.1-P7.3 and P6 browser download finalization remain pending. Detailed source excerpts stay outside Git in local evidence.

P7.1 implementation registration: ADR-027 records the fixed local reading adapter, bundled Python dependencies, immutable project snapshots and scoped `/bridge/readings` API before code. This is a local RY-102 addendum under the existing registration exception; mirror it when the RY original is available. Acceptance includes page departure, restart interruption, exact source hash, old/new imports, errors and original project preservation.

P7.1 development acceptance (2026-11-19): product package 1.8.2 installed in the retained UI harness. A separate real-source project read all 89 PDF pages in the daemon after leaving the page, retaining 64,367 characters and 34 table candidates exactly against the P7.0 baseline. The completed snapshot survived daemon restart unchanged. Original project draft v7, requirements v2, plan v8 and nine renders retain their original hashes/count. Real source content and local evidence remain outside Git; no model call or external upload was made.

The fixed reader uses installed RUYIN CPython and a hash-locked, prebuilt 11-dependency payload with upstream notices, never a Codex/system Python fallback or runtime pip. PDF/DOCX/Markdown and malformed/encrypted/missing-runtime cases were exercised. The build stages a fresh payload and adds an unpacked offline smoke check; that check passed against local resources, but a new Windows installer was not built or published. Host reader/API tests: 108 passed; product tests: 32 passed; mounted reading/writing and two harness checks passed. Page inactivity stops polling without stopping daemon work. Shutdown aborts the child and leaves saved blocks for restart recovery. P7.2 model batching, P7.3 source verification, and P6 browser download finalization remain open.

Boundary: accepted with Markdown text through Materials bindings. Scanned PDF OCR, complex Word table parsing, large-tender completeness and private-network deployment are not accepted by this synthetic public-model test. Confirmation does not assert chapter coverage. No Windows production update was published.


## P7.2 implementation registration (2026-11-19)

Reuse BackgroundJobs for deterministic product-owned source batches, durable results and scoped retries. Reject provider length/content-filter termination for both generation and verification. The product keeps extraction candidates separate until P7.3 evidence verification; no automatic mutation of existing confirmed/manual matrix rows.

Local RY-102 addendum under the standing registration exception: authenticated host-only GET /projects/:id/jobs returns job approval summaries; POST /projects/:id/jobs/:jobId/context-approval accepts {requestHash} and records user authorization for the exact immutable job request and contract. Product /bridge/jobs endpoints remain unable to grant this approval. Daemon may decide only context_confirm checkpoints with exactly one project-document item matching the approved step ID, revision and complete content, while pinned sources and contract remain unchanged. Other checkpoints still require their existing approval. Approval is durable across restart, scoped to that job only, and visible in the host pending panel. Retry retains the same inputs; a different request requires a new approval. No sensitivity downgrade or runtime-core gate removal.

Acceptance: unapproved jobs do not transmit, stale request/hash/context/source/contract cannot inherit approval, approval survives restart, non-context checkpoints remain pending; product lossless batching and invalid envelopes, zero requirements, failure-only retries, departure/reload and original-project preservation. Real-file DeepSeek analysis is explicitly authorized by the owner for this tender only; originals, extracted text and results stay outside Git.

## P7.2 development acceptance (2026-11-19)

Product package 1.9.1 installed in the retained UI harness, SHA256 efc34aa4d9d8f23430d390678b81e94e353de1b87ed85c4043a189990fc70c80. No new Windows installer was built or published; no cloud deployment occurred. The local RY-102 addendum above remains to be mirrored when the authoritative artifact is accessible.

- The owner-authorized real tender retained 89 pages, 64,367 characters and 34 tables as 279 losslessly checked source segments across 12 batches. All 12 batches completed through the configured official DeepSeek route, saving 560 candidates (258 commercial, 302 technical) and 197 model review notes. Batch envelope, source version and segment coverage checks reported no errors; these checks do not establish semantic completeness or exact quote validity.
- Daemon execution continued after page departure. Batch five encountered an empty model response; restart and retry preserved the first four completed tasks and results. After installing 1.9.1 and restarting again, all 12 result task IDs, revisions, SHA256 values and the job authorization record were unchanged.
- Final browser verification showed 279/279 segments, 12/12 valid batches, grouped saved candidates and a closable source-page panel. Unchanged candidates are not rebuilt on polling. Independent synthetic model acceptance returned all eight clauses with exact quotes, quantities and deadlines checked.
- Product tests: 36; BackgroundJobs and gateway: 36; server: 104; workspace and API: 191; UI harness: 2; pack-smoke unit tests: 15. A final targeted route regression covered approval availability. Mounted reading/batch views, syntax/type checks, builds, documentation numbering and whitespace checks passed.
- Original synthetic project remains unchanged after the final restart: draft v7, requirements v2, plan v8 retain baseline SHA256 values; nine render records remain, with no delivery document added.

Evidence stays outside Git in the task visualization directory, p72-acceptance, including lossless input comparison, synthetic model checks, failure-only retry, before/after restart result hashes, final project preservation and browser screenshots. No original source text, candidate payload or credential is added to repository documentation.

P7.2 candidates remain separate from the confirmable matrix. P7.3 must verify exact quotes and immutable versions, distinguish shared notices and other lots from this lot, review conflicting budget scopes, address the existing 500-row matrix limit before importing 560 candidates, and validate business samples. P7 and P6 browser download finalization remain incomplete.

## P7.3 implementation registration (2026-11-19)

Product-only source and scope verification reuses immutable readings, BackgroundJobs, approved model routing and encrypted project documents. No host route or response shape is added. Exact source/hash/location and table-cell checks run locally; only explicit whitespace normalization is allowed. Bounded model review checks whether each requirement is supported and applies to the user-selected lot, shared terms, another lot or an uncertain scope, and reports conflicting values without silently merging them. Saved candidate provenance and compatible Markdown matrix metadata gate adoption and confirmation. Byte-bounded storage and paginated presentation replace the 500-row product cap; existing manual and confirmed rows remain intact. Acceptance covers forged/stale quotes, table associations, source changes, duplicate adoption, conflict preservation, background/restart recovery and the authorized real-source sample. Original text and model payloads remain outside Git.

## P7.3 development acceptance (2026-11-19)

Installed and activated product package 1.10.2, SHA256 be4c28b3081793299d8b86d08aae384f8e166259deb1ea35011d7f1c0e1c3887. No new host interface, queue or persistence layer. No Windows installer or cloud service was released.

- Real-source quote checks: 555 exact matches, 3 explicit whitespace-normalized matches and 2 unmatched designated source segments. File hash, immutable positions and table cells remain binding. Sixteen bounded DeepSeek source/scope review batches completed with every candidate accounted for: 537 ready, 17 requiring review, 2 source errors and 4 other-lot exclusions; zero malformed review results.
- Browser adoption saved 537 unconfirmed rows (250 commercial, 287 technical) at matrix revision 1; repeat adoption retained both count and revision. All adopted source references rechecked successfully; exceptions and other-lot candidates were excluded. Byte-bounded storage replaces the 500-row product cap; a 601-row mounted regression and full 560-candidate capacity probe passed without truncation.
- Candidate filtering, paginated matrix, highlighted source drawer and explicit manual review notes are connected. Changes to evidence, source version, target review or exclusions invalidate confirmation and downstream planning. Repeated current-section navigation notifications no longer close details or reload the matrix; the regression is covered in the mounted probe.
- Page departure retained daemon execution. After final package activation and restart, all 16 result task IDs, revisions and hashes and the context approval remained unchanged. The 537-row matrix remained unconfirmed at v1. Original synthetic project draft v7, requirements v2, plan v8 and nine render records retained baseline contents.
- Product tests: 44 passed. Mounted reading, extraction, source review/adoption and planning probes: 4 passed. Synthetic real-model semantic checks: 7/7; selected real-source business checks: 22/22. Syntax, product build/install validation, documentation numbering, product ASCII and whitespace checks passed. Detailed evidence remains outside Git in p73-acceptance.

This accepts the local P7.3 capability, not a full real-tender certification. Seventeen review items, two quote errors and the original 197 extraction notes remain visible for further review. No real matrix row was confirmed on the owner's behalf. Image/OCR and all cross-page semantics remain limited; the real-source confirm/plan/write/review/export workflow and P6 browser download finalization remain open.

## P7.3 exception disposition acceptance (2026-11-20)

Under the existing owner authorization, all 19 exceptions were inspected against original PDF pages and adjacent pages without changing the immutable snapshot or repeating model calls. Ten were corrected and added to the matrix; nine contain ambiguity in the original and remain awaiting procurement clarification. Final counts: 547 ready, 9 clarification, 0 source errors, 0 unreviewed, 4 other-lot exclusions. This is a completed disposition pass, not a claim that all 19 are resolved.

Product package 1.10.4 was validated, installed and activated in the retained development harness; SHA256 f80672832c79a3b0b96d4eada90fb14b3c7bc2504df1786807a598bb144b9629. Product-only changes support a reviewed primary segment, up to eight individually checked supplemental quotations, durable disposition history and reviewer identity. Unresolved source findings prevent downstream planning even if adopted matrix rows are marked confirmed. No host API shape changed and no Windows installer or cloud service was released.

The matrix contains 547 unconfirmed rows at revision 2; all original 537 rows remain identical. The decision document is revision 19. After restart, matrix and decision revisions/hashes, all 12 extraction and 16 review result documents, task IDs and scoped approvals are unchanged. Repeated adoption adds zero rows and does not change revision. The original synthetic project retains draft v7, requirements v2, plan v8 and nine historical renders with baseline hashes/count.

Product tests: 46 passed. Mounted source-review, batch and planning probes passed; source-review and planning were repeated after the final fix for manual re-review of supplemental evidence. Browser checks covered clarification filtering, primary and supplemental sources, the matrix restriction, stable details and closing actions. Syntax, ASCII, documentation numbering and whitespace checks are recorded with local evidence. Source pages, business dispositions and the 19-item report remain outside Git under p731-exceptions. No procurement communication was sent. Nine clarification items, final business confirmation, the full real-source workflow and P6 browser download finalization remain open.

## P7.4 bidder inquiry MVP acceptance (2026-11-20)

Owner clarification: the product represents the bidder. Identify source-backed doubts and offer two paths: operator clarification/interpretation/explanation, or an optional inquiry to the purchaser and tender agency. The operator decides whether to ask or pursue further questioning. A recorded handling choice allows subsequent work without an enforced inquiry/answer loop. Received answers may become separate supplemental inputs in a later batch; reply intake and automatic reanalysis are deferred.

Installed development package 1.11.2, SHA256 a8714b98fbfd7776d43776a72c77f63d277aa645a04058b3637f9a10dcdde152. Product-only model task, immutable issue manifest and existing BackgroundJobs produce bidder-side questions, impact, inquiry drafts and requested clarifications. They never draft issuer answers, send inquiries or mark requirements confirmed. Recorded handling notes persist with source decisions and enter planning and chapter context. Invalid source quotations remain blocked. No host API or authorization shape changed.

Product tests: 53 passed. Synthetic 99-item batching preserves every issue in 13 bounded batches. Mounted inquiry, source-review, batch and planning probes passed, including submission of the recorded-handling form and continuing without an external answer. Existing owner-authorized source issues yielded nine inquiry drafts in two DeepSeek batches after page departure. Restart retained result hashes, versions, original task IDs and approvals; the 547-row unconfirmed matrix and v19 decisions remained unchanged. Original extraction/review results and synthetic project artifacts also retain their baselines.

Browser acceptance verified both handling paths, source review, saved results and stage navigation. Product startup now retains navigation received before asynchronous panels finish mounting, avoiding an incorrect visible stage. The actual tender remains a software test sample; its final business confirmation does not block development. Local evidence is p74-inquiries; no original text or generated customer content enters Git. No new Windows installer or cloud service was published.
