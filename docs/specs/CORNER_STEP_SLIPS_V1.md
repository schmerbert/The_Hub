# Corner Step Slips v1

## Status

**Implemented.** Step slips are host-authored, deterministic progress glosses for one active wake.

## Boundary

- The canonical conversation rail contains only user ground and final resident utterances. Exact speech emitted while continuing through tools may remain visually inline as an `en route` step, but is not promoted to a canonical utterance or Forest atom.
- Slips are neither resident speech nor Forest material. Tool JSON, Hearth Scroll content, and reasoning content do not enter the rail.
- A slip is projected from persisted wake phases, World action receipts, and pending approvals. It is never an LLM summary.
- Provider `reasoning_content` may appear only as an expandable thinking disclosure in the wake's ordered step timeline.

## Projection

`GET /api/wakes/:id/slips` returns the wake identity and status plus ordered slips:

- `phase`: **Orienting** for the first Hearth phase, then **Considering…**.
- `thinking`: exact non-empty `reasoning_content`, expandable.
- `speech`: exact non-empty provider content from a phase that continues through tool calls, labelled **Resident · en route**.
- `action`: deterministic tool glosses, including door movement, fixture engagement, Workshop looking, kiln start, and timer set.
- `pending`: **Cut waiting on the workbench** for a pending mutation approval.
- `outcome`: refused tool result with its short host error.

The host exposes the active wake ID in `/api/health` while the wake is in progress. Corner polls health and then this projection at a short interval. During a wake, phases, thinking bursts, en-route speech, tool preparation, and action cards remain in chronological order. Each speech segment is created at its first streamed content delta, sealed from `provider.message.ready`, and survives later provider phases. Once complete, the same ordered slips remain inline between the user's ground and the resident's final utterance. Thinking disclosures retain their open state across live rerenders.

## Verification

Tests cover idle active-wake absence, phase thinking, action glosses, refusal/pending projection, final-utterance-only rail behavior, and no provider-generated gloss.
