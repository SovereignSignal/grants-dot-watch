# Remaining Registry Coverage

Date: 2026-07-15 PDT

## Current State

The semantic cleanup queue is clear. `npm run audit:programs` reports zero semantic candidates
and zero unreferenced semantic candidates across 684 programs.

The remaining gaps are source coverage, not known structural defects:

| Coverage field | Programs missing it |
| --- | ---: |
| Confirmed status | 395 |
| Dated or explicit rounds | 441 |
| Mechanism | 373 |
| System classification | 545 |

## Working Rule

Do not fill these fields through inference or bulk defaults. A record should gain a status,
round, mechanism, or system only when a primary source supports it. The strict validator,
semantic audit, and owner-gated Desk remain the controls for every change.

The July 11 owner queue is a historical snapshot. It must be reconciled against the live Desk
and current sources before any remaining proposal is approved. Stale queue text is not an
instruction to mutate the registry.

## Completion Boundary

Engineering cleanup is complete when the validator, semantic audit, unit tests, browser tests,
typecheck, build, GitHub CI, and production smoke checks pass. Registry enrichment continues as
new evidence arrives and is not a finite launch blocker.
