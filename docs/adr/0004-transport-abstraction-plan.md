# ADR 0004: Transport Abstraction Plan

- Status: Accepted
- Date: 2026-05-24

## Context

`agentRuntime.js` currently performs direct HTTP delivery, relay delivery, transport bundle export and import, and relay pull recovery itself. That is acceptable for the current prototype, but future transports need a stable integration point.

## Decision

Introduce a `TransportAdapter` abstraction in stages.

Stage 1:

- document the interface
- allow harmless interface skeletons
- do not deeply refactor working delivery paths yet

Planned shape:

- `id`
- `kind`
- `capabilities`
- `health()`
- `sendBundle({ target, bundle, options })`
- `acceptBundle({ bundle, metadata })`
- `pullQueued({ target })`
- `listRoutes()`
- `listQueue()`

Initial adapters:

- `local-http-agent`
- `local-http-relay`
- `file-bundle`

Planned future adapters:

- `yggdrasil-direct`
- `tcp-direct`
- `serial-bridge`
- `lora-bridge`
- `ble-bridge`

## Consequences

- The current HTTP relay flow stays untouched in Stage 1.
- Agent runtime can later move delivery code behind adapters without changing envelope semantics.
- File export and relay delivery become two implementations of the same transport-level contract rather than unrelated features.
