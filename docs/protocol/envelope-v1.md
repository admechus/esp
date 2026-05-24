# Envelope v1

## Status

Current runtime format used by the agent.

Source of truth today:

- `agent/src/protocol/envelopes.js`

## Shape

```json
{
  "version": 1,
  "kind": "signed-envelope",
  "algorithm": "ES256",
  "curve": "P-256",
  "createdAt": "2026-05-24T00:00:00.000Z",
  "nonceHex": "16-byte-random-hex",
  "sender": {
    "keyId": "p256:...",
    "fingerprintHex": "....",
    "publicKeyBase64": "...."
  },
  "recipient": {
    "keyId": "p256:..."
  },
  "payload": {
    "type": "text/plain",
    "encoding": "utf8",
    "bodyBase64": "...."
  },
  "signatureBase64": "...."
}
```

## Fields

- `version`: currently `1`
- `kind`: currently `signed-envelope`
- `algorithm`: currently `ES256`
- `curve`: currently `P-256`
- `createdAt`: ISO timestamp when the unsigned envelope is created
- `nonceHex`: 16 random bytes encoded as hex
- `sender`: sender identity metadata
- `recipient`: currently either `null` or `{ keyId }`
- `payload`: signed payload object
- `signatureBase64`: ES256 signature returned by device signing flow

## Canonical signing bytes

Signing bytes are the UTF-8 bytes of canonical JSON over the unsigned envelope fields:

- `version`
- `kind`
- `algorithm`
- `curve`
- `createdAt`
- `nonceHex`
- `sender`
- `recipient`
- `payload`

The runtime uses `canonicalStringify(...)` before signing or verification.

## Envelope ID derivation

`envelopeId` is not stored in the envelope body itself.

It is derived as:

1. pick the signed envelope fields:
   - unsigned envelope fields above
   - plus `signatureBase64`
2. canonical JSON encode them
3. SHA-256 hash the UTF-8 bytes
4. hex encode the full digest

## Verification

Verification currently checks:

- ES256 signature validity against `sender.publicKeyBase64`
- derived `keyId`
- derived `fingerprintHex`
- whether those derived values match the embedded sender metadata

## Current limitation

Payload is signed but not encrypted.

Today the payload for text messages is:

- `type = text/plain`
- `encoding = utf8`
- `bodyBase64 = base64(utf8 text)`
