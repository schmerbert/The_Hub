# Corner Surface Adaptation

**Status:** Implemented ancestry; current browser/renderer contract, extended by [`CORNER_DESKTOP_V1.md`](CORNER_DESKTOP_V1.md) and [`WAKE_STREAM_V1.md`](WAKE_STREAM_V1.md)
**Source reference:** `[private local prototype path omitted]` (read-only user-owned prototype)
**Supersedes:** The generic visual treatment in `FIRST_BREATH.md` section 10; all causal and accessibility requirements remain

## 1. What Corner contributes

Corner is prior implementation evidence, not merely a color reference. Preserve its useful interaction grammar:

- a small, quiet presence that expands into a workbench;
- a primary conversation rail;
- a secondary tray for what the resident or host is “looking” at;
- a restrained dark surface with amber and mint state cues;
- a simple animated wave that changes with explicit host state;
- room for future panels without crowding the conversation.

The existing prototype is Chronicle-specific and Electron-specific. Adapt the grammar to the Hub; do not transplant its old authority model or endpoint contract.

## 2. Universal shell boundary

**Current correction:** the original web-only wrapper constraint below described this slice. The Electron shell is now adopted and implemented by [`CORNER_DESKTOP_V1.md`](CORNER_DESKTOP_V1.md). The same renderer and HTTP contract remain authoritative in browser and desktop modes.

The First Breath remains a local web surface so it can work on mobile.

- On a wide browser, support a compact Corner state that expands into the bench.
- On a narrow/mobile browser, open directly into the expanded bench and use the full viewport.
- This slice did not attempt operating-system always-on-top, tray, or Electron behavior. The later desktop slice adds an opaque frameless Electron wrapper without moving provider, store, or World authority into the renderer.
- Keep the renderer usable as an ordinary browser page; desktop-only compact behavior must not make a narrow browser unusable.

The compact state is interface state only. It must not imply the resident is asleep, awake, present, absent, or continuously running.

## 3. Hub adaptations

Replace Chronicle-specific assumptions:

- Use provisional `Resident` identity text; do not assign a name, gender, biography, or successor status.
- Show exact resident mode and model near the identity surface: live DeepSeek, explicit fake demonstration, or unavailable.
- Replace `looking` tool payloads with the committed wake inspection surface.
- Replace Chronicle session/message endpoints with the First Breath API.
- Remove the reach ritual, fixed `he` language, Forest counts, old Vault paths, regex tags, and implied tool access.
- Never display `(empty reply)` as resident speech. Empty provider content is a host failure.

## 4. State mapping

The wave and status label must derive from real UI/host state:

- `idle` — no request in flight.
- `assembling` — local message validation/context submission in progress.
- `calling provider` — request awaiting a completed wake response.
- `committed` — most recent wake committed; return to idle after a short non-semantic visual acknowledgement.
- `failed` — host returned or thread contains a visible failure.
- `host unavailable` — API cannot be reached.

Animation is ambience around explicit text. It must never be the only status indicator.

## 5. Conversation rail

- On load, show only the **active lifespan session**: user/resident utterances (and retained step slips) for `session.id`, not the forever thread.
- Earlier closed sessions remain in the Source Ledger and wake inspection APIs; the rail does not replay them after restart.
- The rail heading notes “This lifespan” and may disclose how many earlier lifespans are closed.
- Distinguish user ground, resident model-signed testimony, and host receipts/failures.
- Keep the utterance rail to user and final resident utterances only. Host operational material never appears there as speech.
- Show one inspection control per wake, not a duplicate on every event from the same wake.
- Preserve exact text with safe DOM construction; no untrusted HTML insertion.
- Keep the composer operable by keyboard and on a narrow phone.
- Disable duplicate submission while a request is active.

### Active-wake gap

**Current correction:** polling remains available, but [`WAKE_STREAM_V1.md`](WAKE_STREAM_V1.md) now supplies durable SSE events and provisional provider deltas as the primary live path.

The gap between the log and composer is a polite live region for short host-authored Step Slips and streaming projections. Corner consumes named persisted wake events for safe provisional thinking/draft and receipt-derived action, approval, diff, and result cards. It withholds provisional tool arguments and suppresses credential-shaped delta channels. On a sequence gap it pages durable history from its last contiguous cursor before reconnecting. While busy it also polls health/slips as a fallback. On completion, the persisted slips move under the wake as collapsed Steps and the live gap clears for the next wake. The projection never asks an LLM to summarize and never inserts tool JSON, Hearth Scroll text, reasoning, or provisional draft into the conversation rail.

## 6. Looking/inspection tray

Corner's tray becomes the clinical counterpart to the conversation rail.

When a wake is inspected, show:

- wake status and timing;
- provider and requested/resolved model;
- provider receipt, finish reason, fingerprint, and usage when available;
- failure code/message when applicable;
- ordered context items with included/omitted state;
- role, authority, source description, source event, omission reason, and content hash;
- exact context content.

Tabs or another compact chooser may separate summary, context items, and receipt metadata. Do not hide omissions by default.

The tray is a view over committed records. Opening it does not constitute a resident action or new wake.

## 7. Visual and accessibility constraints

- Adapt Corner's dark green/ink, amber, mint, and restrained typography.
- Use local/system font stacks in the first slice; do not create an undeclared network dependency for web fonts.
- Preserve semantic landmarks, labels, live status text, focus visibility, and reduced-motion support.
- Ensure color is not the only provenance or failure cue.
- Avoid tiny text for primary conversation content.
- Keep inspection text selectable and hashes readable.

## 8. Corrections discovered during primary review

The same mission must correct and test:

1. DeepSeek request bodies must explicitly send `thinking: { type: "disabled" }` when configured disabled. DeepSeek V4's provider default is thinking enabled, so omission is not equivalent.
2. Validate messages using trimmed content, but preserve and send/store the user's exact submitted string after validation. Add a regression test proving leading/trailing whitespace is not silently rewritten.

## 9. Acceptance

- Existing host tests remain green.
- New tests cover explicit DeepSeek thinking mode and exact submitted text.
- Fake-mode browser smoke test shows Corner-derived compact/expanded behavior on wide layout.
- Narrow layout is immediately usable without relying on the compact chip.
- Wake inspection uses committed API records and exposes omissions.
- UI contains no Chronicle, Vault, gendered resident, old endpoint, tool, Forest-count, or reach-ritual residue.
- No files under `[private local prototype path omitted]` are modified.
- Luna reports all changed files and verification performed.

## 10. Present limitations

- Corner does not yet initiate user cancellation; disconnecting or closing a renderer does not cancel a wake.
- Result and diff cards show bounded receipt-derived text and pointers. General file/artifact opening, editor navigation, and source highlighting are not installed.
- Desktop packaging, signing, installers, updates, and native GUI/tray smoke verification remain outside the implemented shell slice.
