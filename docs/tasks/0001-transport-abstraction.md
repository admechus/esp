# Task 0001: Transport Abstraction

## Goal

Introduce a transport abstraction without breaking current working flows.

## Current status

Completed:

- Stage 1 docs completed
- Phase 1 adapter wrappers completed
- Phase 1.5 helper stabilization completed
- Phase 2 response mapping cleanup and registry-first transport selection completed
- Phase 3 transport result contract stabilization completed

Current adapter modules in the codebase:

- `local-http-agent`
- `local-http-relay`
- `file-bundle`
- `yggdrasil-direct` (experimental scaffold, not wired into runtime)
- `transportRegistry`
- shared helper modules:
  - `transportUrl`
  - `transportErrors`
  - `transportAdapter` result contracts and shape assertions
  - descriptive transport metadata passports

Still intentionally owned by `agentRuntime.js`:

- envelope creation and verification
- inbox, outbox, and receipt state
- transport bundle assembly
- receipt acceptance and outbox status transitions
- business interpretation of normalized transport results into runtime state and return shapes

## Constraints

- Do not remove current CLI commands.
- Do not remove existing HTTP endpoints.
- Do not change current ES256 and P-256 identity flow.
- Do not deeply refactor direct HTTP delivery yet.

## Proposed interface

`TransportAdapter`

- `id`
- `kind`
- `capabilities`
- `health()`
- `sendBundle({ target, bundle, options })`
- `acceptBundle({ bundle, metadata })`
- `pullQueued({ target })`
- `listRoutes()`
- `listQueue()`

Normalized transport result contracts:

- `TransportSendResult`
- `TransportPullResult`
- `TransportFileResult`
- `TransportHealthResult`

## Initial adapters

- `local-http-agent`
- `local-http-relay`
- `file-bundle`

## Future adapters

- `tcp-direct`
- `serial-bridge`
- `lora-bridge`
- `ble-bridge`

## Experimental transport spikes

- `yggdrasil-direct`
  - current state: HTTP-over-URL transport scaffold only
  - not integrated into `agentRuntime.js`
  - no routing, discovery, fallback, or real Yggdrasil-specific networking behavior yet
  - metadata passport is present, but descriptive only

## Suggested implementation order

Completed:

1. Add JSDoc-only adapter contract and transport README.
2. Wrap current direct agent HTTP delivery in a `local-http-agent` adapter.
3. Wrap current relay delivery and pull recovery in a `local-http-relay` adapter.
4. Wrap current file export and import path in a `file-bundle` adapter.
5. Add a small adapter registry for runtime selection.
6. Stabilize shared transport URL and transport error helpers.
7. Move transport-level response mapping into adapters where safe.
8. Reduce direct runtime knowledge of raw transport payload shapes.
9. Use adapter registry as the explicit runtime lookup path.
10. Stabilize normalized transport result contracts and validate them in smoke tests.

## Next remaining phase

The next deeper phase should focus on:

- using the normalized adapter result contracts more consistently across runtime call sites
- deciding whether low-risk route and queue listing contracts should be normalized in the same style
- continuing runtime decoupling only where transport and business boundaries remain clear

This phase should still avoid:

- rewriting relay behavior
- changing protocol formats
- moving business-state ownership out of `agentRuntime.js`
- introducing future transports such as Yggdrasil, LoRa, BLE, or TCP direct

## What remains

The next deeper phase should focus on:

- broader adapter contract adoption
- optional normalization of route and queue listing results
- deeper runtime decoupling from transport details where that does not blur business ownership

## Acceptance shape

- Existing delivery flow still works.
- Existing envelope verification behavior is unchanged.
- Existing relay behavior is unchanged.
- Runtime depends on transport interface instead of transport-specific branching.
