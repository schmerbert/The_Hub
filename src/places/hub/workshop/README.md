# Workshop room package

This is the canonical source package for `room.workshop`. It owns the Workshop declaration, repository adapter, Git, recipes, Sandbox Bay, promotion, and path law behind one room-owned import surface: `index.js`.

The historical `src/world/{workshop,git,recipes,sandbox,sandbox-recipes,promotion}.js`, `src/workshop/path-law.js`, and `src/places/hub/workshop.js` paths are thin compatibility doors only. New composition and room-owned code must import this package or its local modules. They must not acquire new behavior.

Universal World event append/replay, Gateway authorization, Scrub, Result Rack, and provider presentation do not belong to this package.

This is source-coherent packaging, not yet a dynamic installer. Another Marble can copy the room as one unit and adapt its declared host crossings, but the Hub does not yet discover arbitrary room directories, verify a room manifest, or install Ceiling/Gateway/World wiring automatically. Those crossings must remain explicit rather than being hidden behind a claim of plug-and-play support.

`room.json` is the first standing `room-installation.v1` request. It inventories Workshop's requested placement, host-supplied sockets, offered affordances, effects, custody routes, and removal law. Tests require its tool inventory to equal the statically installed Ceiling, mount profile, and Gateway handlers; the manifest itself grants none of them.

The host-owned `src/rooms/workshop-witness.js` answers this request with a deterministic installation witness. Builder inspection exposes its exact manifest and witness hashes, fitted surfaces, optional wiring, and named gaps. The witness verifies current static composition; it is not yet a durable installation receipt.
