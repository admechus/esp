# Dongle Firmware

This target is for the `identity` profile, starting with the `LilyGO T-Dongle-S3`.

## First Responsibilities

- boot
- expose a USB serial command loop
- generate and persist identity
- answer `PING`
- answer `GET_INFO`
- expose public identity
- sign payloads on request

## Later Responsibilities

- encrypted backup export
- approval workflows
- secure unlock state
- user-presence checks

## Current Status

The first firmware increment implements:

- `USB Serial/JTAG` transport for `ESP32-S3`
- line-delimited JSON requests
- `PING`
- `GET_INFO`
- `GEN_IDENTITY`
- `GET_PUBLIC_ID`
- `SIGN_BYTES`
- `SIGN_HASH`

The current token behavior is:

- generate a persistent `ES256 / P-256` identity in `NVS`
- expose `publicKeyBase64`, `fingerprintHex`, and `keyId`
- sign raw payload bytes for small debugging flows
- sign `SHA-256` digests for higher-level envelope flows
