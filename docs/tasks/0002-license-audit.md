# Task 0002: License Audit

## Goal

Keep the repository legally clean as dependencies and integrations grow.

## Audit Rules

- repeat the license audit after major dependency additions
- check future crypto libraries carefully before adoption
- check future Yggdrasil, mesh, and related transport integrations carefully before adoption
- avoid copy-pasted code without attribution
- avoid GPL or AGPL contamination unless that is an explicit project decision

## Review Triggers

Run or refresh the audit when:

- new npm packages are added
- new ESP-IDF or Arduino libraries are added
- copied or adapted code enters the repository
- transport integrations pull in outside implementations
- licensing terms change for existing dependencies

## Output

When the audit is repeated, update:

- `docs/legal/third-party-notices.md`
- relevant ADR or task notes if licensing affects architecture choices
