# Workshop Control Panel v1 — Arms, Approvals, Recipes

> **Status: Implemented ancestry. Superseded for mounting, approval posture, and process lifetime by HUB-016, HUB-017, HUB-018, and HUB-025.** Retained for the original arms and approval crossing where a later specification has not replaced a claim.

## Status and scope

Adopted with [WORKSHOP_STATIONS_V1.md](WORKSHOP_STATIONS_V1.md). This is the first writable Workshop crossing. It mounts surgical execution only while the resident is engaged at `station.control_panel` inside `room.workshop`.

It adds:

- exact single-path patch apply behind user confirmation;
- named test recipes (no freeform shell);
- git status / diff (auto) and git commit (confirm);
- pending approval records inspectable from Spec Table and Corner;
- process lifetime rules when leaving the panel or room;
- custody through Scrub, Spine, action receipts, and Wild `workshop_source` for exact returned source spans only.

It does not add arbitrary shell, force-push, multi-root workspaces, Aider/Luna adapters, streaming IDE chrome, or summaries.

## Project scope

The Workshop root remains the Hub repository root (`HUB_WORKSHOP_ROOT`, default process cwd). Path refusal law from World Graph Workshop v1 still applies: no absolute paths, traversal, symlink escape, `.git`, `.runtime`, credential/env patterns.

## Spec Table work brief

While engaged at `station.spec_table`:

### `workshop_brief_upsert`

Arguments:

- `objective` (string, required, bounded length);
- `scope_paths` (array of relative paths, optional, bounded count);
- `acceptance` (array of short check strings, optional);
- `non_goals` (array of short strings, optional).

Stores a session-scoped work brief as World machinery (not Home Forest). Returns brief id, revision, and hashes of stored fields.

### `workshop_brief_get`

Returns the current session brief or an honest empty result.

### `workshop_pending_diff`

Returns pending approval previews (patch/commit) for the lifespan without applying them.

## Control Panel tools

### `workshop_apply_patch` (confirm class)

Arguments:

- `path` (relative repository path);
- `old_text` (exact contiguous UTF-8 span that must occur exactly once in the file);
- `new_text` (replacement UTF-8; may be empty for deletion of the span).

Behavior:

1. Validate path and load file under Workshop limits.
2. Refuse if `old_text` is missing, empty, or not unique.
3. Build a preview: before/after hashes, byte lengths, and unified-style excerpt of the change.
4. Create a **pending approval** (`kind: patch`); do **not** write the file yet.
5. Return `{ status: 'pending_approval', approvalId, preview }`.

On user confirm via host API, apply the replacement atomically, record action receipt, return committed result. Successful post-apply read of changed spans may enter Wild `workshop_source` when returned as exact source; the approval record itself is machinery.

### `workshop_run_recipe` (auto class)

Named recipes only:

| Recipe id | Command |
| --- | --- |
| `npm_test` | `npm test` |
| `node_test` | `node --test` with optional relative `path` argument under root |

Bounds: timeout (default 120s), cwd = Workshop root, scrubbed env (no injected secrets beyond process defaults needed for node), capture stdout/stderr with byte ceilings, non-zero exit is a committed failure result not a host crash.

No resident-supplied shell string.

### `workshop_git_status` / `workshop_git_diff` (auto)

Read-only git inspection using repository-scoped git (`git -c safe.directory=<root> ...`). Diff may take optional `path`. Output truncated by declared ceilings with disclosure.

### `workshop_git_commit` (confirm class)

Arguments:

- `message` (required, bounded);
- `paths` (optional array; default tracked changes within root subject to policy).

Creates pending approval with status/diff preview. On confirm: `git add` bounded paths then `git commit` with the exact message. No amend, no push, no `--no-verify` skip unless a later adoption says otherwise. Refuse empty commits honestly.

### `workshop_approval_status`

Arguments: optional `approval_id`. Returns one or all pending/resolved approvals for the lifespan.

## Approval classes

| Class | Tools | Default |
| --- | --- | --- |
| Auto | reads, recipes, git status/diff, brief get, approval status, engage/disengage/move | execute immediately |
| Confirm | `workshop_apply_patch`, `workshop_git_commit` | pending until Corner/API confirm or reject |
| Forbidden | force-push, secrets paths, freeform shell, path escape, symlink write | hard refuse |

### Host API

- `GET /api/approvals` — list approvals for the active lifespan.
- `POST /api/approvals/:id/decide` with `{ "decision": "confirm" | "reject" }` — user/builder authority.

Confirm applies the deferred mutation and stores outcome on the approval. Reject marks rejected with no mutation. Duplicate decide refuses.

Fake-mode tests may set `HUB_APPROVAL_MODE=auto` to auto-confirm remaining confirm-class tools inside the gateway for automated coverage. **Superseded for live posture by HUB-025 / [WORKSHOP_TOOL_CEILING_V1.md](WORKSHOP_TOOL_CEILING_V1.md):** ordinary workspace writes and local git add/commit are per-tool **auto**; only delete and branch checkout stay confirm by default.

## Process lifetime

- Disengage Control Panel or leave Workshop: any **running recipe** is killed; receipt records `cancelled_left_station` or `cancelled_left_room`.
- Pending approvals remain inspectable but cannot be confirmed after the creating lifespan ends; a new lifespan does not inherit in-flight arms.
- No silent background mutation after leave.

## Rollback

v1 rollback is git-native and user-driven: refused or rejected patches never write; committed patches rely on git history / user revert. No automatic shadow worktree in v1. A later slice may add worktree isolation.

## Custody

1. Provider tool intent retained in Spine raw return.
2. Return Scrub selects assistant tool-call message.
3. Gateway validates room, station, tool, args, limits.
4. Confirm-class tools create pending approvals before mutation.
5. Committed or refused outcomes get World action receipts.
6. Host-return Scrub before session history.
7. Exact successful read/search source spans → Wild `workshop_source` only.
8. Briefs, approvals, recipe logs, git status text: machinery unless a later policy admits them.

Current receipt semantics distinguish committing an immediate result from committing the deferred mutation. For delete and branch checkout, the initial World action receipt may use `outcome: committed` because creation of the pending-approval result succeeded; it does not claim that the requested filesystem or Git mutation already occurred. The later decision and mutation outcome live on the approval record. A distinct append-only confirmation action receipt remains future custody hardening.

## Corner

Current Corner shows the room, engaged fixture, bounded mounted groups/tools, and pending approvals with confirm/reject controls. Opening inspection UI creates no resident event. The original station wording is retained elsewhere in this document only as implementation ancestry.

## Required verification

- Patch unique-match apply after confirm; non-unique and path escape refuse.
- Patch/commit without confirm does not mutate.
- Reject leaves files unchanged.
- Recipes run only at Control Panel; wrong station refuses.
- Leave room cancels running recipe and clears engagement.
- Git commit requires confirm; status/diff do not.
- `HUB_APPROVAL_MODE=auto` works in tests only when configured.
- Home Forest remains utterance-only; Wild only exact workshop_source spans.
- Spine/Forest verification remain clean with disposable roots.

## Non-goals

Aider adapter, Luna bridge, arbitrary `run_command`, push/deploy, multi-project roots, IDE autocomplete.
