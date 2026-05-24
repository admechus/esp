# Task 0001: Transport Abstraction

## Goal

Introduce a transport abstraction without breaking current working flows.

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

## Initial adapters

- `local-http-agent`
- `local-http-relay`
- `file-bundle`

## Future adapters

- `yggdrasil-direct`
- `tcp-direct`
- `serial-bridge`
- `lora-bridge`
- `ble-bridge`

## Suggested implementation order

1. Add JSDoc-only adapter contract and transport README.
2. Wrap current direct agent HTTP delivery in a `local-http-agent` adapter.
3. Wrap current relay delivery and pull recovery in a `local-http-relay` adapter.
4. Wrap current file export and import path in a `file-bundle` adapter.
5. Move runtime delivery selection behind a small adapter registry.

## Acceptance shape

- Existing delivery flow still works.
- Existing envelope verification behavior is unchanged.
- Existing relay behavior is unchanged.
- Runtime depends on transport interface instead of transport-specific branching.
