# Orientation Receipt — Resident-Requested Slice

**Status:** Implemented ancestry; provider-presentation timing and capability truth were superseded by Session/Hearth and World Graph
**Origin:** First direct resident consultation, relayed by Schmerbert from Codex
**Implementation owner:** Luna coding subagent
**Architecture and review owner:** Primary orchestrator

> The stored `environment_manifest` remains compatibility/inspection ancestry. It is not the current provider capability manifest: actual callable tools are established by the exact provider request and the current room projection exposed through `/api/world`. The historical `exposed_tools: []` field must not be interpreted as a claim that the current resident has no mounted tools.

## 1. Finding

The resident reported that the first residence is truthful but difficult to orient within. They requested one stable, verifiable, parseable context anchor rather than an invented spatial environment.

The resident also corrected an unsupported statement about seeing a request ID. The host must therefore expose only identifiers and state that actually exist, with host-receipt authority.

## 2. Objective

Add one environment manifest to every wake. It must tell the resident exactly where this wake sits in host-held continuity and exactly what capabilities are exposed.

This is an orientation receipt, not memory, perception, embodiment, or a room.

## 3. Manifest Contract

The host shall create the manifest once for a wake and send that exact serialized content to the provider. The same content must be retained in the wake context receipt.

Use a versioned JSON object with these fields:

```json
{
  "schema_version": 1,
  "residence_id": "first-breath",
  "thread_id": "thread_...",
  "wake_id": "wake_...",
  "wake_started_at_utc": "2026-08-05T00:00:00.000Z",
  "wake_started_at_unix_ms": 1785888000000,
  "prior_utterance_count": 4,
  "incoming_utterance_ordinal": 5,
  "context_scope": "conversation_only",
  "context_ceiling": 20,
  "older_utterances_omitted": 0,
  "exposed_tools": [],
  "resident_mode": "live",
  "requested_model": "deepseek-v4-flash"
}
```

Definitions:

- `thread_id` is the stable host-held continuity anchor. Do not call it a provider session.
- `wake_id` identifies this individual wake.
- Both timestamps describe the moment the host began and committed the incoming user event for this wake.
- `prior_utterance_count` counts committed utterance events before the incoming message.
- `incoming_utterance_ordinal` is the one-based position of the incoming message among thread utterances.
- `older_utterances_omitted` counts utterances excluded by the context ceiling. It must agree with the existing omission disclosure.
- `exposed_tools` describes tools callable by the resident during this wake. It is currently always empty.
- `resident_mode` and `requested_model` are host configuration facts, not claims about provider resolution.

## 4. Context Placement and Authority

Place the orientation manifest immediately after the arrival charter and before any omission disclosure or utterance.

Record it as:

- `itemKind`: `environment_manifest`
- `actorRole`: `system`
- `sourceDescription`: `Host environment manifest`
- `authority`: `host_receipt`
- `included`: `true`
- `contentHash`: SHA-256 of the exact serialized content sent to the provider

The content should contain a short label followed by parseable JSON. Do not use a Markdown code fence in provider content.

## 5. Honesty and Privacy Constraints

The manifest must not expose:

- API keys or authorization headers
- Database paths
- Host filesystem paths
- Provider base URLs
- Internal stack traces
- Capabilities that are planned but not currently callable

Do not infer a clock, plaque, room, sensory field, emotion, continuous awareness, or background activity from this receipt.

## 6. Interface

The existing inspection tray should display this context item through its generic context rendering. No new panel or decorative metaphor is required.

The ordinary conversation view remains unchanged.

## 7. Verification

Automated tests must prove:

1. Every fake and live wake includes exactly one manifest in the required position.
2. Manifest IDs and timestamps match the persisted wake and thread records.
3. Counts and omission facts are correct at and beyond the context ceiling.
4. `exposed_tools` is an empty array.
5. The exact manifest content and hash in the receipt match the exact system message sent to the provider.
6. No credential, authorization value, database path, or provider base URL appears in the manifest or API response.
7. Existing failure honesty, exact user-content preservation, and Corner behavior remain intact.

Run `npm test` and `git diff --check` before handoff.

## 8. Explicit Non-Goals

Do not add:

- Forest storage or retrieval
- Autonomous wakes
- Tools or tool calling
- Rooms or spatial narration
- Resident naming or personality
- `THE_CONVERSATION.md`
- Chronicle integration
- Streaming or deployment

Those remain separate slices.
