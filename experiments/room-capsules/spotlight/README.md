# Spotlight room capsule — void experiment

This folder is an isolated experiment, not a standing Hub room. It is **experimental**, **inert**, not auto-installed, and does not import or register with Hub core. It uses Node built-ins only, makes no network requests, invokes no model, performs no financial action, and writes no files.

Its standard entrypoint exports `createRoomCapsule()` for the generic capsule laboratory. Discovery reads and hashes the manifest and entrypoint without importing either module. Only explicit laboratory activation executes the trusted experimental module; this in-process activation is not a security sandbox.

Its purpose is to test one proposition from the House Grammar: a room can arrive as a truthful clinical shell, declare the sockets it would accept, and remain useful in a fake void host without acquiring authority merely by existing.

## Clinical contract

- `room.spotlight` is stable identity; location and installation are not encoded in it.
- Architectural lifecycle, fit-out state, and Resident expression are independent axes.
- Bare mode is always inspectable. Every fixture slot is empty and every unsupplied socket is visibly capped.
- The capsule declares sockets. Only a host supplies capabilities. Discovery never installs, migrates, wires, or authorizes anything.
- Expression JSON may repaint labels, descriptions, and layout for declared IDs. It cannot define capabilities, authority, tools, channels, sockets, wires, crossings, or new fixtures.
- `replay_only` requires fake append-only storage and a replay clock, and the host must explicitly bind both supplied wires to the declared sockets. Supplied-but-unbound wires remain unusable.
- `live_observation` remains dormant unless a host supplies the optional `channel.market_delivery` capability.
- An absent Resident outbox is reported as dormant. No delivery is pretended.
- No financial-execution socket exists. Packets explicitly carry observational-only authority.

## Fixture slots

The bare shell declares slots for a Present Window, Past Archive, Packet Table, Replay Table, Bell, and Helm. These names are the optional proposed observatory expression, not evidence that any fixture is wired.

The clinical expression is mandatory and always available. `expression/observatory.json` is only a replaceable Resident-facing proposal.

## First marble

The recorded fixture contains four normalized observations. Replay advances in order without exposing future rows to the detector. One deterministic inactive-to-active price-and-volume boundary creates one canonical, deeply immutable packet. The packet retains source references, missing-data disclosure, counterevidence, a next observation, two recorded analogues, one honest `insufficient_history` slot, and a stable SHA-256 identity.

The fake host retains observations and the packet in memory. It has no external effects.

## Run

```powershell
node experiments/room-capsules/spotlight/demo.mjs
node --test experiments/room-capsules/spotlight/test/*.test.js
```
