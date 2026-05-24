# ADR 0003: Relay Opacity

- Status: Accepted
- Date: 2026-05-24

## Context

The relay already supports forwarding, queueing, pull recovery, route metadata, transfer records, and receipt forwarding. Future transports and swarm work will become harder if relay logic starts depending on UI-specific or payload-specific knowledge.

## Decision

Relay should remain as opaque as practical.

Relay may route and manage queue state using:

- `targetAgent`
- route label or route name
- target URL
- target key ID when supplied in higher-level metadata
- `queueId`
- `transferId`
- timestamps
- delivery status
- message count
- source agent metadata

Relay should not depend on:

- payload text
- UI conversation state
- sender-side chat layout
- receiver-side rendering rules

Relay must not:

- inspect plaintext message bodies
- mutate envelope payloads
- rewrite signatures
- derive conversation state from message content

## Consequences

- Relay remains suitable for multiple transport adapters.
- UI and conversation logic stay in agent and shell layers.
- Future encrypted payload work will not require major relay redesign.
