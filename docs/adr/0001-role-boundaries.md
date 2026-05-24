# ADR 0001: Role Boundaries

- Status: Accepted
- Date: 2026-05-24

## Context

The current prototype already has working firmware identities, agent-side state, relay delivery, and a unified operator shell. Before adding new transports such as Yggdrasil, LoRa, serial bridges, or mesh, the system needs explicit module boundaries so new work does not leak responsibilities across layers.

## Decision

### Firmware

Firmware:

- owns hardware identity
- owns persistent hardware secrets
- signs approved payload hashes
- exposes device and platform I/O
- may keep learned hardware configuration that is local to the node
- must not own global routing
- must not own UI state
- must not own relay policy

### Agent

Agent:

- owns peer store
- owns inbox, outbox, and receipt state
- owns envelope creation and verification
- owns local device communication
- owns local delivery state transitions
- must use transport abstractions for delivery
- must not expose root secret material to UI or relay

### Relay or Gateway

Relay or gateway:

- owns forwarding
- owns queue, retry, and pull recovery
- owns route metadata
- owns relay transfer records
- must treat envelopes as opaque artifacts where possible
- must not inspect chat plaintext
- must not mutate envelope payloads

### Unified Shell

Unified shell:

- owns operator UI
- owns diagnostics
- owns lifecycle and reconciliation controls
- may aggregate agent, relay, discovery, and hardware views
- must not contain crypto implementation
- must not contain concrete transport implementation
- must call agent and relay APIs instead of duplicating business logic

## Consequences

- New transport work should land under a transport abstraction instead of being hard-wired into UI or relay policy.
- Firmware can evolve hardware discovery independently from message transport.
- Relay remains replaceable because it does not depend on conversation UI or plaintext semantics.
- Unified shell remains an orchestration surface, not a second runtime.
