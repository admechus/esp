# Task 0005: Runtime State and Recovery Audit

## Goal

Audit runtime state persistence, restart behavior, duplicate handling, and
recovery observability before introducing additional real transport trials.

## Runtime State Inventory

Persisted agent runtime state:

- `peers.json`
  - peer identity records
  - labels, roles, and imported identity metadata
- `inbox.json`
  - accepted inbound or self-addressed message records
  - envelope payloads and read markers
- `outbox-log.json`
  - locally created outbound message records
  - delivery status progression and bundle export metadata
- `receipts.json`
  - accepted delivery receipts
  - accepted read receipts
- `identity-cache.json`
  - cached local identity summary
- `device-info-cache.json`
  - cached device info snapshot
- `platform-io-cache.json`
  - cached platform IO snapshot
- `outbox/`
  - saved envelope artifacts
- `transfers/`
  - exported transport bundle artifacts

Current path-resolution finding:

- default agent state root is derived from the current working directory
- when the CLI is launched from the repository root, the default path resolves
  differently than when it is launched from `agent/`
- this behavior is currently observable and stable, but should be treated as a
  future runtime-maturity cleanup candidate rather than changed silently here

Persisted relay-side state:

- `relay-queue.json`
  - queued relay bundles awaiting retry or pull recovery
- `relay-transfers.json`
  - completed relay transfer history

Derived state:

- inbox, outbox, peer, and receipt counts
- transport diagnostics summaries
- runtime profile validation summaries
- UI-oriented conversation filtering or summaries built on stored records

Transient state:

- loaded runtime profile objects
- merged CLI plus profile execution options
- transport registry instances
- serial command queue in memory
- HTTP server instances and bound ports
- manual health-check results

## Restart Recovery Findings

What survives restart:

- all JSON-backed agent stores
- cached identity, device info, and platform IO files
- saved envelope artifacts and saved transport bundle artifacts
- relay queue and relay transfer history in the relay process state dir

What is rebuilt on restart:

- runtime object instances
- transport registry
- diagnostics summaries and counts
- profile validation output, when a profile is loaded manually again

What is intentionally lost on restart:

- active CLI argument state
- manual profile selection unless passed again
- in-memory serial command queue
- temporary health-check results
- live process bindings and HTTP listeners

## Delivery and Duplicate Handling Findings

Queued relay delivery:

- relay queue entries are persisted in `relay-queue.json`
- pull recovery consumes pending entries and marks them delivered or failed
- failed retries remain queued with `lastError` and updated attempt metadata

Receipt processing:

- receipt IDs are deterministic for accepted and read receipts
- receipt store uses `upsertReceipt()` by `receiptId`
- duplicate receipt processing updates one record instead of multiplying entries

Bundle import:

- inbox messages are keyed by `messageId`
- receipt creation for imported bundles is deterministic for the same
  sender/receiver/source/status tuple
- duplicate bundle import updates existing message and receipt records rather
  than creating additional copies

Replay tolerance today:

- tolerance is based on deterministic IDs plus upsert behavior
- no separate replay ledger exists yet
- no automatic repair or cleanup is performed

## Observability Added

Read-only runtime state diagnostics now expose:

- peer count
- inbox count
- outbox count
- receipt count
- saved artifact counts for `outbox/` and `transfers/`
- cache file presence

CLI visibility:

- `node src/cli.js runtime-state`

This command is diagnostics only.
It does not mutate state, repair state, or trigger delivery actions.

## Summary

The current runtime state model is simple but reasonably restart-tolerant:

- persisted stores survive restart cleanly
- duplicate receipts are idempotent at the store level
- duplicate bundle imports are idempotent at the store level
- relay recovery persists queue state separately from agent runtime state

What still remains intentionally manual:

- profile selection
- health checks
- relay pull recovery
- queue cleanup
- any future repair or replay policy
