# Task 0002: Session Layer Roadmap

## Goal

Plan the future sealed message layer without changing the current signed-envelope workflow yet.

## Current state

- text payload is signed
- payload is not encrypted
- relay and bundle flow already work over signed envelopes

## Roadmap

1. Define session establishment metadata.
2. Decide whether session setup stays device-assisted or host-side after identity approval.
3. Introduce sealed payload format without changing transport bundle semantics.
4. Preserve receipt semantics while hiding plaintext from relay.
5. Keep envelope-before-transport boundary intact.

## Non-goals for Stage 1

- no transport rewrite
- no Yggdrasil integration
- no LoRa integration
- no production session ratchet yet
