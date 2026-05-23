# Milestone 01

## Objective

Turn the `LilyGO T-Dongle-S3` into a minimal USB identity token for a local messenger agent.

## Deliverables

### Firmware

- bootable firmware project for `ESP32-S3`
- USB serial command loop
- command: `PING`
- command: `GET_INFO`
- command: `GEN_IDENTITY`
- command: `GET_PUBLIC_ID`
- command: `SIGN_BYTES`

### PC agent

- port discovery
- dongle handshake
- human-readable device info
- request public identity
- request signature for test payload

## Minimal Protocol Shape

Transport can start simple:

- line-delimited JSON over USB serial

Example request:

```json
{"id":1,"cmd":"PING"}
```

Example response:

```json
{"id":1,"ok":true,"result":"PONG"}
```

This is not the final protocol. It is chosen because it is easy to debug with serial tools.

## Success Criteria

Milestone 1 is complete when:

- the host can find the dongle
- the dongle can generate an identity once
- the identity survives reboot
- the host can fetch the public identity
- the host can verify a signature produced by the dongle

Current implementation status:

- complete on `T-Dongle-S3`
- identity is stored in `NVS`
- signatures are `ES256 / P-256`
- public identity includes `publicKeyBase64`, `fingerprintHex`, and `keyId`

## Out Of Scope

- chat UI
- peer-to-peer messaging
- remote transport
- local ESP mesh
- recovery and migration

## Immediate Next Task

Define the first signed message envelope and add a small peer store in the PC agent.
