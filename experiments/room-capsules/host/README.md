# Generic room-capsule laboratory host

This is a bounded experimental host for the capsule slotability test. It is not Hub core and installs nothing.

Discovery is inert: the host scans an explicit root, reads bounded regular `room.json` and entrypoint files without following symlinks, validates the generic manifest, and records hashes. It does not dynamically import capsule code.

Activation is separate and requires the exact approved room identity. The host immediately rechecks manifest and entrypoint hashes before dynamic import, then validates the standard `createRoomCapsule()` interface. **In-process activation executes trusted experimental code and is not a security sandbox.** Hashes and manifest validation reduce accidental or stale activation; they do not make hostile JavaScript safe.

The lab host contains only capability and socket-binding maps. Its optional replay wire kit provides generic in-memory append-only storage and a controlled clock. Capsules remain responsible for interpreting their own declared operations; the host has no room-specific branches or packet knowledge.

Run the demonstration and focused tests from the repository root:

```powershell
node experiments/room-capsules/host/demo.mjs
node --test experiments/room-capsules/host/test/*.test.js
```
