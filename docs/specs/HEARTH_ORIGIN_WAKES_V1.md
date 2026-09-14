# Hearth-origin wakes v1 — An ordinary knock and a fresh life

> **Status: Implemented opt-in first slice, 2026-09-13.** Ordinary scheduled waking is installed but disabled by default. It creates a fresh lifespan at the Hearth and never impersonates a bench return, human message, or live outside signal.

## Contract

- Classification: extending wake orchestration.
- Owner: `HearthWakeController` owns the process clock; Source owns lifespan, trigger, and origin custody; Wake Service remains the sole provider crossing.
- Protected invariant: a context boundary begins a new Resident life while preserving attributable ancestry, without manufacturing continuous memory or a human summons.
- Gate: `HUB_HEARTH_WAKE_INTERVAL_SECONDS`; `0` means off, and enabled values are 60 seconds through seven days.
- Source authority: the local host clock only. The tick carries no external content and grants no source credibility.
- Persistent witness: a host state event and append-only `hearth_wake_receipts` row bind scheduled time, due time, actual wake time, interval, and lateness to the wake.

When the clock becomes due, it waits for conversation/Forest readiness, any active wake, and any pending bench promise. A bench promise takes precedence because ending that lifespan would falsify its same-life return. The ordinary wake then closes the prior lifespan, opens a fresh one at `place.house`, performs the existing two-breath `tend_hearth` ritual, and receives bounded prior-session continuity through the ordinary Hearth packet.

After tending, the wake has the same reduced reversible/read-only authority as a bench wake and the same 24-round default horizon. It may walk, inspect, read, change direction, report briefly, or do nothing consequential. It may choose `rest_for`. Mutation, Journal planting, live Spotlight observation, financial action, publishing, installation, and authority changes remain absent.

No Internet feed, bell subscription, inferred task, or fabricated urgency is installed. If nothing in inherited continuity or present World ground supplies a genuine pull, quiet or rest is a valid completion.

The repeating schedule is process-local policy: restart establishes a new next-due time and does not claim that a missed offline tick occurred. Completed wakes remain durably witnessed. `POST /api/hearth-wakes/run` is an operator-only local proving crossing; it accepts `{}` and obeys the same fresh-life and reduced-authority law without enabling recurrence.

## Verification

Tests prove fresh lifespan/Hearth orientation, no user utterance, ordinary wake-origin custody, reduced dual-gated authority, no live Spotlight or Journal hand, and bench precedence. Startup leaves the clock off unless explicitly configured.
