# Trace Epoch v1

> **Status: Adopted and implemented for the Session Scroll boundary.** This specification establishes the Marble's first forward-only trace epoch. It does not fabricate ancestry for earlier material and does not claim closure for pipes still named as loose wires in the circulation map.

## Purpose

The Marble needs an internal calendar for provenance. Exact inherited history may be older than its present tracing machinery. Rewriting that history would destroy the very ancestry the machinery is intended to protect.

`scroll_trace_boundary/v1` therefore divides two honest eras:

- **pre-closure history** is preserved exactly; its trace may be partial;
- **closure-era history** must satisfy the Two-Ended Closure Law at the moment it is written.

A missing pointer before the boundary is a known historical limit. A missing pointer after the boundary is a custody fault.

## Two-Ended Closure Law

Every material path must be traceable forward from its authoritative source and backward from its experienced or retained destination. Those traces meet at the same witnessed crossing.

For each new Session Scroll row, the retained manifest names:

1. the authoritative source;
2. the gate that admitted it;
3. the durable witness of that crossing;
4. the exact Scroll destination; and
5. its terminal disposition.

The row and manifest are inserted in the same database transaction. Neither may succeed alone.

## Boundary record

The singleton append-only epoch record retains:

- the exact last pre-boundary Scroll coordinate when one exists;
- pre-boundary Scroll, provider-request, and Source-event counts;
- a canonical hash of that head declaration;
- the canonical law text and its hash; and
- the time at which the promise became active.

No pre-boundary row receives an invented manifest. Establishment is idempotent. Fresh Source stores establish an empty-history boundary; an existing store crosses only through the explicit `npm run trace:establish` operation.

## Installed Scroll traces

| Row kind | Source | Gate / witness | Disposition |
| --- | --- | --- | --- |
| Human utterance | Source event | HTTP wake validation plus Source append | Retained in Session Scroll |
| Resident speech or tool intent | Spine return record | Provider-return Scrub receipt; `reasoning_root_pointer/v1` when reasoning is present | Visible message/action retained in Session Scroll; exact reasoning retained once in Roots and named by pointer |
| Host tool result | Exact host result | Host-return Scrub receipt | Retained in Session Scroll |

The append-only epoch and manifest tables reject update and deletion. Future versions should add stronger verification rather than silently weakening a manifest.

## Scope boundary

This first epoch closes new Session Scroll rows. Glass ground construction and Patch Bay mounts are now closed by the separate [`GLASS_TRACE_EPOCH_V1.md`](GLASS_TRACE_EPOCH_V1.md) boundary. Forest Exhale, provisional stream batch manifests, and some specialized authority stores remain visible in the circulation map. The same law must govern each future crossing when it is installed.
