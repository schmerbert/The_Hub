# Corner Step Slips v1

## Status

**Implemented.** Step slips are host-authored, deterministic progress glosses for one active wake.

## Boundary

- The conversation rail contains only user ground and final resident utterances.
- Slips are neither resident speech nor Forest material. Tool JSON, Hearth Scroll content, and reasoning content do not enter the rail.
- A slip is projected from persisted wake phases, World action receipts, and pending approvals. It is never an LLM summary.
- Provider `reasoning_content` may appear only as an expandable thinking disclosure in the gap or under that wake's collapsed Steps record.

## Projection

`GET /api/wakes/:id/slips` returns the wake identity and status plus ordered slips:

- `phase`: **Orienting** for the first Hearth phase, then **Considering…**.
- `thinking`: exact non-empty `reasoning_content`, expandable.
- `action`: deterministic tool glosses, including door movement, fixture engagement, Workshop looking, kiln start, and timer set.
- `pending`: **Cut waiting on the workbench** for a pending mutation approval.
- `outcome`: refused tool result with its short host error.

The host exposes the active wake ID in `/api/health` while the wake is in progress. Corner polls health and then this projection at a short interval, renders it in `#gap`, and moves the final projection under the completed wake as collapsed Steps.

## Verification

Tests cover idle active-wake absence, phase thinking, action glosses, refusal/pending projection, final-utterance-only rail behavior, and no provider-generated gloss.
