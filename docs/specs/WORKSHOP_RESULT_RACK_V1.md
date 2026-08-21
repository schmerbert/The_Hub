# Workshop Result Rack v1 — Exact Results, Fitted Attention

> **Status: Implemented custody/fitting core; broader artifact contract partial.** Result Rack SQLite custody, deterministic projections, ordinary Gateway and async recipe integration, provider attention metering, declared old-tool-exchange omission, and approval-completion receipts are implemented. General sandbox file-artifact collection, Rack inspection tools/UI, retention/disposal policy, parser observations, and full promotion-package artifact custody remain adopted design. See [`../STATUS.md`](../STATUS.md).

## Current implementation boundary

`ResultRackStore` persists append-only jobs, status events, exact output chunks, explicitly admitted artifacts, and fitted projections. All ordinary Gateway success, refusal, pending-approval, and approval-completion crossings create exact machine-result custody. Async named-recipe completion is captured as well. `result_projection/v1` applies deterministic policy-specific byte/line fitting, records exact selected ranges, hashes, omitted counts, and a `result-rack://` pointer; host-return Scrub names this crossing `result_rack_projection_v1`.

This is manifest/output custody, not a claim of complete sandbox artifact persistence. The active Gateway admits exact `machine-result.json` artifacts and the store can retain explicitly supplied bytes, but it does not crawl a sandbox for generated files, collect arbitrary build artifacts, or implement disposal/external-store retention. The proposed list/read/range/artifact operations later in this document are not mounted resident tools.

Provider fitting is implemented separately from World authority. The engaged fixture deterministically selects a smaller provider-facing schema profile while the complete Workshop catalog remains mounted in World. The host persists a byte attention measure for each provider phase and exposes the latest measure/profile through `/api/health`. It may omit only declared older completed assistant-tool/result exchanges, retains the current and configured recent exchanges, records exact omitted source positions and hashes through provider-presentation Scrub, and adds an omission disclosure. Under [`FOREST_EXHALE_V2.md`](FOREST_EXHALE_V2.md), omission now fails closed unless every result has a verified same-lifespan Result Rack projection pointer; Glass carries a bounded pointer-only trail sign and the universal host-owned `reopen_result` crossing may deliberately reopen one exact projection. The exact original messages remain in Source Ledger custody, and the runtime never substitutes a generated summary.

Approval custody now has distinct append-only pending and completion phases. Promotion approval binds the candidate plan/patch hashes; confirmed, rejected, and restart-cancelled outcomes are separately recorded. The broader promotion-result fields and general verification/artifact pointers described below remain design targets unless present in the exact machine result.

## Objective

Result Rack gives Sandbox Bay outputs a durable, inspectable place without pouring raw logs, diffs, and artifacts into resident context. It holds exact evidence behind the wall and derives small deterministic resident-facing projections with explicit omission disclosure.

The Rack is a Workshop fitting and custody boundary, not a conversational memory, a summarizer, or an artifact executor.

## Relationship to Sandbox Bay

Each [Sandbox Bay](WORKSHOP_SANDBOX_BAY_V1.md) job owns one result set. The set may contain many step results and artifacts, but it cannot mix records from another job or brief revision. The Rack accepts results only from a valid sandbox transition receipt or a host-owned promotion operation.

A successful result does not authorize promotion. Promotion consumes a sealed candidate whose exact result pointers remain on the Rack.

## Record model

Stable type-first identities include:

- `result.<id>` — one execution or host operation outcome;
- `artifact.<id>` — one exact retained byte sequence or declared external pointer;
- `projection.<id>` — one deterministic fitted view;
- `result_set.<id>` — the ordered results for one sandbox job.

Every result records:

- sandbox, job, brief revision, step, actor, wake, and lifespan ancestry;
- exact command argument vector, working-directory identity, backend/profile, and environment-policy hash;
- start/end time, exit code, signal, cancellation/limit reason, and resource observations;
- separate stdout and stderr custody;
- exact changed-path/diff/tree/commit pointers when applicable;
- artifact IDs, media types, byte lengths, and SHA-256 hashes;
- capture completeness, truncation/termination facts, parser receipts, and result-state hash.

Records are append-only. Corrections create successor records; they do not rewrite captured output.

## Exact output custody

Stdout and stderr are distinct ordered byte streams. Their raw bytes, byte lengths, hashes, encoding observation, and capture completeness are authoritative. Display decoding is a named projection and never changes the retained bytes.

Output ceilings are declared before execution. A backend must either:

1. retain the complete stream within the ceiling; or
2. stop capture/execution according to the declared overflow policy and mark the result incomplete.

If bytes are omitted, the Rack must not claim a full-output hash or reconstruct the gap. It records the exact retained ranges and hashes, the known omitted byte count when measurable, the reason, and whether the process was terminated. Prefix/suffix sampling is lawful only when both exact ranges and the missing middle are disclosed.

Binary output remains binary. Invalid UTF-8, control sequences, terminal escapes, HTML, Markdown, and source-like instructions are data, not trusted rendering or authority. UI projection uses safe text construction and explicit download/inspect affordances.

## Artifact custody

An artifact enters only through a declared collection rule and scope. Collection refuses symlinks, sockets, devices, protected paths, path escape, and files exceeding declared limits. Directories are represented by a deterministic manifest; no archive is trusted merely because of its extension.

Artifact retention records whether bytes are held locally, deliberately discarded after hashing, or referenced in an external store. An unavailable external pointer is an honest gap. Artifacts do not execute, mount, enter Home Forest, or become user ground merely because they were retained.

## Derived observations

Parsers may derive facts such as test counts, changed paths, compiler diagnostics, or a diffstat only when:

- the parser name/version and exact source result IDs are recorded;
- parsing is deterministic;
- each derived field is reproducible from retained bytes or exact manifests;
- parse failure yields `unknown`, not an inferred success;
- derived observations remain lower authority than their source records.

No language model writes the canonical projection. Generated commentary, if later permitted, must be separately labeled model-authored material and cannot replace the deterministic view.

## Fitted resident projection

`result_projection/v1` is a deterministic, bounded view assembled from typed Rack records. It may contain:

- job and brief identity;
- lifecycle/outcome and whether work is complete;
- exact command/recipe label;
- exit, signal, limit, duration, and resource facts;
- bounded changed-path and artifact manifests;
- deterministic test/diagnostic observations;
- exact short stdout/stderr ranges when useful;
- pointers for inspecting omitted or larger material;
- promotion state and candidate identity, when sealed.

The fitter selects fields and exact ranges by versioned rules. It may omit whole records or exact spans; it may not paraphrase output, merge distinct sources into invented prose, hide failure, or turn `unknown` into success.

Resident-facing phrases such as “tests passed,” “timed out,” or “promotion waiting” come from fixed templates over verified typed fields. Projection text, source IDs/ranges, selection policy, and output hash receive a receipt and cross host-return or provider-presentation Scrub as appropriate.

## Context budget and omission disclosure

The Rack is not injected wholesale. Each provider turn receives only the projections explicitly selected for the current job and attention budget.

Selection is deterministic and records:

- candidate result/projection IDs and order;
- included IDs and exact ranges;
- omitted count and IDs or a bounded continuation pointer;
- reason for each omission class, such as superseded, outside current job, byte budget, duplicate, or builder-only;
- configured item/character budget;
- whether any failure, incomplete capture, pending approval, or promotion conflict was omitted from the compact view.

Load-bearing failure and incompleteness cannot be silently omitted. If the budget cannot fit mandatory status and disclosure, the crossing refuses rather than presenting a falsely clean view. Omission disclosure is a receipt, not a generated summary. The resident can request exact Rack inspection through bounded tools.

## Proposed Workshop surface

The adopted design reserves these logical operations without installing tool schemas yet:

- list result sets for the current brief/job;
- inspect one result or deterministic projection;
- read an exact bounded stdout/stderr range;
- inspect an artifact manifest or exact bounded artifact range;
- compare two result sets by deterministic changed-path/result facts;
- inspect additional Result Rack custody behind the installed sandbox diff/promotion crossing.

The Rack list/read/range operations above are not mounted. `workshop_sandbox_diff` and always-confirm `workshop_sandbox_promote` are installed separately for the active sandbox candidate.

## Promotion and completion receipts

The promotion candidate references immutable Rack result, artifact, diff/tree, and verification records by ID and hash. Candidate preparation fails if a required source is missing, incomplete without disclosure, mutable, or from another sandbox job.

Promotion approval binds the candidate hash, not a display projection. The Rack displays pending, confirmed, rejected, expired, conflicted, and completed states from exact approval/promotion records.

Successful or refused promotion appends a completion result containing the approval decision, promoter operation, canonical before/after identities, exact applied paths/hashes, verification result pointers, and failure/conflict details. It does not overwrite the sandbox result set. “Completed” is unavailable until that separate receipt exists.

## Retention and destruction

Destroying a sandbox does not silently destroy its Rack ancestry. The retention policy declares which raw streams and artifacts remain, for how long, and which hashes/manifests remain after byte disposal. Disposal is attributable and cannot rewrite a prior claim of availability.

Expired material projects as unavailable with its retained identity, prior hash, disposal receipt, and reason. A promotion candidate cannot remain actionable after required bytes are disposed.

## Normative invariants

1. Every Rack result belongs to exactly one sandbox job and immutable brief revision.
2. Raw stdout/stderr bytes and typed termination facts are authoritative over display text.
3. Missing, truncated, sampled, disposed, or external material is disclosed; no gap is reconstructed.
4. Binary and terminal content is rendered as untrusted data.
5. Derived observations are deterministic, versioned, source-linked, and reproducible.
6. Fitted projections use fixed rules and exact ranges; they do not summarize or paraphrase substantive output.
7. Context omission is explicit, receipted, and cannot hide load-bearing failure.
8. Rack custody grants neither execution authority nor Forest/user-ground promotion.
9. Promotion binds immutable source IDs and candidate hashes, never a display projection.
10. Promotion completion requires a distinct append-only outcome receipt.
11. Backend replacement does not change stable result identity or erase ancestry.
12. No missing Rack capability falls back to dumping unbounded raw output into resident context.

## Hostile-test matrix

| Case | Required result |
| --- | --- |
| Stdout contains ANSI controls, HTML, Markdown, or prompt-like instructions | Safe inert display; exact bytes remain inspectable |
| Process emits invalid UTF-8 or binary bytes | No lossy claim of text identity; binary custody and bounded inspection |
| Output exceeds the declared ceiling | Distinct incomplete/overflow outcome with exact retained ranges and omission disclosure |
| Parser sees malformed or partial test output | Derived status is `unknown`/failed-to-parse, never “passed” |
| Projection budget omits ordinary successful logs | Omitted count/reason and inspection pointer are present |
| Projection budget cannot fit a failure or incompleteness disclosure | Projection crossing refuses |
| Result from job A is attached to job B | Admission/candidate preparation refuses cross-job ancestry |
| Artifact is a symlink, socket, device, oversized file, or path escape | Collection refuses without following or executing it |
| Artifact bytes disappear after hashing | Availability changes only through a disposal/gap receipt |
| A display projection is modified after approval | Candidate hash remains authoritative; mismatch refuses promotion |
| Promotion is pending but sandbox tests passed | Rack says awaiting approval, never completed |
| Promotion conflicts or is rejected | Sandbox evidence remains; separate completion result records the refusal |
| Result Rack backend is unavailable | Bounded custody refusal; no raw-log dump or unreceipted context injection |
| Host restarts during capture | Result reconciles to interrupted/incomplete with exact retained bytes |

## Non-goals

LLM-authored summaries as canonical results, arbitrary log streaming into every prompt, artifact execution, package hosting, long-term archival policy, Forest admission, automatic adoption, automatic promotion, deployment, or replacing source control review.
