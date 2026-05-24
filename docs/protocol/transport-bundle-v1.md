# Transport Bundle v1

## Status

Current runtime transport carrier used by the agent and relay.

Source of truth today:

- `agent/src/protocol/transportBundles.js`

## Shape

```json
{
  "version": 1,
  "kind": "transport-bundle",
  "createdAt": "2026-05-24T00:00:00.000Z",
  "source": {
    "agentName": "sender"
  },
  "messageCount": 1,
  "messages": [
    {
      "messageId": "....",
      "envelopeId": "....",
      "envelope": {}
    }
  ]
}
```

## Fields

- `version`: currently `1`
- `kind`: currently `transport-bundle`
- `createdAt`: bundle creation timestamp
- `source`: source metadata chosen by the exporting runtime
- `messageCount`: number of entries in `messages`
- `messages`: array of bundled message records

## Validation

Current validation is intentionally light:

- `kind` must equal `transport-bundle`
- `messages` must be an array

## Current uses

Transport bundle v1 is used for:

- outbox export to JSON files
- import from bundle files
- direct HTTP delivery to another local agent
- HTTP delivery through relay
- relay queueing and later pull recovery

## Notes

Bundle is a transport object, not a cryptographic object.

The envelope inside the bundle remains the signed protocol artifact.
