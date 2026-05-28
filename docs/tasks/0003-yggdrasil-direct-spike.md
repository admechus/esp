# Task 0003: Yggdrasil Direct Transport Spike

## Goal

Keep a low-risk experimental scaffold for future direct peer delivery over Yggdrasil IPv6.

## Current Scope

- adapter file exists at `agent/src/transport/yggdrasilDirectTransport.js`
- follows the normalized `TransportSendResult` contract
- exposes descriptive `TransportMetadata`
- reuses shared transport URL and transport error helpers
- uses the same HTTP-style `/transport/accept-bundle` spike path as a transport contract scaffold
- is intentionally not wired into `agentRuntime.js`

## What Is Real Now

- a direct-send transport adapter contract exists
- the adapter can normalize send results
- the adapter has a descriptive metadata passport
- the adapter can appear in diagnostics-only registries without being wired into runtime delivery
- the adapter can be listed by read-only transport diagnostics helpers in test-only registries
- the adapter can be smoke-tested locally without Yggdrasil installed

## What Is Not Implemented Yet

- no real Yggdrasil interface detection
- no Yggdrasil-specific discovery
- no routing policy
- no fallback behavior
- no direct runtime integration
- no encryption or session changes
- no mesh behavior

## Next Safe Steps

- keep the adapter isolated until transport abstraction is further stabilized
- only integrate it after direct runtime contract adoption is mature
- add real Yggdrasil networking behavior only when installation, addressing, and operational expectations are explicitly defined
