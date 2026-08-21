# Workshop Usability v2 — Legible Bounds and a Reserved Landing

> **Status: Implemented.** This specification revises the Workshop's discovery, bounded inspection, and multi-round completion behavior after a live Resident investigation reached ordinary repository-size limits and then exhausted an invisible tool-round ceiling. It preserves path safety, exact source custody, fitted capability, and bounded wakes.

## 1. Pressure and classification

Change classification: **revising and extending**.

During a live investigation of Recoverable Result Exhale, broad `workshop_search` calls refused before evaluating content because the requested scopes exceeded the 100-file traversal ceiling. The refusal did not name the bound, whether any content had been searched, or the truthful next step. The Resident inferred that `node_modules` was responsible, then spent additional rounds discovering narrower paths and compensating for a read request above the undisclosed 160-line ceiling.

The investigation reached the configured action-round limit. On the intended final response opportunity, tool schemas remained visible; the Resident requested three more actions, all were refused, and the wake failed without a concluding utterance. A later human retry recovered and finished the work.

Protected invariants:

> Workshop work remains exact, bounded, path-confined, and consequence-gated; a bound must make the next truthful move legible rather than converting ordinary repository scale into unexplained absence.

> A bounded wake reserves a real opportunity for Resident speech. The host does not fabricate completion, and it does not invite an action on a phase where action is prohibited.

## 2. Ownership

| Concern | Owner |
| --- | --- |
| Repository traversal, exact read/search projection, exclusions, and limit metadata | Workshop adapter |
| Provider tool schema and configured maxima | Ceiling/Workshop tool catalog |
| Current fixture focus and effective availability | World plus Ceiling projection |
| Tool-round accounting and reserved landing | Wake orchestration |
| Provider-visible budget disclosure | Context presentation through Glass/Scrub |
| Exact results and omitted-result recovery | Result Rack and Result Exhale |

The provider, repository contents, returned error prose, and remembered tool schemas are explicit non-owners. None may widen a path, ceiling, action budget, fixture mount, approval class, or source authority.

## 3. Bounded repository discovery

Search and path matching operate as bounded streaming projections. They do not require complete enumeration of the requested scope before examining eligible files. When a traversal budget is exhausted after lawful work, the result returns the exact matches found so far and marks the projection truncated.

Every bounded discovery result states at least:

- requested path and query or pattern;
- exact matches and hashes;
- files examined;
- configured file and result ceilings;
- whether traversal completed;
- named default exclusions and skipped counts where knowable;
- a stable boundary hint, with a continuation cursor only when one is implemented; and
- a concise truthful next action, such as narrowing the path or continuing from a cursor.

A refusal that occurs before content evaluation says so. No result implies that an unexamined region contained no match.

Repository metadata, dependency, generated, build, and cache trees may be excluded by a declared versioned default policy so ordinary source discovery does not spend its entire budget there. Security exclusions remain unconditional. A later explicit include mechanism may widen convenience exclusions under the same file, byte, and path limits; it can never widen `.git`, `.runtime`, credential, environment, symlink, or root confinement law.

## 4. Exact read continuation

The mounted `workshop_read` schema advertises its effective maximum line count. Every successful read returns the exact inclusive range, total source line count, whether more remains, and the next lawful start line when applicable.

An oversized requested range refuses with the configured maximum and a valid replacement request. A range beyond the source refuses distinctly from a range that is merely too large. The host does not silently clamp an explicitly invalid request, normalize line endings, or summarize omitted source.

## 5. Repository overview

The Workshop tool catalog carries one small read-only overview that reduces blind discovery rounds without adding a new installed room wire. It may identify only mechanically witnessed facts such as:

- repository-relative root and top-level entries;
- declared orientation or agent-instruction files;
- package/build manifests and detected source families;
- applicable traversal exclusions and configured ceilings; and
- current effective fixture/profile coordinates supplied by their owners.

The overview does not summarize repository meaning, choose an implementation authority, read forbidden metadata, inspect credentials, execute discovery code, or replace exact source reads. It is a labeled entrance, not an architectural oracle.

## 6. Capability legibility

A catalog distinguishes:

1. installed Workshop capabilities;
2. capabilities fitted to the current room;
3. capabilities fitted to the engaged fixture/profile; and
4. actions immediately callable on the next provider phase.

Unavailable actions carry a bounded reason and the lawful action that could make them available. Listing a known tool must not imply that it is currently mounted.

## 7. Round budget and reserved landing

`HUB_MAX_TOOL_ROUNDS=N` continues to bound committed action rounds within one human wake. Before each action-capable continuation, the Resident receives a bounded host-owned disclosure of used and remaining action rounds. This is kindness and planning ground, not an authority grant or conversational memory.

After the final permitted action round, wake orchestration makes one provider call with no action schemas. That call is the reserved landing for a Resident utterance. It remains fully witnessed through Glass, Scrub, and Spine. The provider may speak from exact results already in the active causal chain but cannot request another action because no action capability is fitted.

If a provider nevertheless returns a tool call without a presented schema, the host refuses it as an unmounted action and fails honestly. The host never invents a concluding Resident message. Transport failure, empty content, or attention refusal on the reserved landing remains an exact wake failure.

The round budget counts provider action rounds, not the number of parallel calls inside one round. Per-round fan-out remains bounded by the ordinary schema, Gateway, result, and attention laws and may receive a separate explicit ceiling if pressure requires it.

## 8. Result Exhale interaction

A long Workshop wake may omit older completed exchanges through Recoverable Result Exhale. The complete verified trail-sign set is presented once for the causal human wake. Tool continuations must not repeatedly re-expose the identical set merely because another provider phase occurred.

A later continuation may carry no trail-sign packet when the active chain already contains it, or one deterministic source-free continuation marker if needed to preserve deliberate reopening affordance. It may not reproduce result bodies, generate a summary, create Forest eligibility, or hide that exact earlier evidence remains omitted.

Every actual provider-visible exposure remains rooted. Deduplication means fewer exposures occurred; it does not rewrite or coalesce Roots history after presentation.

## 9. Verification

Verification covers:

- a scope larger than the file ceiling returning exact bounded partial search results rather than false absence;
- default dependency/build/cache exclusion and unconditional security exclusion;
- exact files-examined, truncation, boundary, and next-action metadata;
- no match claim for unexamined content;
- schema-visible read maxima and exact read continuation coordinates;
- overview confinement to mechanically witnessed, non-secret facts;
- installed versus presently callable catalog distinctions;
- budget disclosure as action rounds advance;
- removal of action schemas on the reserved landing;
- refusal of a tool call emitted without a mounted schema;
- no fabricated final Resident speech;
- one full trail-sign presentation per causal wake across multiple tool continuations;
- continued deliberate `reopen_result` availability and exactness; and
- complete existing Workshop, World, Glass, Result Rack, Exhale, and runtime regression coverage.

## 10. Deferred

Semantic repository indexing, embeddings, generated repository summaries, learned path ranking, unrestricted dependency search, arbitrary ignore overrides, shell access, adaptive autonomous round extension, multi-root workspaces, and cross-wake autonomous continuation remain deferred.
