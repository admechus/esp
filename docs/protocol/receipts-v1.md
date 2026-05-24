# Receipts v1

## Status

Current runtime receipt models used by agent and relay.

Source of truth today:

- `agent/src/protocol/receipts.js`
- agent-side receipt handling in `agent/src/runtime/agentRuntime.js`

## Delivery receipt

Status:

- `accepted_remote`

Shape:

```json
{
  "receiptId": "receipt:....",
  "messageId": "....",
  "envelopeId": "....",
  "senderKeyId": "p256:....",
  "receiverAgent": "receiver",
  "sourceAgent": "sender",
  "relayName": "gateway-alpha",
  "status": "accepted_remote",
  "acceptedAt": "2026-05-24T00:00:00.000Z"
}
```

## Read receipt

Status:

- `read_remote`

Shape:

```json
{
  "receiptId": "receipt:....",
  "messageId": "....",
  "envelopeId": "....",
  "senderKeyId": "p256:....",
  "receiverAgent": "receiver",
  "sourceAgent": "sender",
  "relayName": "gateway-alpha",
  "status": "read_remote",
  "readAt": "2026-05-24T00:00:00.000Z"
}
```

## Relay receipt

Status:

- `forwarded`

Shape:

```json
{
  "relayReceiptId": "relay:....",
  "transferId": "transfer:....",
  "targetAgent": "receiver",
  "targetUrl": "http://127.0.0.1:8788",
  "sourceAgent": "sender",
  "messageCount": 1,
  "receivedAt": "2026-05-24T00:00:00.000Z",
  "status": "forwarded"
}
```

## Receipt ID derivation

### Delivery and read receipts

`receiptId` is derived from a SHA-256 hash over this pipe-delimited material:

- `messageId`
- `envelopeId`
- `senderKeyId`
- `receiverAgent`
- `sourceAgent`
- `relayName`
- `status`

The stored form is:

- `receipt:` + first 32 hex chars of the digest

### Relay receipts

`relayReceiptId` is derived from a SHA-256 hash over:

- `transferId`
- `targetAgent`
- `targetUrl`
- `sourceAgent`
- `messageCount`
- `receivedAt`

The stored form is:

- `relay:` + first 32 hex chars of the digest

## Sender outbox status updates

When the agent accepts a receipt:

- `accepted_remote` upgrades outbox status to `delivered_remote_ack`
- `read_remote` upgrades outbox status to `read_remote`

Additional fields are updated as applicable:

- `deliveryReceiptId`
- `deliveryAcceptedAt`
- `readReceiptId`
- `readAt`
- `relayReceiptId`
- `remoteAgent`
- `deliverySource`

## Current behavior notes

- Relay can forward receipts back to the sender-side agent.
- Receiver can create a read receipt when a message is marked as read.
- Receipt handling is stateful on the agent side, not in the UI.
