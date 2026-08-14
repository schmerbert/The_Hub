# Room Installation Contract v1

> **Status: Adopted and partially installed.** The manifest contract, Workshop reference manifest, deterministic host-owned Workshop installation witness, and forward-only installation-receipt boundary are implemented and verified. Generic discovery, signature/provenance verification, installation transactions, dynamic Ceiling/Gateway composition, lifecycle persistence, removal tooling, and any marketplace are not implemented.

## Purpose

A room should be carryable as one source package without becoming self-authorizing code. Its manifest describes what it is, where it asks to fit, what sockets it requires, what affordances it offers, what effects those affordances may have, and which custody routes must close them. The receiving Marble alone decides whether to admit the package, build a door, supply wires, mount tools, install handlers, and make the room standing.

This permits people to make rooms and places for their own Marbles while preserving the distinction between distribution and authority.

## The crossing

```text
author / market / local folder
              |
              v
      inert room package
      source + room.json
              |
      bounded host inspection
              |
      identity / provenance / policy review
              |
         explicit admission
              |
   host-owned installation transaction
      | topology + door
      | sockets and bindings
      | Ceiling entries
      | Gateway handlers
      | Scrub and custody routes
              |
       installed room receipt
              |
         standing / disabled
```

The market, package, manifest, and entrypoint cannot skip a stage. Download is not discovery; discovery is not validation; validation is not admission; admission is not wiring; wiring is not standing authority.

## Manifest law

An installation manifest uses `apiVersion: room-installation.v1` and declares:

- a stable `room.*` identity and package version;
- standing or experimental classification and `autoInstall: false`;
- a safe package-relative entrypoint and inert declaration export;
- a requested `place.*` parent while affirming that the host owns the door;
- named sockets whose capabilities are supplied by the host;
- affordance groups bound to declared fixtures, including their effect class, required sockets, host-owned approval policy, and offered tool names;
- host-installed custody routes;
- explicit refusal of self-installation, self-authorization, and ambient authority; and
- host-decided removal that preserves retained custody.

The manifest is bounded data. It makes claims for inspection; it does not prove its own claims or cause installation.

## Host law

The receiving Marble must independently verify at least:

1. package identity, version, bounded paths, content hashes, and provenance;
2. topology identity conflicts and ownership of the proposed parent/door;
3. socket compatibility and the exact host implementation bound to each socket;
4. every tool's Ceiling identity, schema, effect class, and approval class;
5. a complete Gateway handler set with no undeclared handlers;
6. Scrub behavior and durable success, refusal, partial-failure, and approval custody;
7. migrations, retained state, disable behavior, and removal consequences; and
8. an explicit human or governing-policy admission decision.

Installation must eventually be one fail-closed transaction or a recoverable staged protocol with exact receipts. Copying files into a directory is never sufficient.

## Marketplace boundary

A future Marble market may index, search, purchase or transfer, cache, and update room packages. It may publish compatibility and provenance evidence. It cannot grant runtime authority inside a Marble.

Market-facing security work must define publisher identity, signatures, reproducible package hashes, dependency locking, vulnerability response, revocation, update consent, license terms, privacy disclosures, and malicious-package review before remote packages are treated as suitable for installation. Popularity, payment, curation, or a marketplace badge is not authority.

## Reference installation

`room.workshop` is the first standing reference manifest. Its declared affordances must equal the installed Workshop names in the Ceiling, `room.workshop` mount profile, and Gateway registry. Every socket and custody route remains host-owned. The current Hub still composes these crossings statically; the manifest detects drift but does not drive runtime installation.

The host produces `room-installation-witness.v1` from the exact manifest bytes and independently inspected installed surfaces. The witness includes topology, parent containment, entrance, fixtures, schema hashes, Ceiling and mounting presence, Gateway handlers, approval classes, socket bindings, and custody bindings. It has a deterministic hash and is verified only when `gaps` is empty. Required missing wires fail verification; declared optional Forest Wild wiring may remain honestly `optional_unwired`.

The bounded Builder World inspection exposes this witness. The installation-receipt boundary binds an exact verified witness to one exact World event, package and manifest hashes, host bindings, an admission statement, and installation time. Workshop predates this boundary, so its receipt honestly records `inherited_pre_boundary` and `admission.status: not_recorded`; it does not invent a historical admission decision. A future room installed after the boundary must use `forward_installation` and record the actual host admission. The receipt journal witnesses history; it does not yet perform installation or make multi-surface wiring transactional.

The Spotlight capsule remains an experiment. Its `room-capsule.v1` laboratory contract proves inert discovery and activation for observational code; it is not silently promoted to this production contract. Adoption requires an explicit migration once the production host exists.

## Deferred installation machinery

- a standard package archive and dependency format;
- a trusted room directory and inert discovery service;
- content/signature verification and provenance receipts;
- generic admission plus disable, update, rollback, and uninstall journals;
- generic World topology and door composition;
- dynamic Ceiling, schema, Patch Bay, and Gateway registration;
- socket negotiation and capability adapters;
- state migrations and orphaned-custody presentation;
- place packages containing multiple rooms; and
- marketplace transport, accounts, payments, ratings, and publishing.
