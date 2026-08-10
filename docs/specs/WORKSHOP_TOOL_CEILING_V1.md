# Workshop Tool Ceiling v1 — Need-First Function Catalog

> **Status: Implemented.** Current for the installed Workshop catalog and approval classes; Fixtures and Heartbeat own interior engagement and house-bound process lifetime.

## Status and scope

Adopted for the Workshop harness. This specification defines the complete Phase A function catalog by coding need. Interior fittings are defined in [WORKSHOP_FIXTURES_V1.md](WORKSHOP_FIXTURES_V1.md); they do not gate tools.

It supersedes station→tool mounting from [WORKSHOP_STATIONS_V1.md](WORKSHOP_STATIONS_V1.md) for capability resolution. Current fixture engagement remains World state but does not change the tool list; retired station nodes remain ancestry only.

## Mount law

```text
room.workshop → entire workshop_* catalog + move_through_door + inspect_fixture + engage_fixture + disengage_fixture
room.center → move_through_door only
```

The [Ceiling Patch Bay v1](CEILING_PATCH_BAY_V1.md) now owns this equation: Workshop is the fat profile and Center is the move-only profile. The Ceiling remains the complete catalog even while Center mounts only its profile.

Leave Workshop: clear engagement if any; drop all workshop tools. **In-flight kiln is house-bound and is not cancelled by leave** ([WORKSHOP_HEARTBEAT_V1.md](WORKSHOP_HEARTBEAT_V1.md)); explicit `workshop_recipe_cancel` still smothers it. Stale remembered calls refuse at the gateway. Interior fittings: [WORKSHOP_FIXTURES_V1.md](WORKSHOP_FIXTURES_V1.md).

## Catalog

Approval classes: **auto** (run immediately), **confirm** (pending approval until Corner/API decide), **refuse** (not installed).

**Trust parity (HUB-025):** ordinary workspace writes and local git add/commit are **auto**, matching the trust you'd give the same model behind OpenClaw or Hermes. Hard boundaries stay: Workshop root path law, Scrub, recipe allowlist, no freeform shell, no push/amend/force. Only delete and branch checkout remain **confirm** among installed mutate/VCS tools.

### Explore

| Tool | Class |
| --- | --- |
| `workshop_list` | auto |
| `workshop_read` | auto |
| `workshop_search` | auto |
| `workshop_search_regex` | auto |
| `workshop_glob` | auto |
| `workshop_tree` | auto |
| `workshop_stat` | auto |
| `workshop_file_hash` | auto |

### Mutate

| Tool | Class |
| --- | --- |
| `workshop_apply_patch` | auto |
| `workshop_apply_unified_diff` | auto |
| `workshop_write_file` | auto |
| `workshop_create_path` | auto |
| `workshop_rename_path` | auto |
| `workshop_delete_path` | confirm |

### Verify

| Tool | Class |
| --- | --- |
| `workshop_recipe_list` | auto |
| `workshop_run_recipe` | auto |
| `workshop_recipe_status` | auto |
| `workshop_recipe_cancel` | auto |
| `workshop_timer_set` | auto |
| `workshop_timer_status` | auto |
| `workshop_timer_cancel` | auto |

Recipes: `npm_test`, `node_test`, `npm_run` (script must exist in package.json `scripts`), `node_file` (relative `.js`). No freeform shell string.

### VCS

| Tool | Class |
| --- | --- |
| `workshop_git_status` | auto |
| `workshop_git_diff` | auto |
| `workshop_git_log` | auto |
| `workshop_git_show` | auto |
| `workshop_git_branch_list` | auto |
| `workshop_git_add` | auto |
| `workshop_git_commit` | auto |
| `workshop_git_checkout` | confirm |

Hard refuse (not installed): push, pull, fetch, force-push, amend, reset --hard, clean -fd, rebase, merge.

### Work framing

| Tool | Class |
| --- | --- |
| `workshop_brief_upsert` | auto |
| `workshop_brief_get` | auto |
| `workshop_pending_diff` | auto |
| `workshop_approval_status` | auto |
| `workshop_approval_list` | auto |

### Catalog meta

| Tool | Class |
| --- | --- |
| `workshop_tool_catalog` | auto |

Returns mounted tool names, one-line descriptions, and approval classes.

## Path and custody law

Unchanged from World Graph Workshop v1: relative paths under Workshop root; refuse traversal, symlinks, `.git`, `.runtime`, credential/env patterns. Successful exact read/search source spans may enter Wild `workshop_source`. Auto-class mutate/VCS tools create an approval record then apply immediately. Confirm-class tools (`workshop_delete_path`, `workshop_git_checkout`) create pending approvals before mutation. Every host return crosses `scrubHostReturn`. Builder decide remains `POST /api/approvals/:id/decide`. `HUB_APPROVAL_MODE=auto` is a fake-mode test override that also auto-confirms remaining confirm-class tools; live mode refuses that override and keeps them pending.

Named recipes run with a credential-scrubbed child environment. They are an allowlisted execution interface for trusted workspace code, not an operating-system sandbox or a safe way to execute an untrusted repository.

## Non-goals

Fixture tool partitions; freeform shell; multi-root; browser/web; companion bridges; prompt expansion.

## Verification

- Center exposes only `move_through_door`.
- Workshop exposes the full catalog without requiring station engagement.
- Each new tool has positive and hostile tests.
- Confirm-class tools do not mutate until confirmed.
- Leave room drops Workshop tools and clears fixture engagement; a running kiln and lifespan timer continue house-bound.
