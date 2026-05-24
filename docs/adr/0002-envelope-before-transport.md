# ADR 0002: Envelope Before Transport

- Status: Accepted
- Date: 2026-05-24

## Context

The prototype already has working signed envelopes, transport bundles, direct HTTP delivery, relay delivery, file export and import, and receipt propagation. Future work will add more transport types, but that should not change the protocol object that represents a user message.

## Decision

Signed or sealed envelopes are protocol objects.

Transport layers are carrier objects.

Current protocol object:

- envelope v1

Current transport objects:

- local HTTP delivery to agent endpoints
- local HTTP delivery through relay endpoints
- file-based transport bundle export and import

Planned future transport objects:

- Yggdrasil direct transport
- LoRa bridge transport
- TCP direct transport
- serial bridge transport
- BLE bridge transport

The system must create and verify envelopes before transport-specific delivery logic runs.

Transport-specific code may:

- move an envelope
- queue an envelope
- retry an envelope
- batch envelopes into a transport bundle

Transport-specific code must not redefine:

- envelope identity
- envelope signing bytes
- envelope verification behavior

## Consequences

- Envelope format can stay stable while delivery mechanisms change.
- Relay and future bridge code can operate on bundles and metadata rather than plaintext chat semantics.
- Transport adapters can be introduced incrementally without reworking identity or signing flow.
