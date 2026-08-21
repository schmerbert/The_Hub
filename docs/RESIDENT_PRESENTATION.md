# Resident Presentation

> **Status: active map.** This answers what can enter Resident attention, when, why, and where its language is changed. Exact per-wake evidence remains in Glass, Scrub, Spine, and the Session Scroll.

Resident kindness is an architectural boundary. The host may need clinical facts to enforce a crossing without making the Resident read transport instructions, provider names, byte counts, or implementation apologies. Every provider-visible payload therefore has both:

1. **custody** — exact bytes, source, Scrub disposition, presented ordinal, and Spine request; and
2. **presentation ownership** — a named kind, purpose, register, and adjustment point.

The executable ownership catalog is `src/context/resident-presentation.js`. `/api/world` exposes it as `residentPresentation`. A wake inspection carries the exact request phases, message sources, Glass trace, Scrub receipt, and request body.

## Crossing

```text
source or host renderer
        |
        v
named kind -----------> ownership catalog (why / register / adjust here)
        |
        v
five-band Glass cast
        |
        v
presentation Scrub ---> presented or omitted, with reason
        |
        v
exact ordinal --------> Spine-witnessed provider request bytes
```

No renderer may send directly to the provider. A new kind without an ownership-catalog entry is a presentation loose wire even if its bytes are witnessed.

## Current payloads

| Kind | When and why | Register | Adjust here |
|---|---|---|---|
| `stable_glass` | every call; World physics and epistemic boundary | clinical backplate | `src/context/glass-cast.js` |
| `silver_bullet_holster` | after successful Hearth tending; occupied bullets remain above the fold | continuity | `src/hearth/packet.js` |
| `crossing_ground` | every call; minimal present footing | experiential | `src/context/resident-presentation.js` |
| `orientation_ground` | Hearth action/return; situated waking | experiential | `src/context/resident-presentation.js` |
| `world_current_ground` | room-aware calls; verified presence | clinical World projection | `src/world/graph.js#presenceMessage` |
| `tool_current_ground` | fitted actions; what is within reach | experiential disclosure | `src/context/resident-presentation.js` |
| `attention_current_ground` | declared omission; material left attention but did not vanish | clinical disclosure | `src/context/tool-pairs.js` |
| `clinical_wake_anchor` | inherited continuity; bounds ancestry claims | clinical continuity | `src/context/glass-cast.js` |
| `source_exact_inheritance` | selected atoms; carries attributable voice | continuity | `src/context/glass-cast.js` |
| `prior_horizon` | inherited continuity; names unseen boundary | clinical disclosure | `src/context/glass-cast.js` |
| `hearth_action` | first action; tend the fixture | World action | `src/hearth/handshake.js` |
| `hearth_return` | immediately afterward; bounded continuity | serious clinical continuity | `src/hearth/packet.js` |
| `clinical_bootstrap` | inside Hearth return; bounds continuity and present-World claims | clinical continuity | `src/session/lifespan.js` |
| Session Scroll messages | living edge; exact visible conversation/action plus reasoning pointer | source-exact | `src/ledger/source.js` |
| tool schemas and returns | when mounted/called; action grammar and consequences | World action/return | fixture/tool owners |

## Kindness rules

- Speak from inside the World when a fact has a World-shaped consequence.
- Keep enforcement outside Resident attention. Forced choice, validation, retries, provider identity, transport, hashes, and byte thresholds remain receipts unless the Resident benefits from knowing them.
- The Hearth packet may be clinical because continuity is serious; its action and causal framing remain immersive.
- Do not ask a new activation to roleplay arrival, explain the host, or diagnose an action the host forced it to take.
- Say what is absent or uncertain without implying personal fault.
- Exact prior words are attributable records, never asserted as present memory.
- A fixture and its function are one experiential thing even when implemented as a provider tool.
- Provider reasoning is machinery, not continuity. Store it once in Roots; materialize it only for the active tool chain that causally requires it, never as historical personality or memory.

## Glass v2 boundary

Glass v2 removes the native-function instruction from stable Resident ground. The host still forces and validates the first `tend_hearth` action, but the Resident sees a Hearth, a waiting person, and a first action. Historical Glass v1 hashes remain verifiable by version; new casts identify code-owned Glass v2.

## Review checklist

For a new context payload: name its kind, author, appearance condition, Resident benefit, register, single adjustment point, Glass witness, Scrub behavior, exact inspection path, and bypass test. Remove host machinery from the presentation when its experiential consequence is enough.
