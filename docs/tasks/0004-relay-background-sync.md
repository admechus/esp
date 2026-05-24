# Task 0004: Relay Background Sync

## Goal

Move relay queue recovery from mostly manual or timer-local behavior toward a more explicit background sync policy.

## Current state

- relay already queues bundles
- agent can pull queued work
- auto sync exists at the agent level

## Roadmap

1. separate sync policy from agent HTTP server startup
2. expose relay queue health more clearly
3. make retry and pull policy transport-aware
4. add backoff and visibility into failed queue pulls
5. integrate policy into managed lifecycle views
